"use client";

import { useState, useEffect, useRef, useCallback, createContext, useContext } from "react";
import dynamic                                       from "next/dynamic";
import { uploadPhoto }                               from "@/lib/supabase";
import { supabase, signInWithGoogle, sendPhoneOTP, verifyPhoneOTP, signOut } from "@/lib/supabase-auth";

const MapView = dynamic(() => import("@/components/public/MapView"), {
  ssr:     false,
  loading: () => (
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100%",color:"#555",fontSize:13,gap:8}}>
      <div style={{width:16,height:16,border:"2px solid #1e1e1e",borderTopColor:"#EF4444",borderRadius:"50%",animation:"spin .8s linear infinite"}}/>
      Loading map…
    </div>
  ),
});

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const H = [
  { key:"POTHOLE",      e:"🕳️", label:"Pothole"      },
  { key:"FLOOD",        e:"🌊", label:"Flood"        },
  { key:"ACCIDENT",     e:"🚗", label:"Accident"     },
  { key:"DEBRIS",       e:"🪨", label:"Debris"       },
  { key:"BROKEN_LIGHT", e:"🚦", label:"Broken Light" },
  { key:"ROAD_BLOCK",   e:"🚧", label:"Road Block"   },
  { key:"OTHER",        e:"⚠️", label:"Other"        },
];
const hMeta = (k: string) => H.find(x => x.key === k) || H[6];

const SEVS = [
  { key:"LOW",      emoji:"🟢", label:"Minor",     desc:"Small inconvenience, still driveable" },
  { key:"MEDIUM",   emoji:"🟡", label:"Moderate",  desc:"Slow down, drive carefully"           },
  { key:"HIGH",     emoji:"🟠", label:"Dangerous", desc:"Avoid if possible"                    },
  { key:"CRITICAL", emoji:"🔴", label:"Critical",  desc:"Road may be fully blocked"            },
];

const SC: Record<string,string> = { CRITICAL:"#EF4444", HIGH:"#ccc", MEDIUM:"#777", LOW:"#444" };
const SO: Record<string,number> = { CRITICAL:0, HIGH:1, MEDIUM:2, LOW:3 };

const SEV_LABEL: Record<string,string> = { LOW:"Minor", MEDIUM:"Moderate", HIGH:"Dangerous", CRITICAL:"Critical" };

const ST_LABEL: Record<string,string> = {
  PENDING:"Awaiting review", VERIFIED:"Verified",
  IN_REVIEW:"Under review",  RESOLVED:"Fixed",   DISMISSED:"Dismissed",
};

const A_TYPE: Record<string,{color:string;bg:string;border:string;icon:string}> = {
  INFO:         { color:"#60A5FA", bg:"rgba(96,165,250,0.08)",   border:"rgba(96,165,250,0.2)",  icon:"ℹ️" },
  WARNING:      { color:"#F59E0B", bg:"rgba(245,158,11,0.08)",   border:"rgba(245,158,11,0.22)", icon:"⚠️" },
  ROAD_CLOSURE: { color:"#EF4444", bg:"rgba(239,68,68,0.08)",    border:"rgba(239,68,68,0.2)",   icon:"🚫" },
  MAINTENANCE:  { color:"#A78BFA", bg:"rgba(167,139,250,0.08)",  border:"rgba(167,139,250,0.2)", icon:"🔧" },
  EMERGENCY:    { color:"#EF4444", bg:"rgba(239,68,68,0.10)",    border:"rgba(239,68,68,0.3)",   icon:"🚨" },
};

const FORM_STR = {
  EN: {
    step1:"What did you see?", step2:"How bad is it?",
    step3:"Add a photo",       step4:"Ready to submit?",
    photoTip:"Photo → goes live instantly · No photo → waits for admin review",
    takePhoto:"Take Photo",    skip:"Skip — no photo",
    submit:"Submit Report",    submitting:"Submitting…",
    voiceTip:"Hold to describe in any language",
  },
  TW: {
    step1:"Hwɛ biribi a wohu?", step2:"Ɛyɛ den sɛn?",
    step3:"Fa foto",            step4:"Wo ho di?",
    photoTip:"Foto → kɔ live ntɛm · Foto nni hɔ → wɔbɛhwɛ ansa",
    takePhoto:"Fa Foto",        skip:"Twɛn",
    submit:"Soma",              submitting:"Ɛresoma…",
    voiceTip:"Twe wo nan kɔ ho na kasa",
  },
} as const;
type Lang = keyof typeof FORM_STR;

// ─── THEME ────────────────────────────────────────────────────────────────────
const DARK = {
  bg:"#0A0A0A", bg2:"#0D0D0D", bg3:"#111",
  b1:"#1a1a1a", b2:"#111",
  t1:"#fff", t2:"#888", t3:"#555", t4:"#333",
  nav:"rgba(8,8,8,0.97)", navBorder:"#111",
  pa:"#fff", pat:"#000", pi:"#111", pit:"#555", pib:"#1e1e1e",
  sl:"#444", sl2:"#333",
  rpBg:"#111", rpBorder:"#2a2a2a", rpText:"#555",
  inputBg:"#0D0D0D", inputBorder:"#1a1a1a", inputText:"#ccc",
} as const;
const LITE = {
  bg:"#F9F9F9", bg2:"#FFFFFF", bg3:"#F5F5F5",
  b1:"#F0F0F0", b2:"#F0F0F0",
  t1:"#1E1E1E", t2:"#666", t3:"#ABABAB", t4:"#C0C0C0",
  nav:"#FFFFFF", navBorder:"#F0F0F0",
  pa:"#1E1E1E", pat:"#FFF", pi:"#F0F0F0", pit:"#888", pib:"transparent",
  sl:"#1A1A1A", sl2:"#ABABAB",
  rpBg:"#F0F0F0", rpBorder:"#E0E0E0", rpText:"#888",
  inputBg:"#F5F5F5", inputBorder:"#E8E8E8", inputText:"#1E1E1E",
} as const;
type Th = { [K in keyof typeof DARK]: string };
const ThCtx = createContext<Th>(DARK as Th);
const useTh = () => useContext(ThCtx);

// ─── UTILS ────────────────────────────────────────────────────────────────────
function ago(iso: string) {
  const d = Math.floor((Date.now()-new Date(iso).getTime())/1000);
  if (d<60)    return "just now";
  if (d<3600)  return `${Math.floor(d/60)}m ago`;
  if (d<86400) return `${Math.floor(d/3600)}h ago`;
  return       `${Math.floor(d/86400)}d ago`;
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
function fmtDist(km: number) {
  return km < 1 ? `${Math.round(km*1000)}m` : `${km.toFixed(1)}km`;
}

async function revGeo(lat: number, lng: number): Promise<string|null> {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,{headers:{"Accept-Language":"en"}});
    const d = await r.json(); const a = d.address;
    return [a?.road||a?.pedestrian, a?.neighbourhood||a?.suburb||a?.town].filter(Boolean).slice(0,2).join(", ")||null;
  } catch { return null; }
}

function urlBase64ToUint8Array(base64: string) {
  const pad = "=".repeat((4 - base64.length % 4) % 4);
  const b64 = (base64 + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(b64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

// ─── HAZARD TYPE ICON ─────────────────────────────────────────────────────────
function HazardIcon({ k, size=26, color="#666" }: { k:string; size?:number; color?:string }) {
  const s = { stroke:color, strokeWidth:"1.3", strokeLinecap:"round" as const, strokeLinejoin:"round" as const, fill:"none" };
  const sv = (ch: React.ReactNode) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none">{ch}</svg>;
  switch(k) {
    case "POTHOLE": return sv(<>
      <ellipse cx="12" cy="15" rx="8" ry="3.5" {...s}/>
      <ellipse cx="12" cy="15" rx="3.5" ry="1.3" {...s}/>
      <path d="M8 11.5L6 7M16 11.5l2-4.5" {...s}/>
    </>);
    case "FLOOD": return sv(<>
      <path d="M3 9q3-3 6 0t6 0 6 0" {...s}/>
      <path d="M3 14q3-3 6 0t6 0 6 0" {...s}/>
      <path d="M3 19q3-3 6 0t6 0 6 0" {...s}/>
    </>);
    case "ACCIDENT": return sv(<>
      <path d="M2 14h5.5l1.5-4h6l1.5 4H22" {...s}/>
      <circle cx="7.5" cy="15.5" r="1.5" {...s}/>
      <circle cx="16.5" cy="15.5" r="1.5" {...s}/>
      <path d="M18.5 10l2-2M20 12h2M18.5 14l1.5 1.5" {...s}/>
    </>);
    case "DEBRIS": return sv(<>
      <path d="M5 18L9 8l3 5 3-6 4 11H5z" {...s}/>
      <path d="M3 18h18" {...s}/>
    </>);
    case "BROKEN_LIGHT": return sv(<>
      <rect x="8" y="2" width="8" height="14" rx="2" {...s}/>
      <circle cx="12" cy="6" r="1.5" fill={color} stroke="none"/>
      <circle cx="12" cy="10" r="1.5" {...s}/>
      <circle cx="12" cy="14" r="1.5" {...s}/>
      <path d="M10 19h4M12 16v3" {...s}/>
      <path d="M9 3l6 7M15 3L9 10" stroke={color} strokeWidth="1.4" strokeLinecap="round"/>
    </>);
    case "ROAD_BLOCK": return sv(<>
      <rect x="2" y="10" width="20" height="5" rx="1.5" {...s}/>
      <path d="M7 10l4 5M13 10l4 5" {...s}/>
      <path d="M2 15v3M12 15v3M22 15v3" {...s}/>
    </>);
    default: return sv(<>
      <circle cx="12" cy="12" r="9" {...s}/>
      <path d="M12 8c0-2 3-2 3 0s-3 2.5-3 4" {...s}/>
      <circle cx="12" cy="17" r="0.8" fill={color} stroke="none"/>
    </>);
  }
}

// ─── SKELETON ITEM ────────────────────────────────────────────────────────────
function SkeletonItem() {
  return (
    <div style={{display:"flex",alignItems:"center",gap:12,padding:"14px 0",borderBottom:"0.5px solid var(--hsep)"}}>
      <div style={{width:7,height:7,borderRadius:"50%",background:"var(--sk-dot)",flexShrink:0}}/>
      <div style={{flex:1}}>
        <div style={{height:12,width:"45%",borderRadius:4,background:"var(--sk-bar)",marginBottom:6,overflow:"hidden",position:"relative" as const}}>
          <div style={{position:"absolute" as const,inset:0,background:"linear-gradient(90deg,transparent 0%,rgba(128,128,128,0.08) 50%,transparent 100%)",backgroundSize:"200% 100%",animation:"shimmer 1.4s ease-in-out infinite"}}/>
        </div>
        <div style={{height:10,width:"65%",borderRadius:4,background:"var(--sk-bar2)",overflow:"hidden",position:"relative" as const}}>
          <div style={{position:"absolute" as const,inset:0,background:"linear-gradient(90deg,transparent 0%,rgba(128,128,128,0.08) 50%,transparent 100%)",backgroundSize:"200% 100%",animation:"shimmer 1.4s ease-in-out infinite"}}/>
        </div>
      </div>
    </div>
  );
}

// ─── TOAST NOTIFICATION ───────────────────────────────────────────────────────
function Toast({ msg, onDismiss }: { msg: string; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 4500);
    return () => clearTimeout(t);
  }, [onDismiss]);
  return (
    <div style={{
      position:"fixed" as const, top:64, left:12, right:12, zIndex:300,
      background:"rgba(8,8,8,0.97)", backdropFilter:"blur(20px)",
      border:"1px solid rgba(239,68,68,0.35)", borderLeft:"3px solid #EF4444",
      borderRadius:14, padding:"13px 14px",
      display:"flex", alignItems:"center", gap:10,
      animation:"slideDown .25s cubic-bezier(.32,.72,0,1)",
      boxShadow:"0 8px 40px rgba(0,0,0,0.7), 0 0 0 1px rgba(239,68,68,0.1)",
    }}>
      <div style={{width:8,height:8,borderRadius:"50%",background:"#EF4444",flexShrink:0,boxShadow:"0 0 8px #EF4444"}}/>
      <span style={{color:"#fff",fontSize:13,fontWeight:600,flex:1,lineHeight:1.4}}>{msg}</span>
      <button onClick={onDismiss} style={{background:"none",border:"none",color:"#444",fontSize:20,lineHeight:1,padding:"0 2px",flexShrink:0}}>×</button>
    </div>
  );
}

// ─── OFFLINE QUEUE ────────────────────────────────────────────────────────────
const QUEUE_KEY = "rw_offline_queue";
const getQueue  = (): any[] => {
  if (typeof window==="undefined") return [];
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY)||"[]"); } catch { return []; }
};
const saveQueue = (q: any[]) => localStorage.setItem(QUEUE_KEY, JSON.stringify(q));

// ─── VOICE BUTTON ─────────────────────────────────────────────────────────────
function VoiceButton({ onResult, tip }: { onResult:(r:any)=>void; tip:string }) {
  const [state,  setState]  = useState<"idle"|"recording"|"processing"|"denied">("idle");
  const [secs,   setSecs]   = useState(0);
  const mediaRef  = useRef<MediaRecorder|null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef  = useRef<ReturnType<typeof setInterval>|null>(null);

  const start = async (e:any) => {
    e.preventDefault(); if (state!=="idle") return;
    chunksRef.current=[];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({audio:true});
      const mime   = ["audio/webm;codecs=opus","audio/webm","audio/ogg"].find(t=>MediaRecorder.isTypeSupported(t))||"audio/webm";
      const rec    = new MediaRecorder(stream,{mimeType:mime});
      mediaRef.current=rec;
      rec.ondataavailable=e=>{if(e.data.size>0)chunksRef.current.push(e.data);};
      rec.onstop=async()=>{
        stream.getTracks().forEach(t=>t.stop());
        const blob=new Blob(chunksRef.current,{type:mime});
        const reader=new FileReader();
        reader.onload=async()=>{
          setState("processing");
          try {
            const res=await fetch("/api/transcribe",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({audio:reader.result,mimeType:mime})});
            const json=await res.json();
            if(json.success) onResult({...json.data,_mimeType:mime});
          } catch { /* silently degrade if transcription unavailable */ }
          setState("idle"); setSecs(0);
        };
        reader.readAsDataURL(blob);
      };
      rec.start(100); setState("recording");
      timerRef.current=setInterval(()=>setSecs(s=>s+1),1000);
    } catch { setState("denied"); }
  };
  const stop=(e:any)=>{
    e.preventDefault();
    if(state!=="recording") return;
    if(timerRef.current) clearInterval(timerRef.current);
    mediaRef.current?.stop();
  };

  if (state==="denied") return(
    <div style={{background:"rgba(239,68,68,0.05)",border:"1px solid rgba(239,68,68,0.15)",borderRadius:12,padding:"12px 14px",display:"flex",alignItems:"center",gap:8}}>
      <span style={{fontSize:16}}>🎙️</span>
      <div style={{color:"#999",fontSize:12}}>Mic denied — tap a type above instead</div>
    </div>
  );
  if (state==="processing") return(
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:8,padding:"14px",color:"#777",fontSize:13}}>
      <div style={{width:16,height:16,border:"2px solid #333",borderTopColor:"#EF4444",borderRadius:"50%",animation:"spin .8s linear infinite"}}/>
      Processing…
    </div>
  );
  return(
    <button onMouseDown={start} onTouchStart={start} onMouseUp={stop} onTouchEnd={stop}
      style={{width:"100%",background:state==="recording"?"rgba(239,68,68,0.10)":"#111",border:`1px solid ${state==="recording"?"rgba(239,68,68,0.35)":"#1e1e1e"}`,borderRadius:14,padding:"14px",fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",gap:8,color:state==="recording"?"#EF4444":"#777",fontSize:13,fontWeight:600,animation:state==="recording"?"recordPulse 1s ease-in-out infinite":"none"}}>
      <span style={{fontSize:18}}>{state==="recording"?"⏹":"🎙️"}</span>
      {state==="recording"?`Recording… ${secs}s — release to send`:tip}
    </button>
  );
}

// ─── REPORT FORM ──────────────────────────────────────────────────────────────
const STEP_ORDER = ["type","sev","photo","confirm"] as const;
type FormStep = typeof STEP_ORDER[number];

function ReportForm({ gps, onDone, lang, userId }: { gps:any; onDone:(r:any)=>void; lang:Lang; userId?:string }) {
  const [step,       setStep]       = useState<FormStep>("type");
  const [form,       setForm]       = useState({hazardType:"",severity:"",photoUrl:"",preview:""});
  const [uploading,  setUploading]  = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const t = FORM_STR[lang];

  const stepIdx = STEP_ORDER.indexOf(step);
  const go  = (s: FormStep) => setStep(s);
  const back = () => go(STEP_ORDER[Math.max(0, stepIdx-1)]);

  const pickType = (h: typeof H[number]) => { setForm(f=>({...f,hazardType:h.key})); go("sev"); };

  const handleVoice = (result:any) => {
    if (result.hazardType) {
      setForm(f=>({...f,hazardType:result.hazardType,severity:result.severity||""}));
      go(result.severity ? "photo" : "sev");
    }
  };

  const pickSev = (key:string) => { setForm(f=>({...f,severity:key})); go("photo"); };

  const pickPhoto = async (e:any) => {
    const file = e.target?.files?.[0];
    if (!file) { go("confirm"); return; }
    const preview = URL.createObjectURL(file);
    setForm(f=>({...f,preview}));
    setUploading(true);
    go("confirm");
    try {
      const url = await uploadPhoto(file);
      setForm(f=>({...f,photoUrl:url,preview:url}));
    } catch {
      setForm(f=>({...f,photoUrl:preview}));
    } finally { setUploading(false); }
  };

  const submit = async () => {
    setSubmitting(true);
    const payload = {
      latitude:   gps?.lat     || 5.6037,
      longitude:  gps?.lng     || -0.1870,
      address:    gps?.address || "Accra",
      hazardType: form.hazardType,
      severity:   form.severity || "MEDIUM",
      photoUrl:   form.photoUrl || null,
      reporter:   userId        || null,
    };
    const fallback = { id:`local-${Date.now()}`, createdAt:new Date().toISOString(), status:"PENDING", upvoteCount:1, ...payload };

    if (!navigator.onLine) {
      const q = getQueue(); q.push(payload); saveQueue(q);
      onDone({ ...fallback, _queued:true }); return;
    }

    try {
      const res  = await fetch("/api/reports",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
      const json = await res.json();
      if (json.success) { onDone(json.data); return; }
    } catch {
      const q = getQueue(); q.push(payload); saveQueue(q);
      onDone({ ...fallback, _queued:true }); return;
    }
    onDone(fallback);
  };

  const h   = hMeta(form.hazardType);
  const sev = SEVS.find(s=>s.key===form.severity);

  return(
    <div style={{display:"flex",flexDirection:"column" as const,height:"100%",background:"#0A0A0A"}}>
      {/* Progress bar */}
      <div style={{display:"flex",gap:4,padding:"10px 16px 0"}}>
        {STEP_ORDER.map((s,i)=>(
          <div key={s} style={{flex:1,height:3,borderRadius:2,background:i<=stepIdx?"#EF4444":"#1e1e1e",transition:"background .2s"}}/>
        ))}
      </div>

      <div style={{flex:1,overflowY:"auto" as const,padding:"16px 14px 24px"}}>

        {/* ── STEP 1: Hazard type ── */}
        {step==="type"&&(
          <div style={{animation:"fadeUp .15s ease"}}>
            <div style={{color:"#fff",fontWeight:800,fontSize:20,marginBottom:16,letterSpacing:-.3}}>{t.step1}</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:12}}>
              {H.map(hx=>(
                <button key={hx.key} onClick={()=>pickType(hx)}
                  style={{background:"#111",border:"1px solid #1e1e1e",borderRadius:14,padding:"18px 10px 16px",color:"#ccc",fontSize:13,fontWeight:600,fontFamily:"inherit",display:"flex",flexDirection:"column" as const,alignItems:"center",gap:10,transition:"border-color .15s,background .15s"}}>
                  <HazardIcon k={hx.key}/>
                  {hx.label}
                </button>
              ))}
            </div>
            <VoiceButton onResult={handleVoice} tip={t.voiceTip}/>
          </div>
        )}

        {/* ── STEP 2: Severity ── */}
        {step==="sev"&&(
          <div style={{animation:"fadeUp .15s ease"}}>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:20}}>
              <button onClick={back} style={{background:"#111",border:"1px solid #1e1e1e",borderRadius:10,width:34,height:34,display:"flex",alignItems:"center",justifyContent:"center",color:"#888",fontSize:18,flexShrink:0}}>←</button>
              <div>
                <div style={{color:"#777",fontSize:12,marginBottom:2}}>{h.e} {h.label}</div>
                <div style={{color:"#fff",fontWeight:800,fontSize:20,letterSpacing:-.3}}>{t.step2}</div>
              </div>
            </div>
            <div style={{display:"flex",flexDirection:"column" as const,gap:8}}>
              {SEVS.map(s=>(
                <button key={s.key} onClick={()=>pickSev(s.key)}
                  style={{background:"#111",border:"1px solid #1e1e1e",borderRadius:14,padding:"14px 16px",color:"#ccc",fontSize:14,fontWeight:600,fontFamily:"inherit",display:"flex",alignItems:"center",gap:12,textAlign:"left" as const}}>
                  <div style={{width:6,height:6,borderRadius:"50%",background:s.key==="CRITICAL"?"#EF4444":"#333",flexShrink:0}}/>
                  <div>
                    <div style={{fontWeight:700}}>{s.label}</div>
                    <div style={{color:"#555",fontSize:12,marginTop:2}}>{s.desc}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── STEP 3: Photo ── */}
        {step==="photo"&&(
          <div style={{animation:"fadeUp .15s ease"}}>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:20}}>
              <button onClick={back} style={{background:"#111",border:"1px solid #1e1e1e",borderRadius:10,width:34,height:34,display:"flex",alignItems:"center",justifyContent:"center",color:"#888",fontSize:18,flexShrink:0}}>←</button>
              <div>
                <div style={{color:"#777",fontSize:12,marginBottom:2}}>{h.e} {h.label} · {sev?.label}</div>
                <div style={{color:"#fff",fontWeight:800,fontSize:20,letterSpacing:-.3}}>{t.step3}</div>
              </div>
            </div>
            <div style={{background:"#111",border:"1px solid #1e1e1e",borderRadius:12,padding:"11px 14px",marginBottom:16}}>
              <span style={{color:"#555",fontSize:12,lineHeight:1.55}}>{t.photoTip}</span>
            </div>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{display:"none"}} onChange={pickPhoto}/>
            <button onClick={()=>fileRef.current?.click()}
              style={{width:"100%",background:"#1a1a1a",border:"1px solid #2a2a2a",borderRadius:14,padding:"18px",color:"#ccc",fontWeight:700,fontSize:16,fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",gap:10,marginBottom:10}}>
              {t.takePhoto}
            </button>
            <button onClick={()=>go("confirm")}
              style={{width:"100%",background:"#111",border:"1px solid #1e1e1e",borderRadius:14,padding:"14px",color:"#777",fontWeight:600,fontSize:14,fontFamily:"inherit"}}>
              {t.skip}
            </button>
          </div>
        )}

        {/* ── STEP 4: Confirm ── */}
        {step==="confirm"&&(
          <div style={{animation:"fadeUp .15s ease"}}>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:20}}>
              <button onClick={back} style={{background:"#111",border:"1px solid #1e1e1e",borderRadius:10,width:34,height:34,display:"flex",alignItems:"center",justifyContent:"center",color:"#888",fontSize:18,flexShrink:0}}>←</button>
              <div style={{color:"#fff",fontWeight:800,fontSize:20,letterSpacing:-.3}}>{t.step4}</div>
            </div>

            <div style={{background:"#111",border:"1px solid #1e1e1e",borderRadius:16,overflow:"hidden",marginBottom:20}}>
              {form.preview&&(
                <div style={{position:"relative" as const}}>
                  <img src={form.preview} alt="" style={{width:"100%",height:180,objectFit:"cover",display:"block",opacity:uploading?.5:1}}/>
                  {uploading&&<div style={{position:"absolute" as const,inset:0,display:"flex",alignItems:"center",justifyContent:"center",gap:6,color:"#fff",fontSize:12}}>
                    <div style={{width:16,height:16,border:"2px solid #fff4",borderTopColor:"#fff",borderRadius:"50%",animation:"spin .8s linear infinite"}}/>
                    Uploading…
                  </div>}
                </div>
              )}
              <div style={{padding:"16px"}}>
                <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:10}}>
                  <div>
                    <div style={{color:"#fff",fontWeight:700,fontSize:17}}>{h.label}</div>
                    <div style={{color:"#555",fontSize:13,marginTop:3}}>{sev?.label||"Moderate"}</div>
                  </div>
                </div>
                <div style={{color:"#555",fontSize:13}}>{gps?.address||"Accra, Ghana"}</div>
              </div>
            </div>

            <button onClick={submit} disabled={submitting}
              style={{width:"100%",background:submitting?"#7f1d1d":"#EF4444",border:"none",borderRadius:14,padding:"18px",color:"#fff",fontWeight:800,fontSize:17,fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",gap:10}}>
              {submitting
                ?<><div style={{width:18,height:18,border:"2.5px solid #fff4",borderTopColor:"#fff",borderRadius:"50%",animation:"spin .8s linear infinite"}}/>{t.submitting}</>
                :<><span style={{fontSize:20}}>🚨</span>{t.submit}</>
              }
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── DEMO DATA ────────────────────────────────────────────────────────────────
const DEMO_REPORTS = [
  {id:"d1",hazardType:"POTHOLE",     severity:"CRITICAL",status:"VERIFIED",  latitude:5.6448,longitude:-0.0918,photoUrl:"https://images.unsplash.com/photo-1515162816999-a0c47dc192f7?w=600&q=80",upvoteCount:14,address:"Spintex Road",       region:"Greater Accra",createdAt:new Date(Date.now()-7200000).toISOString(),  resolvedAt:null},
  {id:"d2",hazardType:"FLOOD",       severity:"HIGH",    status:"IN_REVIEW", latitude:5.6412,longitude:-0.0882,photoUrl:"https://images.unsplash.com/photo-1574482620826-40685ca5eef2?w=600&q=80",upvoteCount:9, address:"Spintex Road",       region:"Greater Accra",createdAt:new Date(Date.now()-3600000).toISOString(),  resolvedAt:null},
  {id:"d3",hazardType:"POTHOLE",     severity:"CRITICAL",status:"VERIFIED",  latitude:5.6320,longitude:-0.0231,photoUrl:"https://images.unsplash.com/photo-1515162816999-a0c47dc192f7?w=600&q=80",upvoteCount:7, address:"Tema Motorway",      region:"Greater Accra",createdAt:new Date(Date.now()-10800000).toISOString(),resolvedAt:null},
  {id:"d4",hazardType:"ROAD_BLOCK",  severity:"HIGH",    status:"VERIFIED",  latitude:5.6439,longitude:-0.2366,photoUrl:null,                                                                         upvoteCount:5, address:"Atomic Junction",    region:"Greater Accra",createdAt:new Date(Date.now()-1800000).toISOString(),  resolvedAt:null},
  {id:"d5",hazardType:"BROKEN_LIGHT",severity:"MEDIUM",  status:"PENDING",   latitude:5.5487,longitude:-0.2077,photoUrl:"https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=600&q=80",upvoteCount:3, address:"Kwame Nkrumah Ave",  region:"Greater Accra",createdAt:new Date(Date.now()-900000).toISOString(),   resolvedAt:null},
  {id:"d6",hazardType:"DEBRIS",      severity:"MEDIUM",  status:"RESOLVED",  latitude:5.5578,longitude:-0.2040,photoUrl:null,                                                                         upvoteCount:2, address:"Ring Road Central",  region:"Greater Accra",createdAt:new Date(Date.now()-86400000).toISOString(),resolvedAt:new Date(Date.now()-43200000).toISOString(),resolutionNote:"Removed by GHA crew.",fixedBy:"GHA Roads Team"},
];

// ─── DESTINATION SHEET ────────────────────────────────────────────────────────
function DestinationSheet({ fromVal, toVal, onSet, onClose }: {
  fromVal:string; toVal:string; onSet:(f:string,t:string)=>void; onClose:()=>void;
}) {
  const [from, setFrom] = useState(fromVal);
  const [to,   setTo]   = useState(toVal);
  const ready = from.trim() && to.trim();
  return (
    <div style={{position:"fixed" as const,inset:0,zIndex:210}}>
      <div style={{position:"absolute" as const,inset:0,background:"rgba(0,0,0,0.55)",backdropFilter:"blur(4px)"}} onClick={onClose}/>
      <div style={{position:"absolute" as const,bottom:0,left:0,right:0,background:"#0D0D0D",borderRadius:"20px 20px 0 0",padding:"0 20px 48px",animation:"slideUp .25s cubic-bezier(.32,.72,0,1)"}}>
        <div style={{display:"flex",justifyContent:"center",padding:"12px 0 20px"}}>
          <div style={{width:36,height:4,borderRadius:2,background:"#1e1e1e"}}/>
        </div>
        <div style={{fontSize:10,fontWeight:800,letterSpacing:2,color:"#444",marginBottom:18}}>SET DESTINATION</div>
        <div style={{display:"flex",flexDirection:"column" as const,gap:10,marginBottom:16}}>
          <div style={{position:"relative" as const}}>
            <span style={{position:"absolute" as const,left:13,top:"50%",transform:"translateY(-50%)",width:7,height:7,borderRadius:"50%",background:"#555"}}/>
            <input value={from} onChange={e=>setFrom(e.target.value)}
              placeholder="From — e.g. Spintex Road"
              style={{width:"100%",background:"#111",border:"1px solid #1e1e1e",borderRadius:12,padding:"13px 12px 13px 32px",color:"#ccc",fontSize:14,fontFamily:"inherit",outline:"none"}}/>
          </div>
          <div style={{position:"relative" as const}}>
            <span style={{position:"absolute" as const,left:13,top:"50%",transform:"translateY(-50%)",width:7,height:7,borderRadius:"50%",background:"#EF4444"}}/>
            <input value={to} onChange={e=>setTo(e.target.value)}
              placeholder="To — e.g. Circle"
              style={{width:"100%",background:"#111",border:"1px solid #1e1e1e",borderRadius:12,padding:"13px 12px 13px 32px",color:"#ccc",fontSize:14,fontFamily:"inherit",outline:"none"}}/>
          </div>
        </div>
        <button onClick={()=>{onSet(from,to);onClose();}} disabled={!ready}
          style={{width:"100%",background:ready?"#EF4444":"#111",border:"none",borderRadius:12,padding:"15px",color:ready?"#fff":"#333",fontWeight:700,fontSize:15,fontFamily:"inherit"}}>
          Check Route
        </button>
      </div>
    </div>
  );
}

// ─── SETTINGS SHEET ───────────────────────────────────────────────────────────
function SettingsSheet({ theme, onTheme, onClose }: {
  theme: "dark"|"light"; onTheme:(t:"dark"|"light")=>void; onClose:()=>void;
}) {
  const opts: {key:"dark"|"light"; label:string; preview:string}[] = [
    { key:"dark",  label:"Dark",  preview:"#0A0A0A" },
    { key:"light", label:"Light", preview:"#F9F9F9" },
  ];
  return (
    <div style={{position:"fixed" as const,inset:0,zIndex:210}}>
      <div style={{position:"absolute" as const,inset:0,background:"rgba(0,0,0,0.55)",backdropFilter:"blur(4px)"}} onClick={onClose}/>
      <div style={{position:"absolute" as const,bottom:0,left:0,right:0,background:"#0D0D0D",borderRadius:"20px 20px 0 0",padding:"0 20px 48px",animation:"slideUp .25s cubic-bezier(.32,.72,0,1)"}}>
        <div style={{display:"flex",justifyContent:"center",padding:"12px 0 24px"}}>
          <div style={{width:36,height:4,borderRadius:2,background:"#1e1e1e"}}/>
        </div>
        <div style={{fontSize:9,fontWeight:800,letterSpacing:2,color:"#444",marginBottom:20}}>SETTINGS</div>

        {/* Appearance */}
        <div style={{marginBottom:28}}>
          <div style={{fontSize:10,color:"#555",marginBottom:12,fontWeight:700,letterSpacing:.5}}>APPEARANCE</div>
          <div style={{display:"flex",gap:10}}>
            {opts.map(o=>{
              const active = theme===o.key;
              return(
                <button key={o.key} onClick={()=>onTheme(o.key)}
                  style={{flex:1,background:active?"#1a1a1a":"#111",border:`1px solid ${active?"#333":"#1e1e1e"}`,borderRadius:14,padding:"16px 12px",fontFamily:"inherit",display:"flex",flexDirection:"column" as const,alignItems:"center",gap:10}}>
                  <div style={{width:"100%",height:44,borderRadius:8,background:o.preview,border:`1px solid ${o.key==="light"?"#E0E0E0":"#1a1a1a"}`,display:"flex",alignItems:"center",justifyContent:"center",gap:4}}>
                    <div style={{width:4,height:4,borderRadius:"50%",background:o.key==="light"?"#EF4444":"#EF4444"}}/>
                    <div style={{width:18,height:2,borderRadius:1,background:o.key==="light"?"#ABABAB":"#555"}}/>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:6}}>
                    {active&&<div style={{width:5,height:5,borderRadius:"50%",background:"#EF4444"}}/>}
                    <span style={{fontSize:12,fontWeight:600,color:active?"#fff":"#444"}}>{o.label}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <button onClick={onClose}
          style={{width:"100%",background:"#111",border:"1px solid #1e1e1e",borderRadius:12,padding:"14px",color:"#555",fontWeight:700,fontSize:14,fontFamily:"inherit"}}>
          Done
        </button>
      </div>
    </div>
  );
}

// ─── WHATSAPP SHARE ───────────────────────────────────────────────────────────
function shareWhatsApp(r: any) {
  const h    = hMeta(r.hazardType);
  const sev  = SEV_LABEL[r.severity] || r.severity;
  const text = `🚨 ${sev.toUpperCase()} ROAD HAZARD\n${h.e} ${h.label} — ${r.address}, Ghana.\n\n${r.upvoteCount||0} citizens confirmed this.\n\nRoadWatch Ghana: roadwatch-eight-pi.vercel.app`;
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
}

// ─── HAZARD ITEM ─────────────────────────────────────────────────────────────
function HazardItem({ r, isNew, distanceKm, onTap }: {
  r: any; isNew?: boolean; distanceKm?: number|null; onTap: () => void;
}) {
  const [blurbOpen, setBlurbOpen] = useState(false);
  const h      = hMeta(r.hazardType);
  const sev    = r.severity;
  const isFixed = r.status === "RESOLVED";

  const dotSize   = sev==="CRITICAL" ? 8 : sev==="HIGH" ? 7 : sev==="MEDIUM" ? 6 : 5;
  const dotColor  = sev==="CRITICAL" ? "#EF4444" : sev==="HIGH" ? "var(--hd-h)" : sev==="MEDIUM" ? "var(--hd-m)" : "var(--hd-m)";
  const nameSize  = sev==="CRITICAL" ? 19 : sev==="HIGH" ? 14 : 12;
  const nameColor = sev==="CRITICAL" ? "var(--hn-c)" : sev==="HIGH" ? "var(--hn-h)" : "var(--hn-m)";
  const subSize   = sev==="CRITICAL" ? 11 : sev==="HIGH" ? 10.5 : 10;
  const subColor  = sev==="CRITICAL" ? "var(--hs-c)" : sev==="HIGH" ? "var(--hs-h)" : "var(--hs-m)";

  const distStr  = distanceKm != null ? `${fmtDist(distanceKm)} ahead` : null;
  const subtitle = [SEV_LABEL[sev], r.address, distStr].filter(Boolean).join(" · ");

  return (
    <button onClick={onTap} style={{
      display:"flex", alignItems:"flex-start", gap:12,
      padding:"13px 0",
      borderTop:"none", borderLeft:"none", borderRight:"none",
      borderBottom:"0.5px solid var(--hsep)",
      width:"100%", textAlign:"left" as const, fontFamily:"inherit",
      cursor:"pointer", background:"none",
      opacity: isFixed ? 0.22 : 1,
      animation: isNew ? "newReport .35s ease" : undefined,
    }}>
      <div style={{paddingTop:4, flexShrink:0}}>
        {isFixed
          ? <div style={{width:dotSize,height:dotSize,borderRadius:"50%",border:"1px solid var(--hn-m)"}}/>
          : <div style={{width:dotSize,height:dotSize,borderRadius:"50%",background:dotColor}}/>
        }
      </div>
      <div style={{flex:1, minWidth:0}}>
        <div style={{fontSize:nameSize,fontWeight:600,color:nameColor,lineHeight:1.25,textDecoration:isFixed?"line-through":"none",marginBottom:3}}>
          {h.label}
          {isNew&&<span style={{marginLeft:7,fontSize:8,fontWeight:800,letterSpacing:.8,color:"#EF4444",verticalAlign:"middle"}}>JUST IN</span>}
        </div>
        <div style={{fontSize:subSize,color:subColor,lineHeight:1.45}}>
          {subtitle}
        </div>
        {sev==="CRITICAL"&&!isFixed&&(
          <div style={{marginTop:6}}>
            <button onClick={e=>{e.stopPropagation();setBlurbOpen(o=>!o);}}
              style={{background:"none",border:"none",padding:0,color:"var(--hs-c)",fontSize:10,fontWeight:700,fontFamily:"inherit",letterSpacing:.3}}>
              {blurbOpen ? "Hide ↑" : "Details ↓"}
            </button>
            {blurbOpen&&(
              <div style={{marginTop:5,paddingTop:6,borderTop:"0.5px solid var(--hsep)",fontSize:12,lineHeight:1.55}}>
                <span style={{fontWeight:700,color:"var(--hn-c)"}}>Avoid this road. </span>
                <span style={{color:"var(--hblrb)"}}>
                  {r.upvoteCount>1 ? `${r.upvoteCount} confirmed.` : "Use extreme caution."}
                </span>
              </div>
            )}
          </div>
        )}
      </div>
      <div style={{paddingTop:5,flexShrink:0,color:"var(--hchev)",fontSize:14,lineHeight:1}}>›</div>
    </button>
  );
}

// ─── HAZARD SHEET ─────────────────────────────────────────────────────────────
function HazardSheet({ r, distanceKm, confirmed, onConfirm, onClose }: {
  r: any; distanceKm?: number|null; confirmed: boolean; onConfirm: () => void; onClose: () => void;
}) {
  const h = hMeta(r.hazardType);
  const sev = r.severity;
  const dotColor = sev==="CRITICAL" ? "#EF4444" : sev==="HIGH" ? "#282828" : "#181818";

  return (
    <div style={{position:"fixed" as const,inset:0,zIndex:150}}>
      <div style={{position:"absolute" as const,inset:0,background:"rgba(0,0,0,0.25)",backdropFilter:"blur(2px)"}} onClick={onClose}/>
      <div style={{
        position:"absolute" as const, bottom:0, left:0, right:0,
        background:"#FFFFFF", borderRadius:"20px 20px 0 0",
        padding:"0 20px 44px",
        animation:"slideUp .25s cubic-bezier(.32,.72,0,1)",
        boxShadow:"0 -4px 40px rgba(0,0,0,0.12)",
      }}>
        <div style={{display:"flex",justifyContent:"center",padding:"12px 0 20px"}}>
          <div style={{width:36,height:4,borderRadius:2,background:"#E0E0E0"}}/>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
          <div style={{width:8,height:8,borderRadius:"50%",background:dotColor,flexShrink:0}}/>
          <div style={{flex:1}}>
            <div style={{fontSize:17,fontWeight:700,color:"#1E1E1E"}}>{h.label}</div>
            <div style={{fontSize:11,color:"#ABABAB",marginTop:2}}>
              {SEV_LABEL[sev]}{r.address ? ` · ${r.address}` : ""}{distanceKm!=null ? ` · ${fmtDist(distanceKm)}` : ""}
            </div>
          </div>
          <div style={{fontSize:11,color:"#ABABAB"}}>{ago(r.createdAt)}</div>
        </div>
        {r.photoUrl&&(
          <img src={r.photoUrl} alt="" style={{width:"100%",height:160,objectFit:"cover",borderRadius:12,marginBottom:14}}/>
        )}
        <div style={{padding:"10px 0",borderTop:"0.5px solid #F0F0F0",marginBottom:16}}>
          <div style={{fontSize:10,color:"#ABABAB"}}>{r.upvoteCount||0} people confirmed this · {ago(r.createdAt)}</div>
        </div>
        <button onClick={onConfirm} disabled={confirmed}
          style={{
            width:"100%", background:confirmed?"#F5F5F5":"#1E1E1E",
            border:"none", borderRadius:12, padding:"15px",
            color:confirmed?"#ABABAB":"#FFFFFF", fontWeight:700,
            fontSize:15, fontFamily:"inherit",
          }}>
          {confirmed ? "You confirmed this" : "Confirm this hazard"}
        </button>
      </div>
    </div>
  );
}

// ─── SUCCESS SCREEN ───────────────────────────────────────────────────────────
function SuccessScreen({ r, onClose, onSignIn, user }: { r:any; onClose:()=>void; onSignIn?:()=>void; user?:any }) {
  const h      = hMeta(r.hazardType);
  const queued = !!r._queued;
  const hasPhoto = !!r.photoUrl;

  return (
    <div role="alert" aria-live="assertive"
      style={{display:"flex",flexDirection:"column" as const,alignItems:"center",justifyContent:"center",height:"100%",padding:"32px 24px",textAlign:"center" as const,background:"#0A0A0A",animation:"fadeUp .3s ease"}}>

      <div style={{width:80,height:80,borderRadius:"50%",background:"#111",border:"1px solid #1e1e1e",display:"flex",alignItems:"center",justifyContent:"center",marginBottom:20,animation:"successPop .4s cubic-bezier(.175,.885,.32,1.275)"}}>
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
          {queued
            ? <path d="M16 8v8l5 3" stroke="#555" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            : <path d="M8 16l5 5 11-10" stroke="#888" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          }
        </svg>
      </div>

      <div style={{color:"#fff",fontWeight:700,fontSize:22,marginBottom:8,letterSpacing:-.5}}>
        {queued ? "Saved for later" : "Report submitted!"}
      </div>
      <div style={{color:"#666",fontSize:14,lineHeight:1.6,marginBottom:6,maxWidth:280}}>
        {queued
          ? "You're offline. Your report will be sent automatically when you reconnect."
          : hasPhoto
          ? "Your photo makes it live on the map instantly."
          : "Under admin review — goes live once verified."
        }
      </div>

      <div style={{color:"#555",fontSize:13,margin:"20px 0 28px"}}>{h.label} · {r.address||"Accra, Ghana"}</div>

      {!queued&&(
        <button onClick={()=>shareWhatsApp(r)} aria-label="Share this report on WhatsApp"
          style={{width:"100%",background:"#111",border:"1px solid #1e1e1e",borderRadius:14,padding:"15px",color:"#888",fontWeight:700,fontSize:15,fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",gap:10,marginBottom:10}}>
          Share on WhatsApp
        </button>
      )}

      {!queued && !user && onSignIn && (
        <button onClick={onSignIn}
          style={{width:"100%",background:"#111",border:"1px solid #1e1e1e",borderRadius:14,padding:"15px",color:"#666",fontWeight:700,fontSize:14,fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",gap:10,marginBottom:10}}>
          Sign in to track this report
        </button>
      )}

      <button onClick={onClose} aria-label="Close and return to feed"
        style={{width:"100%",background:"#111",border:"1px solid #1e1e1e",borderRadius:14,padding:"15px",color:"#888",fontWeight:700,fontSize:15,fontFamily:"inherit"}}>
        Done
      </button>
    </div>
  );
}

// ─── ONBOARDING OVERLAY ───────────────────────────────────────────────────────
const ONBOARD_STEPS = [
  { icon:"🗺️",  title:"See Ghana's roads",       body:"Real-time road hazard map updated by citizens across Greater Accra and beyond."  },
  { icon:"🚨",  title:"Report in 30 seconds",    body:"Tap the red button, pick the hazard type, add a photo. It's live on the map instantly." },
  { icon:"👥",  title:"Help your community",     body:"Confirm hazards others report. More confirmations → more alerts to more drivers."  },
];

function OnboardingOverlay({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const s = ONBOARD_STEPS[step];
  const last = step === ONBOARD_STEPS.length - 1;

  const finish = () => {
    localStorage.setItem("rw_onboarded", "1");
    onDone();
  };

  return (
    <div style={{position:"fixed" as const,inset:0,zIndex:500,background:"rgba(0,0,0,0.96)",backdropFilter:"blur(10px)",display:"flex",flexDirection:"column" as const,alignItems:"center",justifyContent:"center",padding:"32px 24px",animation:"fadeUp .3s ease"}}>
      <button onClick={finish} style={{position:"absolute" as const,top:20,right:20,background:"none",border:"none",color:"#444",fontSize:22,lineHeight:1}}>×</button>

      {/* Step dots */}
      <div style={{display:"flex",gap:6,marginBottom:40}}>
        {ONBOARD_STEPS.map((_,i)=>(
          <div key={i} style={{width:i===step?20:6,height:6,borderRadius:3,background:i===step?"#EF4444":"#222",transition:"all .25s"}}/>
        ))}
      </div>

      <div style={{fontSize:72,marginBottom:24,animation:"successPop .4s ease"}}>{s.icon}</div>
      <div style={{color:"#fff",fontWeight:900,fontSize:24,marginBottom:12,letterSpacing:-.5,textAlign:"center" as const}}>{s.title}</div>
      <div style={{color:"#666",fontSize:15,lineHeight:1.65,textAlign:"center" as const,maxWidth:300,marginBottom:48}}>{s.body}</div>

      <button onClick={last ? finish : ()=>setStep(s=>s+1)}
        style={{width:"100%",maxWidth:300,background:"#EF4444",border:"none",borderRadius:14,padding:"18px",color:"#fff",fontWeight:800,fontSize:17,fontFamily:"inherit"}}>
        {last ? "Get started" : "Next"}
      </button>
    </div>
  );
}

// ─── AUTH MODAL ───────────────────────────────────────────────────────────────
function AuthModal({ onClose, onSuccess }: { onClose:()=>void; onSuccess:()=>void }) {
  const [mode,    setMode]    = useState<"start"|"otp">("start");
  const [phone,   setPhone]   = useState("");
  const [otp,     setOtp]     = useState("");
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string|null>(null);

  const handleGoogle = async () => {
    setLoading(true); setError(null);
    try {
      const { error: e } = await signInWithGoogle();
      if (e) setError(e.message);
    } catch { setError("Something went wrong. Try again."); }
    finally { setLoading(false); }
  };

  const handleSendOTP = async () => {
    if (!phone.trim()) { setError("Enter your phone number"); return; }
    setLoading(true); setError(null);
    const normalized = phone.startsWith("+") ? phone : `+233${phone.replace(/^0/, "")}`;
    try {
      const { error: e } = await sendPhoneOTP(normalized);
      if (e) setError(e.message);
      else setMode("otp");
    } catch { setError("Failed to send code"); }
    finally { setLoading(false); }
  };

  const handleVerify = async () => {
    if (!otp.trim()) return;
    setLoading(true); setError(null);
    const normalized = phone.startsWith("+") ? phone : `+233${phone.replace(/^0/, "")}`;
    try {
      const { error: e } = await verifyPhoneOTP(normalized, otp);
      if (e) setError(e.message);
      else { onSuccess(); onClose(); }
    } catch { setError("Invalid code. Try again."); }
    finally { setLoading(false); }
  };

  return (
    <div style={{position:"fixed" as const,inset:0,zIndex:250}} role="dialog" aria-modal="true" aria-label="Sign in">
      <div style={{position:"absolute" as const,inset:0,background:"rgba(0,0,0,0.88)",backdropFilter:"blur(10px)"}} onClick={onClose} aria-hidden="true"/>
      <div style={{position:"absolute" as const,bottom:0,left:0,right:0,background:"#0A0A0A",borderRadius:"20px 20px 0 0",border:"1px solid #1a1a1a",borderBottom:"none",padding:"24px 20px 40px",animation:"slideUp .26s cubic-bezier(.32,.72,0,1)"}}>
        <div style={{display:"flex",justifyContent:"center",marginBottom:20}}>
          <div style={{width:36,height:4,borderRadius:2,background:"#1e1e1e"}}/>
        </div>
        <div style={{textAlign:"center" as const,marginBottom:24}}>
          <div style={{fontSize:28,marginBottom:8}}>🔐</div>
          <div style={{color:"#fff",fontWeight:800,fontSize:20,letterSpacing:-.3,marginBottom:6}}>Sign in to RoadWatch</div>
          <div style={{color:"#555",fontSize:13}}>Track your reports · Get hazard alerts</div>
        </div>

        {error&&(
          <div style={{background:"rgba(239,68,68,0.08)",border:"1px solid rgba(239,68,68,0.2)",borderRadius:10,padding:"10px 12px",marginBottom:14,color:"#EF4444",fontSize:13,textAlign:"center" as const}}>
            {error}
          </div>
        )}

        {/* Google */}
        <button onClick={handleGoogle} disabled={loading}
          style={{width:"100%",background:"#fff",border:"none",borderRadius:12,padding:"14px",color:"#111",fontWeight:700,fontSize:15,fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",gap:10,marginBottom:16,opacity:loading?.6:1}}>
          <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
          {loading ? "Signing in…" : "Continue with Google"}
        </button>

        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
          <div style={{flex:1,height:1,background:"#1a1a1a"}}/>
          <span style={{color:"#333",fontSize:12}}>or</span>
          <div style={{flex:1,height:1,background:"#1a1a1a"}}/>
        </div>

        {/* Phone OTP */}
        {mode==="start"&&(
          <>
            <div style={{position:"relative" as const,marginBottom:10}}>
              <span style={{position:"absolute" as const,left:13,top:"50%",transform:"translateY(-50%)",color:"#555",fontSize:13,pointerEvents:"none" as const}}>🇬🇭</span>
              <input value={phone} onChange={e=>setPhone(e.target.value)}
                onKeyDown={e=>e.key==="Enter"&&handleSendOTP()}
                placeholder="Phone number (e.g. 0241234567)"
                style={{width:"100%",background:"#111",border:"1px solid #1e1e1e",borderRadius:12,padding:"13px 12px 13px 38px",color:"#ccc",fontSize:14,fontFamily:"inherit",outline:"none"}}/>
            </div>
            <button onClick={handleSendOTP} disabled={loading||!phone.trim()}
              style={{width:"100%",background:phone.trim()?"rgba(239,68,68,0.1)":"#0D0D0D",border:`1px solid ${phone.trim()?"rgba(239,68,68,0.35)":"#1a1a1a"}`,borderRadius:12,padding:"13px",color:phone.trim()?"#EF4444":"#333",fontWeight:700,fontSize:14,fontFamily:"inherit",opacity:loading?.6:1}}>
              {loading ? "Sending…" : "Send code via SMS"}
            </button>
          </>
        )}

        {mode==="otp"&&(
          <>
            <div style={{color:"#888",fontSize:13,textAlign:"center" as const,marginBottom:12}}>
              Code sent to {phone.startsWith("+") ? phone : `+233${phone.replace(/^0/,"")}`}
              <button onClick={()=>setMode("start")} style={{background:"none",border:"none",color:"#EF4444",fontSize:13,marginLeft:6,fontFamily:"inherit"}}>Change</button>
            </div>
            <input value={otp} onChange={e=>setOtp(e.target.value)} maxLength={6}
              onKeyDown={e=>e.key==="Enter"&&handleVerify()}
              placeholder="6-digit code"
              style={{width:"100%",background:"#111",border:"1px solid #1e1e1e",borderRadius:12,padding:"13px",color:"#ccc",fontSize:22,fontFamily:"inherit",outline:"none",textAlign:"center" as const,letterSpacing:8,marginBottom:10}}/>
            <button onClick={handleVerify} disabled={loading||otp.length<4}
              style={{width:"100%",background:otp.length>=4?"#EF4444":"#111",border:"none",borderRadius:12,padding:"14px",color:otp.length>=4?"#fff":"#333",fontWeight:700,fontSize:15,fontFamily:"inherit",opacity:loading?.6:1}}>
              {loading ? "Verifying…" : "Verify code"}
            </button>
          </>
        )}

        <div style={{color:"#333",fontSize:11,textAlign:"center" as const,marginTop:16,lineHeight:1.5}}>
          Phone OTP requires Twilio configured in Supabase.
        </div>
      </div>
    </div>
  );
}

// ─── PUBLIC PAGE ──────────────────────────────────────────────────────────────
export default function PublicPage() {
  const [reports,       setReports]       = useState<any[]>(DEMO_REPORTS);
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [dismissed,     setDismissed]     = useState<Set<string>>(new Set());
  const [isDemo,        setIsDemo]        = useState(true);
  const [tab,           setTab]           = useState("home");
  const [hazardFilter,  setHazardFilter]  = useState("All");
  const [search,        setSearch]        = useState("");
  const [reporting,     setReporting]     = useState(false);
  const [confirmed,     setConfirmed]     = useState<Record<string,boolean>>({});
  const [gps,           setGps]           = useState<any>({lat:null,lng:null,address:null,status:"idle"});
  const [lang,          setLang]          = useState<Lang>("EN");
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [showInstall,   setShowInstall]   = useState(false);
  const [routeFrom,     setRouteFrom]     = useState("");
  const [routeTo,       setRouteTo]       = useState("");
  const [routeResult,   setRouteResult]   = useState<any[]|null>(null);
  const [safetyScore,   setSafetyScore]   = useState<number|null>(null);
  const [checking,      setChecking]      = useState(false);
  const [loading,       setLoading]       = useState(true);
  const [toast,         setToast]         = useState<string|null>(null);
  const [newReportIds,  setNewReportIds]  = useState<Set<string>>(new Set());
  const [watching,      setWatching]      = useState(0);
  const [submitted,     setSubmitted]     = useState<any>(null);
  const [isOnline,      setIsOnline]      = useState(true);
  const [queueCount,    setQueueCount]    = useState(0);
  const [flushing,      setFlushing]      = useState(false);
  const [user,          setUser]          = useState<any>(null);
  const [showAuth,      setShowAuth]      = useState(false);
  const [onboarded,     setOnboarded]     = useState(true);
  const [pushEnabled,   setPushEnabled]   = useState(false);
  const [sheetReport,   setSheetReport]   = useState<any>(null);
  const [themeName,     setThemeName]     = useState<"dark"|"light">("dark");
  const [showSettings,  setShowSettings]  = useState(false);
  const [feedExpanded,  setFeedExpanded]  = useState(false);
  const [pillsExpanded, setPillsExpanded] = useState(false);
  const [showDestSheet, setShowDestSheet] = useState(false);
  const fabRef   = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  const dismissToast = useCallback(() => setToast(null), []);

  const subscribePush = useCallback(async () => {
    if (!("Notification" in window) || !("serviceWorker" in navigator)) return;
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return;
    try {
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly:      true,
          applicationServerKey: urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!),
        });
      }
      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub),
      });
      setPushEnabled(true);
    } catch {}
  }, []);

  useEffect(()=>{
    setWatching(Math.floor(Math.random()*18)+14);
    setIsOnline(navigator.onLine);
    setQueueCount(getQueue().length);

    // Theme
    const savedTheme = localStorage.getItem("rw_theme") as "dark"|"light"|null;
    if (savedTheme) setThemeName(savedTheme);

    // Onboarding check
    if (!localStorage.getItem("rw_onboarded")) setOnboarded(false);

    // Auto-request GPS for proximity distances (low accuracy, fast)
    setGps((g:any)=>({...g,status:"locating"}));
    navigator.geolocation?.getCurrentPosition(
      async p=>{
        const{latitude:lat,longitude:lng}=p.coords;
        const a=await revGeo(lat,lng);
        setGps({lat,lng,address:a||`${lat.toFixed(4)}°N`,status:"live"});
      },
      ()=>setGps({lat:5.6037,lng:-0.1870,address:"Accra",status:"demo"}),
      {timeout:8000,enableHighAccuracy:false}
    );

    // Auth state
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });
    const { data: { subscription: authSub } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    fetch("/api/reports").then(r=>r.json()).then(j=>{
      if(j.success&&j.data.length>0){setReports(j.data);setIsDemo(false);}
    }).catch(()=>{}).finally(()=>setLoading(false));

    const t = setTimeout(()=>setLoading(false), 1200);

    fetch("/api/announcements").then(r=>r.json()).then(j=>{if(j.success)setAnnouncements(j.data);});

    const handler=(e:any)=>{e.preventDefault();setInstallPrompt(e);setShowInstall(true);};
    window.addEventListener("beforeinstallprompt",handler);

    const goOnline = async () => {
      setIsOnline(true);
      const q = getQueue();
      if (q.length===0) return;
      setFlushing(true);
      const remaining: any[] = [];
      for (const payload of q) {
        try {
          const res  = await fetch("/api/reports",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
          const json = await res.json();
          if (json.success) setReports(p=>[json.data,...p]); else remaining.push(payload);
        } catch { remaining.push(payload); }
      }
      saveQueue(remaining);
      setQueueCount(remaining.length);
      setFlushing(false);
      const sent = q.length - remaining.length;
      if (sent>0) setToast(`${sent} queued report${sent!==1?"s":""} submitted`);
    };
    const goOffline = () => setIsOnline(false);
    window.addEventListener("online",  goOnline);
    window.addEventListener("offline", goOffline);

    return ()=>{
      window.removeEventListener("beforeinstallprompt",handler);
      window.removeEventListener("online",  goOnline);
      window.removeEventListener("offline", goOffline);
      clearTimeout(t);
      authSub.unsubscribe();
    };
  },[]);

  // Fake live update after ~28s
  useEffect(()=>{
    const HAZARDS = [
      { hazardType:"POTHOLE", address:"Lapaz",  severity:"HIGH"     },
      { hazardType:"FLOOD",   address:"Madina", severity:"CRITICAL" },
      { hazardType:"DEBRIS",  address:"Adenta", severity:"MEDIUM"   },
    ];
    const pick = HAZARDS[Math.floor(Math.random()*HAZARDS.length)];
    const id   = `live-${Date.now()}`;
    const t = setTimeout(()=>{
      const h = hMeta(pick.hazardType);
      const liveReport = {
        id, hazardType:pick.hazardType, severity:pick.severity,
        status:"PENDING", latitude:5.5900+Math.random()*0.06,
        longitude:-0.2400+Math.random()*0.08,
        address:pick.address, region:"Greater Accra",
        createdAt:new Date().toISOString(), upvoteCount:1, photoUrl:null,
      };
      setReports(p=>[liveReport,...p]);
      setNewReportIds(s=>new Set([...s,id]));
      setToast(`${h.e} ${SEV_LABEL[pick.severity]} hazard reported at ${pick.address}`);
      setTimeout(()=>setNewReportIds(s=>{const n=new Set(s);n.delete(id);return n;}),8000);
    }, 28000);
    return ()=>clearTimeout(t);
  },[]);

  const getGps=()=>{
    setGps((g:any)=>({...g,status:"locating"}));
    const fb=()=>revGeo(5.6037,-0.1870).then(a=>setGps({lat:5.6037,lng:-0.1870,address:a||"Accra",status:"demo"}));
    if(!navigator.geolocation){fb();return;}
    navigator.geolocation.getCurrentPosition(
      async p=>{const{latitude:lat,longitude:lng}=p.coords;const a=await revGeo(lat,lng);setGps({lat,lng,address:a||`${lat.toFixed(4)}°N`,status:"live"});},
      fb,{timeout:8000,enableHighAccuracy:true}
    );
  };

  // Modal focus management
  useEffect(()=>{
    if (!reporting) { fabRef.current?.focus(); return; }
    const id = requestAnimationFrame(()=>{
      modalRef.current?.querySelector<HTMLElement>("button:not([disabled]),input")?.focus();
    });
    return ()=>cancelAnimationFrame(id);
  },[reporting]);

  // Escape closes modal
  useEffect(()=>{
    const handler=(e:KeyboardEvent)=>{ if(e.key==="Escape"&&reporting){ setReporting(false); setSubmitted(null); } };
    document.addEventListener("keydown",handler);
    return ()=>document.removeEventListener("keydown",handler);
  },[reporting]);

  const onReport=()=>{ if(gps.status==="idle") getGps(); setReporting(true); };
  const onSubmit=(r:any)=>{
    if(r){ setReports(p=>[r,...p]); setSubmitted(r); setQueueCount(getQueue().length); }
    else { setReporting(false); }
  };

  const doConfirm=async(id:string)=>{
    if(confirmed[id]) return;
    setConfirmed(p=>({...p,[id]:true}));
    setReports(p=>p.map(r=>r.id===id?{...r,upvoteCount:(r.upvoteCount||0)+1}:r));
    await fetch(`/api/reports/${id}/upvote`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({fingerprint:`fp-${Date.now()}-${Math.random()}`})});
  };

  const checkRoute=async()=>{
    if(!routeFrom.trim()||!routeTo.trim()) return;
    setChecking(true); setRouteResult(null); setSafetyScore(null);
    await new Promise(r=>setTimeout(r,500));
    const terms=[routeFrom,routeTo].map(s=>s.toLowerCase());
    const hits=reports
      .filter(r=>r.status!=="RESOLVED"&&r.status!=="DISMISSED")
      .filter(r=>terms.some(t=>[(r.address||"").toLowerCase(),(r.landmark||"").toLowerCase(),(r.region||"").toLowerCase()].some(f=>f.includes(t))))
      .sort((a,b)=>SO[a.severity]-SO[b.severity]);

    const crit = hits.filter(r=>r.severity==="CRITICAL").length;
    const high = hits.filter(r=>r.severity==="HIGH").length;
    const med  = hits.filter(r=>r.severity==="MEDIUM").length;
    setSafetyScore(Math.max(0, 10 - (crit*3 + high*2 + med*1)));
    setRouteResult(hits); setChecking(false);
  };

  // ── Theme helper ──
  const th = themeName === "light" ? LITE : DARK;
  const onThemeChange = (t: "dark"|"light") => { setThemeName(t); localStorage.setItem("rw_theme", t); };

  // ── Derived state ──
  const sq             = search.trim().toLowerCase();
  const userLat        = gps.lat as number|null;
  const userLng        = gps.lng as number|null;
  const activeReports  = reports.filter(r=>r.status!=="RESOLVED"&&r.status!=="DISMISSED");
  const fixedReports   = reports.filter(r=>r.status==="RESOLVED"&&r.resolutionNote).sort((a,b)=>new Date(b.resolvedAt).getTime()-new Date(a.resolvedAt).getTime());
  const feedReports    = activeReports
    .filter(r=>hazardFilter==="All"||r.hazardType===hazardFilter)
    .filter(r=>!sq||[(r.address||""),(r.landmark||""),(r.region||"")].some(f=>f.toLowerCase().includes(sq)))
    .map(r=>({
      ...r,
      _dist: (userLat&&userLng&&r.latitude&&r.longitude)
        ? haversine(userLat,userLng,r.latitude,r.longitude)
        : null,
    }))
    .sort((a:any,b:any)=>{
      if(a._dist!==null&&b._dist!==null) return a._dist-b._dist;
      return SO[a.severity]-SO[b.severity]||new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime();
    });
  const nearestWarning = feedReports.find((r:any)=>(r.severity==="CRITICAL"||r.severity==="HIGH")&&r._dist!==null) as any|undefined;
  const myReports      = user ? reports.filter(r=>r.reporter===user.id) : [];
  const criticalCount  = activeReports.filter(r=>r.severity==="CRITICAL").length;
  const totalConfirmed = reports.reduce((s,r)=>s+(r.upvoteCount||0),0);
  const visibleAnnouncements = announcements.filter(a=>!dismissed.has(a.id));

  const scoreColor = (s:number) => s>=8?"#22C55E":s>=5?"#F59E0B":s>=3?"#F97316":"#EF4444";
  const scoreLabel = (s:number) => s>=8?"SAFE":s>=5?"USE CAUTION":s>=3?"RISKY":"DANGEROUS";

  const NavBtn=({tKey,label}:{tKey:string;label:string})=>{
    const active = tab===tKey;
    return(
      <button onClick={()=>setTab(tKey)} aria-label={label} aria-current={active?"page":undefined}
        style={{flex:1,background:"none",border:"none",display:"flex",flexDirection:"column" as const,alignItems:"center",justifyContent:"center",gap:4,fontFamily:"inherit",padding:"10px 0 0",position:"relative" as const}}>
        {active&&<span style={{position:"absolute" as const,top:0,left:"20%",right:"20%",height:2,background:"#EF4444",borderRadius:"0 0 2px 2px"}} aria-hidden="true"/>}
        <span style={{fontSize:11,fontWeight:active?800:600,letterSpacing:.5,color:active?"#fff":"#555",marginTop:2}}>{label}</span>
      </button>
    );
  };

  return(
    <ThCtx.Provider value={th}>
    <div className={themeName==="light"?"lt":""} style={{background:th.bg,minHeight:"100vh",fontFamily:"'Inter',-apple-system,sans-serif",color:th.t1,paddingBottom:100}}>
      <style>{`
        @keyframes fadeUp    {from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
        @keyframes slideUp   {from{transform:translateY(100%)}to{transform:translateY(0)}}
        @keyframes slideDown {from{opacity:0;transform:translateY(-10px)}to{opacity:1;transform:translateY(0)}}
        @keyframes spin      {to{transform:rotate(360deg)}}
        @keyframes fabPulse  {0%,100%{box-shadow:0 4px 24px rgba(239,68,68,0.45),0 0 0 0 rgba(239,68,68,0)}65%{box-shadow:0 4px 24px rgba(239,68,68,0.45),0 0 0 10px rgba(239,68,68,0)}}
        @keyframes recordPulse{0%,100%{box-shadow:0 0 0 0 rgba(239,68,68,0.4)}70%{box-shadow:0 0 0 10px rgba(239,68,68,0)}}
        @keyframes newReport  {0%{opacity:0;transform:translateY(-6px) scale(.98)}100%{opacity:1;transform:translateY(0) scale(1)}}
        @keyframes shimmer    {0%{background-position:200% 0}100%{background-position:-200% 0}}
        @keyframes successPop {0%{transform:scale(0)}70%{transform:scale(1.15)}100%{transform:scale(1)}}
        *{box-sizing:border-box;margin:0;padding:0}
        button{cursor:pointer;-webkit-tap-highlight-color:transparent}
        input::placeholder{color:var(--ph,#333)}
        ::-webkit-scrollbar{display:none}
        :root{
          --hsep:#1a1a1a;--hchev:#2a2a2a;--hblrb:#444;
          --hn-c:#fff;--hn-h:#888;--hn-m:#555;
          --hd-h:#888;--hd-m:#444;
          --hs-c:#555;--hs-h:#444;--hs-m:#333;
          --sk-dot:#1e1e1e;--sk-bar:#141414;--sk-bar2:#111;
        }
        .lt{
          --hsep:#F0F0F0;--hchev:#C8C8C8;--hblrb:#ABABAB;
          --hn-c:#ABABAB;--hn-h:#5A5A5A;--hn-m:#282828;
          --hd-h:#282828;--hd-m:#181818;
          --hs-c:#2E2E2E;--hs-h:#242424;--hs-m:#181818;
          --sk-dot:#E0E0E0;--sk-bar:#EBEBEB;--sk-bar2:#F0F0F0;
          --ph:#ABABAB;
        }
      `}</style>

      {/* ── ONBOARDING ── */}
      {!onboarded && <OnboardingOverlay onDone={() => setOnboarded(true)}/>}

      {/* ── AUTH MODAL ── */}
      {showAuth && <AuthModal onClose={()=>setShowAuth(false)} onSuccess={()=>setShowAuth(false)}/>}

      {/* ── OFFLINE / QUEUE BANNER ── */}
      {!isOnline&&(
        <div role="alert" style={{position:"fixed" as const,top:0,left:0,right:0,zIndex:400,background:"rgba(20,10,0,0.97)",borderBottom:"1px solid rgba(245,158,11,0.3)",padding:"8px 16px",display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontSize:14}}>📡</span>
          <span style={{color:"#F59E0B",fontSize:12,fontWeight:600}}>You're offline — reports are queued and will submit when you reconnect</span>
          {queueCount>0&&<span style={{marginLeft:"auto",color:"#F59E0B",fontSize:11,fontWeight:700}}>{queueCount} queued</span>}
        </div>
      )}
      {isOnline&&flushing&&(
        <div role="status" style={{position:"fixed" as const,top:0,left:0,right:0,zIndex:400,background:"rgba(0,20,10,0.97)",borderBottom:"1px solid rgba(34,197,94,0.3)",padding:"8px 16px",display:"flex",alignItems:"center",gap:8}}>
          <div style={{width:12,height:12,border:"2px solid #22C55E44",borderTopColor:"#22C55E",borderRadius:"50%",animation:"spin .8s linear infinite"}}/>
          <span style={{color:"#22C55E",fontSize:12,fontWeight:600}}>Submitting {queueCount} queued report{queueCount!==1?"s":""}…</span>
        </div>
      )}

      {/* ── TOAST ── */}
      {toast&&<Toast msg={toast} onDismiss={dismissToast}/>}

      {/* ── HEADER ── */}
      <div style={{background:th.bg,padding:"18px 18px 14px",position:"sticky" as const,top:0,zIndex:50}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10}}>
          <div>
            <div style={{fontSize:9,fontWeight:800,letterSpacing:3,color:"#EF4444",marginBottom:5}}>ROADWATCH GH</div>
            <div style={{fontSize:26,fontWeight:700,color:th.t1,letterSpacing:-.6,lineHeight:1.1,marginBottom:5}}>Watch the roads.</div>
            <div style={{fontSize:11,color:th.t3}}>Live hazards. Smarter commutes. Safer cities.</div>
          </div>
          <button onClick={()=>setShowDestSheet(true)} style={{background:th.bg2,border:`1px solid ${th.b1}`,borderRadius:100,padding:"9px 14px",display:"flex",alignItems:"center",gap:6,fontFamily:"inherit",flexShrink:0,marginTop:2}}>
            <svg width="11" height="14" viewBox="0 0 11 14" fill="none">
              <path d="M5.5 0C3.02 0 1 2.02 1 4.5c0 3.19 4.5 9 4.5 9s4.5-5.81 4.5-9C10 2.02 7.98 0 5.5 0z" fill="#EF4444"/>
              <circle cx="5.5" cy="4.5" r="1.8" fill="#fff"/>
            </svg>
            <span style={{color:th.t1,fontSize:11,fontWeight:600}}>{routeFrom&&routeTo?`${routeFrom} → ${routeTo}`:"Set destination"}</span>
          </button>
        </div>
      </div>

      {/* ══ HOME TAB ══ */}
      {tab==="home"&&(
        <div style={{animation:"fadeUp .18s ease",paddingBottom:120}}>

          {/* Critical alert banner */}
          {(()=>{
            const crit=(routeResult??feedReports).find((r:any)=>r.severity==="CRITICAL");
            if(!crit) return null;
            const h=hMeta(crit.hazardType);
            const dist=crit._dist!=null?` · ${fmtDist(crit._dist)} ahead`:"";
            return(
              <div style={{padding:"12px 18px 0"}} onClick={()=>setSheetReport(crit)}>
                <div style={{background:"rgba(100,20,20,0.55)",border:"1px solid rgba(239,68,68,0.25)",borderRadius:16,padding:"15px 16px",display:"flex",alignItems:"center",gap:12,cursor:"pointer"}}>
                  <svg width="22" height="20" viewBox="0 0 22 20" fill="none" style={{flexShrink:0}}>
                    <path d="M11 1L21 19H1L11 1Z" fill="#F59E0B" stroke="#F59E0B" strokeWidth="0.5" strokeLinejoin="round"/>
                    <line x1="11" y1="8" x2="11" y2="13" stroke="#1a0808" strokeWidth="2" strokeLinecap="round"/>
                    <circle cx="11" cy="16" r="1.1" fill="#1a0808"/>
                  </svg>
                  <div style={{flex:1}}>
                    <div style={{fontSize:14,fontWeight:700,lineHeight:1.3,marginBottom:3}}>
                      <span style={{color:"#EF4444"}}>{criticalCount} critical hazard{criticalCount!==1?"s":""}</span>
                      <span style={{color:"#fff"}}> on your route</span>
                    </div>
                    <div style={{fontSize:12,color:"rgba(255,255,255,0.5)"}}>{h.label} on {crit.address||"this road"}{dist}</div>
                  </div>
                  <span style={{color:"rgba(255,255,255,0.4)",fontSize:18}}>›</span>
                </div>
              </div>
            );
          })()}

          {/* Map — edge to edge */}
          <div style={{height:300,margin:"14px 0 0",position:"relative" as const}}>
            <MapView reports={routeResult??reports} hazardFilter="All" onConfirm={doConfirm} confirmed={confirmed}/>
          </div>

          {/* ON YOUR ROUTE section */}
          <div style={{padding:"20px 18px 0"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <circle cx="4" cy="4" r="2.5" stroke={th.t2} strokeWidth="1.2" fill="none"/>
                  <circle cx="12" cy="12" r="2.5" stroke={th.t2} strokeWidth="1.2" fill="none"/>
                  <path d="M4 6.5C4 9 6 10 8 10s4 1 4 3.5" stroke={th.t2} strokeWidth="1.2" strokeLinecap="round"/>
                </svg>
                <span style={{fontSize:10,fontWeight:800,letterSpacing:2,color:th.t2}}>{routeResult?"ON YOUR ROUTE":"NEAR YOU"}</span>
              </div>
              {(routeResult??feedReports).length>3&&(
                <button onClick={()=>setFeedExpanded(p=>!p)}
                  style={{background:"none",border:"none",color:"#EF4444",fontSize:13,fontWeight:700,fontFamily:"inherit",display:"flex",alignItems:"center",gap:2}}>
                  {feedExpanded?"Less":"See all"} <span style={{fontSize:16,lineHeight:1}}>›</span>
                </button>
              )}
            </div>

            <div style={{background:th.bg2,borderRadius:16,overflow:"hidden"}}>
              {loading&&[0,1,2].map(i=><SkeletonItem key={i}/>)}
              {!loading&&(()=>{
                const items=routeResult??feedReports;
                const shown=feedExpanded?items:items.slice(0,3);
                if(shown.length===0) return(
                  <div style={{padding:"32px",textAlign:"center" as const,color:th.t4,fontSize:13}}>No hazards found.</div>
                );
                return shown.map((r:any,i:number)=>{
                  const sevColor=r.severity==="CRITICAL"?"#EF4444":r.severity==="HIGH"?"#888":"#555";
                  return(
                    <button key={r.id} onClick={()=>setSheetReport(r)}
                      style={{width:"100%",display:"flex",alignItems:"center",gap:14,padding:"15px 16px",background:"none",border:"none",borderBottom:i<shown.length-1?`0.5px solid ${th.b1}`:"none",fontFamily:"inherit",textAlign:"left" as const,cursor:"pointer"}}>
                      <div style={{width:9,height:9,borderRadius:"50%",background:r.severity==="CRITICAL"?"#EF4444":"#444",flexShrink:0}}/>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:15,fontWeight:600,color:th.t1,marginBottom:3}}>{r.address||hMeta(r.hazardType).label}</div>
                        <div style={{fontSize:12,color:th.t3}}>
                          <span style={{color:sevColor,fontWeight:600}}>{SEV_LABEL[r.severity]}</span>
                          {" · "}{hMeta(r.hazardType).label}{r._dist!=null?` · ${fmtDist(r._dist)} ahead`:""}
                        </div>
                      </div>
                      <span style={{color:th.t4,fontSize:18,flexShrink:0}}>›</span>
                    </button>
                  );
                });
              })()}
            </div>
          </div>
        </div>
      )}

      {/* ══ ALERTS TAB ══ */}
      {tab==="alerts"&&(
        <div style={{padding:"16px 18px 0",animation:"fadeUp .18s ease"}}>
          <div style={{color:th.t1,fontWeight:700,fontSize:18,letterSpacing:-.3,marginBottom:4}}>Alerts</div>
          <div style={{color:th.t3,fontSize:12,marginBottom:16}}>Official announcements and road closures.</div>
          {visibleAnnouncements.length===0
            ?<div style={{textAlign:"center" as const,padding:"48px 0",color:th.t4,fontSize:13}}>No alerts right now.</div>
            :visibleAnnouncements.map(a=>{
              const isEmergency=a.type==="EMERGENCY"||a.type==="ROAD_CLOSURE";
              return(
                <div key={a.id} style={{background:th.bg2,border:`1px solid ${isEmergency?"rgba(239,68,68,0.2)":th.b1}`,borderLeft:`2px solid ${isEmergency?"#EF4444":th.b1}`,borderRadius:12,padding:"13px",marginBottom:10,display:"flex",alignItems:"flex-start",gap:10}}>
                  <div style={{flex:1}}>
                    <div style={{color:th.t4,fontSize:9,fontWeight:700,letterSpacing:1,marginBottom:3}}>{a.region||"NATIONAL"}</div>
                    <div style={{color:th.t1,fontWeight:700,fontSize:13,marginBottom:3}}>{a.title}</div>
                    <div style={{color:th.t3,fontSize:12,lineHeight:1.5}}>{a.body}</div>
                  </div>
                  <button onClick={()=>setDismissed(d=>new Set([...d,a.id]))} style={{background:"none",border:"none",color:th.t4,fontSize:20,lineHeight:1,flexShrink:0}}>×</button>
                </div>
              );
            })
          }
        </div>
      )}

      {/* ══ DASHBOARD TAB ══ */}
      {tab==="dashboard"&&(
        <div style={{padding:"16px 18px 0",animation:"fadeUp .18s ease"}}>
          <div style={{color:th.t1,fontWeight:700,fontSize:18,letterSpacing:-.3,marginBottom:16}}>Dashboard</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>
            {[
              {label:"Active hazards",  value:activeReports.length,     color:"#EF4444"},
              {label:"Critical",        value:criticalCount,            color:"#EF4444"},
              {label:"Fixed recently",  value:fixedReports.length,      color:"#22C55E"},
              {label:"Total confirmed", value:totalConfirmed,           color:th.t2},
            ].map(s=>(
              <div key={s.label} style={{background:th.bg2,border:`1px solid ${th.b1}`,borderRadius:14,padding:"16px"}}>
                <div style={{fontSize:26,fontWeight:700,color:s.color,lineHeight:1,marginBottom:4}}>{s.value}</div>
                <div style={{fontSize:11,color:th.t3}}>{s.label}</div>
              </div>
            ))}
          </div>
          <div style={{background:th.bg2,border:`1px solid ${th.b1}`,borderRadius:14,padding:"16px",marginBottom:10}}>
            <div style={{fontSize:11,fontWeight:700,color:th.t3,letterSpacing:.5,marginBottom:12}}>BY TYPE</div>
            {H.map(hx=>{
              const count = activeReports.filter(r=>r.hazardType===hx.key).length;
              const pct   = activeReports.length>0 ? (count/activeReports.length)*100 : 0;
              return count>0 ? (
                <div key={hx.key} style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
                  <div style={{width:80,fontSize:11,color:th.t2,flexShrink:0}}>{hx.label}</div>
                  <div style={{flex:1,height:4,background:th.b1,borderRadius:2,overflow:"hidden"}}>
                    <div style={{width:`${pct}%`,height:"100%",background:"#EF4444",borderRadius:2}}/>
                  </div>
                  <div style={{width:20,fontSize:11,color:th.t3,textAlign:"right" as const,flexShrink:0}}>{count}</div>
                </div>
              ) : null;
            })}
          </div>
        </div>
      )}

      {/* PWA install prompt */}
      {showInstall&&(
        <div style={{position:"fixed" as const,bottom:90,left:12,right:12,zIndex:105,background:"#0D0D0D",border:"1px solid #1e1e1e",borderRadius:14,padding:"12px 14px",display:"flex",alignItems:"center",gap:10,animation:"fadeUp .2s ease"}}>
          <div style={{flex:1}}>
            <div style={{color:"#ccc",fontWeight:700,fontSize:13}}>Add to Home Screen</div>
            <div style={{color:"#555",fontSize:11}}>Works offline · No app store needed</div>
          </div>
          <button onClick={async()=>{installPrompt?.prompt();const r=await installPrompt?.userChoice;if(r?.outcome==="accepted")setShowInstall(false);}}
            style={{background:"#fff",border:"none",borderRadius:10,padding:"8px 14px",color:"#000",fontWeight:700,fontSize:13,fontFamily:"inherit"}}>Add</button>
          <button onClick={()=>setShowInstall(false)} style={{background:"none",border:"none",color:"#444",fontSize:20,lineHeight:1}}>×</button>
        </div>
      )}

      {/* ── REPORT MODAL ── */}
      {reporting&&(
        <div style={{position:"fixed" as const,inset:0,zIndex:200}} role="dialog" aria-modal="true" aria-label="Report a road hazard">
          <div style={{position:"absolute" as const,inset:0,background:"rgba(0,0,0,0.88)",backdropFilter:"blur(10px)"}}
            onClick={()=>{ if(!submitted){ setReporting(false); } }} aria-hidden="true"/>
          <div ref={modalRef} style={{position:"absolute" as const,bottom:0,left:0,right:0,background:"#0A0A0A",borderRadius:"20px 20px 0 0",border:"1px solid #1a1a1a",borderBottom:"none",height:"88vh",display:"flex",flexDirection:"column" as const,animation:"slideUp .26s cubic-bezier(.32,.72,0,1)"}}
            onKeyDown={(e)=>{
              if(e.key==="Tab"){
                const els=modalRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]),input,[tabindex]:not([tabindex='-1'])");
                if(!els||els.length===0) return;
                const first=els[0], last=els[els.length-1];
                if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
                else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
              }
            }}>
            {submitted ? (
              <SuccessScreen
                r={submitted}
                user={user}
                onClose={()=>{ setSubmitted(null); setReporting(false); }}
                onSignIn={()=>{ setSubmitted(null); setReporting(false); setShowAuth(true); }}
              />
            ) : (
              <>
                <div style={{flexShrink:0}}>
                  <div style={{display:"flex",justifyContent:"center",paddingTop:9,paddingBottom:2}}>
                    <div style={{width:36,height:4,borderRadius:2,background:"#1e1e1e"}} aria-hidden="true"/>
                  </div>
                  <div style={{padding:"10px 14px 12px",borderBottom:"1px solid #111",display:"flex",alignItems:"center",gap:10}}>
                    <div style={{width:34,height:34,borderRadius:"50%",background:"#111",border:"1px solid #1e1e1e",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}} aria-hidden="true">
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2L14 13H2L8 2Z" stroke="#555" strokeWidth="1.2" fill="none" strokeLinejoin="round"/><line x1="8" y1="6" x2="8" y2="9.5" stroke="#555" strokeWidth="1.2" strokeLinecap="round"/><circle cx="8" cy="11.5" r="0.7" fill="#555"/></svg>
                    </div>
                    <div style={{flex:1}}>
                      <div style={{color:"#fff",fontWeight:700,fontSize:14}}>Report a Hazard</div>
                      <div style={{fontSize:10,display:"flex",alignItems:"center",gap:4,marginTop:1}} aria-live="polite">
                        {gps.status==="locating"
                          ?<><div style={{width:7,height:7,border:"1.5px solid #333",borderTopColor:"#22C55E",borderRadius:"50%",animation:"spin .8s linear infinite"}} aria-hidden="true"/><span style={{color:"#555"}}>Getting location…</span></>
                          :gps.status==="live"
                          ?<><span style={{width:4,height:4,borderRadius:"50%",background:"#666",display:"inline-block"}} aria-hidden="true"/><span style={{color:"#888"}}>GPS locked · {gps.address}</span></>
                          :<><span style={{width:4,height:4,borderRadius:"50%",background:"#555",display:"inline-block"}} aria-hidden="true"/><span style={{color:"#555"}}>Location ready</span></>
                        }
                      </div>
                    </div>
                    <button onClick={()=>setLang(l=>l==="EN"?"TW":"EN")} aria-label={`Switch language to ${lang==="EN"?"Twi":"English"}`}
                      style={{background:"#111",border:"1px solid #1e1e1e",borderRadius:8,padding:"5px 9px",color:"#666",fontSize:9,fontWeight:900,letterSpacing:.5,fontFamily:"inherit"}}>
                      {lang==="EN"?"TW 🇬🇭":"EN 🇬🇧"}
                    </button>
                    <button onClick={()=>setReporting(false)} aria-label="Close report form"
                      style={{background:"#111",border:"1px solid #1e1e1e",borderRadius:8,width:30,height:30,display:"flex",alignItems:"center",justifyContent:"center",color:"#555",fontSize:18,lineHeight:1}}>×</button>
                  </div>
                </div>
                <div style={{flex:1,overflow:"hidden"}}>
                  <ReportForm gps={gps} onDone={onSubmit} lang={lang} userId={user?.id}/>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Destination sheet */}
      {showDestSheet&&(
        <DestinationSheet
          fromVal={routeFrom} toVal={routeTo}
          onSet={(f,t)=>{ setRouteFrom(f); setRouteTo(t); setTimeout(checkRoute,50); }}
          onClose={()=>setShowDestSheet(false)}
        />
      )}

      {/* Settings sheet */}
      {showSettings&&(
        <SettingsSheet theme={themeName} onTheme={onThemeChange} onClose={()=>setShowSettings(false)}/>
      )}

      {/* Hazard detail sheet */}
      {sheetReport&&(
        <HazardSheet
          r={sheetReport}
          distanceKm={feedReports.find((fr:any)=>fr.id===sheetReport.id)?._dist??null}
          confirmed={!!confirmed[sheetReport.id]}
          onConfirm={()=>{ doConfirm(sheetReport.id); }}
          onClose={()=>setSheetReport(null)}
        />
      )}

      {/* ── BOTTOM NAV ── */}
      <div style={{position:"fixed" as const,bottom:0,left:0,right:0,zIndex:99,background:th.nav,borderTop:`0.5px solid ${th.navBorder}`,backdropFilter:"blur(20px)"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-around",padding:"10px 8px 28px"}}>
          {/* Home */}
          <button onClick={()=>setTab("home")} style={{display:"flex",flexDirection:"column" as const,alignItems:"center",gap:3,background:"none",border:"none",fontFamily:"inherit",padding:"4px 10px"}}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M3 9.5L10 3l7 6.5V17a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z" stroke={tab==="home"?"#EF4444":th.t4} strokeWidth="1.3" fill={tab==="home"?"#EF4444":"none"} strokeLinejoin="round"/>
              <path d="M7.5 18V13h5v5" stroke={tab==="home"?"#EF4444":th.t4} strokeWidth="1.3" strokeLinejoin="round"/>
            </svg>
            <span style={{fontSize:8,fontWeight:700,letterSpacing:.5,color:tab==="home"?"#EF4444":th.t4}}>HOME</span>
          </button>
          {/* Report */}
          <button ref={fabRef} onClick={onReport} style={{display:"flex",flexDirection:"column" as const,alignItems:"center",gap:3,background:"none",border:"none",fontFamily:"inherit",padding:"4px 10px"}}>
            <div style={{width:40,height:40,borderRadius:"50%",background:th.bg2,border:`1px solid ${th.b1}`,display:"flex",alignItems:"center",justifyContent:"center",marginBottom:2}}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <line x1="8" y1="3" x2="8" y2="13" stroke={th.t2} strokeWidth="1.5" strokeLinecap="round"/>
                <line x1="3" y1="8" x2="13" y2="8" stroke={th.t2} strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </div>
            <span style={{fontSize:8,fontWeight:700,letterSpacing:.5,color:th.t4}}>REPORT</span>
          </button>
          {/* Alerts */}
          <button onClick={()=>setTab("alerts")} style={{display:"flex",flexDirection:"column" as const,alignItems:"center",gap:3,background:"none",border:"none",fontFamily:"inherit",padding:"4px 10px"}}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M10 2.5a6 6 0 016 6c0 3 1.5 4.5 1.5 4.5H2.5S4 11.5 4 8.5a6 6 0 016-6z" stroke={tab==="alerts"?"#EF4444":th.t4} strokeWidth="1.3" fill={tab==="alerts"?"rgba(239,68,68,0.15)":"none"}/>
              <path d="M8 16.5a2 2 0 004 0" stroke={tab==="alerts"?"#EF4444":th.t4} strokeWidth="1.3"/>
              {visibleAnnouncements.length>0&&<circle cx="15" cy="5" r="3" fill="#EF4444"/>}
            </svg>
            <span style={{fontSize:8,fontWeight:700,letterSpacing:.5,color:tab==="alerts"?"#EF4444":th.t4}}>ALERTS</span>
          </button>
          {/* Dashboard */}
          <button onClick={()=>setTab("dashboard")} style={{display:"flex",flexDirection:"column" as const,alignItems:"center",gap:3,background:"none",border:"none",fontFamily:"inherit",padding:"4px 10px"}}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <rect x="2" y="12" width="4" height="6" rx="1" fill={tab==="dashboard"?"#EF4444":th.t4}/>
              <rect x="8" y="8"  width="4" height="10" rx="1" fill={tab==="dashboard"?"#EF4444":th.t4}/>
              <rect x="14" y="4" width="4" height="14" rx="1" fill={tab==="dashboard"?"#EF4444":th.t4}/>
            </svg>
            <span style={{fontSize:8,fontWeight:700,letterSpacing:.5,color:tab==="dashboard"?"#EF4444":th.t4}}>DASHBOARD</span>
          </button>
        </div>
      </div>
    </div>
    </ThCtx.Provider>
  );
}
