"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

const SC: Record<string, string> = {
  CRITICAL: "#EF4444",
  HIGH:     "#F97316",
  MEDIUM:   "#F59E0B",
  LOW:      "#22C55E",
};

const EMOJI: Record<string, string> = {
  POTHOLE: "🕳️", FLOOD: "🌊", ACCIDENT: "🚗", DEBRIS: "🪨",
  BROKEN_LIGHT: "🚦", ROAD_BLOCK: "🚧", OTHER: "⚠️",
};

const SEV_LABEL: Record<string, string> = {
  CRITICAL: "Critical", HIGH: "Dangerous", MEDIUM: "Moderate", LOW: "Minor",
};

function timeAgo(iso: string) {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (d < 3600)  return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

interface Props {
  reports:      any[];
  hazardFilter: string;
  onConfirm:    (id: string) => void;
  confirmed:    Record<string, boolean>;
}

export default function PublicMapView({ reports, hazardFilter, onConfirm, confirmed }: Props) {
  const containerRef  = useRef<HTMLDivElement>(null);
  const mapRef        = useRef<maplibregl.Map | null>(null);
  const markersRef    = useRef<maplibregl.Marker[]>([]);
  const [ready,       setReady]       = useState(false);
  const [markerCount, setMarkerCount] = useState(0);
  const [selected,    setSelected]    = useState<any | null>(null);

  // Init map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container:          containerRef.current,
      style:              "https://tiles.openfreemap.org/styles/liberty",
      center:             [-0.187, 5.604], // Accra
      zoom:               11,
      attributionControl: false,
    });

    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.on("load", () => setReady(true));
    map.on("click", () => setSelected(null));

    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // Re-render markers when data or filter changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    // Remove old markers
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];

    const visible = reports.filter(r =>
      r.latitude && r.longitude &&
      r.status !== "RESOLVED" &&
      r.status !== "DISMISSED" &&
      (hazardFilter === "All" || r.hazardType === hazardFilter)
    );

    visible.forEach(r => {
      const color = SC[r.severity] || "#F59E0B";
      const emoji = EMOJI[r.hazardType] || "⚠️";

      const el = document.createElement("div");
      el.style.cssText = [
        `width:36px`, `height:36px`, `border-radius:50% 50% 50% 0`,
        `transform:rotate(-45deg)`, `background:${color}`,
        `border:2px solid rgba(255,255,255,0.3)`,
        `box-shadow:0 2px 10px ${color}55`,
        `display:flex`, `align-items:center`, `justify-content:center`,
        `cursor:pointer`, `transition:transform .15s`,
      ].join(";");

      const inner = document.createElement("span");
      inner.style.cssText = "transform:rotate(45deg);font-size:15px;line-height:1;pointer-events:none";
      inner.textContent = emoji;
      el.appendChild(inner);

      el.addEventListener("click", (e) => {
        e.stopPropagation();
        setSelected(r);
        map.flyTo({ center: [r.longitude, r.latitude], zoom: Math.max(map.getZoom(), 13), duration: 500 });
      });
      el.addEventListener("mouseenter", () => { el.style.transform = "rotate(-45deg) scale(1.2)"; });
      el.addEventListener("mouseleave", () => { el.style.transform = "rotate(-45deg) scale(1)"; });

      const marker = new maplibregl.Marker({ element: el, anchor: "bottom" })
        .setLngLat([r.longitude, r.latitude])
        .addTo(map);

      markersRef.current.push(marker);
    });

    setMarkerCount(markersRef.current.length);

    // Fit bounds if we have multiple pins
    if (visible.length > 1) {
      const bounds = new maplibregl.LngLatBounds();
      visible.forEach(r => bounds.extend([r.longitude, r.latitude]));
      map.fitBounds(bounds, { padding: 60, maxZoom: 14, duration: 600 });
    }
  }, [ready, reports, hazardFilter]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      {/* Map canvas */}
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />

      {/* Maplibre popup style overrides */}
      <style>{`
        .maplibregl-ctrl-top-right { top: 8px !important; right: 8px !important; }
        .maplibregl-ctrl-bottom-left { bottom: 4px !important; left: 4px !important; }
        .maplibregl-ctrl-attrib { font-size: 9px !important; }
        .maplibregl-ctrl button { width: 30px !important; height: 30px !important; }
      `}</style>

      {/* Active pin count badge */}
      {ready && (
        <div style={{
          position:"absolute", top:10, left:10,
          background:"rgba(10,10,10,0.85)", backdropFilter:"blur(8px)",
          border:"1px solid rgba(255,255,255,0.08)", borderRadius:20,
          padding:"5px 12px", display:"flex", alignItems:"center", gap:6,
        }}>
          <span style={{ width:5, height:5, borderRadius:"50%", background:"#22C55E", display:"inline-block", boxShadow:"0 0 6px #22C55E" }}/>
          <span style={{ color:"#ccc", fontSize:11, fontWeight:700 }}>
            {markerCount} active on map
          </span>
        </div>
      )}

      {/* Selected report card */}
      {selected && (
        <div style={{
          position:"absolute", bottom:16, left:12, right:12, zIndex:10,
          background:"rgba(13,13,13,0.97)", backdropFilter:"blur(12px)",
          border:`1px solid ${SC[selected.severity]}33`,
          borderLeft:`3px solid ${SC[selected.severity]}`,
          borderRadius:16, padding:"14px",
          animation:"fadeUp .15s ease",
        }}>
          <style>{`@keyframes fadeUp{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}`}</style>
          <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:8 }}>
            <div style={{ display:"flex", alignItems:"center", gap:10, flex:1 }}>
              <span style={{ fontSize:24 }}>{EMOJI[selected.hazardType] || "⚠️"}</span>
              <div>
                <div style={{ color:"#fff", fontWeight:700, fontSize:15 }}>
                  {selected.hazardType.replace(/_/g," ")}
                </div>
                <div style={{ color: SC[selected.severity], fontSize:12, fontWeight:600, marginTop:1 }}>
                  {SEV_LABEL[selected.severity]}
                </div>
              </div>
            </div>
            <button onClick={() => setSelected(null)}
              style={{ background:"#1a1a1a", border:"1px solid #222", borderRadius:8, width:28, height:28, display:"flex", alignItems:"center", justifyContent:"center", color:"#666", fontSize:16 }}>
              ×
            </button>
          </div>
          <div style={{ color:"#888", fontSize:12, marginTop:8 }}>
            📍 {selected.address}{selected.landmark ? `, ${selected.landmark}` : ""}
          </div>
          <div style={{ color:"#555", fontSize:11, marginTop:3 }}>
            {timeAgo(selected.createdAt)} · {selected.status.replace(/_/g," ")}
          </div>
          <button onClick={() => { onConfirm(selected.id); setSelected({ ...selected, upvoteCount: (selected.upvoteCount||0)+1 }); }}
            disabled={confirmed[selected.id]}
            style={{
              width:"100%", marginTop:10,
              background: confirmed[selected.id] ? "rgba(34,197,94,0.08)" : "#1a1a1a",
              border:`1px solid ${confirmed[selected.id] ? "rgba(34,197,94,0.25)" : "#222"}`,
              borderRadius:10, padding:"10px",
              color: confirmed[selected.id] ? "#22C55E" : "#888",
              fontWeight:700, fontSize:13, fontFamily:"inherit",
              display:"flex", alignItems:"center", justifyContent:"center", gap:6,
            }}>
            {confirmed[selected.id]
              ? "✓ You confirmed this"
              : `👍 I can confirm this · ${selected.upvoteCount || 0}`
            }
          </button>
        </div>
      )}

      {/* No-coordinates hint for demo mode */}
      {ready && markerCount === 0 && (
        <div style={{
          position:"absolute", top:"50%", left:"50%", transform:"translate(-50%,-50%)",
          background:"rgba(10,10,10,0.88)", backdropFilter:"blur(8px)",
          border:"1px solid #1e1e1e", borderRadius:14,
          padding:"20px 24px", textAlign:"center" as const, maxWidth:240,
        }}>
          <div style={{ fontSize:32, marginBottom:8 }}>📍</div>
          <div style={{ color:"#fff", fontWeight:700, fontSize:14, marginBottom:4 }}>No pins yet</div>
          <div style={{ color:"#666", fontSize:12, lineHeight:1.5 }}>
            Report a hazard and it will appear on this map.
          </div>
        </div>
      )}
    </div>
  );
}
