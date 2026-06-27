"use client";

import { useState, useEffect, useRef } from "react";
import dynamic                          from "next/dynamic";
import { uploadPhoto }                  from "@/lib/supabase";

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

const SC: Record<string,string> = { CRITICAL:"#EF4444", HIGH:"#F97316", MEDIUM:"#F59E0B", LOW:"#22C55E" };
const SO: Record<string,number> = { CRITICAL:0, HIGH:1, MEDIUM:2, LOW:3 };

const SEV_LABEL: Record<string,string> = { LOW:"Minor", MEDIUM:"Moderate", HIGH:"Dangerous", CRITICAL:"Critical" };

const ST_LABEL: Record<string,string> = {
  PENDING:"Awaiting review", VERIFIED:"Admin verified",
  IN_REVIEW:"Under review",  RESOLVED:"Fixed",         DISMISSED:"Dismissed",
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

function ago(iso: string) {
  const d = Math.floor((Date.now()-new Date(iso).getTime())/1000);
  if (d<60)    return "just now";
  if (d<3600)  return `${Math.floor(d/60)}m ago`;
  if (d<86400) return `${Math.floor(d/3600)}h ago`;
  return       `${Math.floor(d/86400)}d ago`;
}

async function revGeo(lat: number, lng: number): Promise<string|null> {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,{headers:{"Accept-Language":"en"}});
    const d = await r.json(); const a = d.address;
    return [a?.road||a?.pedestrian, a?.neighbourhood||a?.suburb||a?.town].filter(Boolean).slice(0,2).join(", ")||null;
  } catch { return null; }
}

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
          } catch { /* mic available, transcribe failed — silently degrade */ }
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

// ─── REPORT FORM (3-step, no chat delay) ──────────────────────────────────────
const STEP_ORDER = ["type","sev","photo","confirm"] as const;
type FormStep = typeof STEP_ORDER[number];

function ReportForm({ gps, onDone, lang }: { gps:any; onDone:(r:any)=>void; lang:Lang }) {
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
      latitude:  gps?.lat   || 5.6037,
      longitude: gps?.lng   || -0.1870,
      address:   gps?.address || "Accra",
      hazardType: form.hazardType,
      severity:   form.severity || "MEDIUM",
      photoUrl:   form.photoUrl || null,
    };
    try {
      const res  = await fetch("/api/reports",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
      const json = await res.json();
      if (json.success) { onDone(json.data); return; }
    } catch {}
    onDone({id:`local-${Date.now()}`,createdAt:new Date().toISOString(),status:"PENDING",upvoteCount:1,...payload});
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
                  style={{background:"#111",border:"1px solid #1e1e1e",borderRadius:14,padding:"16px 12px",color:"#F0F0F0",fontSize:14,fontWeight:600,fontFamily:"inherit",display:"flex",alignItems:"center",gap:8,textAlign:"left" as const}}>
                  <span style={{fontSize:22,flexShrink:0}}>{hx.e}</span>{hx.label}
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
  {id:"d1",hazardType:"POTHOLE",     severity:"CRITICAL",status:"VERIFIED",  latitude:5.6448,longitude:-0.0918,photoUrl:"https://images.unsplash.com/photo-1515162816999-a0c47dc192f7?w=600&q=80",upvoteCount:14,address:"Spintex Road",      region:"Greater Accra",createdAt:new Date(Date.now()-7200000).toISOString(),  resolvedAt:null},
  {id:"d2",hazardType:"FLOOD",       severity:"HIGH",    status:"IN_REVIEW", latitude:5.6412,longitude:-0.0882,photoUrl:"https://images.unsplash.com/photo-1574482620826-40685ca5eef2?w=600&q=80",upvoteCount:9, address:"Spintex Road",      region:"Greater Accra",createdAt:new Date(Date.now()-3600000).toISOString(),  resolvedAt:null},
  {id:"d3",hazardType:"POTHOLE",     severity:"CRITICAL",status:"VERIFIED",  latitude:5.6320,longitude:-0.0231,photoUrl:"https://images.unsplash.com/photo-1515162816999-a0c47dc192f7?w=600&q=80",upvoteCount:7, address:"Tema Motorway",     region:"Greater Accra",createdAt:new Date(Date.now()-10800000).toISOString(),resolvedAt:null},
  {id:"d4",hazardType:"ROAD_BLOCK",  severity:"HIGH",    status:"VERIFIED",  latitude:5.6439,longitude:-0.2366,photoUrl:null,                                                                        upvoteCount:5, address:"Atomic Junction",   region:"Greater Accra",createdAt:new Date(Date.now()-1800000).toISOString(),  resolvedAt:null},
  {id:"d5",hazardType:"BROKEN_LIGHT",severity:"MEDIUM",  status:"PENDING",   latitude:5.5487,longitude:-0.2077,photoUrl:"https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=600&q=80",upvoteCount:3, address:"Kwame Nkrumah Ave", region:"Greater Accra",createdAt:new Date(Date.now()-900000).toISOString(),   resolvedAt:null},
  {id:"d6",hazardType:"DEBRIS",      severity:"MEDIUM",  status:"RESOLVED",  latitude:5.5578,longitude:-0.2040,photoUrl:null,                                                                        upvoteCount:2, address:"Ring Road Central", region:"Greater Accra",createdAt:new Date(Date.now()-86400000).toISOString(),resolvedAt:new Date(Date.now()-43200000).toISOString(),resolutionNote:"Removed by GHA crew.",fixedBy:"GHA Roads Team"},
];

// ─── REPORT CARD ──────────────────────────────────────────────────────────────
function shareWhatsApp(r: any) {
  const h    = hMeta(r.hazardType);
  const sev  = SEV_LABEL[r.severity] || r.severity;
  const text = `🚨 ${sev.toUpperCase()} ROAD HAZARD\n${h.e} ${h.label} — ${r.address}, Ghana.\n\n${r.upvoteCount || 0} citizens confirmed this.\n\nRoadWatch Ghana: roadwatch-eight-pi.vercel.app`;
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
}

function ReportCard({ r, confirmed, onConfirm }: { r:any; confirmed:boolean; onConfirm:()=>void }) {
  const h       = hMeta(r.hazardType);
  const isFixed = r.status==="RESOLVED";

  if (isFixed) return(
    <div style={{background:"#0C0C0C",border:"1px solid rgba(34,197,94,0.15)",borderLeft:"3px solid #22C55E",borderRadius:14,overflow:"hidden",marginBottom:10}}>
      {r.photoUrl&&<img src={r.photoUrl} alt="" style={{width:"100%",height:80,objectFit:"cover",display:"block",opacity:.35}}/>}
      <div style={{padding:"12px 14px"}}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
          <span style={{fontSize:15}}>✅</span>
          <span style={{color:"#22C55E",fontWeight:700,fontSize:13}}>Fixed — {h.label}</span>
          <span style={{color:"#555",fontSize:11,marginLeft:"auto"}}>{ago(r.resolvedAt||r.createdAt)}</span>
        </div>
        <div style={{color:"#666",fontSize:12,marginBottom:6}}>📍 {r.address}{r.landmark?`, ${r.landmark}`:""}</div>
        {r.resolutionNote&&<div style={{background:"#141414",borderRadius:9,padding:"8px 11px",color:"#666",fontSize:12,lineHeight:1.55,fontStyle:"italic"}}>"{r.resolutionNote}"{r.fixedBy&&<span style={{color:"#444"}}> — {r.fixedBy}</span>}</div>}
        <div style={{color:"#555",fontSize:11,marginTop:8}}>👍 {r.upvoteCount||0} confirmed this</div>
      </div>
    </div>
  );

  return(
    <div style={{background:"#0D0D0D",border:`1px solid ${SC[r.severity]}22`,borderLeft:`3px solid ${SC[r.severity]}`,borderRadius:14,overflow:"hidden",marginBottom:10}}>
      {r.photoUrl&&<img src={r.photoUrl} alt="" style={{width:"100%",height:150,objectFit:"cover",display:"block"}}/>}
      <div style={{padding:"12px 14px"}}>
        <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:8,marginBottom:6}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <span style={{fontSize:22,flexShrink:0}}>{h.e}</span>
            <div>
              <div style={{color:"#fff",fontWeight:700,fontSize:14}}>{h.label}</div>
              <div style={{color:"#777",fontSize:12,marginTop:2}}>📍 {r.address}{r.landmark?`, ${r.landmark}`:""}</div>
            </div>
          </div>
          <span style={{color:SC[r.severity],fontSize:10,fontWeight:800,background:`${SC[r.severity]}15`,border:`1px solid ${SC[r.severity]}30`,borderRadius:20,padding:"3px 9px",flexShrink:0,whiteSpace:"nowrap" as const}}>
            {SEV_LABEL[r.severity]||r.severity}
          </span>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:10}}>
          <span style={{color:"#666",fontSize:10,fontWeight:700}}>{ST_LABEL[r.status]||r.status}</span>
          <span style={{color:"#333",fontSize:10}}>·</span>
          <span style={{color:"#555",fontSize:10,marginLeft:"auto"}}>{ago(r.createdAt)}</span>
        </div>
        <div style={{display:"flex",gap:7}}>
          <button onClick={onConfirm} disabled={confirmed}
            style={{flex:1,background:confirmed?"rgba(34,197,94,0.08)":"#141414",border:`1px solid ${confirmed?"rgba(34,197,94,0.25)":"#222"}`,borderRadius:10,padding:"11px",color:confirmed?"#22C55E":"#888",fontWeight:700,fontSize:13,fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
            {confirmed?<>✓ Confirmed</>:<>👍 Confirm · {r.upvoteCount||0}</>}
          </button>
          <button onClick={()=>shareWhatsApp(r)}
            style={{background:"#141414",border:"1px solid #222",borderRadius:10,padding:"11px 13px",color:"#25D366",fontSize:16,display:"flex",alignItems:"center",justifyContent:"center"}}
            title="Share on WhatsApp">
            📤
          </button>
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
  const [checking,      setChecking]      = useState(false);

  useEffect(()=>{
    fetch("/api/reports").then(r=>r.json()).then(j=>{
      if(j.success&&j.data.length>0){setReports(j.data);setIsDemo(false);}
    }).catch(()=>{});
    fetch("/api/announcements").then(r=>r.json()).then(j=>{if(j.success)setAnnouncements(j.data);});
    const handler=(e:any)=>{e.preventDefault();setInstallPrompt(e);setShowInstall(true);};
    window.addEventListener("beforeinstallprompt",handler);
    return ()=>window.removeEventListener("beforeinstallprompt",handler);
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

  const onReport=()=>{ if(gps.status==="idle") getGps(); setReporting(true); };
  const onSubmit=(r:any)=>{ if(r) setReports(p=>[r,...p]); setReporting(false); };

  const doConfirm=async(id:string)=>{
    if(confirmed[id]) return;
    setConfirmed(p=>({...p,[id]:true}));
    setReports(p=>p.map(r=>r.id===id?{...r,upvoteCount:(r.upvoteCount||0)+1}:r));
    await fetch(`/api/reports/${id}/upvote`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({fingerprint:`fp-${Date.now()}-${Math.random()}`})});
  };

  const checkRoute=async()=>{
    if(!routeFrom.trim()||!routeTo.trim()) return;
    setChecking(true); setRouteResult(null);
    await new Promise(r=>setTimeout(r,500));
    const terms=[routeFrom,routeTo].map(s=>s.toLowerCase());
    const hits=reports
      .filter(r=>r.status!=="RESOLVED"&&r.status!=="DISMISSED")
      .filter(r=>terms.some(t=>[(r.address||"").toLowerCase(),(r.landmark||"").toLowerCase(),(r.region||"").toLowerCase()].some(f=>f.includes(t))))
      .sort((a,b)=>SO[a.severity]-SO[b.severity]);
    setRouteResult(hits); setChecking(false);
  };

  const sq = search.trim().toLowerCase();
  const activeReports = reports.filter(r=>r.status!=="RESOLVED"&&r.status!=="DISMISSED");
  const fixedReports  = reports
    .filter(r=>r.status==="RESOLVED"&&r.resolutionNote)
    .sort((a,b)=>new Date(b.resolvedAt).getTime()-new Date(a.resolvedAt).getTime());
  const feedReports = activeReports
    .filter(r=>hazardFilter==="All"||r.hazardType===hazardFilter)
    .filter(r=>!sq||[(r.address||""),(r.landmark||""),(r.region||"")].some(f=>f.toLowerCase().includes(sq)))
    .sort((a,b)=>SO[a.severity]-SO[b.severity]||new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime());

  const criticalCount = activeReports.filter(r=>r.severity==="CRITICAL").length;
  const visibleAnnouncements = announcements.filter(a=>!dismissed.has(a.id));

  // Nav helper
  const NavBtn=({tKey,icon,label}:{tKey:string;icon:string;label:string})=>(
    <button onClick={()=>setTab(tKey)} style={{background:"none",border:"none",display:"flex",flexDirection:"column" as const,alignItems:"center",justifyContent:"center",gap:3,fontFamily:"inherit",padding:"4px 0"}}>
      <span style={{fontSize:20}}>{icon}</span>
      <span style={{fontSize:8,fontWeight:900,letterSpacing:.8,color:tab===tKey?"#EF4444":"#666"}}>{label.toUpperCase()}</span>
    </button>
  );

  return(
    <div style={{background:"#0A0A0A",minHeight:"100vh",fontFamily:"'Inter',-apple-system,sans-serif",color:"#fff",paddingBottom:80}}>
      <style>{`
        @keyframes fadeUp    {from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
        @keyframes slideUp   {from{transform:translateY(100%)}to{transform:translateY(0)}}
        @keyframes spin      {to{transform:rotate(360deg)}}
        @keyframes fabPulse  {0%,100%{box-shadow:0 4px 24px rgba(239,68,68,0.45),0 0 0 0 rgba(239,68,68,0)}65%{box-shadow:0 4px 24px rgba(239,68,68,0.45),0 0 0 10px rgba(239,68,68,0)}}
        @keyframes recordPulse{0%,100%{box-shadow:0 0 0 0 rgba(239,68,68,0.4)}70%{box-shadow:0 0 0 10px rgba(239,68,68,0)}}
        *{box-sizing:border-box;margin:0;padding:0}
        button{cursor:pointer;-webkit-tap-highlight-color:transparent}
        input::placeholder{color:#444}
        ::-webkit-scrollbar{display:none}
      `}</style>

      {/* ── HEADER ── */}
      <div style={{background:"#080808",borderBottom:"1px solid #111",padding:"13px 18px",display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky" as const,top:0,zIndex:50}}>
        <div>
          <div style={{color:"#EF4444",fontSize:8,fontWeight:900,letterSpacing:3,marginBottom:1}}>ROADWATCH GH</div>
          <div style={{color:"#fff",fontWeight:900,fontSize:16,letterSpacing:-.4,lineHeight:1}}>Watch the roads.</div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          {isDemo&&<span style={{fontSize:8,fontWeight:900,letterSpacing:1.5,color:"#666",background:"#111",border:"1px solid #1e1e1e",borderRadius:20,padding:"3px 9px"}}>PREVIEW</span>}
          <div style={{background:"rgba(34,197,94,0.06)",border:"1px solid rgba(34,197,94,0.18)",borderRadius:20,padding:"5px 10px",display:"flex",alignItems:"center",gap:4}}>
            <span style={{width:5,height:5,borderRadius:"50%",background:"#22C55E",display:"inline-block",boxShadow:"0 0 6px #22C55E"}}/>
            <span style={{color:"#22C55E",fontSize:9,fontWeight:900,letterSpacing:1.5}}>LIVE</span>
          </div>
        </div>
      </div>

      {/* ══ FEED TAB ══ */}
      {tab==="feed"&&(
        <div style={{animation:"fadeUp .18s ease"}}>

          {/* Hero */}
          <div style={{padding:"20px 18px 16px",borderBottom:"1px solid #111"}}>
            {criticalCount>0&&(
              <div style={{background:"rgba(239,68,68,0.06)",border:"1px solid rgba(239,68,68,0.18)",borderRadius:10,padding:"9px 14px",marginBottom:14,display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontSize:14}}>🔴</span>
                <span style={{color:"#EF4444",fontSize:12,fontWeight:700}}>{criticalCount} critical {criticalCount!==1?"hazards":"hazard"} on Ghana's roads right now</span>
              </div>
            )}
            <div style={{color:"#888",fontSize:13,marginBottom:8}}>See a road hazard?</div>
            <button onClick={onReport}
              style={{width:"100%",background:"#EF4444",border:"none",borderRadius:14,padding:"17px 20px",color:"#fff",fontWeight:900,fontSize:17,fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",gap:10,animation:"fabPulse 4s ease-in-out infinite",marginBottom:8}}>
              <span style={{fontSize:22}}>🚨</span> Report It Now
            </button>
            <div style={{color:"#555",fontSize:11,textAlign:"center" as const}}>Takes 30 seconds · Helps keep Ghana's roads safe</div>
          </div>

          <div style={{padding:"14px 18px 0"}}>
            {/* Announcements */}
            {visibleAnnouncements.length>0&&(
              <div style={{marginBottom:14}}>
                {visibleAnnouncements.map(a=>{
                  const at=A_TYPE[a.type]||A_TYPE.INFO;
                  return(
                    <div key={a.id} style={{background:at.bg,border:`1px solid ${at.border}`,borderLeft:`3px solid ${at.color}`,borderRadius:12,padding:"11px 13px",marginBottom:6,display:"flex",alignItems:"flex-start",gap:8}}>
                      <div style={{flex:1}}>
                        <div style={{display:"flex",alignItems:"center",gap:5,marginBottom:3}}>
                          <span style={{fontSize:12}}>{at.icon}</span>
                          <span style={{color:at.color,fontSize:9,fontWeight:800,letterSpacing:1}}>{a.region||"NATIONAL"}</span>
                        </div>
                        <div style={{color:"#fff",fontWeight:700,fontSize:13,marginBottom:2}}>{a.title}</div>
                        <div style={{color:"#888",fontSize:11,lineHeight:1.5}}>{a.body}</div>
                      </div>
                      <button onClick={()=>setDismissed(d=>new Set([...d,a.id]))}
                        style={{background:"none",border:"none",color:"#555",fontSize:20,lineHeight:1,padding:"0 2px",flexShrink:0}}>×</button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Search */}
            <div style={{position:"relative" as const,marginBottom:10}}>
              <span style={{position:"absolute" as const,left:11,top:"50%",transform:"translateY(-50%)",fontSize:14,pointerEvents:"none" as const}}>🔍</span>
              <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search road or area…"
                style={{width:"100%",background:"#0D0D0D",border:"1px solid #1a1a1a",borderRadius:12,padding:"10px 12px 10px 34px",color:"#ccc",fontSize:13,fontFamily:"inherit",outline:"none"}}/>
              {search&&<button onClick={()=>setSearch("")}
                style={{position:"absolute" as const,right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",color:"#555",fontSize:18,lineHeight:1}}>×</button>}
            </div>

            {/* Hazard type filter pills */}
            <div style={{display:"flex",gap:6,overflowX:"auto" as const,paddingBottom:4,marginBottom:14}}>
              {[{key:"All",e:"◈",label:"All"},...H].map(hx=>(
                <button key={hx.key} onClick={()=>setHazardFilter(hx.key)}
                  style={{flexShrink:0,background:hazardFilter===hx.key?"rgba(239,68,68,0.12)":"#0D0D0D",border:`1px solid ${hazardFilter===hx.key?"rgba(239,68,68,0.3)":"#1a1a1a"}`,borderRadius:20,padding:"6px 12px",color:hazardFilter===hx.key?"#EF4444":"#777",fontSize:11,fontWeight:700,fontFamily:"inherit"}}>
                  {hx.e} {hx.label}
                </button>
              ))}
            </div>

            {/* Section label */}
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
              <div style={{fontSize:9,fontWeight:900,letterSpacing:2,color:"#555"}}>CITIZEN REPORTS · {feedReports.length}</div>
              {fixedReports.length>0&&(
                <button onClick={()=>setTab("fixed")}
                  style={{background:"none",border:"none",color:"#22C55E",fontSize:11,fontWeight:700,fontFamily:"inherit",padding:0}}>
                  ✅ {fixedReports.length} fixed →
                </button>
              )}
            </div>

            {feedReports.length===0
              ?<div style={{textAlign:"center" as const,padding:"48px 0"}}>
                <div style={{fontSize:40,marginBottom:12}}>👁️</div>
                <div style={{color:"#fff",fontWeight:700,fontSize:16,marginBottom:6}}>No reports yet</div>
                <div style={{color:"#777",fontSize:13,marginBottom:20}}>Be the first watchdog on Ghana's roads.</div>
                <button onClick={onReport} style={{background:"#EF4444",border:"none",borderRadius:12,padding:"13px 24px",color:"#fff",fontWeight:700,fontSize:14,fontFamily:"inherit"}}>🚨 Report a Hazard</button>
              </div>
              :feedReports.map(r=><ReportCard key={r.id} r={r} confirmed={!!confirmed[r.id]} onConfirm={()=>doConfirm(r.id)}/>)
            }
          </div>
        </div>
      )}

      {/* ══ ROUTE TAB ══ */}
      {tab==="route"&&(
        <div style={{padding:"20px 18px 0",animation:"fadeUp .18s ease"}}>
          <div style={{marginBottom:20}}>
            <div style={{color:"#fff",fontWeight:900,fontSize:20,letterSpacing:-.4,marginBottom:4}}>Check a Route</div>
            <div style={{color:"#777",fontSize:13}}>See what citizens have reported along any road.</div>
          </div>

          <div style={{display:"flex",flexDirection:"column" as const,gap:8,marginBottom:14}}>
            <div style={{position:"relative" as const}}>
              <span style={{position:"absolute" as const,left:13,top:"50%",transform:"translateY(-50%)",width:8,height:8,borderRadius:"50%",background:"#22C55E",flexShrink:0}}/>
              <input value={routeFrom} onChange={e=>setRouteFrom(e.target.value)}
                onKeyDown={e=>e.key==="Enter"&&checkRoute()}
                placeholder="From — e.g. Spintex Road"
                style={{width:"100%",background:"#0D0D0D",border:"1px solid #1a1a1a",borderRadius:12,padding:"13px 12px 13px 32px",color:"#ccc",fontSize:14,fontFamily:"inherit",outline:"none"}}/>
            </div>
            <div style={{position:"relative" as const}}>
              <span style={{position:"absolute" as const,left:13,top:"50%",transform:"translateY(-50%)",width:8,height:8,borderRadius:"50%",background:"#EF4444",flexShrink:0}}/>
              <input value={routeTo} onChange={e=>setRouteTo(e.target.value)}
                onKeyDown={e=>e.key==="Enter"&&checkRoute()}
                placeholder="To — e.g. Tema Motorway"
                style={{width:"100%",background:"#0D0D0D",border:"1px solid #1a1a1a",borderRadius:12,padding:"13px 12px 13px 32px",color:"#ccc",fontSize:14,fontFamily:"inherit",outline:"none"}}/>
            </div>
            <button onClick={checkRoute} disabled={checking||!routeFrom.trim()||!routeTo.trim()}
              style={{background:routeFrom.trim()&&routeTo.trim()?"#EF4444":"#111",border:"none",borderRadius:12,padding:"14px",color:routeFrom.trim()&&routeTo.trim()?"#fff":"#444",fontWeight:700,fontSize:15,fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
              {checking?<><div style={{width:16,height:16,border:"2px solid #fff4",borderTopColor:"#fff",borderRadius:"50%",animation:"spin .8s linear infinite"}}/>Checking…</>:<>🔍 Check Route</>}
            </button>
          </div>

          {routeResult!==null&&(
            <div style={{animation:"fadeUp .15s ease"}}>
              <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:12}}>
                <div style={{fontSize:9,fontWeight:900,letterSpacing:2,color:"#555"}}>
                  {routeResult.length===0?"NO REPORTS FOUND":`${routeResult.length} REPORT${routeResult.length!==1?"S":""} MENTIONING THESE ROADS`}
                </div>
              </div>
              {routeResult.length===0
                ?<div style={{background:"rgba(34,197,94,0.05)",border:"1px solid rgba(34,197,94,0.15)",borderRadius:14,padding:"28px",textAlign:"center" as const}}>
                  <div style={{fontSize:36,marginBottom:10}}>✅</div>
                  <div style={{color:"#22C55E",fontWeight:700,fontSize:16,marginBottom:4}}>Looking clear</div>
                  <div style={{color:"#666",fontSize:12}}>No citizen reports for these roads right now.</div>
                </div>
                :routeResult.map(r=><ReportCard key={r.id} r={r} confirmed={!!confirmed[r.id]} onConfirm={()=>doConfirm(r.id)}/>)
              }
            </div>
          )}

          {routeResult===null&&!checking&&(
            <div style={{textAlign:"center" as const,padding:"32px 0",color:"#444",fontSize:13}}>
              Enter a start and end point to see citizen reports along that road.
            </div>
          )}
        </div>
      )}

      {/* ══ MAP TAB ══ */}
      {tab==="map"&&(
        <div style={{position:"fixed" as const,top:56,bottom:72,left:0,right:0}}>
          {/* Route check drawer at top of map */}
          <div style={{position:"absolute" as const,top:0,left:0,right:0,zIndex:10,background:"rgba(5,5,5,0.92)",backdropFilter:"blur(12px)",borderBottom:"1px solid #111",padding:"10px 14px"}}>
            <div style={{display:"flex",gap:7}}>
              <div style={{flex:1,position:"relative" as const}}>
                <span style={{position:"absolute" as const,left:10,top:"50%",transform:"translateY(-50%)",width:7,height:7,borderRadius:"50%",background:"#22C55E"}}/>
                <input value={routeFrom} onChange={e=>setRouteFrom(e.target.value)}
                  onKeyDown={e=>e.key==="Enter"&&checkRoute()}
                  placeholder="From"
                  style={{width:"100%",background:"#111",border:"1px solid #1a1a1a",borderRadius:10,padding:"9px 10px 9px 26px",color:"#ccc",fontSize:13,fontFamily:"inherit",outline:"none"}}/>
              </div>
              <div style={{flex:1,position:"relative" as const}}>
                <span style={{position:"absolute" as const,left:10,top:"50%",transform:"translateY(-50%)",width:7,height:7,borderRadius:"50%",background:"#EF4444"}}/>
                <input value={routeTo} onChange={e=>setRouteTo(e.target.value)}
                  onKeyDown={e=>e.key==="Enter"&&checkRoute()}
                  placeholder="To"
                  style={{width:"100%",background:"#111",border:"1px solid #1a1a1a",borderRadius:10,padding:"9px 10px 9px 26px",color:"#ccc",fontSize:13,fontFamily:"inherit",outline:"none"}}/>
              </div>
              <button onClick={checkRoute} disabled={checking||!routeFrom.trim()||!routeTo.trim()}
                style={{background:routeFrom.trim()&&routeTo.trim()?"#EF4444":"#111",border:"none",borderRadius:10,padding:"9px 14px",color:routeFrom.trim()&&routeTo.trim()?"#fff":"#333",fontWeight:700,fontSize:13,fontFamily:"inherit",flexShrink:0}}>
                {checking?<div style={{width:14,height:14,border:"2px solid #fff4",borderTopColor:"#fff",borderRadius:"50%",animation:"spin .8s linear infinite"}}/>:"🔍"}
              </button>
            </div>
            {routeResult!==null&&(
              <div style={{marginTop:6,fontSize:10,fontWeight:700,letterSpacing:1.5,color:routeResult.length===0?"#22C55E":"#F59E0B"}}>
                {routeResult.length===0?"✓ NO HAZARDS FOUND ON THIS ROUTE":`⚠ ${routeResult.length} HAZARD${routeResult.length!==1?"S":""} FOUND — CHECK PINS ON MAP`}
              </div>
            )}
          </div>
          {/* Map fills remaining space */}
          <div style={{position:"absolute" as const,top:routeResult!==null?86:54,bottom:0,left:0,right:0}}>
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
                style={{flexShrink:0,background:hazardFilter===hx.key?"rgba(239,68,68,0.9)":"rgba(5,5,5,0.88)",backdropFilter:"blur(8px)",border:`1px solid ${hazardFilter===hx.key?"#EF4444":"rgba(255,255,255,0.08)"}`,borderRadius:20,padding:"5px 11px",color:hazardFilter===hx.key?"#fff":"#aaa",fontSize:11,fontWeight:700,fontFamily:"inherit"}}>
                {hx.e} {hx.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ══ FIXED TAB ══ */}
      {tab==="fixed"&&(
        <div style={{padding:"20px 18px 0",animation:"fadeUp .18s ease"}}>
          <div style={{marginBottom:18}}>
            <div style={{color:"#fff",fontWeight:900,fontSize:20,letterSpacing:-.4,marginBottom:4}}>Roads Citizens Fixed</div>
            <div style={{color:"#777",fontSize:13}}>These hazards were reported and resolved.</div>
          </div>
          {fixedReports.length===0
            ?<div style={{textAlign:"center" as const,padding:"48px 0",color:"#555",fontSize:14}}>Nothing resolved yet</div>
            :fixedReports.map(r=><ReportCard key={r.id} r={r} confirmed={!!confirmed[r.id]} onConfirm={()=>doConfirm(r.id)}/>)
          }
        </div>
      )}

      {/* PWA install */}
      {showInstall&&(
        <div style={{position:"fixed" as const,bottom:76,left:12,right:12,zIndex:105,background:"#0D0D0D",border:"1px solid #1e1e1e",borderRadius:14,padding:"12px 14px",display:"flex",alignItems:"center",gap:10,animation:"fadeUp .2s ease"}}>
          <span style={{fontSize:20}}>📲</span>
          <div style={{flex:1}}>
            <div style={{color:"#fff",fontWeight:700,fontSize:13}}>Add to Home Screen</div>
            <div style={{color:"#777",fontSize:11}}>Works offline · No app store needed</div>
          </div>
          <button onClick={async()=>{installPrompt?.prompt();const r=await installPrompt?.userChoice;if(r?.outcome==="accepted")setShowInstall(false);}}
            style={{background:"#EF4444",border:"none",borderRadius:10,padding:"8px 14px",color:"#fff",fontWeight:700,fontSize:13,fontFamily:"inherit"}}>Add</button>
          <button onClick={()=>setShowInstall(false)} style={{background:"none",border:"none",color:"#555",fontSize:20,lineHeight:1}}>×</button>
        </div>
      )}

      {/* Report modal */}
      {reporting&&(
        <div style={{position:"fixed" as const,inset:0,zIndex:200}}>
          <div style={{position:"absolute" as const,inset:0,background:"rgba(0,0,0,0.88)",backdropFilter:"blur(10px)"}} onClick={()=>setReporting(false)}/>
          <div style={{position:"absolute" as const,bottom:0,left:0,right:0,background:"#0A0A0A",borderRadius:"20px 20px 0 0",border:"1px solid #1a1a1a",borderBottom:"none",height:"88vh",display:"flex",flexDirection:"column" as const,animation:"slideUp .26s cubic-bezier(.32,.72,0,1)"}}>
            {/* Modal header */}
            <div style={{flexShrink:0}}>
              <div style={{display:"flex",justifyContent:"center",paddingTop:9,paddingBottom:2}}>
                <div style={{width:36,height:4,borderRadius:2,background:"#1e1e1e"}}/>
              </div>
              <div style={{padding:"10px 14px 12px",borderBottom:"1px solid #111",display:"flex",alignItems:"center",gap:10}}>
                <div style={{width:34,height:34,borderRadius:"50%",background:"linear-gradient(135deg,#EF4444,#7F1D1D)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,flexShrink:0}}>🚧</div>
                <div style={{flex:1}}>
                  <div style={{color:"#fff",fontWeight:700,fontSize:14}}>Report a Hazard</div>
                  <div style={{fontSize:10,display:"flex",alignItems:"center",gap:4,marginTop:1}}>
                    {gps.status==="locating"
                      ?<><div style={{width:7,height:7,border:"1.5px solid #333",borderTopColor:"#22C55E",borderRadius:"50%",animation:"spin .8s linear infinite"}}/><span style={{color:"#666"}}>Getting location…</span></>
                      :gps.status==="live"
                      ?<><span style={{width:4,height:4,borderRadius:"50%",background:"#22C55E",display:"inline-block"}}/><span style={{color:"#4ade80"}}>GPS locked · {gps.address}</span></>
                      :<><span style={{width:4,height:4,borderRadius:"50%",background:"#666",display:"inline-block"}}/><span style={{color:"#666"}}>Location ready</span></>
                    }
                  </div>
                </div>
                <button onClick={()=>setLang(l=>l==="EN"?"TW":"EN")}
                  style={{background:"#111",border:"1px solid #1e1e1e",borderRadius:8,padding:"5px 9px",color:"#777",fontSize:9,fontWeight:900,letterSpacing:.5,fontFamily:"inherit"}}>
                  {lang==="EN"?"TW 🇬🇭":"EN 🇬🇧"}
                </button>
                <button onClick={()=>setReporting(false)}
                  style={{background:"#111",border:"1px solid #1e1e1e",borderRadius:8,width:30,height:30,display:"flex",alignItems:"center",justifyContent:"center",color:"#666",fontSize:18,lineHeight:1}}>×</button>
              </div>
            </div>
            <div style={{flex:1,overflow:"hidden"}}>
              <ReportForm gps={gps} onDone={onSubmit} lang={lang}/>
            </div>
          </div>
        </div>
      )}

      {/* ── BOTTOM NAV ── */}
      {/* Grid: [Feed][Route][FAB-center][Fixed][ghost] — FAB at column 3/5 = true center */}
      <div style={{position:"fixed" as const,bottom:0,left:0,right:0,background:"rgba(5,5,5,0.97)",borderTop:"1px solid #111",paddingBottom:20,display:"grid",gridTemplateColumns:"1fr 1fr 56px 1fr 1fr",alignItems:"end",backdropFilter:"blur(20px)",zIndex:99}}>
        <div style={{padding:"9px 0 0"}}><NavBtn tKey="feed"  icon="📋" label="Feed"/></div>
        <div style={{padding:"9px 0 0"}}><NavBtn tKey="map"   icon="🗺️" label="Map"/></div>
        {/* Centre FAB — raised above nav */}
        <div style={{display:"flex",justifyContent:"center",alignItems:"flex-end",paddingBottom:0}}>
          <button onClick={onReport}
            style={{background:"#EF4444",border:"3px solid #050505",borderRadius:"50%",width:58,height:58,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,position:"relative" as const,bottom:16,boxShadow:"0 4px 24px rgba(239,68,68,0.55)"}}>
            🚨
          </button>
        </div>
        <div style={{padding:"9px 0 0"}}><NavBtn tKey="fixed" icon="✅" label="Fixed"/></div>
        <div/>{/* ghost — mirrors Feed slot for symmetric centering */}
      </div>
    </div>
  );
}
