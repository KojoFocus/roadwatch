"use client";

import { useState, useEffect, useRef, useCallback } from "react";
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
  return km < 1 ? `${Math.round(km*1000)}m away` : `${km.toFixed(1)}km away`;
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

// ─── SKELETON CARD ────────────────────────────────────────────────────────────
function SkeletonCard() {
  return (
    <div style={{background:"#0D0D0D",border:"1px solid #141414",borderRadius:16,overflow:"hidden",marginBottom:12}}>
      <div style={{height:160,background:"#111",position:"relative" as const,overflow:"hidden"}}>
        <div style={{position:"absolute" as const,inset:0,background:"linear-gradient(90deg,transparent 0%,rgba(255,255,255,0.03) 50%,transparent 100%)",animation:"shimmer 1.4s ease-in-out infinite",backgroundSize:"200% 100%"}}/>
      </div>
      <div style={{padding:"14px"}}>
        <div style={{display:"flex",gap:10,marginBottom:14}}>
          <div style={{width:42,height:42,borderRadius:12,background:"#141414",flexShrink:0}}/>
          <div style={{flex:1,display:"flex",flexDirection:"column" as const,gap:8,justifyContent:"center"}}>
            <div style={{height:13,width:"55%",borderRadius:6,background:"#141414"}}/>
            <div style={{height:10,width:"35%",borderRadius:6,background:"#111"}}/>
          </div>
          <div style={{height:20,width:60,borderRadius:20,background:"#141414",alignSelf:"center" as const}}/>
        </div>
        <div style={{height:40,borderRadius:10,background:"#111"}}/>
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
                  style={{background:"#111",border:"1px solid #1e1e1e",borderRadius:14,padding:"18px 12px",color:"#F0F0F0",fontSize:14,fontWeight:600,fontFamily:"inherit",display:"flex",alignItems:"center",gap:8,textAlign:"left" as const,transition:"border-color .15s,background .15s"}}>
                  <span style={{fontSize:26,flexShrink:0}}>{hx.e}</span>{hx.label}
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
                  style={{background:"#111",border:`1px solid ${SC[s.key]}22`,borderLeft:`3px solid ${SC[s.key]}`,borderRadius:14,padding:"14px 16px",color:"#F0F0F0",fontSize:14,fontWeight:600,fontFamily:"inherit",display:"flex",alignItems:"center",gap:12,textAlign:"left" as const}}>
                  <span style={{fontSize:22,flexShrink:0}}>{s.emoji}</span>
                  <div>
                    <div style={{fontWeight:700}}>{s.label}</div>
                    <div style={{color:"#777",fontSize:12,marginTop:2}}>{s.desc}</div>
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
            <div style={{background:"rgba(245,158,11,0.06)",border:"1px solid rgba(245,158,11,0.15)",borderRadius:12,padding:"11px 14px",marginBottom:16,display:"flex",alignItems:"flex-start",gap:8}}>
              <span style={{flexShrink:0}}>💡</span>
              <span style={{color:"#999",fontSize:12,lineHeight:1.55}}>{t.photoTip}</span>
            </div>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{display:"none"}} onChange={pickPhoto}/>
            <button onClick={()=>fileRef.current?.click()}
              style={{width:"100%",background:"#EF4444",border:"none",borderRadius:14,padding:"18px",color:"#fff",fontWeight:800,fontSize:16,fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",gap:10,marginBottom:10}}>
              <span style={{fontSize:22}}>📷</span>{t.takePhoto}
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
                  <span style={{fontSize:28}}>{h.e}</span>
                  <div>
                    <div style={{color:"#fff",fontWeight:700,fontSize:17}}>{h.label}</div>
                    <div style={{color:SC[form.severity||"MEDIUM"],fontSize:13,fontWeight:600,marginTop:3}}>{sev?.label||"Moderate"}</div>
                  </div>
                </div>
                <div style={{color:"#888",fontSize:13}}>📍 {gps?.address||"Accra, Ghana"}</div>
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

// ─── WHATSAPP SHARE ───────────────────────────────────────────────────────────
function shareWhatsApp(r: any) {
  const h    = hMeta(r.hazardType);
  const sev  = SEV_LABEL[r.severity] || r.severity;
  const text = `🚨 ${sev.toUpperCase()} ROAD HAZARD\n${h.e} ${h.label} — ${r.address}, Ghana.\n\n${r.upvoteCount||0} citizens confirmed this.\n\nRoadWatch Ghana: roadwatch-eight-pi.vercel.app`;
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
}

// ─── REPORT CARD ──────────────────────────────────────────────────────────────
function ReportCard({ r, confirmed, onConfirm, isNew, distanceKm }: { r:any; confirmed:boolean; onConfirm:()=>void; isNew?:boolean; distanceKm?:number|null }) {
  const h       = hMeta(r.hazardType);
  const isFixed = r.status === "RESOLVED";
  const color   = SC[r.severity] || "#F59E0B";

  if (isFixed) return (
    <div style={{background:"#0C0C0C",border:"1px solid rgba(34,197,94,0.15)",borderLeft:"3px solid #22C55E",borderRadius:16,overflow:"hidden",marginBottom:12}}>
      {r.photoUrl&&<img src={r.photoUrl} alt="" style={{width:"100%",height:72,objectFit:"cover",display:"block",filter:"grayscale(70%) brightness(0.4)"}}/>}
      <div style={{padding:"13px 14px"}}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
          <div style={{background:"rgba(34,197,94,0.1)",border:"1px solid rgba(34,197,94,0.2)",borderRadius:20,padding:"3px 9px",display:"flex",alignItems:"center",gap:4}}>
            <span style={{fontSize:10}}>✅</span>
            <span style={{color:"#22C55E",fontWeight:800,fontSize:9,letterSpacing:.8}}>FIXED</span>
          </div>
          <span style={{color:"#666",fontSize:12}}>{h.e} {h.label}</span>
          <span style={{color:"#3a3a3a",fontSize:11,marginLeft:"auto"}}>{ago(r.resolvedAt||r.createdAt)}</span>
        </div>
        <div style={{color:"#555",fontSize:12,marginBottom:r.resolutionNote?8:0}}>📍 {r.address}</div>
        {r.resolutionNote&&(
          <div style={{background:"#111",borderRadius:10,padding:"9px 12px",color:"#555",fontSize:12,lineHeight:1.6,fontStyle:"italic"}}>
            "{r.resolutionNote}"
            {r.fixedBy&&<span style={{color:"#3a3a3a",display:"block",marginTop:3,fontStyle:"normal",fontSize:11}}>— {r.fixedBy}</span>}
          </div>
        )}
        <div style={{color:"#3a3a3a",fontSize:11,marginTop:8}}>👍 {r.upvoteCount||0} citizens confirmed</div>
      </div>
    </div>
  );

  return (
    <div style={{
      background:"#0D0D0D",
      border:`1px solid ${isNew?"rgba(239,68,68,0.3)":"#141414"}`,
      borderRadius:16, overflow:"hidden", marginBottom:12,
      animation: isNew ? "newReport .35s ease" : "fadeUp .2s ease",
      boxShadow: isNew ? "0 0 20px rgba(239,68,68,0.12)" : "none",
    }}>
      <div style={{position:"relative" as const, height: r.photoUrl ? 190 : 88, overflow:"hidden"}}>
        {r.photoUrl ? (
          <>
            <img src={r.photoUrl} alt={h.label} style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}}/>
            <div style={{position:"absolute" as const,inset:0,background:"linear-gradient(to top, rgba(8,8,8,0.96) 0%, rgba(8,8,8,0.3) 55%, transparent 100%)"}}/>
          </>
        ) : (
          <div style={{width:"100%",height:"100%",background:"#0D0D0D",display:"flex",alignItems:"center",justifyContent:"center",borderBottom:"1px solid #141414"}}>
            <span style={{fontSize:40, opacity:.25}}>{h.e}</span>
          </div>
        )}
        <div style={{position:"absolute" as const,top:10,right:10}}>
          <span style={{color:r.severity==="CRITICAL"?"#EF4444":"#aaa",fontSize:9,fontWeight:700,background:"rgba(8,8,8,0.88)",backdropFilter:"blur(8px)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:20,padding:"4px 10px",letterSpacing:.8}}>
            {SEV_LABEL[r.severity]||r.severity}
          </span>
        </div>
        {isNew&&(
          <div style={{position:"absolute" as const,top:10,left:10,background:"#EF4444",borderRadius:20,padding:"4px 9px"}}>
            <span style={{color:"#fff",fontSize:9,fontWeight:900,letterSpacing:.8}}>JUST IN</span>
          </div>
        )}
        {r.photoUrl&&(
          <div style={{position:"absolute" as const,bottom:10,left:13,right:48,display:"flex",alignItems:"center",gap:8}}>
            <span style={{fontSize:22,flexShrink:0}}>{h.e}</span>
            <div>
              <div style={{color:"#fff",fontWeight:800,fontSize:15,lineHeight:1,textShadow:"0 1px 6px rgba(0,0,0,0.9)"}}>{h.label}</div>
              <div style={{color:"rgba(255,255,255,0.55)",fontSize:11,marginTop:2}}>📍 {r.address}</div>
            </div>
          </div>
        )}
      </div>

      <div style={{padding:"12px 14px"}}>
        {!r.photoUrl&&(
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
            <div style={{width:44,height:44,borderRadius:12,background:"#141414",border:"1px solid #1e1e1e",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,flexShrink:0}}>
              {h.e}
            </div>
            <div>
              <div style={{color:"#fff",fontWeight:700,fontSize:15}}>{h.label}</div>
              <div style={{color:"#555",fontSize:12,marginTop:2}}>📍 {r.address}</div>
            </div>
          </div>
        )}
        <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:12}}>
          <div style={{background:"#111",border:"1px solid #1e1e1e",borderRadius:6,padding:"2px 7px",flexShrink:0}}>
            <span style={{color:r.status==="VERIFIED"?"#fff":"#555",fontSize:9,fontWeight:700,letterSpacing:.5}}>{ST_LABEL[r.status]||r.status}</span>
          </div>
          <span style={{color:"#2a2a2a",fontSize:10}}>·</span>
          <span style={{color:"#555",fontSize:11}}>{ago(r.createdAt)}</span>
          {distanceKm != null && (
            <><span style={{color:"#2a2a2a",fontSize:10}}>·</span><span style={{color:distanceKm<2?"#ccc":"#555",fontSize:11,fontWeight:distanceKm<2?700:400}}>{fmtDist(distanceKm)}</span></>
          )}
        </div>
        <div style={{display:"flex",gap:8}}>
          <button onClick={onConfirm} disabled={confirmed}
            style={{flex:1,background:confirmed?"rgba(34,197,94,0.08)":"rgba(255,255,255,0.03)",border:`1px solid ${confirmed?"rgba(34,197,94,0.28)":"rgba(255,255,255,0.06)"}`,borderRadius:10,padding:"12px",color:confirmed?"#22C55E":"#888",fontWeight:700,fontSize:13,fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",gap:6,transition:"all .2s"}}>
            {confirmed?<><span style={{fontSize:14}}>✓</span> Confirmed · {r.upvoteCount||0}</>:<><span style={{fontSize:14}}>👍</span> I see this · {r.upvoteCount||0}</>}
          </button>
          <button onClick={()=>shareWhatsApp(r)} style={{background:"#111",border:"1px solid #1e1e1e",borderRadius:10,padding:"12px 14px",color:"#555",fontSize:14,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}} title="Share on WhatsApp">
            📤
          </button>
        </div>
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

      <div style={{width:80,height:80,borderRadius:"50%",background:queued?"rgba(245,158,11,0.1)":"rgba(34,197,94,0.1)",border:`2px solid ${queued?"#F59E0B":"#22C55E"}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:36,marginBottom:20,animation:"successPop .4s cubic-bezier(.175,.885,.32,1.275)"}}>
        {queued ? "⏳" : "✅"}
      </div>

      <div style={{color:"#fff",fontWeight:900,fontSize:22,marginBottom:8,letterSpacing:-.5}}>
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

      <div style={{fontSize:40,margin:"20px 0 8px"}}>{h.e}</div>
      <div style={{color:"#555",fontSize:13,marginBottom:28}}>{h.label} · {r.address||"Accra, Ghana"}</div>

      {!queued&&(
        <button onClick={()=>shareWhatsApp(r)} aria-label="Share this report on WhatsApp"
          style={{width:"100%",background:"rgba(37,211,102,0.08)",border:"1px solid rgba(37,211,102,0.25)",borderRadius:14,padding:"15px",color:"#25D366",fontWeight:700,fontSize:15,fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",gap:10,marginBottom:10}}>
          📤 Share on WhatsApp
        </button>
      )}

      {!queued && !user && onSignIn && (
        <button onClick={onSignIn}
          style={{width:"100%",background:"rgba(96,165,250,0.08)",border:"1px solid rgba(96,165,250,0.2)",borderRadius:14,padding:"15px",color:"#60A5FA",fontWeight:700,fontSize:14,fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",gap:10,marginBottom:10}}>
          🔐 Sign in to track this report
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
  const [tab,           setTab]           = useState("feed");
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
    <div style={{background:"#0A0A0A",minHeight:"100vh",fontFamily:"'Inter',-apple-system,sans-serif",color:"#fff",paddingBottom:80}}>
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
        input::placeholder{color:#333}
        ::-webkit-scrollbar{display:none}
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
      <div style={{background:"#080808",borderBottom:"1px solid #111",padding:"12px 18px",position:"sticky" as const,top:0,zIndex:50}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
          <div>
            <div style={{color:"#333",fontSize:8,fontWeight:700,letterSpacing:3,marginBottom:1}}>ROADWATCH GH</div>
            <div style={{color:"#fff",fontWeight:900,fontSize:16,letterSpacing:-.4,lineHeight:1}}>Watch the roads.</div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            {/* Push notification bell */}
            <button onClick={subscribePush} aria-label={pushEnabled?"Notifications on":"Enable notifications"}
              style={{background:"#111",border:"1px solid #1e1e1e",borderRadius:8,width:28,height:28,display:"flex",alignItems:"center",justifyContent:"center",color:pushEnabled?"#888":"#333",fontSize:12,fontWeight:700}}>
              {pushEnabled?"●":"○"}
            </button>

            {/* Auth */}
            {user ? (
              <button onClick={()=>signOut().then(()=>setUser(null))}
                style={{background:"#111",border:"1px solid #1e1e1e",borderRadius:20,padding:"5px 10px",color:"#666",fontSize:10,fontWeight:600,fontFamily:"inherit",letterSpacing:.3}}>
                {user.email?.split("@")[0] || user.phone?.slice(-4) || "ME"} · out
              </button>
            ) : (
              <button onClick={()=>setShowAuth(true)}
                style={{background:"#111",border:"1px solid #222",borderRadius:20,padding:"5px 11px",color:"#888",fontSize:10,fontWeight:600,letterSpacing:.3,fontFamily:"inherit"}}>
                Sign in
              </button>
            )}

            {isDemo&&<span style={{fontSize:8,fontWeight:900,letterSpacing:1.5,color:"#555",background:"#111",border:"1px solid #1e1e1e",borderRadius:20,padding:"3px 9px"}}>DEMO</span>}
            <div style={{background:"#0D0D0D",border:"1px solid #1a1a1a",borderRadius:20,padding:"5px 10px",display:"flex",alignItems:"center",gap:5}}>
              <span style={{width:4,height:4,borderRadius:"50%",background:"#22C55E",display:"inline-block"}}/>
              <span style={{color:"#555",fontSize:9,fontWeight:700,letterSpacing:1.5}}>LIVE</span>
            </div>
          </div>
        </div>

        {/* Stats strip */}
        <div style={{display:"flex",gap:0,borderRadius:10,overflow:"hidden",border:"1px solid #1a1a1a"}}>
          {[
            { value:activeReports.length, label:"Active",    color:"#fff"     },
            { value:criticalCount,         label:"Critical",  color:criticalCount>0?"#EF4444":"#fff" },
            { value:totalConfirmed,        label:"Confirmed", color:"#fff"     },
            { value:fixedReports.length,   label:"Fixed",     color:"#fff"     },
          ].map((s,i)=>(
            <div key={s.label} style={{flex:1,background:"#0D0D0D",padding:"7px 0",textAlign:"center" as const,borderLeft:i?`1px solid #1a1a1a`:"none"}}>
              <div style={{color:s.color,fontSize:16,fontWeight:900,lineHeight:1}}>{s.value}</div>
              <div style={{color:"#333",fontSize:9,fontWeight:700,letterSpacing:.5,marginTop:2}}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ══ FEED TAB ══ */}
      {tab==="feed"&&(
        <div style={{animation:"fadeUp .18s ease"}}>

          {/* Hero CTA */}
          <div style={{padding:"18px 18px 14px",borderBottom:"1px solid #111"}}>
            {/* Nearest warning banner */}
            {nearestWarning && (
              <div style={{background:"rgba(239,68,68,0.06)",border:"1px solid rgba(239,68,68,0.25)",borderLeft:"4px solid #EF4444",borderRadius:12,padding:"12px 14px",marginBottom:14}}>
                <div style={{fontSize:9,fontWeight:900,letterSpacing:2,color:"#EF4444",marginBottom:5}}>
                  ⚠ {SEV_LABEL[nearestWarning.severity].toUpperCase()} — NEAREST HAZARD
                </div>
                <div style={{color:"#fff",fontWeight:800,fontSize:16,lineHeight:1.2,marginBottom:3}}>
                  {hMeta(nearestWarning.hazardType).e} {hMeta(nearestWarning.hazardType).label}
                </div>
                <div style={{color:"#777",fontSize:12}}>
                  {nearestWarning.address}
                  {nearestWarning._dist!==null&&<span style={{color:"#bbb",fontWeight:700}}> · {fmtDist(nearestWarning._dist)}</span>}
                </div>
              </div>
            )}
            <div style={{color:"#444",fontSize:11,textAlign:"center" as const}}>Tap + below to report a hazard · Takes 30 seconds</div>
          </div>

          <div style={{padding:"14px 18px 0"}}>

            {/* Announcements */}
            {visibleAnnouncements.length>0&&(
              <div style={{marginBottom:14}}>
                {visibleAnnouncements.map(a=>{
                  const isEmergency = a.type==="EMERGENCY"||a.type==="ROAD_CLOSURE";
                  return(
                    <div key={a.id} style={{background:"#0D0D0D",border:`1px solid ${isEmergency?"rgba(239,68,68,0.2)":"#1a1a1a"}`,borderLeft:`2px solid ${isEmergency?"#EF4444":"#2a2a2a"}`,borderRadius:12,padding:"11px 13px",marginBottom:6,display:"flex",alignItems:"flex-start",gap:8}}>
                      <div style={{flex:1}}>
                        <div style={{display:"flex",alignItems:"center",gap:5,marginBottom:3}}>
                          <span style={{color:"#444",fontSize:9,fontWeight:700,letterSpacing:1}}>{a.region||"NATIONAL"}</span>
                        </div>
                        <div style={{color:"#e0e0e0",fontWeight:700,fontSize:13,marginBottom:2}}>{a.title}</div>
                        <div style={{color:"#555",fontSize:11,lineHeight:1.5}}>{a.body}</div>
                      </div>
                      <button onClick={()=>setDismissed(d=>new Set([...d,a.id]))}
                        style={{background:"none",border:"none",color:"#333",fontSize:20,lineHeight:1,padding:"0 2px",flexShrink:0}}>×</button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* My Reports (signed-in users) */}
            {user && myReports.length > 0 && (
              <div style={{marginBottom:16}}>
                <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:10}}>
                  <div style={{fontSize:9,fontWeight:700,letterSpacing:2,color:"#444"}}>MY REPORTS · {myReports.length}</div>
                </div>
                {myReports.slice(0,3).map(r=><ReportCard key={r.id} r={r} confirmed={!!confirmed[r.id]} onConfirm={()=>doConfirm(r.id)}/>)}
                <div style={{height:1,background:"#141414",margin:"16px 0"}}/>
              </div>
            )}

            {/* Sign-in nudge for non-users */}
            {!user && (
              <button onClick={()=>setShowAuth(true)}
                style={{width:"100%",background:"#0D0D0D",border:"1px solid #1a1a1a",borderRadius:12,padding:"11px 14px",marginBottom:14,display:"flex",alignItems:"center",gap:10,textAlign:"left" as const}}>
                <div style={{flex:1}}>
                  <div style={{color:"#888",fontWeight:600,fontSize:13}}>Sign in to track your reports</div>
                  <div style={{color:"#444",fontSize:11,marginTop:1}}>See your submissions · Get hazard alerts</div>
                </div>
                <span style={{color:"#333",fontSize:14}}>›</span>
              </button>
            )}

            {/* Search */}
            <div style={{position:"relative" as const,marginBottom:10}}>
              <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search road or area…"
                style={{width:"100%",background:"#0D0D0D",border:"1px solid #1a1a1a",borderRadius:12,padding:"10px 12px",color:"#ccc",fontSize:13,fontFamily:"inherit",outline:"none"}}/>
              {search&&<button onClick={()=>setSearch("")}
                style={{position:"absolute" as const,right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",color:"#555",fontSize:18,lineHeight:1}}>×</button>}
            </div>

            {/* Hazard filter pills */}
            <div style={{display:"flex",gap:6,overflowX:"auto" as const,paddingBottom:4,marginBottom:16}}>
              {[{key:"All",label:"All"},...H].map(hx=>(
                <button key={hx.key} onClick={()=>setHazardFilter(hx.key)}
                  style={{flexShrink:0,background:hazardFilter===hx.key?"#fff":"#0D0D0D",border:`1px solid ${hazardFilter===hx.key?"#fff":"#1e1e1e"}`,borderRadius:20,padding:"6px 12px",color:hazardFilter===hx.key?"#000":"#555",fontSize:11,fontWeight:700,fontFamily:"inherit",transition:"all .15s"}}>
                  {hx.label}
                </button>
              ))}
            </div>

            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
              <div style={{fontSize:9,fontWeight:900,letterSpacing:2,color:"#444"}}>CITIZEN REPORTS · {feedReports.length}</div>
              {watching>0&&<div style={{display:"flex",alignItems:"center",gap:4}}>
                <span style={{width:4,height:4,borderRadius:"50%",background:"#333",display:"inline-block"}}/>
                <span style={{color:"#333",fontSize:10}}>{watching} watching</span>
              </div>}
            </div>

            {loading&&[0,1,2].map(i=><SkeletonCard key={i}/>)}

            {!loading&&(feedReports.length===0
              ?<div style={{textAlign:"center" as const,padding:"52px 0"}}>
                <div style={{fontSize:44,marginBottom:12,opacity:.6}}>👁️</div>
                <div style={{color:"#fff",fontWeight:700,fontSize:16,marginBottom:6}}>No reports yet</div>
                <div style={{color:"#666",fontSize:13,marginBottom:24}}>Be the first watchdog on Ghana's roads.</div>
                <button onClick={onReport} style={{background:"#EF4444",border:"none",borderRadius:14,padding:"14px 28px",color:"#fff",fontWeight:800,fontSize:14,fontFamily:"inherit"}}>
                  🚨 Report a Hazard
                </button>
              </div>
              :feedReports.map((r:any)=><ReportCard key={r.id} r={r} confirmed={!!confirmed[r.id]} onConfirm={()=>doConfirm(r.id)} isNew={newReportIds.has(r.id)} distanceKm={r._dist}/>)
            )}

            {!loading&&fixedReports.length>0&&(
              <>
                <div style={{display:"flex",alignItems:"center",gap:10,margin:"28px 0 14px"}}>
                  <div style={{flex:1,height:1,background:"#141414"}}/>
                  <div style={{display:"flex",alignItems:"center",gap:6}}>
                    <span style={{fontSize:12}}>✅</span>
                    <span style={{fontSize:9,fontWeight:900,letterSpacing:2,color:"#22C55E"}}>RECENTLY FIXED · {fixedReports.length}</span>
                  </div>
                  <div style={{flex:1,height:1,background:"#141414"}}/>
                </div>
                {fixedReports.map(r=><ReportCard key={r.id} r={r} confirmed={!!confirmed[r.id]} onConfirm={()=>doConfirm(r.id)}/>)}
              </>
            )}
          </div>
        </div>
      )}

      {/* ══ ROUTE TAB ══ */}
      {tab==="route"&&(
        <div style={{padding:"20px 18px 0",animation:"fadeUp .18s ease"}}>
          <div style={{marginBottom:20}}>
            <div style={{color:"#fff",fontWeight:900,fontSize:20,letterSpacing:-.4,marginBottom:4}}>Check a Route</div>
            <div style={{color:"#666",fontSize:13}}>See what citizens have reported along any road.</div>
          </div>

          <div style={{display:"flex",flexDirection:"column" as const,gap:8,marginBottom:14}}>
            <div style={{position:"relative" as const}}>
              <span style={{position:"absolute" as const,left:13,top:"50%",transform:"translateY(-50%)",width:8,height:8,borderRadius:"50%",background:"#444",flexShrink:0}}/>
              <input value={routeFrom} onChange={e=>setRouteFrom(e.target.value)} onKeyDown={e=>e.key==="Enter"&&checkRoute()}
                placeholder="From — e.g. Spintex Road"
                style={{width:"100%",background:"#0D0D0D",border:"1px solid #1a1a1a",borderRadius:12,padding:"13px 12px 13px 32px",color:"#ccc",fontSize:14,fontFamily:"inherit",outline:"none"}}/>
            </div>
            <div style={{position:"relative" as const}}>
              <span style={{position:"absolute" as const,left:13,top:"50%",transform:"translateY(-50%)",width:8,height:8,borderRadius:"50%",background:"#333",flexShrink:0}}/>
              <input value={routeTo} onChange={e=>setRouteTo(e.target.value)} onKeyDown={e=>e.key==="Enter"&&checkRoute()}
                placeholder="To — e.g. Tema Motorway"
                style={{width:"100%",background:"#0D0D0D",border:"1px solid #1a1a1a",borderRadius:12,padding:"13px 12px 13px 32px",color:"#ccc",fontSize:14,fontFamily:"inherit",outline:"none"}}/>
            </div>
            <button onClick={checkRoute} disabled={checking||!routeFrom.trim()||!routeTo.trim()}
              style={{background:routeFrom.trim()&&routeTo.trim()?"#EF4444":"#111",border:"none",borderRadius:12,padding:"14px",color:routeFrom.trim()&&routeTo.trim()?"#fff":"#333",fontWeight:700,fontSize:15,fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
              {checking?<><div style={{width:16,height:16,border:"2px solid #fff4",borderTopColor:"#fff",borderRadius:"50%",animation:"spin .8s linear infinite"}}/>Checking…</>:<>🔍 Check Route</>}
            </button>
          </div>

          {/* Safety score */}
          {safetyScore!==null&&(
            <div style={{background:`rgba(${safetyScore>=8?"34,197,94":safetyScore>=5?"245,158,11":safetyScore>=3?"249,115,22":"239,68,68"},0.07)`,border:`1px solid rgba(${safetyScore>=8?"34,197,94":safetyScore>=5?"245,158,11":safetyScore>=3?"249,115,22":"239,68,68"},0.2)`,borderRadius:12,padding:"14px 16px",marginBottom:14,display:"flex",alignItems:"center",gap:14}}>
              <div style={{textAlign:"center" as const,flexShrink:0}}>
                <div style={{color:scoreColor(safetyScore),fontSize:28,fontWeight:900,lineHeight:1}}>{safetyScore}</div>
                <div style={{color:"#555",fontSize:10,marginTop:1}}>/ 10</div>
              </div>
              <div>
                <div style={{color:scoreColor(safetyScore),fontWeight:800,fontSize:14,letterSpacing:.5}}>{scoreLabel(safetyScore)}</div>
                <div style={{color:"#555",fontSize:12,marginTop:2}}>Route safety score based on citizen reports</div>
              </div>
            </div>
          )}

          {routeResult!==null&&(
            <div style={{animation:"fadeUp .15s ease"}}>
              <div style={{fontSize:9,fontWeight:900,letterSpacing:2,color:"#444",marginBottom:12}}>
                {routeResult.length===0?"NO REPORTS FOUND":`${routeResult.length} REPORT${routeResult.length!==1?"S":""} ON THIS ROUTE`}
              </div>
              {routeResult.length===0
                ?<div style={{background:"rgba(34,197,94,0.05)",border:"1px solid rgba(34,197,94,0.15)",borderRadius:14,padding:"28px",textAlign:"center" as const}}>
                  <div style={{fontSize:36,marginBottom:10}}>✅</div>
                  <div style={{color:"#22C55E",fontWeight:700,fontSize:16,marginBottom:4}}>Looking clear</div>
                  <div style={{color:"#555",fontSize:12}}>No citizen reports for these roads right now.</div>
                </div>
                :routeResult.map(r=><ReportCard key={r.id} r={r} confirmed={!!confirmed[r.id]} onConfirm={()=>doConfirm(r.id)}/>)
              }
            </div>
          )}

          {routeResult===null&&!checking&&(
            <div style={{textAlign:"center" as const,padding:"32px 0",color:"#333",fontSize:13}}>
              Enter a start and end point to see citizen reports along that road.
            </div>
          )}
        </div>
      )}

      {/* ══ MAP TAB ══ */}
      {tab==="map"&&(
        <div style={{position:"fixed" as const,top:113,bottom:72,left:0,right:0}}>
          {/* Route check bar */}
          <div style={{position:"absolute" as const,top:0,left:0,right:0,zIndex:10,background:"rgba(5,5,5,0.93)",backdropFilter:"blur(12px)",borderBottom:"1px solid #111",padding:"10px 14px"}}>
            <div style={{display:"flex",gap:7}}>
              <div style={{flex:1,position:"relative" as const}}>
                <span style={{position:"absolute" as const,left:10,top:"50%",transform:"translateY(-50%)",width:7,height:7,borderRadius:"50%",background:"#333"}}/>
                <input value={routeFrom} onChange={e=>setRouteFrom(e.target.value)} onKeyDown={e=>e.key==="Enter"&&checkRoute()}
                  placeholder="From"
                  style={{width:"100%",background:"#111",border:"1px solid #1a1a1a",borderRadius:10,padding:"9px 10px 9px 26px",color:"#ccc",fontSize:13,fontFamily:"inherit",outline:"none"}}/>
              </div>
              <div style={{flex:1,position:"relative" as const}}>
                <span style={{position:"absolute" as const,left:10,top:"50%",transform:"translateY(-50%)",width:7,height:7,borderRadius:"50%",background:"#333"}}/>
                <input value={routeTo} onChange={e=>setRouteTo(e.target.value)} onKeyDown={e=>e.key==="Enter"&&checkRoute()}
                  placeholder="To"
                  style={{width:"100%",background:"#111",border:"1px solid #1a1a1a",borderRadius:10,padding:"9px 10px 9px 26px",color:"#ccc",fontSize:13,fontFamily:"inherit",outline:"none"}}/>
              </div>
              <button onClick={checkRoute} disabled={checking||!routeFrom.trim()||!routeTo.trim()}
                style={{background:routeFrom.trim()&&routeTo.trim()?"#EF4444":"#111",border:"none",borderRadius:10,padding:"9px 14px",color:routeFrom.trim()&&routeTo.trim()?"#fff":"#333",fontWeight:700,fontSize:13,fontFamily:"inherit",flexShrink:0}}>
                {checking?<div style={{width:14,height:14,border:"2px solid #fff4",borderTopColor:"#fff",borderRadius:"50%",animation:"spin .8s linear infinite"}}/>:"🔍"}
              </button>
            </div>
            {/* Safety score on map */}
            {safetyScore!==null&&(
              <div style={{marginTop:6,display:"flex",alignItems:"center",gap:8}}>
                <span style={{color:scoreColor(safetyScore),fontSize:11,fontWeight:900,letterSpacing:1}}>
                  {scoreLabel(safetyScore)} · {safetyScore}/10
                </span>
                {routeResult&&routeResult.length>0&&(
                  <span style={{color:"#555",fontSize:10}}>⚠ {routeResult.length} hazard{routeResult.length!==1?"s":""} on route</span>
                )}
              </div>
            )}
            {safetyScore===null&&routeResult!==null&&(
              <div style={{marginTop:6,fontSize:10,fontWeight:700,letterSpacing:1.5,color:"#22C55E"}}>
                ✓ NO HAZARDS ON THIS ROUTE
              </div>
            )}
          </div>
          {/* Map fills remaining */}
          <div style={{position:"absolute" as const,top:safetyScore!==null?86:routeResult!==null?72:54,bottom:0,left:0,right:0}}>
            <MapView
              reports={routeResult!==null?routeResult:reports}
              hazardFilter={hazardFilter}
              onConfirm={doConfirm}
              confirmed={confirmed}
            />
          </div>
          {/* Filter pills overlay */}
          <div style={{position:"absolute" as const,bottom:10,left:12,right:0,zIndex:10,display:"flex",gap:5,overflowX:"auto" as const,paddingRight:12}}>
            {[{key:"All",e:"◈",label:"All"},...H].map(hx=>(
              <button key={hx.key} onClick={()=>setHazardFilter(hx.key)}
                style={{flexShrink:0,background:hazardFilter===hx.key?"rgba(255,255,255,0.95)":"rgba(8,8,8,0.88)",backdropFilter:"blur(8px)",border:`1px solid ${hazardFilter===hx.key?"rgba(255,255,255,0.9)":"rgba(255,255,255,0.06)"}`,borderRadius:20,padding:"5px 11px",color:hazardFilter===hx.key?"#000":"#777",fontSize:11,fontWeight:700,fontFamily:"inherit"}}>
                {hx.e} {hx.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* PWA install prompt */}
      {showInstall&&(
        <div style={{position:"fixed" as const,bottom:84,left:12,right:12,zIndex:105,background:"#0D0D0D",border:"1px solid #1e1e1e",borderRadius:14,padding:"12px 14px",display:"flex",alignItems:"center",gap:10,animation:"fadeUp .2s ease"}}>
          <span style={{fontSize:20}}>📲</span>
          <div style={{flex:1}}>
            <div style={{color:"#fff",fontWeight:700,fontSize:13}}>Add to Home Screen</div>
            <div style={{color:"#666",fontSize:11}}>Works offline · No app store needed</div>
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
                    <div style={{width:34,height:34,borderRadius:"50%",background:"linear-gradient(135deg,#EF4444,#7F1D1D)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,flexShrink:0}} aria-hidden="true">🚧</div>
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

      {/* ── BOTTOM NAV ── */}
      <div style={{position:"fixed" as const,bottom:0,left:0,right:0,zIndex:99,background:"rgba(8,8,8,0.97)",borderTop:"1px solid #111",backdropFilter:"blur(20px)"}}>
        <div style={{display:"flex",alignItems:"flex-end",paddingBottom:20}}>
          <NavBtn tKey="feed" label="Feed"/>
          <div style={{flex:1,display:"flex",justifyContent:"center",alignItems:"flex-end"}}>
            <div style={{position:"relative" as const,bottom:14}}>
              <button ref={fabRef} onClick={onReport} aria-label="Report a road hazard" style={{width:56,height:56,borderRadius:"50%",background:"#EF4444",border:"4px solid #080808",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,animation:"fabPulse 5s ease-in-out infinite"}}>
                🚨
              </button>
              <div style={{textAlign:"center" as const,marginTop:4,fontSize:9,fontWeight:800,letterSpacing:.6,color:"#EF4444",lineHeight:1}}>REPORT</div>
            </div>
          </div>
          <NavBtn tKey="map" label="Map"/>
        </div>
      </div>
    </div>
  );
}
