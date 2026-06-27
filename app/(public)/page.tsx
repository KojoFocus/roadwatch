"use client";

import { useState, useEffect, useRef } from "react";
import dynamic                          from "next/dynamic";
import { uploadPhoto, uploadAudio }     from "@/lib/supabase";
import { AREAS }                        from "@/lib/areas";

const RouteMapGL = dynamic(() => import("@/components/RouteMapGL"), { ssr: false });

// ─── TYPES & CONSTANTS ────────────────────────────────────────────────────────
const CONFIDENCE: Record<string, any> = {
  LOW:       { label:"Unverified", color:"#374151", bg:"rgba(55,65,81,0.08)",    border:"rgba(55,65,81,0.18)",    pin:"#374151", showInAreas:false, showInRoute:false },
  MEDIUM:    { label:"Reported",   color:"#F59E0B", bg:"rgba(245,158,11,0.08)",  border:"rgba(245,158,11,0.22)", pin:"#F59E0B", showInAreas:true,  showInRoute:true  },
  HIGH:      { label:"Verified",   color:"#F97316", bg:"rgba(249,115,22,0.08)",  border:"rgba(249,115,22,0.25)", pin:"#F97316", showInAreas:true,  showInRoute:true  },
  CONFIRMED: { label:"Confirmed",  color:"#EF4444", bg:"rgba(239,68,68,0.08)",   border:"rgba(239,68,68,0.28)",  pin:"#EF4444", showInAreas:true,  showInRoute:true  },
};
function getConf(r: any) {
  if (r.status==="VERIFIED"||r.status==="IN_REVIEW") return "HIGH";
  if ((r.upvoteCount||r.upvotes||0) >= 3) return "CONFIRMED";
  if (r.photoUrl) return "MEDIUM";
  return "LOW";
}

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
  LOW:      { label:"Low",      c:"#22C55E", bg:"rgba(34,197,94,0.08)",   b:"rgba(34,197,94,0.22)"  },
  MEDIUM:   { label:"Moderate", c:"#F59E0B", bg:"rgba(245,158,11,0.08)",  b:"rgba(245,158,11,0.22)" },
  HIGH:     { label:"High",     c:"#F97316", bg:"rgba(249,115,22,0.08)",  b:"rgba(249,115,22,0.25)" },
  CRITICAL: { label:"Critical", c:"#EF4444", bg:"rgba(239,68,68,0.08)",   b:"rgba(239,68,68,0.28)"  },
};
const SC: Record<string, string> = { CRITICAL:"#EF4444", HIGH:"#F97316", MEDIUM:"#F59E0B", LOW:"#22C55E" };
const SO: Record<string, number> = { CRITICAL:0, HIGH:1, MEDIUM:2, LOW:3 };


const A_TYPE: Record<string, { color: string; bg: string; border: string; icon: string }> = {
  INFO:         { color:"#60A5FA", bg:"rgba(96,165,250,0.08)",  border:"rgba(96,165,250,0.2)",  icon:"ℹ️" },
  WARNING:      { color:"#F59E0B", bg:"rgba(245,158,11,0.08)", border:"rgba(245,158,11,0.22)", icon:"⚠️" },
  ROAD_CLOSURE: { color:"#EF4444", bg:"rgba(239,68,68,0.08)",  border:"rgba(239,68,68,0.2)",   icon:"🚫" },
  MAINTENANCE:  { color:"#A78BFA", bg:"rgba(167,139,250,0.08)",border:"rgba(167,139,250,0.2)", icon:"🔧" },
  EMERGENCY:    { color:"#EF4444", bg:"rgba(239,68,68,0.1)",   border:"rgba(239,68,68,0.3)",   icon:"🚨" },
};

function ago(iso: string) {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (d < 3600)  return `${Math.floor(d/60)}m`;
  if (d < 86400) return `${Math.floor(d/3600)}h`;
  return `${Math.floor(d/86400)}d`;
}

function areaSafety(areaId: string, reports: any[]) {
  const active = reports.filter(r =>
    r.areaId === areaId &&
    r.status !== "RESOLVED" && r.status !== "DISMISSED" &&
    CONFIDENCE[getConf(r)].showInAreas
  );
  if (!active.length) return { score:"CLEAR",    label:"Clear",     c:"#22C55E", bg:"rgba(34,197,94,0.06)",  b:"rgba(34,197,94,0.18)",  count:0, reports:[] };
  if (active.some((r:any) => r.severity==="CRITICAL")) return { score:"DANGER",   label:"Danger",    c:"#EF4444", bg:"rgba(239,68,68,0.06)",  b:"rgba(239,68,68,0.18)",  count:active.length, reports:active };
  if (active.some((r:any) => r.severity==="HIGH"))     return { score:"CAUTION",  label:"Caution",   c:"#F97316", bg:"rgba(249,115,22,0.06)", b:"rgba(249,115,22,0.18)", count:active.length, reports:active };
  return                                                      { score:"ADVISORY", label:"Advisory",  c:"#F59E0B", bg:"rgba(245,158,11,0.06)", b:"rgba(245,158,11,0.18)", count:active.length, reports:active };
}

async function revGeo(lat: number, lng: number): Promise<string | null> {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`, { headers: { "Accept-Language": "en" } });
    const d = await r.json();
    const a = d.address;
    return [a?.road || a?.pedestrian, a?.neighbourhood || a?.suburb || a?.town].filter(Boolean).slice(0, 2).join(", ") || null;
  } catch { return null; }
}

// ─── CHAT BOT ─────────────────────────────────────────────────────────────────
function Bot({ text }: { text: string }) {
  return (
    <div style={{ display:"flex", alignItems:"flex-end", gap:8, marginBottom:5 }}>
      <div style={{ width:28, height:28, borderRadius:"50%", background:"linear-gradient(135deg,#EF4444,#7F1D1D)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, flexShrink:0 }}>🚧</div>
      <div style={{ background:"#1A1A1A", borderRadius:"15px 15px 15px 4px", padding:"9px 13px", maxWidth:"80%", color:"#F0F0F0", fontSize:14, lineHeight:1.55 }}>{text}</div>
    </div>
  );
}
function User({ text, img }: { text?: string; img?: string }) {
  return (
    <div style={{ display:"flex", justifyContent:"flex-end", marginBottom:5 }}>
      <div style={{ background:"#B91C1C", borderRadius:img?"13px 13px 4px 13px":"15px 15px 4px 15px", padding:img?"5px":"9px 13px", maxWidth:260, color:"#fff", fontSize:14 }}>
        {img ? <img src={img} alt="" style={{ width:214, height:136, objectFit:"cover", borderRadius:8, display:"block" }}/> : text}
      </div>
    </div>
  );
}
function Dots() {
  return (
    <div style={{ display:"flex", alignItems:"flex-end", gap:8, marginBottom:5 }}>
      <div style={{ width:28, height:28, borderRadius:"50%", background:"linear-gradient(135deg,#EF4444,#7F1D1D)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, flexShrink:0 }}>🚧</div>
      <div style={{ background:"#1A1A1A", borderRadius:"15px 15px 15px 4px", padding:"10px 14px", display:"flex", gap:4 }}>
        {[0,1,2].map(i => <div key={i} style={{ width:6, height:6, borderRadius:"50%", background:"#444", animation:`bob 1.2s ${i*.2}s infinite` }}/>)}
      </div>
    </div>
  );
}

function VoiceButton({ onResult, onDenied }: { onResult: (r: any) => void; onDenied?: () => void }) {
  const [state, setState] = useState<"idle"|"recording"|"processing"|"denied">("idle");
  const [secs,  setSecs]  = useState(0);
  const mediaRef          = useRef<MediaRecorder | null>(null);
  const chunksRef         = useRef<Blob[]>([]);
  const timerRef          = useRef<any>(null);
  const mimeRef           = useRef<string>("");

  const start = async (e: any) => {
    e.preventDefault();
    if (state !== "idle") return;
    chunksRef.current = [];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime   = ["audio/webm;codecs=opus","audio/webm","audio/ogg"].find(t => MediaRecorder.isTypeSupported(t)) || "audio/webm";
      mimeRef.current = mime;
      const rec    = new MediaRecorder(stream, { mimeType: mime });
      mediaRef.current = rec;
      rec.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob   = new Blob(chunksRef.current, { type: mime });
        const reader = new FileReader();
        reader.onload = async () => {
          setState("processing");
          try {
            const res  = await fetch("/api/transcribe", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ audio: reader.result, mimeType: mime }) });
            const json = await res.json();
            if (json.success) onResult({ ...json.data, _audioBlob: blob, _mimeType: mime });
          } catch { onDenied?.(); }
          setState("idle"); setSecs(0);
        };
        reader.readAsDataURL(blob);
      };
      rec.start(100);
      setState("recording");
      timerRef.current = setInterval(() => setSecs(s => s + 1), 1000);
    } catch {
      setState("denied");
      onDenied?.();
    }
  };

  const stop = (e: any) => {
    e.preventDefault();
    if (state !== "recording") return;
    clearInterval(timerRef.current);
    mediaRef.current?.stop();
  };

  if (state === "denied") return (
    <div style={{ background:"rgba(239,68,68,0.05)", border:"1px solid rgba(239,68,68,0.15)", borderRadius:12, padding:"12px 14px", display:"flex", alignItems:"center", gap:8 }}>
      <span style={{ fontSize:16 }}>🎙️</span>
      <div>
        <div style={{ color:"#EF4444", fontSize:12, fontWeight:700 }}>Mic access denied</div>
        <div style={{ color:"#444", fontSize:11, marginTop:1 }}>Use the chips above to report instead</div>
      </div>
    </div>
  );

  if (state === "processing") return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:8, padding:"14px", color:"#888", fontSize:13 }}>
      <div style={{ width:16, height:16, border:"2px solid #333", borderTopColor:"#EF4444", borderRadius:"50%", animation:"spin .8s linear infinite" }}/>
      Processing voice…
    </div>
  );

  return (
    <button
      onMouseDown={start} onTouchStart={start}
      onMouseUp={stop}    onTouchEnd={stop}
      style={{ width:"100%", background:state==="recording"?"rgba(239,68,68,0.12)":"#141414", border:`1px solid ${state==="recording"?"rgba(239,68,68,0.4)":"#1a1a1a"}`, borderRadius:14, padding:"14px", cursor:"pointer", fontFamily:"inherit", display:"flex", alignItems:"center", justifyContent:"center", gap:8, color:state==="recording"?"#EF4444":"#666", fontSize:14, fontWeight:600, animation:state==="recording"?"recordPulse 1s ease-in-out infinite":"none" }}>
      <span style={{ fontSize:20 }}>{state==="recording" ? "⏹" : "🎙️"}</span>
      {state==="recording" ? `Recording… ${secs}s (release to send)` : "Hold to speak in any language"}
    </button>
  );
}

// ─── TWI / ENGLISH BOT STRINGS ───────────────────────────────────────────────
const BOT_STR = {
  EN: {
    opener:  "What did you spot on the road?",
    howBad:  "How bad is it?",
    photo:   "Snap a photo if you can — it helps it go live faster.",
    gotIt:   "Got it.",
    ready:   "Ready to submit?",
    skip:    "Okay — it'll be reviewed before going live. Ready?",
    done:    ["✅ Submitted.", "Your pin is live on the map.", "Thank you 🇬🇭"],
    noMic:   "Mic not available — tap a hazard type above.",
    noClass: "I heard you but couldn't classify it — tap the hazard type below.",
    voiceGot:"Got it from your voice note.",
    photoAdd:"📷 Photo uploaded.",
    photoLoc:"📷 Photo added.",
  },
  TW: {
    opener:  "Hwɛ biribi a ɛyɛ den wɔ ɔkwan so?",
    howBad:  "Ɛyɛ den sɛn?",
    photo:   "Sɛ wobetumi a, fa foto — ɛboa ma ɛkɔ live ntɛm.",
    gotIt:   "Mete aseɛ.",
    ready:   "Wo ho di?",
    skip:    "Okiir — wɔbɛhwɛ ansa na ɛkɔ live. Wo ho di?",
    done:    ["✅ Woasoma.", "Wo pin wɔ map so live.", "Meda wo ase 🇬🇭"],
    noMic:   "Mik nni hɔ — twa hazard type a ɛwɔ soro.",
    noClass: "Metee wo asɛm nanso meennye type nho — twa type a ɛwɔ ase.",
    voiceGot:"Megye wo asɛm.",
    photoAdd:"📷 Foto asoma.",
    photoLoc:"📷 Foto aka ho.",
  },
} as const;
type Lang = keyof typeof BOT_STR;

function ChatReport({ gps, onDone, lang }: { gps: any; onDone: (r: any) => void; lang: Lang }) {
  const [msgs,      setMsgs]      = useState<any[]>([]);
  const [typing,    setTyping]    = useState(false);
  const [mode,      setMode]      = useState<string|null>(null);
  const [form,      setForm]      = useState({ hazardType:"", severity:"", photoUrl:"", voiceUrl:"", transcript:"" });
  const [uploading, setUploading] = useState(false);
  const bottomRef                 = useRef<HTMLDivElement>(null);
  const fileRef                   = useRef<HTMLInputElement>(null);
  const booted                    = useRef(false);
  const pendingFile               = useRef<File | null>(null);
  const t = BOT_STR[lang];

  const scroll  = () => setTimeout(() => bottomRef.current?.scrollIntoView({ behavior:"smooth" }), 60);
  const pushBot = (texts: string[]) => new Promise<void>(res => {
    setTyping(true); scroll();
    setTimeout(() => { setTyping(false); setMsgs(p => [...p, ...texts.map(t => ({ role:"bot", t }))]); scroll(); res(); }, 850);
  });
  const pushUser = (t?: string, img?: string) => { setMsgs(p => [...p, { role:"user", t, img }]); scroll(); };
  const pushInfo = (t: string, c = "#4ade80") => { setMsgs(p => [...p, { role:"info", t, c }]); scroll(); };

  useEffect(() => {
    if (booted.current) return; booted.current = true;
    pushBot([t.opener]).then(() => setMode("hazard"));
  }, []);

  useEffect(() => { if (gps?.address) pushInfo(`📍 ${gps.address}`); }, [gps?.address]);

  const pickH = async (h: any) => {
    setMode(null); setForm(p => ({ ...p, hazardType: h.key }));
    pushUser(`${h.e} ${h.label}`);
    await pushBot([`${h.label} — ${t.gotIt}`, t.howBad]);
    setMode("sev");
  };
  const pickS = async (s: any) => {
    setMode(null); setForm(p => ({ ...p, severity: s.key }));
    pushUser(`${s.emoji} ${s.label}`);
    await pushBot([t.gotIt, t.photo]);
    setMode("photo");
  };
  const pickP = async (e: any) => {
    setMode(null);
    const file = e.target?.files?.[0];
    if (file) {
      const preview = URL.createObjectURL(file);
      pushUser(undefined, preview);
      setUploading(true);
      try {
        const publicUrl = await uploadPhoto(file);
        setForm(p => ({ ...p, photoUrl: publicUrl }));
        await pushBot([t.photoAdd, t.ready]);
      } catch {
        setForm(p => ({ ...p, photoUrl: preview }));
        await pushBot([t.photoLoc, t.ready]);
      } finally {
        setUploading(false);
      }
    } else {
      pushUser("Skip photo");
      await pushBot([t.skip]);
    }
    setMode("confirm");
  };

  const handleVoiceResult = async (result: any) => {
    if (result.hazardType) {
      const h = hMeta(result.hazardType);
      setForm(p => ({ ...p, hazardType: result.hazardType, severity: result.severity || "", transcript: result.transcript || "" }));
      pushUser(`🎙️ "${result.transcript}"`);
      const sevLabel  = result.severity ? SEV[result.severity]?.label : null;
      const locHint   = result.locationHint ? ` near ${result.locationHint}` : "";
      const confirmed = sevLabel
        ? `I heard: "${result.transcript}". Looks like a ${h.label}${locHint} — ${sevLabel} severity. Is that right?`
        : `I heard: "${result.transcript}". Looks like a ${h.label}${locHint}. Is that right?`;
      await pushBot([confirmed]);
      setMode("voice-confirm");
    } else {
      pushUser(`🎙️ "${result.transcript}"`);
      await pushBot([t.noClass]);
      setMode("hazard");
    }
  };

  const acceptVoice = async () => {
    const h = hMeta(form.hazardType);
    pushUser(`${h.e} ${h.label}`);
    if (form.severity) {
      await pushBot([t.voiceGot, t.photo]);
      setMode("photo");
    } else {
      await pushBot([t.howBad]);
      setMode("sev");
    }
  };

  const rejectVoice = async () => {
    setForm(p => ({ ...p, hazardType:"", severity:"" }));
    pushUser("Fix");
    await pushBot([t.opener]);
    setMode("hazard");
  };

  const submit = async () => {
    setMode(null); pushUser("Submit");
    try {
      const res  = await fetch("/api/reports", {
        method:  "POST",
        headers: { "Content-Type":"application/json" },
        body: JSON.stringify({
          latitude:   gps?.lat      || 5.6037,
          longitude:  gps?.lng      || -0.1870,
          address:    gps?.address  || "Accra",
          hazardType: form.hazardType,
          severity:   form.severity,
          photoUrl:   form.photoUrl   || null,
          transcript: form.transcript || null,
        }),
      });
      const json = await res.json();
      if (json.success) {
        await pushBot(t.done as unknown as string[]);
        setMode("done");
        setTimeout(() => onDone(json.data), 1000);
        return;
      }
    } catch { /* fall through */ }
    await pushBot(t.done as unknown as string[]);
    setMode("done");
    setTimeout(() => onDone({ id:`local-${Date.now()}`, latitude:gps?.lat||5.6037, longitude:gps?.lng||-0.1870, address:gps?.address||"Accra", hazardType:form.hazardType, severity:form.severity, status:"PENDING", upvoteCount:1, photoUrl:form.photoUrl||null, createdAt:new Date().toISOString() }), 1000);
  };

  const hm   = H.find(x => x.key === form.hazardType);
  const SEVS = [{ key:"LOW", emoji:"🟢", label:"Minor" }, { key:"MEDIUM", emoji:"🟡", label:"Moderate" }, { key:"HIGH", emoji:"🟠", label:"Dangerous" }, { key:"CRITICAL", emoji:"🔴", label:"Critical" }];

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", background:"#0A0A0A" }}>
      <div style={{ flex:1, overflowY:"auto", padding:"12px 14px 6px" }}>
        {msgs.map((m, i) =>
          m.role === "bot"  ? <Bot key={i} text={m.t}/> :
          m.role === "user" ? <User key={i} text={m.t} img={m.img}/> :
          <div key={i} style={{ textAlign:"center", margin:"6px 0 8px" }}>
            <span style={{ color:m.c, fontSize:11, background:"rgba(0,0,0,0.4)", padding:"4px 12px", borderRadius:20, border:`1px solid ${m.c}22` }}>{m.t}</span>
          </div>
        )}
        {typing && <Dots/>}
        {mode === "voice-confirm" && (
          <div style={{ paddingLeft:36, marginBottom:8, animation:"fadeUp .2s ease" }}>
            <div style={{ display:"flex", gap:7 }}>
              <button onClick={acceptVoice} style={{ flex:1, background:"rgba(34,197,94,0.08)", border:"1px solid rgba(34,197,94,0.25)", borderRadius:12, padding:"11px", color:"#4ade80", fontWeight:700, fontSize:13, fontFamily:"inherit" }}>
                ✓ Yes, that's right
              </button>
              <button onClick={rejectVoice} style={{ background:"#141414", border:"1px solid #1a1a1a", borderRadius:12, padding:"11px 14px", color:"#555", fontWeight:600, fontSize:13, fontFamily:"inherit" }}>
                Fix it
              </button>
            </div>
          </div>
        )}
        {uploading && (
          <div style={{ paddingLeft:36, marginBottom:8 }}>
            <div style={{ color:"#555", fontSize:12, display:"flex", alignItems:"center", gap:6 }}>
              <div style={{ width:12, height:12, border:"2px solid #333", borderTopColor:"#F59E0B", borderRadius:"50%", animation:"spin .8s linear infinite" }}/>
              Uploading photo…
            </div>
          </div>
        )}
        {mode === "confirm" && (
          <div style={{ paddingLeft:36, marginBottom:8, animation:"fadeUp .2s ease" }}>
            <div style={{ background:"#161616", border:"1px solid #222", borderRadius:14, overflow:"hidden" }}>
              {form.photoUrl && <img src={form.photoUrl} alt="" style={{ width:"100%", height:120, objectFit:"cover", display:"block" }}/>}
              <div style={{ padding:"12px 14px" }}>
                <div style={{ display:"flex", gap:8, marginBottom:8 }}>
                  <span style={{ fontSize:22 }}>{hm?.e}</span>
                  <div>
                    <div style={{ color:"#fff", fontWeight:700, fontSize:14 }}>{hm?.label}</div>
                    <div style={{ color:SC[form.severity], fontSize:12, marginTop:1 }}>{SEVS.find(s => s.key === form.severity)?.label}</div>
                  </div>
                </div>
                <div style={{ color:"#444", fontSize:12, marginBottom:14 }}>📍 {gps?.address || "Accra"}</div>
                <div style={{ display:"flex", gap:7 }}>
                  <button onClick={submit} style={{ flex:1, background:"#EF4444", border:"none", borderRadius:10, padding:"12px", color:"#fff", fontWeight:700, fontSize:14, cursor:"pointer", fontFamily:"inherit" }}>Submit</button>
                  <button onClick={() => onDone(null)} style={{ background:"#1a1a1a", border:"1px solid #1e1e1e", borderRadius:10, padding:"12px 14px", color:"#555", fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>Cancel</button>
                </div>
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef}/>
      </div>

      {mode === "hazard" && (
        <div style={{ borderTop:"1px solid #141414", background:"#0D0D0D" }}>
          <div style={{ padding:"10px 12px 6px", display:"grid", gridTemplateColumns:"1fr 1fr", gap:6 }}>
            {H.map(h => (
              <button key={h.key} onClick={() => pickH(h)} style={{ background:"#141414", border:"1px solid #1a1a1a", borderRadius:12, padding:"11px 12px", color:"#F0F0F0", fontSize:13, fontWeight:600, cursor:"pointer", fontFamily:"inherit", display:"flex", alignItems:"center", gap:7 }}>
                <span style={{ fontSize:18 }}>{h.e}</span>{h.label}
              </button>
            ))}
          </div>
          <div style={{ padding:"6px 12px 14px" }}>
            <VoiceButton onResult={handleVoiceResult} onDenied={async () => {
              await pushBot([t.noMic]);
            }}/>
          </div>
        </div>
      )}
      {mode === "sev" && (
        <div style={{ borderTop:"1px solid #141414", padding:"10px 12px 14px", background:"#0D0D0D", display:"flex", flexDirection:"column", gap:6 }}>
          {SEVS.map(s => (
            <button key={s.key} onClick={() => pickS(s)} style={{ background:"#141414", border:"1px solid #1a1a1a", borderRadius:12, padding:"10px 14px", color:"#F0F0F0", fontSize:13, fontWeight:600, cursor:"pointer", fontFamily:"inherit", display:"flex", alignItems:"center", gap:10 }}>
              <span style={{ fontSize:19 }}>{s.emoji}</span>
              <div style={{ textAlign:"left" }}>
                <div>{s.label}</div>
                <div style={{ color:"#333", fontSize:11, fontWeight:400, marginTop:1 }}>
                  {s.key==="LOW"?"Small inconvenience":s.key==="MEDIUM"?"Drive carefully":s.key==="HIGH"?"Avoid if possible":"Road may be blocked"}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
      {mode === "photo" && (
        <div style={{ borderTop:"1px solid #141414", padding:"10px 12px 18px", background:"#0D0D0D" }}>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display:"none" }} onChange={pickP}/>
          <div style={{ background:"rgba(245,158,11,0.05)", border:"1px solid rgba(245,158,11,0.12)", borderRadius:10, padding:"8px 12px", marginBottom:8, display:"flex", alignItems:"center", gap:7 }}>
            <span>💡</span><span style={{ color:"#666", fontSize:12 }}>Photo = instant live pin · No photo = waits for admin review</span>
          </div>
          <div style={{ display:"flex", gap:7 }}>
            <button onClick={() => fileRef.current?.click()} style={{ flex:1, background:"#EF4444", border:"none", borderRadius:12, padding:"14px", color:"#fff", fontWeight:700, fontSize:15, cursor:"pointer", fontFamily:"inherit", display:"flex", alignItems:"center", justifyContent:"center", gap:7 }}>
              <span style={{ fontSize:19 }}>📷</span>Take Photo
            </button>
            <button onClick={() => pickP({ target:{ files:[] } })} style={{ background:"#141414", border:"1px solid #1a1a1a", borderRadius:12, padding:"14px 16px", color:"#555", fontWeight:600, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>Skip</button>
          </div>
        </div>
      )}
      <input ref={fileRef} type="file" style={{ display:"none" }}/>
    </div>
  );
}

// ─── DEMO DATA (shown until real API data loads) ──────────────────────────────
const DEMO_REPORTS = [
  { id:"d1", areaId:"spintex",       hazardType:"POTHOLE",      severity:"CRITICAL", status:"VERIFIED",  photoUrl:"https://images.unsplash.com/photo-1515162816999-a0c47dc192f7?w=600&q=80", upvoteCount:14, address:"Spintex Road",       createdAt: new Date(Date.now()-7200000).toISOString(),  resolvedAt:null },
  { id:"d2", areaId:"spintex",       hazardType:"FLOOD",        severity:"HIGH",     status:"IN_REVIEW", photoUrl:"https://images.unsplash.com/photo-1574482620826-40685ca5eef2?w=600&q=80", upvoteCount:9,  address:"Spintex Road",       createdAt: new Date(Date.now()-3600000).toISOString(),  resolvedAt:null },
  { id:"d3", areaId:"tema",          hazardType:"POTHOLE",      severity:"CRITICAL", status:"VERIFIED",  photoUrl:"https://images.unsplash.com/photo-1515162816999-a0c47dc192f7?w=600&q=80", upvoteCount:7,  address:"Tema Motorway",      createdAt: new Date(Date.now()-10800000).toISOString(), resolvedAt:null },
  { id:"d4", areaId:"haatso",        hazardType:"ROAD_BLOCK",   severity:"HIGH",     status:"VERIFIED",  photoUrl:null, upvoteCount:5,  address:"Atomic Junction",    createdAt: new Date(Date.now()-1800000).toISOString(),  resolvedAt:null },
  { id:"d5", areaId:"accra-central", hazardType:"BROKEN_LIGHT", severity:"MEDIUM",   status:"PENDING",   photoUrl:"https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=600&q=80", upvoteCount:3,  address:"Kwame Nkrumah Ave",  createdAt: new Date(Date.now()-900000).toISOString(),   resolvedAt:null },
  { id:"d6", areaId:"ring-road",     hazardType:"DEBRIS",       severity:"MEDIUM",   status:"RESOLVED",  photoUrl:null, upvoteCount:2,  address:"Ring Road Central", createdAt: new Date(Date.now()-86400000).toISOString(), resolvedAt: new Date(Date.now()-43200000).toISOString(), resolutionNote:"Removed by GHA crew.", fixedBy:"GHA Roads Team" },
];

// ─── PUBLIC PAGE ──────────────────────────────────────────────────────────────
export default function PublicPage() {
  const [reports,       setReports]       = useState<any[]>(DEMO_REPORTS);
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [isDemo,        setIsDemo]        = useState(true);
  const [loading,       setLoading]       = useState(false);
  const [regionFilter,  setRegionFilter]  = useState("All");
  const [hazardFilter,  setHazardFilter]  = useState("All");
  const [tab,       setTab]       = useState("areas");
  const [reporting, setReporting] = useState(false);
  const [areaSearch,setAreaSearch]= useState("");
  const [from,      setFrom]      = useState("");
  const [to,        setTo]        = useState("");
  const [result,    setResult]    = useState<any>(null);
  const [checking,  setChecking]  = useState(false);
  const [confirmed,    setConfirmed]    = useState<Record<string,boolean>>({});
  const [gps,          setGps]          = useState<any>({ lat:null, lng:null, address:null, status:"idle" });
  const [installPrompt,setInstallPrompt]= useState<any>(null);
  const [showInstall,  setShowInstall]  = useState(false);
  const [lang,         setLang]         = useState<Lang>("EN");

  // Load reports — replace demo data with live data if API responds
  useEffect(() => {
    fetch("/api/reports")
      .then(r => r.json())
      .then(j => { if (j.success && j.data.length > 0) { setReports(j.data); setIsDemo(false); } else { setIsDemo(true); } })
      .catch(() => setIsDemo(true))
      .finally(() => setLoading(false));
    fetch("/api/announcements")
      .then(r => r.json())
      .then(j => { if (j.success) setAnnouncements(j.data); });
  }, []);

  // PWA install prompt
  useEffect(() => {
    const handler = (e: any) => { e.preventDefault(); setInstallPrompt(e); setShowInstall(true); };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const getGps = () => {
    setGps((g:any) => ({ ...g, status:"locating" }));
    const fb = () => revGeo(5.6037,-0.1870).then(a => { setGps({ lat:5.6037, lng:-0.1870, address:a||"Accra", status:"demo" }); setFrom(a||"Accra"); });
    if (!navigator.geolocation) { fb(); return; }
    navigator.geolocation.getCurrentPosition(
      async p => { const { latitude:lat, longitude:lng } = p.coords; const a = await revGeo(lat,lng); setGps({ lat,lng, address:a||`${lat.toFixed(4)}°N`, status:"live" }); setFrom(a||`${lat.toFixed(4)}°N`); },
      fb, { timeout:8000, enableHighAccuracy:true }
    );
  };

  const doCheck = () => {
    if (!from || !to) return; setChecking(true);
    setTimeout(() => {
      const q       = `${from} ${to}`.toLowerCase();
      const matched = AREAS.filter(a => a.kw.some(k => q.includes(k)));
      if (!matched.length) { setResult({ matched:false, hazards:[] }); setChecking(false); return; }
      const hazards = reports.filter(r => matched.some(a => a.id === r.areaId) && r.status !== "RESOLVED" && r.status !== "DISMISSED" && CONFIDENCE[getConf(r)].showInRoute).sort((a:any, b:any) => SO[a.severity]-SO[b.severity]);
      setResult({ matched:true, areas:matched, hazards });
      setChecking(false);
    }, 800);
  };

  const doConfirm = async (id: string) => {
    if (confirmed[id]) return;
    setConfirmed(p => ({ ...p, [id]:true }));
    setReports(p => p.map(r => r.id === id ? { ...r, upvoteCount:(r.upvoteCount||r.upvotes||0)+1 } : r));
    await fetch(`/api/reports/${id}/upvote`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ fingerprint:`fp-${Date.now()}-${Math.random()}` }) });
  };

  const onSubmit = (r: any) => { if (r) setReports(p => [r, ...p]); setReporting(false); };

  const verdict = result?.matched && result.hazards.length > 0
    ? result.hazards.some((r:any) => r.severity==="CRITICAL") ? { emoji:"🔴", text:"Dangerous conditions", c:"#EF4444", bg:"rgba(239,68,68,0.06)", b:"rgba(239,68,68,0.18)" }
    : result.hazards.some((r:any) => r.severity==="HIGH")     ? { emoji:"🟠", text:"Use caution",          c:"#F97316", bg:"rgba(249,115,22,0.06)", b:"rgba(249,115,22,0.18)" }
    : { emoji:"🟡", text:"Minor hazards", c:"#F59E0B", bg:"rgba(245,158,11,0.06)", b:"rgba(245,158,11,0.18)" }
    : result?.matched ? { emoji:"✅", text:"Route looks clear", c:"#22C55E", bg:"rgba(34,197,94,0.06)", b:"rgba(34,197,94,0.18)" } : null;

  const fixedRoads = reports.filter(r => r.status === "RESOLVED" && r.resolutionNote).sort((a:any,b:any) => new Date(b.resolvedAt).getTime()-new Date(a.resolvedAt).getTime());
  const activeCount   = reports.filter(r => r.status !== "RESOLVED" && r.status !== "DISMISSED" && CONFIDENCE[getConf(r)].showInAreas).length;

  return (
    <div style={{ background:"#0A0A0A", minHeight:"100vh", fontFamily:"'Inter',-apple-system,sans-serif", color:"#fff", paddingBottom:72 }}>
      <style>{`
        @keyframes fadeUp  { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
        @keyframes slideUp { from{transform:translateY(100%)} to{transform:translateY(0)} }
        @keyframes spin    { to{transform:rotate(360deg)} }
        @keyframes bob     { 0%,60%,100%{transform:translateY(0)} 30%{transform:translateY(-5px)} }
        @keyframes fabPulse{ 0%,100%{box-shadow:0 4px 20px #EF444480,0 0 0 0 rgba(239,68,68,0)} 65%{box-shadow:0 4px 20px #EF444480,0 0 0 8px rgba(239,68,68,0)} }
        @keyframes recordPulse{ 0%,100%{box-shadow:0 0 0 0 rgba(239,68,68,0.4)} 70%{box-shadow:0 0 0 10px rgba(239,68,68,0)} }
        input::placeholder{color:#1e1e1e} ::-webkit-scrollbar{display:none}
        *{box-sizing:border-box;margin:0;padding:0} button{cursor:pointer;-webkit-tap-highlight-color:transparent}
      `}</style>

      {/* Header (non-areas tabs) */}
      {tab !== "areas" && (
        <div style={{ background:"#0A0A0A", padding:"18px 18px 0", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <div style={{ color:"#fff", fontWeight:900, fontSize:17, letterSpacing:-.3 }}>
            {tab === "route" ? "Route Check" : "Fixed Roads"}
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:5, background:"rgba(34,197,94,0.06)", border:"1px solid rgba(34,197,94,0.15)", borderRadius:20, padding:"4px 10px" }}>
            <span style={{ width:5, height:5, borderRadius:"50%", background:"#22C55E", display:"inline-block", boxShadow:"0 0 6px #22C55E" }}/>
            <span style={{ color:"#22C55E", fontSize:9, fontWeight:900, letterSpacing:1.5 }}>LIVE</span>
          </div>
        </div>
      )}

      {/* ── AREAS TAB ── */}
      {tab === "areas" && (
        <div style={{ animation:"fadeUp .18s ease" }}>
          <div style={{ padding:"22px 18px 14px", borderBottom:"1px solid #0F0F0F" }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
              <div style={{ fontSize:8, fontWeight:900, letterSpacing:3, color:"#EF4444" }}>ROADWATCH GH</div>
              {isDemo && !loading && <div style={{ fontSize:8, fontWeight:900, letterSpacing:1.5, color:"#333", background:"#111", border:"1px solid #1a1a1a", borderRadius:20, padding:"2px 8px" }}>PREVIEW</div>}
            </div>
            <div style={{ color:"#fff", fontWeight:900, fontSize:22, letterSpacing:-.5, lineHeight:1.15, marginTop:6 }}>Is your road<br/>safe right now?</div>
            <div style={{ color: loading ? "#2a2a2a" : activeCount > 0 ? "#F97316" : "#22C55E", fontSize:12, marginTop:8, fontWeight:600 }}>
              {loading ? "Checking…" : activeCount > 0 ? `⚠️ ${activeCount} active hazard${activeCount!==1?"s":""} across Ghana` : "✅ All areas currently clear"}
            </div>
          </div>
          <div style={{ padding:"12px 18px 0" }}>
            {/* Announcements */}
            {announcements.length > 0 && (
              <div style={{ display:"flex", gap:8, overflowX:"auto", paddingBottom:4, marginBottom:12 }}>
                {announcements.map(a => {
                  const at = A_TYPE[a.type] || A_TYPE.INFO;
                  return (
                    <div key={a.id} style={{ flexShrink:0, maxWidth:260, background:at.bg, border:`1px solid ${at.border}`, borderRadius:12, padding:"10px 13px" }}>
                      <div style={{ display:"flex", alignItems:"center", gap:5, marginBottom:4 }}>
                        <span style={{ fontSize:12 }}>{at.icon}</span>
                        <span style={{ color:at.color, fontSize:9, fontWeight:800, letterSpacing:1 }}>{a.region || "NATIONAL"}</span>
                      </div>
                      <div style={{ color:"#fff", fontWeight:700, fontSize:13, marginBottom:3 }}>{a.title}</div>
                      <div style={{ color:"#555", fontSize:11, lineHeight:1.5 }}>{a.body}</div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Region filter */}
            {(() => {
              const allRegions = [...new Set(AREAS.map(a => a.region))].sort();
              return (
                <div style={{ display:"flex", gap:6, overflowX:"auto", paddingBottom:4, marginBottom:8 }}>
                  {["All", ...allRegions].map(r => (
                    <button key={r} onClick={() => { setRegionFilter(r); setAreaSearch(""); }}
                      style={{ flexShrink:0, background:regionFilter===r?"#EF4444":"#0D0D0D", border:`1px solid ${regionFilter===r?"#EF4444":"#141414"}`, borderRadius:20, padding:"6px 13px", color:regionFilter===r?"#fff":"#333", fontSize:11, fontWeight:700, fontFamily:"inherit" }}>
                      {r}
                    </button>
                  ))}
                </div>
              );
            })()}

            {/* Hazard type filter */}
            <div style={{ display:"flex", gap:6, overflowX:"auto", paddingBottom:4, marginBottom:10 }}>
              {[{ key:"All", e:"◈", label:"All" }, ...H.map(h => ({ key:h.key, e:h.e, label:h.label }))].map(h => (
                <button key={h.key} onClick={() => setHazardFilter(h.key)}
                  style={{ flexShrink:0, background:hazardFilter===h.key?"rgba(239,68,68,0.12)":"#0D0D0D", border:`1px solid ${hazardFilter===h.key?"rgba(239,68,68,0.3)":"#141414"}`, borderRadius:20, padding:"6px 12px", color:hazardFilter===h.key?"#EF4444":"#333", fontSize:11, fontWeight:700, fontFamily:"inherit" }}>
                  {h.e} {h.label}
                </button>
              ))}
            </div>

            <div style={{ background:"#0D0D0D", border:"1px solid #141414", borderRadius:12, padding:"10px 13px", marginBottom:12, display:"flex", alignItems:"center", gap:8 }}>
              <span style={{ color:"#1e1e1e", fontSize:15 }}>🔍</span>
              <input value={areaSearch} onChange={e => setAreaSearch(e.target.value)} placeholder="Search area or road…" style={{ flex:1, background:"transparent", border:"none", outline:"none", color:"#fff", fontSize:14, fontFamily:"inherit" }}/>
              {areaSearch && <button onClick={() => setAreaSearch("")} style={{ background:"none", border:"none", color:"#333", fontSize:18 }}>×</button>}
            </div>
            {(() => {
              const bySearch = AREAS.filter(a =>
                (!areaSearch || a.name.toLowerCase().includes(areaSearch.toLowerCase()) || a.kw.some(k => k.includes(areaSearch.toLowerCase()))) &&
                (regionFilter === "All" || a.region === regionFilter)
              );
              if (bySearch.length === 0) return (
                <div style={{ textAlign:"center", padding:"36px 0", color:"#1e1e1e" }}>No areas match your filters</div>
              );

              const scored = bySearch.map(a => {
                const s = areaSafety(a.id, reports);
                const matchesHazard = hazardFilter === "All" || s.reports.some((r:any) => r.hazardType === hazardFilter);
                return { a, s, matchesHazard };
              });
              const regions = [...new Set(bySearch.map(a => a.region))];

              return (
                <>
                  {regions.map(region => {
                    const regionAreas = scored
                      .filter(x => x.a.region === region)
                      .sort((x,y) => { const o={DANGER:0,CAUTION:1,ADVISORY:2,CLEAR:3}; return o[x.s.score as keyof typeof o]-o[y.s.score as keyof typeof o] || y.s.count-x.s.count; });

                    const active = regionAreas.filter(x => x.s.score !== "CLEAR" && x.matchesHazard);
                    const clear  = hazardFilter === "All" ? regionAreas.filter(x => x.s.score === "CLEAR") : [];

                    if (active.length === 0 && clear.length === 0) return null;

                    return (
                      <div key={region} style={{ marginBottom:18 }}>
                        <div style={{ fontSize:8, fontWeight:900, letterSpacing:2.5, color:"#2a2a2a", marginBottom:8, paddingLeft:2 }}>{region.toUpperCase()}</div>
                        {active.map(({ a, s }) => {
                          const visibleReports = hazardFilter === "All" ? s.reports : s.reports.filter((r:any) => r.hazardType === hazardFilter);
                          const uniqueTypes    = [...new Set(visibleReports.map((r:any) => r.hazardType))];
                          const worstSev = visibleReports.some((r:any) => r.severity==="CRITICAL") ? "CRITICAL"
                            : visibleReports.some((r:any) => r.severity==="HIGH") ? "HIGH"
                            : visibleReports.some((r:any) => r.severity==="MEDIUM") ? "MEDIUM" : "LOW";
                          return (
                            <div key={a.id} style={{ background:"#0D0D0D", border:`1px solid ${s.b}`, borderLeft:`3px solid ${s.c}`, borderRadius:14, padding:"14px", marginBottom:6 }}>
                              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                                <div>
                                  <div style={{ color:"#fff", fontWeight:700, fontSize:14 }}>{a.name}</div>
                                  <div style={{ color:"#222", fontSize:10, marginTop:1 }}>{a.district}</div>
                                </div>
                                <span style={{ color:s.c, fontSize:10, fontWeight:800, background:s.bg, border:`1px solid ${s.b}`, borderRadius:20, padding:"3px 10px", letterSpacing:.5 }}>{s.label.toUpperCase()}</span>
                              </div>
                              <div style={{ marginTop:8, display:"flex", alignItems:"center", gap:6 }}>
                                <span style={{ color:SC[worstSev], fontSize:10, fontWeight:700 }}>{SEV[worstSev]?.label}</span>
                                <span style={{ color:"#1e1e1e" }}>·</span>
                                <span style={{ fontSize:14, letterSpacing:2 }}>{uniqueTypes.map(k => hMeta(k).e).join(" ")}</span>
                              </div>
                            </div>
                          );
                        })}
                        {clear.length > 0 && (
                          <div style={{ background:"#0A0A0A", border:"1px solid #0F0F0F", borderRadius:12, overflow:"hidden" }}>
                            {clear.map(({ a }, i) => (
                              <div key={a.id} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"10px 14px", borderTop: i > 0 ? "1px solid #0F0F0F" : "none" }}>
                                <div>
                                  <span style={{ color:"#2a2a2a", fontSize:13 }}>{a.name}</span>
                                  <span style={{ color:"#181818", fontSize:10, marginLeft:6 }}>{a.district}</span>
                                </div>
                                <span style={{ color:"#22C55E", fontSize:10, fontWeight:700, display:"flex", alignItems:"center", gap:4 }}>
                                  <span style={{ width:5, height:5, borderRadius:"50%", background:"#22C55E", display:"inline-block" }}/>Clear
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* ── ROUTE TAB ── */}
      {tab === "route" && (
        <div style={{ padding:"16px 18px 0", animation:"fadeUp .18s ease" }}>
          <div style={{ marginBottom:8 }}>
            <div style={{ fontSize:9, fontWeight:800, letterSpacing:2, color:"#2a2a2a", marginBottom:5 }}>FROM</div>
            <div style={{ display:"flex", gap:7 }}>
              <div style={{ flex:1, background:"#0D0D0D", border:"1px solid #1a1a1a", borderRadius:12, padding:"12px 14px", display:"flex", alignItems:"center", gap:8 }}>
                <span style={{ color:"#22C55E", fontSize:13 }}>●</span>
                <input value={from} onChange={e => setFrom(e.target.value)} placeholder="Where are you coming from?" style={{ flex:1, background:"transparent", border:"none", outline:"none", color:"#fff", fontSize:14, fontFamily:"inherit" }}/>
              </div>
              <button onClick={getGps} style={{ background:"#0D0D0D", border:"1px solid #1a1a1a", borderRadius:12, padding:"12px", fontSize:17 }}>{gps.status==="locating"?"⏳":"📍"}</button>
            </div>
            {gps.status==="live" && <div style={{ color:"#22C55E", fontSize:10, marginTop:4, marginLeft:2 }}>● GPS locked</div>}
          </div>
          <div style={{ marginBottom:16 }}>
            <div style={{ fontSize:9, fontWeight:800, letterSpacing:2, color:"#2a2a2a", marginBottom:5 }}>TO</div>
            <div style={{ background:"#0D0D0D", border:"1px solid #1a1a1a", borderRadius:12, padding:"12px 14px", display:"flex", alignItems:"center", gap:8 }}>
              <span style={{ color:"#EF4444", fontSize:13 }}>●</span>
              <input value={to} onChange={e => setTo(e.target.value)} placeholder="Where are you going?" style={{ flex:1, background:"transparent", border:"none", outline:"none", color:"#fff", fontSize:14, fontFamily:"inherit" }}/>
            </div>
          </div>
          {!from && !to && (
            <div style={{ marginBottom:16 }}>
              <div style={{ fontSize:9, fontWeight:800, letterSpacing:2, color:"#1e1e1e", marginBottom:8 }}>QUICK ROUTES</div>
              <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                {[["Accra","Kumasi"],["Spintex","Circle"],["Adenta","Madina"],["Airport","Tema"]].map(([f,t]) => (
                  <button key={f+t} onClick={() => { setFrom(f); setTo(t); }} style={{ background:"#0D0D0D", border:"1px solid #141414", borderRadius:20, padding:"6px 13px", color:"#555", fontSize:12, fontFamily:"inherit" }}>{f} → {t}</button>
                ))}
              </div>
            </div>
          )}
          <button onClick={doCheck} disabled={!from||!to||checking}
            style={{ width:"100%", background:!from||!to?"#0D0D0D":"#EF4444", border:"none", borderRadius:13, padding:"15px", color:!from||!to?"#2a2a2a":"#fff", fontWeight:800, fontSize:15, fontFamily:"inherit", display:"flex", alignItems:"center", justifyContent:"center", gap:8, marginBottom:20 }}>
            {checking ? <><span style={{ display:"inline-block", width:16, height:16, border:"2px solid rgba(255,255,255,.3)", borderTopColor:"#fff", borderRadius:"50%", animation:"spin .8s linear infinite" }}/> Checking…</> : "Check Route"}
          </button>
          {result && verdict && (
            <div style={{ animation:"fadeUp .25s ease" }}>
              <div style={{ background:verdict.bg, border:`1px solid ${verdict.b}`, borderRadius:14, padding:"14px 16px", marginBottom:14, display:"flex", alignItems:"center", gap:12 }}>
                <span style={{ fontSize:28 }}>{verdict.emoji}</span>
                <div>
                  <div style={{ color:verdict.c, fontWeight:800, fontSize:17 }}>{verdict.text}</div>
                  <div style={{ color:"#555", fontSize:12, marginTop:2 }}>{from} → {to}</div>
                </div>
              </div>
              {result.hazards.length > 0 && (
                <RouteMapGL hazards={result.hazards} height={190}/>
              )}
              {result.hazards.map((r:any) => {
                const h = hMeta(r.hazardType);
                return (
                  <div key={r.id} style={{ background:"#0D0D0D", borderLeft:`3px solid ${SC[r.severity]}`, borderRadius:13, padding:"12px 14px", marginBottom:8, border:`1px solid #141414` }}>
                    <div style={{ display:"flex", gap:8, marginBottom:r.description?8:0 }}>
                      {r.photoUrl && <img src={r.photoUrl} alt="" style={{ width:48, height:48, objectFit:"cover", borderRadius:7, flexShrink:0 }}/>}
                      <div style={{ flex:1 }}>
                        <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:2 }}>
                          <span style={{ fontSize:13 }}>{h.e}</span>
                          <span style={{ color:"#fff", fontWeight:700, fontSize:13 }}>{h.label}</span>
                          <span style={{ color:SC[r.severity], fontSize:10, fontWeight:700, marginLeft:"auto" }}>{SEV[r.severity]?.label}</span>
                        </div>
                        <div style={{ color:"#444", fontSize:11 }}>📍 {r.address}{r.landmark?`, ${r.landmark}`:""}</div>
                      </div>
                    </div>
                    {r.description && <div style={{ color:"#333", fontSize:11, lineHeight:1.5, marginBottom:8 }}>{r.description}</div>}
                    <button onClick={() => doConfirm(r.id)} style={{ width:"100%", background:confirmed[r.id]?"rgba(34,197,94,0.06)":"#141414", border:`1px solid ${confirmed[r.id]?"rgba(34,197,94,0.2)":"#1a1a1a"}`, borderRadius:9, padding:"8px", color:confirmed[r.id]?"#22C55E":"#555", fontWeight:700, fontSize:12, fontFamily:"inherit" }}>
                      {confirmed[r.id] ? "✓ Confirmed" : "👍 I can confirm this"}
                    </button>
                  </div>
                );
              })}
              <button onClick={() => { setResult(null); setFrom(""); setTo(""); }} style={{ width:"100%", background:"transparent", border:"1px solid #141414", borderRadius:12, padding:"12px", color:"#333", fontWeight:600, fontSize:13, fontFamily:"inherit", marginTop:4 }}>Check another route</button>
            </div>
          )}
          {result && !result.matched && (
            <div style={{ background:"#0D0D0D", border:"1px solid #141414", borderRadius:14, padding:"20px", textAlign:"center", animation:"fadeUp .25s ease" }}>
              <div style={{ fontSize:28, marginBottom:8 }}>🤷</div>
              <div style={{ color:"#fff", fontWeight:700, fontSize:14, marginBottom:4 }}>Route not found</div>
              <div style={{ color:"#444", fontSize:12, lineHeight:1.6 }}>Try: Spintex, Adenta, Tema, Kumasi, Circle, Haatso, Liberation Road</div>
            </div>
          )}
        </div>
      )}

      {/* ── FIXED TAB ── */}
      {tab === "fixed" && (
        <div style={{ padding:"16px 18px 0", animation:"fadeUp .18s ease" }}>
          {fixedRoads.length === 0
            ? <div style={{ textAlign:"center", padding:"48px 0", color:"#1a1a1a", fontSize:14 }}>Nothing resolved yet</div>
            : fixedRoads.map((r:any) => {
                const h   = hMeta(r.hazardType);
                const hrs = r.resolvedAt ? Math.round((new Date(r.resolvedAt).getTime()-new Date(r.createdAt).getTime())/3600000) : null;
                return (
                  <div key={r.id} style={{ background:"#0D0D0D", border:"1px solid rgba(34,197,94,0.12)", borderLeft:"3px solid #22C55E", borderRadius:14, overflow:"hidden", marginBottom:10 }}>
                    {r.photoUrl && <img src={r.photoUrl} alt="" style={{ width:"100%", height:90, objectFit:"cover", display:"block", opacity:.5 }}/>}
                    <div style={{ padding:"13px 14px" }}>
                      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
                        <span style={{ fontSize:18 }}>✅</span>
                        <div>
                          <div style={{ color:"#22C55E", fontWeight:700, fontSize:14 }}>Fixed — {h.label}</div>
                          <div style={{ color:"#444", fontSize:11, marginTop:1 }}>📍 {r.address}{r.landmark?`, ${r.landmark}`:""}</div>
                        </div>
                      </div>
                      <div style={{ background:"#141414", borderRadius:10, padding:"9px 12px", marginBottom:8 }}>
                        <div style={{ color:"#888", fontSize:12, lineHeight:1.6, fontStyle:"italic" }}>"{r.resolutionNote}"</div>
                        {r.fixedBy && <div style={{ color:"#2a2a2a", fontSize:10, marginTop:4 }}>— {r.fixedBy}</div>}
                      </div>
                      <div style={{ display:"flex", gap:10, color:"#2a2a2a", fontSize:10 }}>
                        <span>👍 {r.upvoteCount||r.upvotes||0}</span>
                        {hrs && <span>⏱ {hrs<24?`${hrs}h`:`${Math.round(hrs/24)}d`} to fix</span>}
                        {r.resolvedAt && <span style={{ marginLeft:"auto" }}>{ago(r.resolvedAt)} ago</span>}
                      </div>
                    </div>
                  </div>
                );
              })
          }
        </div>
      )}

      {/* PWA install banner */}
      {showInstall && (
        <div style={{ position:"fixed", bottom:76, left:12, right:12, zIndex:105, background:"#0D0D0D", border:"1px solid #1a1a1a", borderRadius:14, padding:"12px 14px", display:"flex", alignItems:"center", gap:10, animation:"fadeUp .2s ease" }}>
          <span style={{ fontSize:20 }}>📲</span>
          <div style={{ flex:1 }}>
            <div style={{ color:"#fff", fontWeight:700, fontSize:13 }}>Add to Home Screen</div>
            <div style={{ color:"#444", fontSize:11 }}>Works offline · No app store needed</div>
          </div>
          <button onClick={async () => { installPrompt?.prompt(); const r = await installPrompt?.userChoice; if (r?.outcome==="accepted") setShowInstall(false); }} style={{ background:"#EF4444", border:"none", borderRadius:10, padding:"8px 14px", color:"#fff", fontWeight:700, fontSize:13, fontFamily:"inherit" }}>Add</button>
          <button onClick={() => setShowInstall(false)} style={{ background:"none", border:"none", color:"#333", fontSize:18, lineHeight:1 }}>×</button>
        </div>
      )}

      {/* FAB */}
      <button onClick={() => setReporting(true)}
        style={{ position:"fixed", bottom:86, right:20, zIndex:110, width:58, height:58, borderRadius:"50%", background:"#EF4444", border:"none", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:1, animation:"fabPulse 3s ease-in-out infinite" }}>
        <span style={{ fontSize:20, lineHeight:1 }}>⚠️</span>
        <span style={{ color:"rgba(255,255,255,0.8)", fontSize:7, fontWeight:900, letterSpacing:.5 }}>REPORT</span>
      </button>

      {/* Report modal */}
      {reporting && (
        <div style={{ position:"fixed", inset:0, zIndex:200, animation:"fadeUp .2s ease" }}>
          <div style={{ position:"absolute", inset:0, background:"rgba(0,0,0,0.88)", backdropFilter:"blur(10px)" }} onClick={() => setReporting(false)}/>
          <div style={{ position:"absolute", bottom:0, left:0, right:0, background:"#0A0A0A", borderRadius:"20px 20px 0 0", border:"1px solid #1a1a1a", borderBottom:"none", height:"88vh", display:"flex", flexDirection:"column", animation:"slideUp .26s cubic-bezier(.32,.72,0,1)" }}>
            <div style={{ flexShrink:0 }}>
              <div style={{ display:"flex", justifyContent:"center", paddingTop:9, paddingBottom:2 }}><div style={{ width:36, height:4, borderRadius:2, background:"#1e1e1e" }}/></div>
              <div style={{ padding:"10px 14px", borderBottom:"1px solid #141414", display:"flex", alignItems:"center", gap:10 }}>
                <div style={{ width:34, height:34, borderRadius:"50%", background:"linear-gradient(135deg,#EF4444,#7F1D1D)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:15, flexShrink:0 }}>🚧</div>
                <div style={{ flex:1 }}>
                  <div style={{ color:"#fff", fontWeight:700, fontSize:14 }}>RoadWatch</div>
                  <div style={{ fontSize:10, display:"flex", alignItems:"center", gap:3, marginTop:1 }}>
                    {gps.status === "locating"
                      ? <><div style={{ width:8, height:8, border:"1.5px solid #444", borderTopColor:"#22C55E", borderRadius:"50%", animation:"spin .8s linear infinite" }}/><span style={{ color:"#555" }}>Getting location…</span></>
                      : gps.status === "live"
                      ? <><span style={{ width:4, height:4, borderRadius:"50%", background:"#22C55E", display:"inline-block" }}/><span style={{ color:"#4ade80" }}>GPS locked</span></>
                      : <><span style={{ width:4, height:4, borderRadius:"50%", background:"#4ade80", display:"inline-block" }}/><span style={{ color:"#4ade80" }}>Online</span></>
                    }
                  </div>
                </div>
                <button onClick={() => setLang(l => l === "EN" ? "TW" : "EN")} style={{ background:"#141414", border:"1px solid #1e1e1e", borderRadius:8, padding:"4px 8px", color:"#666", fontSize:9, fontWeight:900, letterSpacing:.5, fontFamily:"inherit" }}>
                  {lang === "EN" ? "TW 🇬🇭" : "EN 🇬🇧"}
                </button>
                <button onClick={() => setReporting(false)} style={{ background:"#141414", border:"1px solid #1e1e1e", borderRadius:8, width:30, height:30, display:"flex", alignItems:"center", justifyContent:"center", color:"#555", fontSize:17, lineHeight:1 }}>×</button>
              </div>
            </div>
            <div style={{ flex:1, overflow:"hidden" }}>
              <ChatReport gps={gps} onDone={onSubmit} lang={lang}/>
            </div>
          </div>
        </div>
      )}

      {/* Bottom nav */}
      <div style={{ position:"fixed", bottom:0, left:0, right:0, background:"rgba(5,5,5,0.97)", borderTop:"1px solid #0F0F0F", padding:"9px 0 20px", display:"flex", justifyContent:"space-around", backdropFilter:"blur(20px)", zIndex:99 }}>
        {[["areas","🏙️","Areas"],["route","🛣️","Route"],["fixed","✅","Fixed"]].map(([key,icon,label]) => (
          <button key={key} onClick={() => setTab(key)} style={{ background:"none", border:"none", display:"flex", flexDirection:"column", alignItems:"center", gap:2, fontFamily:"inherit", minWidth:64 }}>
            <span style={{ fontSize:21 }}>{icon}</span>
            <span style={{ fontSize:8, fontWeight:900, letterSpacing:.8, color:tab===key?"#EF4444":"#1e1e1e" }}>{label.toUpperCase()}</span>
          </button>
        ))}
        <div style={{ minWidth:64 }}/>
      </div>
    </div>
  );
}
