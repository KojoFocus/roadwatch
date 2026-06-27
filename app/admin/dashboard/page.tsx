"use client";

import { useState, useEffect } from "react";
import { useRouter }           from "next/navigation";
import dynamic                 from "next/dynamic";

const AdminMapGL = dynamic(() => import("@/components/AdminMapGL"), { ssr: false });

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const CONFIDENCE: Record<string, any> = {
  LOW:       { label:"Unverified", color:"#374151", bg:"rgba(55,65,81,0.08)",    border:"rgba(55,65,81,0.18)"    },
  MEDIUM:    { label:"Reported",   color:"#F59E0B", bg:"rgba(245,158,11,0.08)",  border:"rgba(245,158,11,0.22)" },
  HIGH:      { label:"Verified",   color:"#F97316", bg:"rgba(249,115,22,0.08)",  border:"rgba(249,115,22,0.25)" },
  CONFIRMED: { label:"Confirmed",  color:"#EF4444", bg:"rgba(239,68,68,0.08)",   border:"rgba(239,68,68,0.28)"  },
};

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

const ST: Record<string, any> = {
  PENDING:   { label:"Pending",   c:"#64748B", bg:"rgba(100,116,139,0.08)", b:"rgba(100,116,139,0.2)"  },
  VERIFIED:  { label:"Verified",  c:"#F59E0B", bg:"rgba(245,158,11,0.08)", b:"rgba(245,158,11,0.22)"  },
  IN_REVIEW: { label:"In Review", c:"#60A5FA", bg:"rgba(96,165,250,0.08)", b:"rgba(96,165,250,0.22)"  },
  RESOLVED:  { label:"Resolved",  c:"#22C55E", bg:"rgba(34,197,94,0.08)",  b:"rgba(34,197,94,0.22)"   },
  DISMISSED: { label:"Dismissed", c:"#374151", bg:"rgba(55,65,81,0.08)",   b:"rgba(55,65,81,0.18)"    },
};
const ST_FLOW = ["PENDING","VERIFIED","IN_REVIEW","RESOLVED"];

function ago(iso: string) {
  const d = Math.floor((Date.now()-new Date(iso).getTime())/1000);
  if (d<3600)  return `${Math.floor(d/60)}m`;
  if (d<86400) return `${Math.floor(d/3600)}h`;
  return `${Math.floor(d/86400)}d`;
}


// ─── PDF EXPORT ───────────────────────────────────────────────────────────────
function exportPDF(r: any, h: any) {
  const win = window.open("", "_blank");
  if (!win) return;
  win.document.write(`<!DOCTYPE html><html><head><title>RoadWatch Report #${r.id.slice(-6)}</title>
<style>
  body { font-family: Arial, sans-serif; max-width: 600px; margin: 40px auto; color: #111; }
  h1 { color: #EF4444; margin-bottom: 4px; }
  .badge { display:inline-block; padding:2px 10px; border-radius:20px; font-size:12px; font-weight:700; }
  .label { font-size:11px; color:#888; text-transform:uppercase; letter-spacing:1px; margin-top:14px; margin-bottom:4px; }
  img { width:100%; border-radius:8px; margin:10px 0; }
  table { width:100%; border-collapse:collapse; margin:10px 0; }
  td { padding:8px 12px; border-bottom:1px solid #eee; font-size:13px; }
  td:first-child { color:#888; width:140px; }
  .note { background:#f9f9f9; border-left:3px solid #22C55E; padding:12px 16px; border-radius:4px; font-style:italic; }
  @media print { body { margin: 0; } }
</style></head><body>
<h1>🚧 RoadWatch Ghana</h1>
<p style="color:#888;font-size:12px;">Report #${r.id.slice(-6)} · Generated ${new Date().toLocaleDateString("en-GB", { day:"numeric", month:"long", year:"numeric" })}</p>
${r.photoUrl ? `<img src="${r.photoUrl}" alt="Hazard photo"/>` : ""}
<div class="label">Incident</div>
<table>
  <tr><td>Type</td><td>${h.e} ${h.label}</td></tr>
  <tr><td>Severity</td><td>${SEV[r.severity]?.label || r.severity}</td></tr>
  <tr><td>Status</td><td>${ST[r.status]?.label || r.status}</td></tr>
  <tr><td>Confidence</td><td>${CONFIDENCE[r.confidence||"MEDIUM"]?.label}</td></tr>
  <tr><td>Reported</td><td>${new Date(r.createdAt).toLocaleString("en-GB")}</td></tr>
  <tr><td>Confirmations</td><td>${r.upvoteCount||0}</td></tr>
</table>
<div class="label">Location</div>
<table>
  <tr><td>Address</td><td>${r.address}${r.landmark ? `, ${r.landmark}` : ""}</td></tr>
  <tr><td>GPS</td><td>${r.latitude.toFixed(6)}, ${r.longitude.toFixed(6)}</td></tr>
  <tr><td>Map</td><td><a href="https://maps.google.com?q=${r.latitude},${r.longitude}">View on Google Maps</a></td></tr>
</table>
${r.description ? `<div class="label">Description</div><p>${r.description}</p>` : ""}
${r.transcript  ? `<div class="label">Voice Transcript</div><p><em>"${r.transcript}"</em></p>` : ""}
${r.resolutionNote ? `<div class="label">Resolution</div><div class="note">${r.resolutionNote}${r.fixedBy ? `<br/><small>— ${r.fixedBy}</small>` : ""}</div>` : ""}
<p style="margin-top:40px;font-size:10px;color:#ccc;">RoadWatch Ghana · roadwatch.gh · This document is for official use.</p>
</body></html>`);
  win.document.close();
  win.print();
}

// ─── DETAIL PANEL ─────────────────────────────────────────────────────────────
function DetailPanel({ r, onClose, onUpdate }: { r:any; onClose:()=>void; onUpdate:(updated:any)=>void }) {
  const [status,     setStatus]     = useState(r.status);
  const [note,       setNote]       = useState(r.resolutionNote || "");
  const [fixedBy,    setFixedBy]    = useState(r.fixedBy || "");
  const [saving,     setSaving]     = useState(false);
  const [saved,      setSaved]      = useState(false);
  const [activities, setActivities] = useState<any[]>([]);
  const h         = hMeta(r.hazardType);
  const conf      = r.confidence || "MEDIUM";
  const needNote  = status==="RESOLVED" && !note.trim();

  const fwdMsg = [
    `RoadWatch Alert 🚧`,
    ``,
    `${h.label} at ${r.address}${r.landmark ? `, ${r.landmark}` : ""}`,
    `Severity: ${SEV[r.severity]?.label}`,
    `GPS: ${r.latitude.toFixed(5)}, ${r.longitude.toFixed(5)}`,
    `Map: https://maps.google.com?q=${r.latitude},${r.longitude}`,
    r.photoUrl ? `Photo: ${r.photoUrl}` : null,
    ``,
    `${r.upvoteCount||0} citizen(s) confirmed this. Please inspect and act.`,
    ``,
    `— RoadWatch Ghana`,
  ].filter(l => l !== null).join("\n");

  useEffect(() => {
    fetch(`/api/reports/${r.id}`)
      .then(res => res.json())
      .then(j => { if (j.success) setActivities(j.data.activities || []); })
      .catch(() => {});
  }, [r.id]);

  const save = async () => {
    if (needNote) return;
    setSaving(true);
    try {
      const res  = await fetch(`/api/reports/${r.id}`, { method:"PATCH", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ status, resolutionNote:note, fixedBy }) });
      const json = await res.json();
      if (json.success) { onUpdate(json.data); setSaved(true); setTimeout(onClose, 700); }
    } catch { /* local update */ onUpdate({ ...r, status, resolutionNote:note, fixedBy }); setSaved(true); setTimeout(onClose, 700); }
    setSaving(false);
  };

  return (
    <div style={{ position:"fixed", inset:0, zIndex:200, background:"rgba(0,0,0,0.8)", backdropFilter:"blur(8px)", display:"flex", alignItems:"flex-end" }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ width:"100%", maxHeight:"93vh", overflowY:"auto", background:"#0C0C0C", borderRadius:"20px 20px 0 0", border:"1px solid #1a1a1a", borderBottom:"none", animation:"slideUp .26s cubic-bezier(.32,.72,0,1)" }}>
        <div style={{ display:"flex", justifyContent:"center", paddingTop:9, paddingBottom:2 }}><div style={{ width:36, height:4, borderRadius:2, background:"#1e1e1e" }}/></div>

        {r.photoUrl ? (
          <div style={{ position:"relative", height:190 }}>
            <img src={r.photoUrl} alt="" style={{ width:"100%", height:"100%", objectFit:"cover", display:"block" }}/>
            <div style={{ position:"absolute", inset:0, background:"linear-gradient(to top,#0C0C0C 0%,transparent 55%)" }}/>
            <div style={{ position:"absolute", top:10, right:12 }}><span style={{ background:"rgba(0,0,0,0.75)", color:"#4ade80", fontSize:9, fontWeight:800, letterSpacing:1.5, padding:"3px 9px", borderRadius:20 }}>📷 PHOTO EVIDENCE</span></div>
            <div style={{ position:"absolute", bottom:12, left:14 }}>
              <div style={{ color:"#fff", fontWeight:800, fontSize:17 }}>{h.e} {h.label}</div>
              <div style={{ color:"rgba(255,255,255,.4)", fontSize:11, marginTop:2 }}>{r.address}{r.landmark?`, ${r.landmark}`:""}</div>
            </div>
          </div>
        ) : (
          <div style={{ padding:"14px 18px 0", display:"flex", alignItems:"center", gap:10 }}>
            <div style={{ width:46, height:46, borderRadius:12, background:"#141414", display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, flexShrink:0 }}>{h.e}</div>
            <div>
              <div style={{ color:"#fff", fontWeight:800, fontSize:16 }}>{h.label}</div>
              <div style={{ color:"#444", fontSize:12, marginTop:1 }}>{r.address}{r.landmark?`, ${r.landmark}`:""}</div>
            </div>
          </div>
        )}

        <div style={{ padding:"14px 18px 44px" }}>
          {/* Confidence */}
          <div style={{ background:CONFIDENCE[conf]?.bg, border:`1px solid ${CONFIDENCE[conf]?.border}`, borderRadius:10, padding:"9px 12px", marginBottom:14, display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ fontSize:16 }}>{conf==="LOW"?"🔘":conf==="MEDIUM"?"📷":conf==="HIGH"?"✓":"🔴"}</span>
            <div>
              <div style={{ color:CONFIDENCE[conf]?.color, fontWeight:700, fontSize:12 }}>{CONFIDENCE[conf]?.label}</div>
              <div style={{ color:"#2a2a2a", fontSize:10, marginTop:1 }}>👍 {r.upvoteCount||0} · {r.photoUrl?"Photo":"No photo"}{r.transcript?` · 🎙️ Voice`:""}</div>
            </div>
          </div>

          {/* Voice transcript if present */}
          {r.transcript && (
            <div style={{ background:"rgba(96,165,250,0.06)", border:"1px solid rgba(96,165,250,0.15)", borderRadius:12, padding:"11px 14px", marginBottom:12 }}>
              <div style={{ color:"#60A5FA", fontSize:10, fontWeight:700, marginBottom:4 }}>🎙️ VOICE TRANSCRIPT</div>
              <div style={{ color:"#ccc", fontSize:13, lineHeight:1.6, fontStyle:"italic" }}>"{r.transcript}"</div>
            </div>
          )}

          <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:14 }}>
            <span style={{ color:SEV[r.severity]?.c, fontSize:11, fontWeight:700, background:SEV[r.severity]?.bg, border:`1px solid ${SEV[r.severity]?.b}`, borderRadius:20, padding:"3px 10px" }}>{SEV[r.severity]?.label}</span>
            <span style={{ color:ST[status]?.c, fontSize:11, fontWeight:700, background:ST[status]?.bg, border:`1px solid ${ST[status]?.b}`, borderRadius:20, padding:"3px 10px" }}>{ST[status]?.label}</span>
            <span style={{ color:"#1e1e1e", fontSize:11, marginLeft:"auto" }}>{ago(r.createdAt)} ago</span>
          </div>

          {/* Location */}
          <div style={{ background:"#111", border:"1px solid #1a1a1a", borderRadius:13, overflow:"hidden", marginBottom:10 }}>
            <div style={{ padding:"11px 14px" }}>
              <div style={{ color:"#fff", fontWeight:700, fontSize:13, marginBottom:3 }}>📍 {r.address}{r.landmark?`, ${r.landmark}`:""}</div>
              <div style={{ fontFamily:"monospace", color:"#38bdf8", fontSize:11, background:"#080808", padding:"5px 9px", borderRadius:7, display:"inline-block" }}>{r.latitude.toFixed(6)}, {r.longitude.toFixed(6)}</div>
            </div>
            <a href={`https://maps.google.com?q=${r.latitude},${r.longitude}`} target="_blank" rel="noreferrer"
              style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:7, padding:"11px", borderTop:"1px solid #141414", color:"#60A5FA", fontSize:12, fontWeight:700, textDecoration:"none", background:"#0a0a0a" }}>
              🗺️ Open in Google Maps
            </a>
          </div>

          {/* Description */}
          {r.description && (
            <div style={{ background:"#111", border:"1px solid #1a1a1a", borderRadius:12, padding:"11px 14px", marginBottom:10 }}>
              <div style={{ color:"#ccc", fontSize:13, lineHeight:1.65 }}>"{r.description}"</div>
              <div style={{ color:"#1e1e1e", fontSize:10, marginTop:6 }}>{r.reporter}{r.photoUrl&&<span style={{ color:"#4ade80" }}> · 📷</span>}</div>
            </div>
          )}

          {/* Forward */}
          <div style={{ background:"rgba(96,165,250,0.05)", border:"1px solid rgba(96,165,250,0.12)", borderRadius:12, padding:"11px 13px", marginBottom:12 }}>
            <div style={{ color:"#60A5FA", fontSize:11, fontWeight:700, marginBottom:8 }}>📤 Forward to Authority</div>
            <div style={{ display:"flex", gap:6 }}>
              {[["📱 SMS","sms"],["📧 Email","email"],["💬 WhatsApp","whatsapp"]].map(([l,t]) => (
                <button key={t} onClick={() => { const e=encodeURIComponent(fwdMsg); t==="whatsapp"?window.open(`https://wa.me/?text=${e}`):t==="sms"?window.open(`sms:?body=${e}`):window.open(`mailto:?subject=RoadWatch Alert&body=${e}`); }}
                  style={{ flex:1, background:"#111", border:"1px solid #141414", borderRadius:9, padding:"8px 5px", color:"#60A5FA", fontSize:11, fontWeight:700, fontFamily:"inherit" }}>{l}</button>
              ))}
            </div>
          </div>

          {/* Status pipeline */}
          <div style={{ marginBottom:12 }}>
            <div style={{ fontSize:9, fontWeight:800, letterSpacing:2, color:"#2a2a2a", marginBottom:10 }}>STATUS</div>
            <div style={{ display:"flex", alignItems:"center", marginBottom:10 }}>
              {ST_FLOW.map((s,i) => {
                const m=ST[s]; const idx=ST_FLOW.indexOf(status); const active=s===status; const past=i<idx;
                return (
                  <div key={s} style={{ display:"flex", alignItems:"center", flex:i<ST_FLOW.length-1?1:0 }}>
                    <button onClick={() => setStatus(s)} style={{ width:28, height:28, borderRadius:"50%", border:`2px solid ${active||past?m.c:"#1e1e1e"}`, background:active?m.c:past?m.bg:"#0C0C0C", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                      <span style={{ fontSize:10, color:active?"#000":past?m.c:"#333" }}>{past?"✓":active?"●":i+1}</span>
                    </button>
                    {i<ST_FLOW.length-1&&<div style={{ flex:1, height:2, background:past?m.c:"#141414", margin:"0 3px" }}/>}
                  </div>
                );
              })}
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6 }}>
              {Object.entries(ST).map(([key,m]:any) => (
                <button key={key} onClick={() => setStatus(key)} style={{ background:status===key?m.bg:"#0C0C0C", border:`1px solid ${status===key?m.b:"#141414"}`, borderRadius:11, padding:"10px 12px", color:status===key?m.c:"#2a2a2a", fontSize:12, fontWeight:700, fontFamily:"inherit", textAlign:"left", display:"flex", alignItems:"center", gap:6 }}>
                  <span style={{ width:6, height:6, borderRadius:"50%", background:status===key?m.c:"#1e1e1e", display:"inline-block", flexShrink:0 }}/>{m.label}
                </button>
              ))}
            </div>
          </div>

          {/* Resolution note */}
          <div style={{ marginBottom:12 }}>
            <div style={{ fontSize:9, fontWeight:800, letterSpacing:2, color:status==="RESOLVED"?"#22C55E":"#2a2a2a", marginBottom:6 }}>
              {status==="RESOLVED" ? "RESOLUTION NOTE · REQUIRED · BECOMES PUBLIC" : "ADMIN NOTE"}
            </div>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={3}
              placeholder={status==="RESOLVED" ? "What was fixed, by whom, when — citizens will see this" : "Internal note…"}
              style={{ width:"100%", background:"#111", border:`1px solid ${needNote?"rgba(239,68,68,0.4)":status==="RESOLVED"?"rgba(34,197,94,0.25)":"#1a1a1a"}`, borderRadius:11, padding:"11px 13px", color:"#ccc", fontSize:13, resize:"none", outline:"none", fontFamily:"inherit", boxSizing:"border-box" as const, lineHeight:1.55 }}/>
            {needNote && <div style={{ color:"#EF4444", fontSize:10, marginTop:3 }}>Required to mark as Resolved</div>}
            {status==="RESOLVED" && (
              <input value={fixedBy} onChange={e => setFixedBy(e.target.value)} placeholder="Fixed by (e.g. GHA Roads Team)"
                style={{ width:"100%", background:"#111", border:"1px solid rgba(34,197,94,0.18)", borderRadius:10, padding:"9px 13px", color:"#ccc", fontSize:12, outline:"none", fontFamily:"inherit", boxSizing:"border-box" as const, marginTop:6 }}/>
            )}
          </div>

          <div style={{ display:"flex", gap:7, marginBottom:14 }}>
            <button onClick={save} disabled={needNote||saving}
              style={{ flex:1, background:saved?"#14532d":needNote?"#141414":"#EF4444", border:"none", borderRadius:12, padding:"14px", color:needNote?"#2a2a2a":"#fff", fontWeight:800, fontSize:14, fontFamily:"inherit" }}>
              {saved ? "✓ Saved" : saving ? "Saving…" : "Save Changes"}
            </button>
            <button onClick={onClose} style={{ background:"#111", border:"1px solid #1a1a1a", borderRadius:12, padding:"14px 16px", color:"#444", fontSize:13, fontFamily:"inherit" }}>Cancel</button>
          </div>

          {/* PDF export */}
          <button onClick={() => exportPDF(r, h)} style={{ width:"100%", background:"#0C0C0C", border:"1px solid #141414", borderRadius:12, padding:"11px", color:"#555", fontWeight:700, fontSize:12, fontFamily:"inherit", marginBottom:14 }}>
            🖨️ Export as PDF
          </button>

          {/* Activity log */}
          {activities.length > 0 && (
            <div>
              <div style={{ fontSize:9, fontWeight:800, letterSpacing:2, color:"#2a2a2a", marginBottom:8 }}>ACTIVITY LOG</div>
              <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                {activities.map((a:any) => (
                  <div key={a.id} style={{ display:"flex", gap:8, alignItems:"flex-start" }}>
                    <div style={{ width:6, height:6, borderRadius:"50%", background:"#1e1e1e", flexShrink:0, marginTop:4 }}/>
                    <div style={{ flex:1 }}>
                      <div style={{ color:"#333", fontSize:11 }}>
                        {a.action === "STATUS_CHANGED" ? a.detail : a.action}
                        {a.admin && <span style={{ color:"#1a1a1a" }}> · {a.admin.name}</span>}
                      </div>
                      <div style={{ color:"#1a1a1a", fontSize:10 }}>
                        {new Date(a.createdAt).toLocaleString("en-GB", { day:"numeric", month:"short", hour:"2-digit", minute:"2-digit" })}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── EXPORT HELPERS ───────────────────────────────────────────────────────────
function esc(v: any) { const s=String(v??""); return s.includes(",")||s.includes('"')||s.includes("\n")?`"${s.replace(/"/g,'""')}"`:`${s}`; }
function dlCSV(rows: any[]) {
  const hdrs = ["ID","Date","Address","Landmark","Latitude","Longitude","Hazard","Severity","Status","Confidence","Upvotes","Reporter","Description","Resolution Note","Fixed By","Resolved Date","Photo URL"];
  const lines = [hdrs.join(","), ...rows.map(r => [r.id, new Date(r.createdAt).toLocaleDateString("en-GB"), r.address, r.landmark||"", r.latitude, r.longitude, hMeta(r.hazardType).label, SEV[r.severity]?.label||r.severity, ST[r.status]?.label||r.status, r.confidence||"", r.upvoteCount||0, r.reporter||"Anonymous", r.description||"", r.resolutionNote||"", r.fixedBy||"", r.resolvedAt?new Date(r.resolvedAt).toLocaleDateString("en-GB"):"", r.photoUrl||""].map(esc).join(","))];
  const blob = new Blob([lines.join("\n")], { type:"text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a"); a.href=url; a.download=`roadwatch-${new Date().toISOString().slice(0,10)}.csv`; a.click(); URL.revokeObjectURL(url);
}

const ANNOUNCE_TYPES: Record<string, { label: string; color: string; bg: string; border: string; icon: string }> = {
  INFO:         { label:"Info",         color:"#60A5FA", bg:"rgba(96,165,250,0.08)",  border:"rgba(96,165,250,0.2)",  icon:"ℹ️" },
  WARNING:      { label:"Warning",      color:"#F59E0B", bg:"rgba(245,158,11,0.08)", border:"rgba(245,158,11,0.22)", icon:"⚠️" },
  ROAD_CLOSURE: { label:"Road Closure", color:"#EF4444", bg:"rgba(239,68,68,0.08)",  border:"rgba(239,68,68,0.2)",   icon:"🚫" },
  MAINTENANCE:  { label:"Maintenance",  color:"#A78BFA", bg:"rgba(167,139,250,0.08)",border:"rgba(167,139,250,0.2)", icon:"🔧" },
  EMERGENCY:    { label:"Emergency",    color:"#EF4444", bg:"rgba(239,68,68,0.1)",   border:"rgba(239,68,68,0.3)",   icon:"🚨" },
};

const GH_REGIONS = ["Greater Accra","Ashanti","Western","Central","Eastern","Northern","Upper East","Upper West","Volta","Oti","Bono","Bono East","Ahafo","Savannah","North East","Western North"];

// ─── ADMIN DASHBOARD ──────────────────────────────────────────────────────────
export default function DashboardPage() {
  const [reports,       setReports]       = useState<any[]>([]);
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [tab,           setTab]           = useState("feed");
  const [filter,        setFilter]        = useState("ALL");
  const [search,        setSearch]        = useState("");
  const [selected,      setSelected]      = useState<any>(null);
  const [aForm,         setAForm]         = useState({ title:"", body:"", type:"INFO", region:"", expiresAt:"" });
  const [aPosting,      setAPosting]      = useState(false);
  const router                            = useRouter();

  useEffect(() => {
    fetch("/api/reports")
      .then(r => r.json())
      .then(j => { if (j.success) setReports(j.data); })
      .finally(() => setLoading(false));
    fetch("/api/announcements")
      .then(r => r.json())
      .then(j => { if (j.success) setAnnouncements(j.data); });
  }, []);

  const logout = async () => { await fetch("/api/auth", { method:"DELETE" }); router.push("/admin/login"); };

  const onUpdate = (updated: any) => setReports(p => p.map(r => r.id === updated.id ? { ...updated, upvoteCount: r.upvoteCount } : r));

  const postAnnouncement = async () => {
    if (!aForm.title.trim() || !aForm.body.trim()) return;
    setAPosting(true);
    try {
      const res  = await fetch("/api/announcements", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(aForm) });
      const json = await res.json();
      if (json.success) { setAnnouncements(p => [json.data, ...p]); setAForm({ title:"", body:"", type:"INFO", region:"", expiresAt:"" }); }
    } finally { setAPosting(false); }
  };

  const deleteAnnouncement = async (id: string) => {
    await fetch(`/api/announcements/${id}`, { method:"DELETE" });
    setAnnouncements(p => p.filter(a => a.id !== id));
  };

  const pending    = reports.filter(r => r.status==="PENDING").length;
  const unverified = reports.filter(r => r.status==="PENDING" && !r.photoUrl).length;
  const critical   = reports.filter(r => r.severity==="CRITICAL" && r.status!=="RESOLVED").length;
  const resolved   = reports.filter(r => r.status==="RESOLVED").length;

  const FILTERS = [
    { k:"ALL",        l:`All · ${reports.length}` },
    { k:"PENDING",    l:`⏳ · ${pending}` },
    { k:"UNVERIFIED", l:`🔘 · ${unverified}` },
    { k:"CRITICAL",   l:`🔴 · ${critical}` },
    { k:"PHOTO",      l:"📷" },
    { k:"RESOLVED",   l:`✅ · ${resolved}` },
    { k:"POTHOLE",    l:"🕳️" },
    { k:"FLOOD",      l:"🌊" },
  ];

  const filtered = reports
    .filter(r => {
      if (filter==="ALL")        return true;
      if (filter==="PENDING")    return r.status==="PENDING";
      if (filter==="UNVERIFIED") return r.status==="PENDING" && !r.photoUrl;
      if (filter==="CRITICAL")   return r.severity==="CRITICAL" && r.status!=="RESOLVED";
      if (filter==="PHOTO")      return !!r.photoUrl;
      if (filter==="RESOLVED")   return r.status==="RESOLVED";
      return r.hazardType === filter;
    })
    .filter(r => !search || (r.address+r.landmark+r.hazardType).toLowerCase().includes(search.toLowerCase()))
    .sort((a,b) => SO[a.severity]-SO[b.severity]);

  const topAlert = critical > 0
    ? { msg:`${critical} critical · need immediate attention`, c:"#EF4444", bg:"rgba(239,68,68,0.05)", b:"rgba(239,68,68,0.1)" }
    : unverified > 0
    ? { msg:`${unverified} without photo · needs admin review`, c:"#64748B", bg:"rgba(100,116,139,0.05)", b:"rgba(100,116,139,0.1)" }
    : null;

  return (
    <div style={{ background:"#0A0A0A", minHeight:"100vh", fontFamily:"'Inter',-apple-system,sans-serif", color:"#fff", paddingBottom:72 }}>
      <style>{`
        @keyframes slideUp { from{transform:translateY(100%)} to{transform:translateY(0)} }
        @keyframes pulse   { 0%,100%{opacity:1} 50%{opacity:.3} }
        *{box-sizing:border-box;margin:0;padding:0} button{cursor:pointer;-webkit-tap-highlight-color:transparent}
        input::placeholder,textarea::placeholder{color:#1e1e1e} ::-webkit-scrollbar{display:none}
      `}</style>

      {/* Header */}
      <div style={{ background:"#080808", borderBottom:"1px solid #0F0F0F", padding:"13px 18px", display:"flex", alignItems:"center", justifyContent:"space-between", position:"sticky" as const, top:0, zIndex:50 }}>
        <div style={{ color:"#fff", fontWeight:900, fontSize:16, letterSpacing:-.3 }}>Admin</div>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <button onClick={() => dlCSV(filtered)} style={{ background:"#111", border:"1px solid #1a1a1a", borderRadius:10, padding:"6px 12px", color:"#666", fontSize:12, fontWeight:700, fontFamily:"inherit" }}>⬇️ Export</button>
          <div style={{ background:"rgba(34,197,94,0.06)", border:"1px solid rgba(34,197,94,0.15)", borderRadius:20, padding:"5px 10px", display:"flex", alignItems:"center", gap:4 }}>
            <span style={{ width:5, height:5, borderRadius:"50%", background:"#22C55E", display:"inline-block", animation:"pulse 2s infinite" }}/>
            <span style={{ color:"#22C55E", fontSize:9, fontWeight:900, letterSpacing:1.5 }}>LIVE</span>
          </div>
          <button onClick={logout} style={{ background:"none", border:"none", color:"#333", fontSize:12, fontFamily:"inherit" }}>Sign out</button>
        </div>
      </div>

      {topAlert && (
        <div style={{ background:topAlert.bg, borderBottom:`1px solid ${topAlert.b}`, padding:"9px 18px" }}>
          <span style={{ color:topAlert.c, fontSize:12, fontWeight:700 }}>{topAlert.msg}</span>
        </div>
      )}

      {/* Stats */}
      <div style={{ padding:"14px 18px 0", display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:7 }}>
        {[{v:reports.length,l:"Reports",c:"#555"},{v:pending,l:"Pending",c:"#F59E0B"},{v:critical,l:"Critical",c:"#EF4444"},{v:resolved,l:"Resolved",c:"#22C55E"}].map(s => (
          <div key={s.l} style={{ background:"#0C0C0C", border:"1px solid #111", borderRadius:12, padding:"11px 10px", textAlign:"center" as const }}>
            <div style={{ color:s.c, fontSize:10, fontWeight:800, letterSpacing:.5, marginBottom:3 }}>{s.l.toUpperCase()}</div>
            <div style={{ color:"#fff", fontSize:22, fontWeight:900, lineHeight:1 }}>{s.v}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ padding:"12px 18px 0" }}>
        <div style={{ display:"flex", gap:3, background:"#0C0C0C", borderRadius:12, padding:3, border:"1px solid #111", marginBottom:12 }}>
          {[["feed","📋 Feed"],["map","🗺️ Map"],["announce","📢"],["analytics","📊"]].map(([key,label]) => (
            <button key={key} onClick={() => setTab(key)} style={{ flex:key==="analytics"||key==="announce"?0:1, background:tab===key?"#EF4444":"transparent", border:"none", borderRadius:9, padding:"10px", color:tab===key?"#fff":"#2a2a2a", fontWeight:800, fontSize:13, fontFamily:"inherit", whiteSpace:"nowrap" as const, position:"relative" as const }}>
              {label}
              {key==="announce" && announcements.length > 0 && <span style={{ position:"absolute" as const, top:6, right:6, width:6, height:6, borderRadius:"50%", background:"#EF4444", display:"block" }}/>}
            </button>
          ))}
        </div>

        {loading && <div style={{ textAlign:"center", padding:"40px 0", color:"#2a2a2a", fontSize:14 }}>Loading reports…</div>}

        {/* Map tab */}
        {!loading && tab === "map" && (
          <>
            <div style={{ borderRadius:16, overflow:"hidden", marginBottom:12, border:"1px solid #111", height:320 }}>
              <AdminMapGL reports={reports} selectedId={selected?.id} onSelect={r => setSelected(r)}/>
            </div>
            {reports.filter(r => r.status!=="RESOLVED"&&r.status!=="DISMISSED").sort((a,b) => SO[a.severity]-SO[b.severity]).map(r => (
              <ReportCard key={r.id} r={r} selected={selected?.id===r.id} onClick={() => setSelected(selected?.id===r.id?null:r)}/>
            ))}
          </>
        )}

        {/* Feed tab */}
        {!loading && tab === "feed" && (
          <>
            <div style={{ background:"#0C0C0C", border:"1px solid #111", borderRadius:11, padding:"10px 13px", marginBottom:8, display:"flex", alignItems:"center", gap:7 }}>
              <span style={{ color:"#1a1a1a", fontSize:14 }}>🔍</span>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…" style={{ flex:1, background:"transparent", border:"none", outline:"none", color:"#fff", fontSize:14, fontFamily:"inherit" }}/>
              {search && <button onClick={() => setSearch("")} style={{ background:"none", border:"none", color:"#2a2a2a", fontSize:18 }}>×</button>}
            </div>
            <div style={{ display:"flex", gap:5, overflowX:"auto", paddingBottom:6, marginBottom:10 }}>
              {FILTERS.map(f => (
                <button key={f.k} onClick={() => setFilter(f.k)} style={{ background:filter===f.k?"#EF4444":"#0C0C0C", border:`1px solid ${filter===f.k?"#EF4444":"#111"}`, borderRadius:20, padding:"6px 12px", color:filter===f.k?"#fff":"#2a2a2a", fontSize:11, fontWeight:700, whiteSpace:"nowrap" as const, fontFamily:"inherit", flexShrink:0 }}>{f.l}</button>
              ))}
            </div>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
              <span style={{ color:"#111", fontSize:9, fontWeight:700, letterSpacing:.5 }}>{filtered.length} REPORTS</span>
              <button onClick={() => dlCSV(filtered)} style={{ background:"none", border:"none", color:"#2a2a2a", fontSize:11, fontWeight:700, fontFamily:"inherit" }}>⬇️ Export {filtered.length}</button>
            </div>
            {filtered.length === 0
              ? <div style={{ textAlign:"center", padding:"40px 0", color:"#141414", fontSize:14 }}>Nothing here</div>
              : filtered.map(r => <ReportCard key={r.id} r={r} selected={selected?.id===r.id} onClick={() => setSelected(selected?.id===r.id?null:r)}/>)
            }
          </>
        )}
      </div>

        {/* Analytics tab */}
        {!loading && tab === "analytics" && (() => {
          const now    = Date.now();
          const weekMs = 7 * 86400000;
          const thisW  = reports.filter(r => now - new Date(r.createdAt).getTime() < weekMs).length;
          const lastW  = reports.filter(r => { const a = now - new Date(r.createdAt).getTime(); return a >= weekMs && a < 2*weekMs; }).length;

          const byArea  = Object.entries(
            reports.filter(r=>r.areaId).reduce((acc:any,r)=>{ acc[r.areaId]=(acc[r.areaId]||{id:r.areaId,count:0}); acc[r.areaId].count++; return acc; },{})
          ).sort((a:any,b:any)=>b[1].count-a[1].count).slice(0,3) as [string,{count:number}][];

          const AREA_NAMES: Record<string,string> = { spintex:"Spintex Rd", adenta:"Adenta · Madina", "accra-central":"Accra Central", tema:"Tema Motorway", "kumasi-road":"Kumasi Rd", haatso:"Haatso · Atomic", liberation:"Liberation Rd", "ring-road":"Ring Road" };

          const byHazard = H.map(h => ({
            ...h, count: reports.filter(r=>r.hazardType===h.key && r.status!=="DISMISSED").length
          })).sort((a,b)=>b.count-a.count);
          const maxH = Math.max(...byHazard.map(x=>x.count), 1);

          const resolved   = reports.filter(r=>r.status==="RESOLVED");
          const resRate    = reports.length ? Math.round((resolved.length/reports.length)*100) : 0;
          const avgHrs     = resolved.length
            ? Math.round(resolved.filter(r=>r.resolvedAt).reduce((s,r)=>{
                return s + (new Date(r.resolvedAt).getTime()-new Date(r.createdAt).getTime())/3600000;
              },0) / resolved.filter(r=>r.resolvedAt).length * 10) / 10
            : null;

          return (
            <div style={{ animation:"fadeUp .18s ease" }}>
              {/* Weekly trend */}
              <div style={{ background:"#0C0C0C", border:"1px solid #111", borderRadius:13, padding:"14px", marginBottom:8 }}>
                <div style={{ fontSize:9, fontWeight:800, letterSpacing:2, color:"#2a2a2a", marginBottom:10 }}>THIS WEEK VS LAST WEEK</div>
                <div style={{ display:"flex", gap:10, alignItems:"flex-end", height:60, marginBottom:6 }}>
                  {[{l:"Last",v:lastW,c:"#1e1e1e"},{l:"This",v:thisW,c:"#EF4444"}].map(b => (
                    <div key={b.l} style={{ flex:1, display:"flex", flexDirection:"column" as const, alignItems:"center", gap:4 }}>
                      <span style={{ color:b.c==="#EF4444"?"#EF4444":"#333", fontSize:14, fontWeight:800 }}>{b.v}</span>
                      <div style={{ width:"100%", background:b.c, borderRadius:"4px 4px 0 0", height:`${Math.max(4, (b.v/Math.max(thisW,lastW,1))*44)}px` }}/>
                      <span style={{ color:"#333", fontSize:9, fontWeight:700 }}>{b.l.toUpperCase()}</span>
                    </div>
                  ))}
                  <div style={{ flex:3 }}/>
                </div>
                {thisW > lastW
                  ? <div style={{ color:"#EF4444", fontSize:11 }}>↑ {thisW-lastW} more than last week</div>
                  : thisW < lastW
                  ? <div style={{ color:"#22C55E", fontSize:11 }}>↓ {lastW-thisW} fewer than last week</div>
                  : <div style={{ color:"#555", fontSize:11 }}>Same as last week</div>
                }
              </div>

              {/* Resolution stats */}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:7, marginBottom:8 }}>
                <div style={{ background:"#0C0C0C", border:"1px solid #111", borderRadius:13, padding:"14px", textAlign:"center" as const }}>
                  <div style={{ fontSize:9, fontWeight:800, letterSpacing:1.5, color:"#2a2a2a", marginBottom:4 }}>RESOLUTION RATE</div>
                  <div style={{ color:resRate>60?"#22C55E":resRate>30?"#F59E0B":"#EF4444", fontSize:28, fontWeight:900, lineHeight:1 }}>{resRate}%</div>
                </div>
                <div style={{ background:"#0C0C0C", border:"1px solid #111", borderRadius:13, padding:"14px", textAlign:"center" as const }}>
                  <div style={{ fontSize:9, fontWeight:800, letterSpacing:1.5, color:"#2a2a2a", marginBottom:4 }}>AVG RESOLVE TIME</div>
                  <div style={{ color:"#60A5FA", fontSize:22, fontWeight:900, lineHeight:1 }}>{avgHrs != null ? `${avgHrs}h` : "—"}</div>
                </div>
              </div>

              {/* Top areas */}
              {byArea.length > 0 && (
                <div style={{ background:"#0C0C0C", border:"1px solid #111", borderRadius:13, padding:"14px", marginBottom:8 }}>
                  <div style={{ fontSize:9, fontWeight:800, letterSpacing:2, color:"#2a2a2a", marginBottom:10 }}>TOP AREAS</div>
                  {byArea.map(([id,{count}]:any,i)=>(
                    <div key={id} style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
                      <span style={{ color:"#1e1e1e", fontSize:11, width:14, textAlign:"right" as const }}>{i+1}</span>
                      <div style={{ flex:1 }}>
                        <div style={{ color:"#555", fontSize:12, marginBottom:2 }}>{AREA_NAMES[id]||id}</div>
                        <div style={{ height:4, background:"#111", borderRadius:2 }}>
                          <div style={{ height:4, background:"#EF4444", borderRadius:2, width:`${(count/byArea[0][1].count)*100}%` }}/>
                        </div>
                      </div>
                      <span style={{ color:"#333", fontSize:12, fontWeight:700 }}>{count}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Hazard breakdown */}
              <div style={{ background:"#0C0C0C", border:"1px solid #111", borderRadius:13, padding:"14px" }}>
                <div style={{ fontSize:9, fontWeight:800, letterSpacing:2, color:"#2a2a2a", marginBottom:10 }}>HAZARD TYPES</div>
                {byHazard.filter(x=>x.count>0).map(x=>(
                  <div key={x.key} style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
                    <span style={{ fontSize:13, width:20 }}>{x.e}</span>
                    <div style={{ flex:1 }}>
                      <div style={{ height:5, background:"#111", borderRadius:2 }}>
                        <div style={{ height:5, background:"#EF4444", borderRadius:2, opacity:.7, width:`${(x.count/maxH)*100}%` }}/>
                      </div>
                    </div>
                    <span style={{ color:"#333", fontSize:11, width:18, textAlign:"right" as const }}>{x.count}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

      {/* Bottom nav */}
      <div style={{ position:"fixed" as const, bottom:0, left:0, right:0, background:"rgba(5,5,5,0.97)", borderTop:"1px solid #0F0F0F", padding:"9px 0 20px", display:"flex", justifyContent:"space-around", backdropFilter:"blur(20px)", zIndex:99 }}>
        {[["feed","📋","Feed"],["map","🗺️","Map"],["analytics","📊","Stats"]].map(([key,icon,label]) => (
          <button key={key} onClick={() => setTab(key)} style={{ background:"none", border:"none", display:"flex", flexDirection:"column" as const, alignItems:"center", gap:2, fontFamily:"inherit", minWidth:60 }}>
            <span style={{ fontSize:21 }}>{icon}</span>
            <span style={{ fontSize:8, fontWeight:900, letterSpacing:.8, color:tab===key?"#EF4444":"#1e1e1e" }}>{label.toUpperCase()}</span>
          </button>
        ))}
      </div>

        {/* Announce tab */}
        {tab === "announce" && (
          <div style={{ animation:"fadeUp .18s ease" }}>
            {/* Create form */}
            <div style={{ background:"#0C0C0C", border:"1px solid #111", borderRadius:14, padding:"16px", marginBottom:12 }}>
              <div style={{ fontSize:9, fontWeight:800, letterSpacing:2, color:"#2a2a2a", marginBottom:12 }}>NEW ANNOUNCEMENT</div>

              {/* Type selector */}
              <div style={{ display:"flex", gap:5, flexWrap:"wrap" as const, marginBottom:10 }}>
                {Object.entries(ANNOUNCE_TYPES).map(([k,v]) => (
                  <button key={k} onClick={() => setAForm(f => ({ ...f, type:k }))}
                    style={{ background:aForm.type===k?v.bg:"#0A0A0A", border:`1px solid ${aForm.type===k?v.border:"#141414"}`, borderRadius:20, padding:"5px 11px", color:aForm.type===k?v.color:"#333", fontSize:10, fontWeight:700, fontFamily:"inherit" }}>
                    {v.icon} {v.label}
                  </button>
                ))}
              </div>

              <input value={aForm.title} onChange={e => setAForm(f => ({ ...f, title:e.target.value }))} placeholder="Title"
                style={{ width:"100%", background:"#0A0A0A", border:"1px solid #141414", borderRadius:10, padding:"11px 13px", color:"#fff", fontSize:14, fontFamily:"inherit", marginBottom:8 }}/>

              <textarea value={aForm.body} onChange={e => setAForm(f => ({ ...f, body:e.target.value }))} placeholder="Message to citizens…" rows={3}
                style={{ width:"100%", background:"#0A0A0A", border:"1px solid #141414", borderRadius:10, padding:"11px 13px", color:"#fff", fontSize:13, fontFamily:"inherit", resize:"vertical" as const, marginBottom:8 }}/>

              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:12 }}>
                <div>
                  <div style={{ fontSize:9, fontWeight:800, letterSpacing:1.5, color:"#2a2a2a", marginBottom:5 }}>REGION (optional)</div>
                  <select value={aForm.region} onChange={e => setAForm(f => ({ ...f, region:e.target.value }))}
                    style={{ width:"100%", background:"#0A0A0A", border:"1px solid #141414", borderRadius:10, padding:"10px 12px", color:aForm.region?"#fff":"#333", fontSize:13, fontFamily:"inherit" }}>
                    <option value="">National</option>
                    {GH_REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                <div>
                  <div style={{ fontSize:9, fontWeight:800, letterSpacing:1.5, color:"#2a2a2a", marginBottom:5 }}>EXPIRES (optional)</div>
                  <input type="datetime-local" value={aForm.expiresAt} onChange={e => setAForm(f => ({ ...f, expiresAt:e.target.value }))}
                    style={{ width:"100%", background:"#0A0A0A", border:"1px solid #141414", borderRadius:10, padding:"10px 12px", color:aForm.expiresAt?"#fff":"#333", fontSize:13, fontFamily:"inherit" }}/>
                </div>
              </div>

              <button onClick={postAnnouncement} disabled={aPosting || !aForm.title.trim() || !aForm.body.trim()}
                style={{ width:"100%", background:!aForm.title.trim()||!aForm.body.trim()?"#0A0A0A":"#EF4444", border:"none", borderRadius:11, padding:"13px", color:!aForm.title.trim()||!aForm.body.trim()?"#1e1e1e":"#fff", fontWeight:800, fontSize:14, fontFamily:"inherit" }}>
                {aPosting ? "Posting…" : "📢 Post Announcement"}
              </button>
            </div>

            {/* Active announcements */}
            {announcements.length === 0
              ? <div style={{ textAlign:"center", padding:"32px 0", color:"#1a1a1a", fontSize:13 }}>No active announcements</div>
              : announcements.map(a => {
                  const at = ANNOUNCE_TYPES[a.type] || ANNOUNCE_TYPES.INFO;
                  return (
                    <div key={a.id} style={{ background:"#0C0C0C", border:`1px solid ${at.border}`, borderLeft:`3px solid ${at.color}`, borderRadius:14, padding:"13px 14px", marginBottom:8 }}>
                      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:8 }}>
                        <div style={{ flex:1 }}>
                          <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:4 }}>
                            <span style={{ fontSize:13 }}>{at.icon}</span>
                            <span style={{ color:at.color, fontSize:9, fontWeight:800, letterSpacing:1 }}>{at.label.toUpperCase()}</span>
                            <span style={{ color:"#1e1e1e", fontSize:9 }}>·</span>
                            <span style={{ color:"#333", fontSize:9 }}>{a.region || "National"}</span>
                          </div>
                          <div style={{ color:"#fff", fontWeight:700, fontSize:14, marginBottom:4 }}>{a.title}</div>
                          <div style={{ color:"#444", fontSize:12, lineHeight:1.5 }}>{a.body}</div>
                          <div style={{ color:"#1a1a1a", fontSize:10, marginTop:6 }}>
                            {a.admin?.name} · {ago(a.createdAt)} ago
                            {a.expiresAt && ` · expires ${new Date(a.expiresAt).toLocaleDateString("en-GB")}`}
                          </div>
                        </div>
                        <button onClick={() => deleteAnnouncement(a.id)}
                          style={{ background:"none", border:"none", color:"#1a1a1a", fontSize:18, lineHeight:1, padding:"0 2px", flexShrink:0 }}>×</button>
                      </div>
                    </div>
                  );
                })
            }
          </div>
        )}

      {selected && <DetailPanel r={selected} onClose={() => setSelected(null)} onUpdate={onUpdate}/>}
    </div>
  );
}

// ─── REPORT CARD ──────────────────────────────────────────────────────────────
function ReportCard({ r, selected, onClick }: { r:any; selected:boolean; onClick:()=>void }) {
  const h    = hMeta(r.hazardType);
  const conf = r.confidence || "MEDIUM";
  const cm   = CONFIDENCE[conf];
  return (
    <div onClick={onClick} style={{ background:selected?"#111":"#0C0C0C", border:`1px solid ${selected?"#1e1e1e":"#111"}`, borderLeft:`3px solid ${selected?SC[r.severity]:"transparent"}`, borderRadius:13, padding:"11px 13px", marginBottom:6, display:"flex", gap:10, alignItems:"flex-start" }}>
      <div style={{ width:46, height:46, borderRadius:9, overflow:"hidden", flexShrink:0, background:"#141414", display:"flex", alignItems:"center", justifyContent:"center" }}>
        {r.photoUrl ? <img src={r.photoUrl} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }}/> : <span style={{ fontSize:20 }}>{h.e}</span>}
      </div>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:2 }}>
          <span style={{ color:"#fff", fontWeight:700, fontSize:13 }}>{h.label}</span>
          <span style={{ color:SEV[r.severity]?.c, fontSize:10, fontWeight:700, background:SEV[r.severity]?.bg, border:`1px solid ${SEV[r.severity]?.b}`, borderRadius:20, padding:"2px 7px" }}>{SEV[r.severity]?.label}</span>
        </div>
        <div style={{ color:"#333", fontSize:11, marginBottom:2, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" as const }}>📍 {r.address}{r.landmark?`, ${r.landmark}`:""}</div>
        <div style={{ color:"#1a1a1a", fontSize:9, fontFamily:"monospace", marginBottom:3 }}>{r.latitude?.toFixed(4)}, {r.longitude?.toFixed(4)}</div>
        <div style={{ display:"flex", alignItems:"center", gap:5 }}>
          <span style={{ color:ST[r.status]?.c, fontSize:10, fontWeight:700, background:ST[r.status]?.bg, border:`1px solid ${ST[r.status]?.b}`, borderRadius:20, padding:"2px 7px" }}>{ST[r.status]?.label}</span>
          <span style={{ color:cm?.color, fontSize:9, fontWeight:700, background:cm?.bg, border:`1px solid ${cm?.border}`, borderRadius:20, padding:"1px 6px" }}>{cm?.label}</span>
          {r.photoUrl && <span style={{ color:"#2a2a2a", fontSize:10 }}>📷</span>}
          {r.transcript && <span style={{ color:"#2a2a2a", fontSize:10 }}>🎙️</span>}
          <span style={{ color:"#1a1a1a", fontSize:10, marginLeft:"auto" }}>{ago(r.createdAt)}</span>
        </div>
      </div>
    </div>
  );
}
