"use client";

import { useState, useEffect, useRef } from "react";
import { uploadPhoto }                  from "@/lib/supabase";

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

const SEV: Record<string, any> = {
  LOW:      { label:"Minor",     c:"#22C55E", bg:"rgba(34,197,94,0.10)",   b:"rgba(34,197,94,0.25)"  },
  MEDIUM:   { label:"Moderate",  c:"#F59E0B", bg:"rgba(245,158,11,0.10)",  b:"rgba(245,158,11,0.25)" },
  HIGH:     { label:"Dangerous", c:"#F97316", bg:"rgba(249,115,22,0.10)",  b:"rgba(249,115,22,0.28)" },
  CRITICAL: { label:"Critical",  c:"#EF4444", bg:"rgba(239,68,68,0.10)",   b:"rgba(239,68,68,0.28)"  },
};
const SC: Record<string, string> = { CRITICAL:"#EF4444", HIGH:"#F97316", MEDIUM:"#F59E0B", LOW:"#22C55E" };
const SO: Record<string, number> = { CRITICAL:0, HIGH:1, MEDIUM:2, LOW:3 };

const ST_LABEL: Record<string, string> = {
  PENDING:"Awaiting review", VERIFIED:"Admin verified", IN_REVIEW:"Under review",
  RESOLVED:"Fixed", DISMISSED:"Dismissed",
};

const A_TYPE: Record<string, { color:string; bg:string; border:string; icon:string }> = {
  INFO:         { color:"#60A5FA", bg:"rgba(96,165,250,0.08)",   border:"rgba(96,165,250,0.2)",  icon:"ℹ️" },
  WARNING:      { color:"#F59E0B", bg:"rgba(245,158,11,0.08)",  border:"rgba(245,158,11,0.22)", icon:"⚠️" },
  ROAD_CLOSURE: { color:"#EF4444", bg:"rgba(239,68,68,0.08)",   border:"rgba(239,68,68,0.2)",   icon:"🚫" },
  MAINTENANCE:  { color:"#A78BFA", bg:"rgba(167,139,250,0.08)", border:"rgba(167,139,250,0.2)", icon:"🔧" },
  EMERGENCY:    { color:"#EF4444", bg:"rgba(239,68,68,0.1)",    border:"rgba(239,68,68,0.3)",   icon:"🚨" },
};

function getConf(r: any) {
  if (r.status==="VERIFIED"||r.status==="IN_REVIEW") return "HIGH";
  if ((r.upvoteCount||0)>=3) return "CONFIRMED";
  if (r.photoUrl) return "MEDIUM";
  return "LOW";
}

function ago(iso: string) {
  const d = Math.floor((Date.now()-new Date(iso).getTime())/1000);
  if (d<60)    return "just now";
  if (d<3600)  return `${Math.floor(d/60)}m ago`;
  if (d<86400) return `${Math.floor(d/3600)}h ago`;
  return `${Math.floor(d/86400)}d ago`;
}

async function revGeo(lat: number, lng: number): Promise<string|null> {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,{headers:{"Accept-Language":"en"}});
    const d = await r.json(); const a = d.address;
    return [a?.road||a?.pedestrian, a?.neighbourhood||a?.suburb||a?.town].filter(Boolean).slice(0,2).join(", ")||null;
  } catch { return null; }
}

// ─── VOICE BUTTON ─────────────────────────────────────────────────────────────
function VoiceButton({ onResult, onDenied }: { onResult:(r:any)=>void; onDenied?:()=>void }) {
  const [state,  setState]  = useState<"idle"|"recording"|"processing"|"denied">("idle");
  const [secs,   setSecs]   = useState(0);
  const mediaRef  = useRef<MediaRecorder|null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef  = useRef<any>(null);
  const mimeRef   = useRef<string>("");

  const start = async (e: any) => {
    e.preventDefault(); if (state!=="idle") return;
    chunksRef.current=[];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({audio:true});
      const mime   = ["audio/webm;codecs=opus","audio/webm","audio/ogg"].find(t=>MediaRecorder.isTypeSupported(t))||"audio/webm";
      mimeRef.current=mime;
      const rec = new MediaRecorder(stream,{mimeType:mime});
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
            if(json.success) onResult({...json.data,_audioBlob:blob,_mimeType:mime});
          } catch { onDenied?.(); }
          setState("idle"); setSecs(0);
        };
        reader.readAsDataURL(blob);
      };
      rec.start(100); setState("recording");
      timerRef.current=setInterval(()=>setSecs(s=>s+1),1000);
    } catch { setState("denied"); onDenied?.(); }
  };
  const stop=(e:any)=>{e.preventDefault();if(state!=="recording")return;clearInterval(timerRef.current);mediaRef.current?.stop();};

  if (state==="denied") return(
    <div style={{background:"rgba(239,68,68,0.05)",border:"1px solid rgba(239,68,68,0.15)",borderRadius:12,padding:"12px 14px",display:"flex",alignItems:"center",gap:8}}>
      <span style={{fontSize:16}}>🎙️</span>
      <div><div style={{color:"#EF4444",fontSize:12,fontWeight:700}}>Mic access denied</div><div style={{color:"#555",fontSize:11,marginTop:1}}>Tap a hazard type above instead</div></div>
    </div>
  );
  if (state==="processing") return(
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:8,padding:"14px",color:"#666",fontSize:13}}>
      <div style={{width:16,height:16,border:"2px solid #333",borderTopColor:"#EF4444",borderRadius:"50%",animation:"spin .8s linear infinite"}}/>Processing voice…
    </div>
  );
  return(
    <button onMouseDown={start} onTouchStart={start} onMouseUp={stop} onTouchEnd={stop}
      style={{width:"100%",background:state==="recording"?"rgba(239,68,68,0.12)":"#141414",border:`1px solid ${state==="recording"?"rgba(239,68,68,0.4)":"#1a1a1a"}`,borderRadius:14,padding:"14px",fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",gap:8,color:state==="recording"?"#EF4444":"#555",fontSize:14,fontWeight:600,animation:state==="recording"?"recordPulse 1s ease-in-out infinite":"none"}}>
      <span style={{fontSize:20}}>{state==="recording"?"⏹":"🎙️"}</span>
      {state==="recording"?`Recording… ${secs}s — release to send`:"Hold to describe in any language"}
    </button>
  );
}

// ─── CHAT REPORT (bot-guided report flow) ─────────────────────────────────────
const BOT_STR = {
  EN: { opener:"What did you spot on the road?", howBad:"How bad is it?", photo:"Snap a photo if you can — it goes live faster.", gotIt:"Got it.", ready:"Ready to submit?", skip:"Okay — it'll be reviewed before going live. Ready?", done:["✅ Report submitted.","Your pin is live.","Thank you 🇬🇭"], noMic:"Mic not available — tap a hazard type above.", noClass:"I heard you but couldn't classify it — tap the type below.", voiceGot:"Got it from your voice.", photoAdd:"📷 Photo uploaded.", photoLoc:"📷 Photo added." },
  TW: { opener:"Hwɛ biribi a ɛyɛ den wɔ ɔkwan so?", howBad:"Ɛyɛ den sɛn?", photo:"Sɛ wobetumi a, fa foto — ɛkɔ live ntɛm.", gotIt:"Mete aseɛ.", ready:"Wo ho di?", skip:"Okiir — wɔbɛhwɛ ansa na ɛkɔ live. Wo ho di?", done:["✅ Woasoma.","Wo pin wɔ map so live.","Meda wo ase 🇬🇭"], noMic:"Mik nni hɔ — twa hazard type a ɛwɔ soro.", noClass:"Metee wo asɛm nanso meennye type nho — twa type a ɛwɔ ase.", voiceGot:"Megye wo asɛm.", photoAdd:"📷 Foto asoma.", photoLoc:"📷 Foto aka ho." },
} as const;
type Lang = keyof typeof BOT_STR;

function Bot({ text }: { text:string }) {
  return(
    <div style={{display:"flex",alignItems:"flex-end",gap:8,marginBottom:6}}>
      <div style={{width:28,height:28,borderRadius:"50%",background:"linear-gradient(135deg,#EF4444,#7F1D1D)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,flexShrink:0}}>🚧</div>
      <div style={{background:"#1A1A1A",borderRadius:"15px 15px 15px 4px",padding:"10px 14px",maxWidth:"82%",color:"#F0F0F0",fontSize:14,lineHeight:1.55}}>{text}</div>
    </div>
  );
}
function UserMsg({ text, img }: { text?:string; img?:string }) {
  return(
    <div style={{display:"flex",justifyContent:"flex-end",marginBottom:6}}>
      <div style={{background:"#B91C1C",borderRadius:img?"13px 13px 4px 13px":"15px 15px 4px 15px",padding:img?"5px":"10px 14px",maxWidth:260,color:"#fff",fontSize:14}}>
        {img?<img src={img} alt="" style={{width:214,height:136,objectFit:"cover",borderRadius:8,display:"block"}}/>:text}
      </div>
    </div>
  );
}
function Dots() {
  return(
    <div style={{display:"flex",alignItems:"flex-end",gap:8,marginBottom:6}}>
      <div style={{width:28,height:28,borderRadius:"50%",background:"linear-gradient(135deg,#EF4444,#7F1D1D)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,flexShrink:0}}>🚧</div>
      <div style={{background:"#1A1A1A",borderRadius:"15px 15px 15px 4px",padding:"10px 14px",display:"flex",gap:4}}>
        {[0,1,2].map(i=><div key={i} style={{width:6,height:6,borderRadius:"50%",background:"#444",animation:`bob 1.2s ${i*.2}s infinite`}}/>)}
      </div>
    </div>
  );
}

function ChatReport({ gps, onDone, lang }: { gps:any; onDone:(r:any)=>void; lang:Lang }) {
  const [msgs,      setMsgs]      = useState<any[]>([]);
  const [typing,    setTyping]    = useState(false);
  const [mode,      setMode]      = useState<string|null>(null);
  const [form,      setForm]      = useState({hazardType:"",severity:"",photoUrl:"",transcript:""});
  const [uploading, setUploading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef   = useRef<HTMLInputElement>(null);
  const booted    = useRef(false);
  const t = BOT_STR[lang];

  const scroll   = () => setTimeout(()=>bottomRef.current?.scrollIntoView({behavior:"smooth"}),60);
  const pushBot  = (texts:string[]) => new Promise<void>(res=>{
    setTyping(true); scroll();
    setTimeout(()=>{setTyping(false);setMsgs(p=>[...p,...texts.map(txt=>({role:"bot",t:txt}))]);scroll();res();},850);
  });
  const pushUser = (txt?:string,img?:string)=>{setMsgs(p=>[...p,{role:"user",t:txt,img}]);scroll();};
  const pushInfo = (txt:string,c="#4ade80")=>{setMsgs(p=>[...p,{role:"info",t:txt,c}]);scroll();};

  useEffect(()=>{
    if(booted.current) return; booted.current=true;
    pushBot([t.opener]).then(()=>setMode("hazard"));
  },[]);
  useEffect(()=>{if(gps?.address) pushInfo(`📍 ${gps.address}`);},[gps?.address]);

  const pickH=async(h:any)=>{
    setMode(null);setForm(p=>({...p,hazardType:h.key}));pushUser(`${h.e} ${h.label}`);
    await pushBot([`${h.label} — ${t.gotIt}`,t.howBad]);setMode("sev");
  };
  const SEVS=[{key:"LOW",emoji:"🟢",label:"Minor"},{key:"MEDIUM",emoji:"🟡",label:"Moderate"},{key:"HIGH",emoji:"🟠",label:"Dangerous"},{key:"CRITICAL",emoji:"🔴",label:"Critical"}];
  const pickS=async(s:any)=>{
    setMode(null);setForm(p=>({...p,severity:s.key}));pushUser(`${s.emoji} ${s.label}`);
    await pushBot([t.gotIt,t.photo]);setMode("photo");
  };
  const pickP=async(e:any)=>{
    setMode(null);
    const file=e.target?.files?.[0];
    if(file){
      const preview=URL.createObjectURL(file);
      pushUser(undefined,preview);setUploading(true);
      try{const url=await uploadPhoto(file);setForm(p=>({...p,photoUrl:url}));await pushBot([t.photoAdd,t.ready]);}
      catch{setForm(p=>({...p,photoUrl:preview}));await pushBot([t.photoLoc,t.ready]);}
      finally{setUploading(false);}
    } else {pushUser("Skip photo");await pushBot([t.skip]);}
    setMode("confirm");
  };
  const handleVoice=async(result:any)=>{
    if(result.hazardType){
      const h=hMeta(result.hazardType);
      setForm(p=>({...p,hazardType:result.hazardType,severity:result.severity||"",transcript:result.transcript||""}));
      pushUser(`🎙️ "${result.transcript}"`);
      const sev=result.severity?SEV[result.severity]?.label:null;
      const loc=result.locationHint?` near ${result.locationHint}`:"";
      await pushBot([`I heard: "${result.transcript}". Looks like a ${h.label}${loc}${sev?` — ${sev} severity`:""}.`]);
      setMode("voice-confirm");
    } else {
      pushUser(`🎙️ "${result.transcript}"`);
      await pushBot([t.noClass]);setMode("hazard");
    }
  };
  const acceptVoice=async()=>{
    const h=hMeta(form.hazardType);pushUser(`${h.e} ${h.label}`);
    if(form.severity){await pushBot([t.voiceGot,t.photo]);setMode("photo");}
    else{await pushBot([t.howBad]);setMode("sev");}
  };
  const rejectVoice=async()=>{setForm(p=>({...p,hazardType:"",severity:""}));pushUser("Fix");await pushBot([t.opener]);setMode("hazard");};

  const submit=async()=>{
    setMode(null);pushUser("Submit");
    const payload={latitude:gps?.lat||5.6037,longitude:gps?.lng||-0.1870,address:gps?.address||"Accra",hazardType:form.hazardType,severity:form.severity,photoUrl:form.photoUrl||null,transcript:form.transcript||null};
    try{
      const res=await fetch("/api/reports",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
      const json=await res.json();
      if(json.success){await pushBot(t.done as unknown as string[]);setMode("done");setTimeout(()=>onDone(json.data),1000);return;}
    } catch {}
    await pushBot(t.done as unknown as string[]);setMode("done");
    setTimeout(()=>onDone({id:`local-${Date.now()}`,createdAt:new Date().toISOString(),status:"PENDING",upvoteCount:1,...payload}),1000);
  };

  const hm=H.find(x=>x.key===form.hazardType);

  return(
    <div style={{display:"flex",flexDirection:"column",height:"100%",background:"#0A0A0A"}}>
      <div style={{flex:1,overflowY:"auto",padding:"12px 14px 6px"}}>
        {msgs.map((m,i)=>
          m.role==="bot"?<Bot key={i} text={m.t}/>:
          m.role==="user"?<UserMsg key={i} text={m.t} img={m.img}/>:
          <div key={i} style={{textAlign:"center",margin:"6px 0 8px"}}>
            <span style={{color:m.c,fontSize:11,background:"rgba(0,0,0,0.4)",padding:"4px 12px",borderRadius:20,border:`1px solid ${m.c}22`}}>{m.t}</span>
          </div>
        )}
        {typing&&<Dots/>}
        {mode==="voice-confirm"&&(
          <div style={{paddingLeft:36,marginBottom:8,animation:"fadeUp .2s ease"}}>
            <div style={{display:"flex",gap:7}}>
              <button onClick={acceptVoice} style={{flex:1,background:"rgba(34,197,94,0.08)",border:"1px solid rgba(34,197,94,0.25)",borderRadius:12,padding:"11px",color:"#4ade80",fontWeight:700,fontSize:13,fontFamily:"inherit"}}>✓ Yes, that's right</button>
              <button onClick={rejectVoice} style={{background:"#141414",border:"1px solid #1a1a1a",borderRadius:12,padding:"11px 14px",color:"#555",fontWeight:600,fontSize:13,fontFamily:"inherit"}}>Fix it</button>
            </div>
          </div>
        )}
        {uploading&&<div style={{paddingLeft:36,marginBottom:8}}><div style={{color:"#555",fontSize:12,display:"flex",alignItems:"center",gap:6}}><div style={{width:12,height:12,border:"2px solid #333",borderTopColor:"#F59E0B",borderRadius:"50%",animation:"spin .8s linear infinite"}}/>Uploading photo…</div></div>}
        {mode==="confirm"&&(
          <div style={{paddingLeft:36,marginBottom:8,animation:"fadeUp .2s ease"}}>
            <div style={{background:"#161616",border:"1px solid #222",borderRadius:14,overflow:"hidden"}}>
              {form.photoUrl&&<img src={form.photoUrl} alt="" style={{width:"100%",height:120,objectFit:"cover",display:"block"}}/>}
              <div style={{padding:"12px 14px"}}>
                <div style={{display:"flex",gap:8,marginBottom:8}}>
                  <span style={{fontSize:22}}>{hm?.e}</span>
                  <div>
                    <div style={{color:"#fff",fontWeight:700,fontSize:14}}>{hm?.label}</div>
                    <div style={{color:SC[form.severity],fontSize:12,marginTop:1}}>{SEVS.find(s=>s.key===form.severity)?.label}</div>
                  </div>
                </div>
                <div style={{color:"#555",fontSize:12,marginBottom:14}}>📍 {gps?.address||"Accra"}</div>
                <div style={{display:"flex",gap:7}}>
                  <button onClick={submit} style={{flex:1,background:"#EF4444",border:"none",borderRadius:10,padding:"12px",color:"#fff",fontWeight:700,fontSize:14,fontFamily:"inherit"}}>Submit</button>
                  <button onClick={()=>onDone(null)} style={{background:"#1a1a1a",border:"1px solid #1e1e1e",borderRadius:10,padding:"12px 14px",color:"#555",fontSize:13,fontFamily:"inherit"}}>Cancel</button>
                </div>
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef}/>
      </div>

      {mode==="hazard"&&(
        <div style={{borderTop:"1px solid #141414",background:"#0D0D0D"}}>
          <div style={{padding:"10px 12px 6px",display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
            {H.map(h=>(
              <button key={h.key} onClick={()=>pickH(h)} style={{background:"#141414",border:"1px solid #1a1a1a",borderRadius:12,padding:"11px 12px",color:"#F0F0F0",fontSize:13,fontWeight:600,fontFamily:"inherit",display:"flex",alignItems:"center",gap:7}}>
                <span style={{fontSize:18}}>{h.e}</span>{h.label}
              </button>
            ))}
          </div>
          <div style={{padding:"6px 12px 14px"}}>
            <VoiceButton onResult={handleVoice} onDenied={async()=>{await pushBot([t.noMic]);}}/>
          </div>
        </div>
      )}
      {mode==="sev"&&(
        <div style={{borderTop:"1px solid #141414",padding:"10px 12px 14px",background:"#0D0D0D",display:"flex",flexDirection:"column",gap:6}}>
          {SEVS.map(s=>(
            <button key={s.key} onClick={()=>pickS(s)} style={{background:"#141414",border:"1px solid #1a1a1a",borderRadius:12,padding:"10px 14px",color:"#F0F0F0",fontSize:13,fontWeight:600,fontFamily:"inherit",display:"flex",alignItems:"center",gap:10}}>
              <span style={{fontSize:19}}>{s.emoji}</span>
              <div style={{textAlign:"left" as const}}>
                <div>{s.label}</div>
                <div style={{color:"#444",fontSize:11,fontWeight:400,marginTop:1}}>{s.key==="LOW"?"Small inconvenience":s.key==="MEDIUM"?"Drive carefully":s.key==="HIGH"?"Avoid if possible":"Road may be blocked"}</div>
              </div>
            </button>
          ))}
        </div>
      )}
      {mode==="photo"&&(
        <div style={{borderTop:"1px solid #141414",padding:"10px 12px 18px",background:"#0D0D0D"}}>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{display:"none"}} onChange={pickP}/>
          <div style={{background:"rgba(245,158,11,0.05)",border:"1px solid rgba(245,158,11,0.12)",borderRadius:10,padding:"8px 12px",marginBottom:8,display:"flex",alignItems:"center",gap:7}}>
            <span>💡</span><span style={{color:"#666",fontSize:12}}>Photo = instant live pin · No photo = waits for admin review</span>
          </div>
          <div style={{display:"flex",gap:7}}>
            <button onClick={()=>fileRef.current?.click()} style={{flex:1,background:"#EF4444",border:"none",borderRadius:12,padding:"14px",color:"#fff",fontWeight:700,fontSize:15,fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",gap:7}}>
              <span style={{fontSize:19}}>📷</span>Take Photo
            </button>
            <button onClick={()=>pickP({target:{files:[]}})} style={{background:"#141414",border:"1px solid #1a1a1a",borderRadius:12,padding:"14px 16px",color:"#555",fontWeight:600,fontSize:13,fontFamily:"inherit"}}>Skip</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── DEMO DATA ────────────────────────────────────────────────────────────────
const DEMO_REPORTS = [
  {id:"d1",areaId:"spintex",       hazardType:"POTHOLE",      severity:"CRITICAL",status:"VERIFIED",  photoUrl:"https://images.unsplash.com/photo-1515162816999-a0c47dc192f7?w=600&q=80",upvoteCount:14,address:"Spintex Road",      region:"Greater Accra",createdAt:new Date(Date.now()-7200000).toISOString(),  resolvedAt:null},
  {id:"d2",areaId:"spintex",       hazardType:"FLOOD",        severity:"HIGH",    status:"IN_REVIEW", photoUrl:"https://images.unsplash.com/photo-1574482620826-40685ca5eef2?w=600&q=80",upvoteCount:9, address:"Spintex Road",      region:"Greater Accra",createdAt:new Date(Date.now()-3600000).toISOString(),  resolvedAt:null},
  {id:"d3",areaId:"tema",          hazardType:"POTHOLE",      severity:"CRITICAL",status:"VERIFIED",  photoUrl:"https://images.unsplash.com/photo-1515162816999-a0c47dc192f7?w=600&q=80",upvoteCount:7, address:"Tema Motorway",     region:"Greater Accra",createdAt:new Date(Date.now()-10800000).toISOString(),resolvedAt:null},
  {id:"d4",areaId:"haatso",        hazardType:"ROAD_BLOCK",   severity:"HIGH",    status:"VERIFIED",  photoUrl:null,                                                                                    upvoteCount:5, address:"Atomic Junction",   region:"Greater Accra",createdAt:new Date(Date.now()-1800000).toISOString(),  resolvedAt:null},
  {id:"d5",areaId:"accra-central", hazardType:"BROKEN_LIGHT", severity:"MEDIUM",  status:"PENDING",   photoUrl:"https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=600&q=80",  upvoteCount:3, address:"Kwame Nkrumah Ave", region:"Greater Accra",createdAt:new Date(Date.now()-900000).toISOString(),   resolvedAt:null},
  {id:"d6",areaId:"ring-road",     hazardType:"DEBRIS",       severity:"MEDIUM",  status:"RESOLVED",  photoUrl:null,                                                                                    upvoteCount:2, address:"Ring Road Central", region:"Greater Accra",createdAt:new Date(Date.now()-86400000).toISOString(),resolvedAt:new Date(Date.now()-43200000).toISOString(),resolutionNote:"Removed by GHA crew.",fixedBy:"GHA Roads Team"},
];

// ─── REPORT FEED CARD ─────────────────────────────────────────────────────────
function ReportCard({ r, confirmed, onConfirm }: { r:any; confirmed:boolean; onConfirm:()=>void }) {
  const h       = hMeta(r.hazardType);
  const isFixed = r.status==="RESOLVED";
  const conf    = getConf(r);
  const confLabel: Record<string,string> = {LOW:"Unverified",MEDIUM:"Reported",HIGH:"Verified",CONFIRMED:"Confirmed"};

  if (isFixed) return (
    <div style={{background:"#0C0C0C",border:"1px solid rgba(34,197,94,0.12)",borderLeft:"3px solid #22C55E",borderRadius:14,overflow:"hidden",marginBottom:10}}>
      {r.photoUrl&&<img src={r.photoUrl} alt="" style={{width:"100%",height:80,objectFit:"cover",display:"block",opacity:.4}}/>}
      <div style={{padding:"12px 14px"}}>
        <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:6}}>
          <span style={{fontSize:16}}>✅</span>
          <div style={{flex:1}}>
            <span style={{color:"#22C55E",fontWeight:700,fontSize:13}}>Fixed — {h.label}</span>
            <span style={{color:"#2a2a2a",fontSize:11,marginLeft:8}}>{ago(r.resolvedAt||r.createdAt)}</span>
          </div>
        </div>
        <div style={{color:"#333",fontSize:12,marginBottom:4}}>📍 {r.address}{r.landmark?`, ${r.landmark}`:""}</div>
        {r.resolutionNote&&<div style={{background:"#141414",borderRadius:9,padding:"8px 11px",color:"#555",fontSize:12,lineHeight:1.55,fontStyle:"italic"}}>"{r.resolutionNote}"{r.fixedBy&&<span style={{color:"#2a2a2a"}}> — {r.fixedBy}</span>}</div>}
        <div style={{color:"#1a1a1a",fontSize:10,marginTop:6}}>👍 {r.upvoteCount||0} confirmed</div>
      </div>
    </div>
  );

  return (
    <div style={{background:"#0D0D0D",border:`1px solid ${SC[r.severity]}22`,borderLeft:`3px solid ${SC[r.severity]}`,borderRadius:14,overflow:"hidden",marginBottom:10}}>
      {r.photoUrl&&<img src={r.photoUrl} alt="" style={{width:"100%",height:140,objectFit:"cover",display:"block"}}/>}
      <div style={{padding:"12px 14px"}}>
        <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:6}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <span style={{fontSize:22}}>{h.e}</span>
            <div>
              <div style={{color:"#fff",fontWeight:700,fontSize:14}}>{h.label}</div>
              <div style={{color:"#444",fontSize:11,marginTop:1}}>📍 {r.address}{r.landmark?`, ${r.landmark}`:""}</div>
            </div>
          </div>
          <span style={{color:SC[r.severity],fontSize:10,fontWeight:800,background:`${SC[r.severity]}18`,border:`1px solid ${SC[r.severity]}33`,borderRadius:20,padding:"3px 9px",flexShrink:0}}>{SEV[r.severity]?.label}</span>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:10}}>
          <span style={{color:"#555",fontSize:10,fontWeight:700}}>{confLabel[conf]}</span>
          <span style={{color:"#1a1a1a",fontSize:10}}>·</span>
          <span style={{color:"#555",fontSize:10}}>{ST_LABEL[r.status]||r.status}</span>
          <span style={{color:"#1a1a1a",fontSize:10,marginLeft:"auto"}}>{ago(r.createdAt)}</span>
        </div>
        <button onClick={onConfirm} disabled={confirmed}
          style={{width:"100%",background:confirmed?"rgba(34,197,94,0.08)":"#141414",border:`1px solid ${confirmed?"rgba(34,197,94,0.25)":"#1e1e1e"}`,borderRadius:10,padding:"10px",color:confirmed?"#22C55E":"#555",fontWeight:700,fontSize:13,fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
          {confirmed?<>✓ You confirmed this</>:<>👍 I can confirm this · <span style={{color:"#2a2a2a"}}>{r.upvoteCount||0}</span></>}
        </button>
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
  const [reporting,     setReporting]     = useState(false);
  const [confirmed,     setConfirmed]     = useState<Record<string,boolean>>({});
  const [gps,           setGps]           = useState<any>({lat:null,lng:null,address:null,status:"idle"});
  const [lang,          setLang]          = useState<Lang>("EN");
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [showInstall,   setShowInstall]   = useState(false);

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

  const onReport=()=>{
    if(gps.status==="idle") getGps();
    setReporting(true);
  };

  const onSubmit=(r:any)=>{
    if(r) setReports(p=>[r,...p]);
    setReporting(false);
  };

  const doConfirm=async(id:string)=>{
    if(confirmed[id]) return;
    setConfirmed(p=>({...p,[id]:true}));
    setReports(p=>p.map(r=>r.id===id?{...r,upvoteCount:(r.upvoteCount||0)+1}:r));
    await fetch(`/api/reports/${id}/upvote`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({fingerprint:`fp-${Date.now()}-${Math.random()}`})});
  };

  const activeReports  = reports.filter(r=>r.status!=="RESOLVED"&&r.status!=="DISMISSED");
  const fixedReports   = reports.filter(r=>r.status==="RESOLVED"&&r.resolutionNote).sort((a,b)=>new Date(b.resolvedAt).getTime()-new Date(a.resolvedAt).getTime());
  const visibleAnnouncements = announcements.filter(a=>!dismissed.has(a.id));

  const feedReports = activeReports
    .filter(r=>hazardFilter==="All"||r.hazardType===hazardFilter)
    .sort((a,b)=>SO[a.severity]-SO[b.severity]||new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime());

  const criticalCount = activeReports.filter(r=>r.severity==="CRITICAL").length;

  return(
    <div style={{background:"#0A0A0A",minHeight:"100vh",fontFamily:"'Inter',-apple-system,sans-serif",color:"#fff",paddingBottom:80}}>
      <style>{`
        @keyframes fadeUp  {from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
        @keyframes slideUp {from{transform:translateY(100%)}to{transform:translateY(0)}}
        @keyframes spin    {to{transform:rotate(360deg)}}
        @keyframes bob     {0%,60%,100%{transform:translateY(0)}30%{transform:translateY(-5px)}}
        @keyframes fabPulse{0%,100%{box-shadow:0 4px 24px #EF444466,0 0 0 0 rgba(239,68,68,0)}65%{box-shadow:0 4px 24px #EF444466,0 0 0 10px rgba(239,68,68,0)}}
        @keyframes recordPulse{0%,100%{box-shadow:0 0 0 0 rgba(239,68,68,0.4)}70%{box-shadow:0 0 0 10px rgba(239,68,68,0)}}
        *{box-sizing:border-box;margin:0;padding:0}button{cursor:pointer;-webkit-tap-highlight-color:transparent}
        input::placeholder{color:#1e1e1e}::-webkit-scrollbar{display:none}
      `}</style>

      {/* ── HEADER ── */}
      <div style={{background:"#080808",borderBottom:"1px solid #0F0F0F",padding:"13px 18px",display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky" as const,top:0,zIndex:50}}>
        <div>
          <div style={{color:"#EF4444",fontSize:8,fontWeight:900,letterSpacing:3,marginBottom:1}}>ROADWATCH GH</div>
          <div style={{color:"#fff",fontWeight:900,fontSize:16,letterSpacing:-.4,lineHeight:1}}>Watch the roads.</div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          {isDemo&&<div style={{fontSize:8,fontWeight:900,letterSpacing:1.5,color:"#2a2a2a",background:"#111",border:"1px solid #141414",borderRadius:20,padding:"3px 9px"}}>PREVIEW</div>}
          <div style={{background:"rgba(34,197,94,0.06)",border:"1px solid rgba(34,197,94,0.15)",borderRadius:20,padding:"5px 10px",display:"flex",alignItems:"center",gap:4}}>
            <span style={{width:5,height:5,borderRadius:"50%",background:"#22C55E",display:"inline-block",boxShadow:"0 0 6px #22C55E"}}/>
            <span style={{color:"#22C55E",fontSize:9,fontWeight:900,letterSpacing:1.5}}>LIVE</span>
          </div>
        </div>
      </div>

      {/* ── FEED TAB ── */}
      {tab==="feed"&&(
        <div style={{animation:"fadeUp .18s ease"}}>

          {/* Hero CTA */}
          <div style={{padding:"20px 18px 16px",borderBottom:"1px solid #0F0F0F"}}>
            {criticalCount>0&&(
              <div style={{background:"rgba(239,68,68,0.06)",border:"1px solid rgba(239,68,68,0.15)",borderRadius:10,padding:"8px 13px",marginBottom:14,display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontSize:14}}>🔴</span>
                <span style={{color:"#EF4444",fontSize:12,fontWeight:700}}>{criticalCount} critical hazard{criticalCount!==1?"s":""} on Ghana's roads right now</span>
              </div>
            )}
            <div style={{color:"#888",fontSize:13,marginBottom:6}}>See a road hazard?</div>
            <button onClick={onReport}
              style={{width:"100%",background:"#EF4444",border:"none",borderRadius:14,padding:"17px 20px",color:"#fff",fontWeight:900,fontSize:17,fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",gap:10,animation:"fabPulse 4s ease-in-out infinite",marginBottom:8}}>
              <span style={{fontSize:22}}>🚨</span> Report It Now
            </button>
            <div style={{color:"#2a2a2a",fontSize:11,textAlign:"center" as const}}>
              Takes 30 seconds · Helps keep Ghana's roads safe
            </div>
          </div>

          <div style={{padding:"12px 18px 0"}}>
            {/* Announcements */}
            {visibleAnnouncements.length>0&&(
              <div style={{marginBottom:12}}>
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
                        <div style={{color:"#555",fontSize:11,lineHeight:1.5}}>{a.body}</div>
                      </div>
                      <button onClick={()=>setDismissed(d=>new Set([...d,a.id]))} style={{background:"none",border:"none",color:"#2a2a2a",fontSize:18,lineHeight:1,padding:"0 2px",flexShrink:0}}>×</button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Hazard type filters */}
            <div style={{display:"flex",gap:6,overflowX:"auto",paddingBottom:4,marginBottom:12}}>
              {[{key:"All",e:"◈",label:"All"},...H].map(h=>(
                <button key={h.key} onClick={()=>setHazardFilter(h.key)}
                  style={{flexShrink:0,background:hazardFilter===h.key?"rgba(239,68,68,0.12)":"#0D0D0D",border:`1px solid ${hazardFilter===h.key?"rgba(239,68,68,0.3)":"#141414"}`,borderRadius:20,padding:"6px 12px",color:hazardFilter===h.key?"#EF4444":"#444",fontSize:11,fontWeight:700,fontFamily:"inherit"}}>
                  {h.e} {h.label}
                </button>
              ))}
            </div>

            {/* Section label */}
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
              <div style={{fontSize:9,fontWeight:900,letterSpacing:2,color:"#2a2a2a"}}>CITIZEN REPORTS · {feedReports.length}</div>
              {fixedReports.length>0&&(
                <button onClick={()=>setTab("fixed")} style={{background:"none",border:"none",color:"#22C55E",fontSize:11,fontWeight:700,fontFamily:"inherit",padding:0}}>
                  ✅ {fixedReports.length} fixed →
                </button>
              )}
            </div>

            {feedReports.length===0
              ?<div style={{textAlign:"center",padding:"48px 0"}}>
                <div style={{fontSize:40,marginBottom:12}}>👁️</div>
                <div style={{color:"#fff",fontWeight:700,fontSize:16,marginBottom:6}}>No reports yet</div>
                <div style={{color:"#333",fontSize:13,marginBottom:20}}>Be the first to report a hazard on Ghana's roads.</div>
                <button onClick={onReport} style={{background:"#EF4444",border:"none",borderRadius:12,padding:"13px 24px",color:"#fff",fontWeight:700,fontSize:14,fontFamily:"inherit"}}>🚨 Report a Hazard</button>
              </div>
              :feedReports.map(r=>(
                <ReportCard key={r.id} r={r} confirmed={!!confirmed[r.id]} onConfirm={()=>doConfirm(r.id)}/>
              ))
            }
          </div>
        </div>
      )}

      {/* ── FIXED TAB ── */}
      {tab==="fixed"&&(
        <div style={{padding:"20px 18px 0",animation:"fadeUp .18s ease"}}>
          <div style={{marginBottom:16}}>
            <div style={{color:"#fff",fontWeight:900,fontSize:20,letterSpacing:-.4,marginBottom:4}}>Roads you helped fix</div>
            <div style={{color:"#444",fontSize:13}}>These hazards were reported by citizens and resolved.</div>
          </div>
          {fixedReports.length===0
            ?<div style={{textAlign:"center",padding:"48px 0",color:"#1a1a1a",fontSize:14}}>Nothing resolved yet</div>
            :fixedReports.map(r=><ReportCard key={r.id} r={r} confirmed={!!confirmed[r.id]} onConfirm={()=>doConfirm(r.id)}/>)
          }
        </div>
      )}

      {/* PWA install banner */}
      {showInstall&&(
        <div style={{position:"fixed" as const,bottom:76,left:12,right:12,zIndex:105,background:"#0D0D0D",border:"1px solid #1a1a1a",borderRadius:14,padding:"12px 14px",display:"flex",alignItems:"center",gap:10,animation:"fadeUp .2s ease"}}>
          <span style={{fontSize:20}}>📲</span>
          <div style={{flex:1}}>
            <div style={{color:"#fff",fontWeight:700,fontSize:13}}>Add to Home Screen</div>
            <div style={{color:"#444",fontSize:11}}>Works offline · No app store needed</div>
          </div>
          <button onClick={async()=>{installPrompt?.prompt();const r=await installPrompt?.userChoice;if(r?.outcome==="accepted")setShowInstall(false);}} style={{background:"#EF4444",border:"none",borderRadius:10,padding:"8px 14px",color:"#fff",fontWeight:700,fontSize:13,fontFamily:"inherit"}}>Add</button>
          <button onClick={()=>setShowInstall(false)} style={{background:"none",border:"none",color:"#333",fontSize:18,lineHeight:1}}>×</button>
        </div>
      )}

      {/* Report modal */}
      {reporting&&(
        <div style={{position:"fixed" as const,inset:0,zIndex:200,animation:"fadeUp .2s ease"}}>
          <div style={{position:"absolute" as const,inset:0,background:"rgba(0,0,0,0.88)",backdropFilter:"blur(10px)"}} onClick={()=>setReporting(false)}/>
          <div style={{position:"absolute" as const,bottom:0,left:0,right:0,background:"#0A0A0A",borderRadius:"20px 20px 0 0",border:"1px solid #1a1a1a",borderBottom:"none",height:"88vh",display:"flex",flexDirection:"column" as const,animation:"slideUp .26s cubic-bezier(.32,.72,0,1)"}}>
            <div style={{flexShrink:0}}>
              <div style={{display:"flex",justifyContent:"center",paddingTop:9,paddingBottom:2}}><div style={{width:36,height:4,borderRadius:2,background:"#1e1e1e"}}/></div>
              <div style={{padding:"10px 14px",borderBottom:"1px solid #141414",display:"flex",alignItems:"center",gap:10}}>
                <div style={{width:34,height:34,borderRadius:"50%",background:"linear-gradient(135deg,#EF4444,#7F1D1D)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,flexShrink:0}}>🚧</div>
                <div style={{flex:1}}>
                  <div style={{color:"#fff",fontWeight:700,fontSize:14}}>Report a Hazard</div>
                  <div style={{fontSize:10,display:"flex",alignItems:"center",gap:3,marginTop:1}}>
                    {gps.status==="locating"
                      ?<><div style={{width:8,height:8,border:"1.5px solid #444",borderTopColor:"#22C55E",borderRadius:"50%",animation:"spin .8s linear infinite"}}/><span style={{color:"#555"}}>Getting location…</span></>
                      :gps.status==="live"
                      ?<><span style={{width:4,height:4,borderRadius:"50%",background:"#22C55E",display:"inline-block"}}/><span style={{color:"#4ade80"}}>GPS locked</span></>
                      :<><span style={{width:4,height:4,borderRadius:"50%",background:"#4ade80",display:"inline-block"}}/><span style={{color:"#4ade80"}}>Online</span></>
                    }
                  </div>
                </div>
                <button onClick={()=>setLang(l=>l==="EN"?"TW":"EN")} style={{background:"#141414",border:"1px solid #1e1e1e",borderRadius:8,padding:"4px 8px",color:"#666",fontSize:9,fontWeight:900,letterSpacing:.5,fontFamily:"inherit"}}>
                  {lang==="EN"?"TW 🇬🇭":"EN 🇬🇧"}
                </button>
                <button onClick={()=>setReporting(false)} style={{background:"#141414",border:"1px solid #1e1e1e",borderRadius:8,width:30,height:30,display:"flex",alignItems:"center",justifyContent:"center",color:"#555",fontSize:17,lineHeight:1}}>×</button>
              </div>
            </div>
            <div style={{flex:1,overflow:"hidden"}}>
              <ChatReport gps={gps} onDone={onSubmit} lang={lang}/>
            </div>
          </div>
        </div>
      )}

      {/* Bottom nav */}
      <div style={{position:"fixed" as const,bottom:0,left:0,right:0,background:"rgba(5,5,5,0.97)",borderTop:"1px solid #0F0F0F",padding:"9px 0 20px",display:"flex",justifyContent:"space-around",backdropFilter:"blur(20px)",zIndex:99}}>
        {[["feed","📋","Feed"],["fixed","✅","Fixed"]].map(([key,icon,label])=>(
          <button key={key} onClick={()=>setTab(key)} style={{background:"none",border:"none",display:"flex",flexDirection:"column" as const,alignItems:"center",gap:2,fontFamily:"inherit",minWidth:80}}>
            <span style={{fontSize:21}}>{icon}</span>
            <span style={{fontSize:8,fontWeight:900,letterSpacing:.8,color:tab===key?"#EF4444":"#1e1e1e"}}>{label.toUpperCase()}</span>
          </button>
        ))}
        {/* Centre report button */}
        <button onClick={onReport}
          style={{background:"#EF4444",border:"none",borderRadius:"50%",width:56,height:56,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,position:"relative" as const,top:-14,boxShadow:"0 4px 20px rgba(239,68,68,0.5)"}}>
          🚨
        </button>
        <div style={{minWidth:80}}/>
        <div style={{minWidth:80}}/>
      </div>
    </div>
  );
}
