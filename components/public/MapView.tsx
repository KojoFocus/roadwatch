"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

const SC: Record<string, string> = {
  CRITICAL: "#EF4444",
  HIGH:     "#cccccc",
  MEDIUM:   "#888888",
  LOW:      "#555555",
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
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<maplibregl.Map | null>(null);
  const [ready,      setReady]      = useState(false);
  const [pinCount,   setPinCount]   = useState(0);
  const [selected,   setSelected]   = useState<any | null>(null);
  const [webGLOk,    setWebGLOk]    = useState(true);
  const [mapError,   setMapError]   = useState(false);
  const [showLegend, setShowLegend] = useState(false);

  // Init map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    if (!gl) { setWebGLOk(false); return; }

    const map = new maplibregl.Map({
      container:          containerRef.current,
      style:              "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
      center:             [-0.187, 5.604],
      zoom:               11,
      attributionControl: false,
    });

    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.on("load",  () => setReady(true));
    map.on("click", () => setSelected(null));
    map.on("error", (e: any) => {
      if (e?.error?.message?.includes("tiles") || e?.error?.status === 0) setMapError(true);
    });

    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // Update GeoJSON source and layers when data or filter changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const visible = reports.filter(r =>
      r.latitude && r.longitude &&
      r.status !== "RESOLVED" &&
      r.status !== "DISMISSED" &&
      (hazardFilter === "All" || r.hazardType === hazardFilter)
    );
    setPinCount(visible.length);

    const geojson: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: visible.map(r => ({
        type:     "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [r.longitude, r.latitude] },
        properties: {
          id:          r.id,
          hazardType:  r.hazardType,
          severity:    r.severity,
          address:     r.address     || "",
          landmark:    r.landmark    || "",
          status:      r.status      || "PENDING",
          upvoteCount: r.upvoteCount || 0,
          createdAt:   r.createdAt,
        },
      })),
    };

    const src = map.getSource("hazards") as maplibregl.GeoJSONSource | undefined;
    if (src) {
      src.setData(geojson);
    } else {
      // Add clustered source and all layers (runs once)
      map.addSource("hazards", {
        type:          "geojson",
        data:          geojson,
        cluster:       true,
        clusterMaxZoom: 14,
        clusterRadius: 50,
      });

      // Cluster bubble
      map.addLayer({
        id:     "clusters",
        type:   "circle",
        source: "hazards",
        filter: ["has", "point_count"],
        paint:  {
          "circle-color":         "#1a1a1a",
          "circle-radius":        ["step", ["get", "point_count"], 18, 5, 24, 15, 30],
          "circle-stroke-width":  1.5,
          "circle-stroke-color":  "rgba(255,255,255,0.2)",
          "circle-opacity":       0.95,
        },
      });

      // Cluster count text
      map.addLayer({
        id:     "cluster-count",
        type:   "symbol",
        source: "hazards",
        filter: ["has", "point_count"],
        layout: {
          "text-field": "{point_count_abbreviated}",
          "text-size":  12,
        },
        paint: { "text-color": "#aaa" },
      });

      // Individual points — red for critical, grey scale for rest
      map.addLayer({
        id:     "unclustered-point",
        type:   "circle",
        source: "hazards",
        filter: ["!", ["has", "point_count"]],
        paint:  {
          "circle-color": [
            "match", ["get", "severity"],
            "CRITICAL", "#EF4444",
            "HIGH",     "#cccccc",
            "MEDIUM",   "#888888",
            "LOW",      "#555555",
            "#888888",
          ],
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 6, 14, 11],
          "circle-stroke-width": 2,
          "circle-stroke-color": "rgba(0,0,0,0.5)",
          "circle-opacity": 0.95,
        },
      });

      // Click cluster → zoom in to expand
      map.on("click", "clusters", async (e: any) => {
        e.originalEvent.stopPropagation();
        const features = map.queryRenderedFeatures(e.point, { layers: ["clusters"] });
        const clusterId = features[0]?.properties?.cluster_id;
        if (clusterId == null) return;
        const source = map.getSource("hazards") as maplibregl.GeoJSONSource;
        try {
          const zoom = await source.getClusterExpansionZoom(clusterId);
          const coords = (features[0].geometry as any).coordinates;
          map.flyTo({ center: coords, zoom: zoom + 0.5, duration: 400 });
        } catch {}
      });

      // Click individual pin → show card
      map.on("click", "unclustered-point", (e: any) => {
        e.originalEvent.stopPropagation();
        const f = e.features?.[0];
        if (!f) return;
        const p      = f.properties;
        const coords = (f.geometry as any).coordinates;
        setSelected({
          id:          p.id,
          hazardType:  p.hazardType,
          severity:    p.severity,
          address:     p.address,
          landmark:    p.landmark || null,
          status:      p.status,
          upvoteCount: p.upvoteCount,
          createdAt:   p.createdAt,
          longitude:   coords[0],
          latitude:    coords[1],
        });
        map.flyTo({ center: coords, zoom: Math.max(map.getZoom(), 13), duration: 400 });
      });

      map.on("mouseenter", "clusters",          () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "clusters",          () => { map.getCanvas().style.cursor = ""; });
      map.on("mouseenter", "unclustered-point", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "unclustered-point", () => { map.getCanvas().style.cursor = ""; });
    }

    if (visible.length > 1) {
      const bounds = new maplibregl.LngLatBounds();
      visible.forEach(r => bounds.extend([r.longitude, r.latitude]));
      map.fitBounds(bounds, { padding: 60, maxZoom: 14, duration: 600 });
    }
  }, [ready, reports, hazardFilter]);

  // Fallback when WebGL or tiles unavailable
  if (!webGLOk || mapError) {
    const active = reports.filter(r =>
      r.status !== "RESOLVED" && r.status !== "DISMISSED" &&
      (hazardFilter === "All" || r.hazardType === hazardFilter)
    );
    return (
      <div style={{ width:"100%", height:"100%", background:"#080808", overflowY:"auto" as const, padding:"16px" }} role="region" aria-label="Hazard list (map unavailable)">
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:14 }}>
          <span style={{ fontSize:18 }}>📋</span>
          <div>
            <div style={{ color:"#555", fontSize:11, fontWeight:700 }}>MAP UNAVAILABLE</div>
            <div style={{ color:"#333", fontSize:10 }}>{!webGLOk ? "WebGL not supported on this device" : "Tiles failed to load — check connection"}</div>
          </div>
        </div>
        <div style={{ fontSize:9, fontWeight:900, letterSpacing:2, color:"#444", marginBottom:10 }}>ACTIVE HAZARDS · {active.length}</div>
        {active.length === 0
          ? <div style={{ color:"#333", fontSize:13, textAlign:"center" as const, paddingTop:40 }}>No active hazards</div>
          : active.map(r => {
              const color = SC[r.severity] || "#F59E0B";
              return (
                <div key={r.id} style={{ background:"#0D0D0D", border:`1px solid ${color}22`, borderLeft:`3px solid ${color}`, borderRadius:12, padding:"11px 13px", marginBottom:8, display:"flex", alignItems:"center", gap:10 }}>
                  <span style={{ fontSize:20 }} aria-hidden="true">{EMOJI[r.hazardType]||"⚠️"}</span>
                  <div style={{ flex:1 }}>
                    <div style={{ color:"#fff", fontSize:13, fontWeight:600 }}>{r.hazardType.replace(/_/g," ")}</div>
                    <div style={{ color:"#666", fontSize:11, marginTop:2 }}>📍 {r.address}</div>
                  </div>
                  <span style={{ color:color, fontSize:9, fontWeight:900, letterSpacing:.5 }}>{SEV_LABEL[r.severity]||r.severity}</span>
                </div>
              );
            })
        }
      </div>
    );
  }

  return (
    <div style={{ position:"relative", width:"100%", height:"100%" }}>
      <div ref={containerRef} style={{ width:"100%", height:"100%" }} aria-label="Interactive hazard map of Greater Accra" role="application"/>

      <style>{`
        .maplibregl-ctrl-top-right  { top: 8px !important; right: 8px !important; }
        .maplibregl-ctrl-bottom-left { bottom: 4px !important; left: 4px !important; }
        .maplibregl-ctrl-attrib { font-size: 9px !important; }
        .maplibregl-ctrl button { width: 30px !important; height: 30px !important; }
        @keyframes fadeUp { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
      `}</style>

      {/* Pin count badge */}
      {ready && (
        <div style={{ position:"absolute", top:10, left:10, background:"rgba(10,10,10,0.85)", backdropFilter:"blur(8px)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:20, padding:"5px 12px", display:"flex", alignItems:"center", gap:6 }}>
          <span style={{ width:4, height:4, borderRadius:"50%", background:"#444", display:"inline-block" }}/>
          <span style={{ color:"#ccc", fontSize:11, fontWeight:700 }}>{pinCount} active</span>
        </div>
      )}

      {/* Legend toggle */}
      {ready && (
        <button onClick={() => setShowLegend(l => !l)} aria-label="Toggle map legend" aria-expanded={showLegend}
          style={{ position:"absolute", top:10, left:120, zIndex:20, background:"rgba(10,10,10,0.85)", backdropFilter:"blur(8px)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:20, padding:"5px 12px", color:showLegend?"#fff":"#888", fontSize:11, fontWeight:700, fontFamily:"inherit" }}>
          ◈ Legend
        </button>
      )}

      {/* Legend panel */}
      {showLegend && (
        <div style={{ position:"absolute", top:44, left:120, zIndex:20, background:"rgba(10,10,10,0.97)", backdropFilter:"blur(12px)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:12, padding:"12px 14px", minWidth:154, animation:"fadeUp .15s ease" }}>
          <div style={{ fontSize:9, fontWeight:900, letterSpacing:2, color:"#444", marginBottom:10 }}>SEVERITY</div>
          {[
            { label:"Critical",  color:"#EF4444" },
            { label:"Dangerous", color:"#cccccc" },
            { label:"Moderate",  color:"#888888" },
            { label:"Minor",     color:"#555555" },
          ].map(({ label, color }) => (
            <div key={label} style={{ display:"flex", alignItems:"center", gap:8, marginBottom:7 }}>
              <div style={{ width:11, height:11, borderRadius:"50%", background:color, flexShrink:0, boxShadow:`0 0 6px ${color}66` }}/>
              <span style={{ color:"#ccc", fontSize:12 }}>{label}</span>
            </div>
          ))}
          <div style={{ borderTop:"1px solid #1e1e1e", marginTop:6, paddingTop:8, display:"flex", alignItems:"center", gap:8 }}>
            <div style={{ width:22, height:22, borderRadius:"50%", background:"#1a1a1a", border:"1px solid #333", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
              <span style={{ color:"#fff", fontSize:9, fontWeight:900 }}>3</span>
            </div>
            <span style={{ color:"#888", fontSize:11 }}>Cluster — tap to expand</span>
          </div>
        </div>
      )}

      {/* Selected report card */}
      {selected && (
        <div style={{ position:"absolute", bottom:16, left:12, right:12, zIndex:10, background:"rgba(13,13,13,0.97)", backdropFilter:"blur(12px)", border:`1px solid ${SC[selected.severity]}33`, borderLeft:`3px solid ${SC[selected.severity]}`, borderRadius:16, padding:"14px", animation:"fadeUp .15s ease" }}>
          <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:8 }}>
            <div style={{ display:"flex", alignItems:"center", gap:10, flex:1 }}>
              <span style={{ fontSize:24 }}>{EMOJI[selected.hazardType] || "⚠️"}</span>
              <div>
                <div style={{ color:"#fff", fontWeight:700, fontSize:15 }}>
                  {selected.hazardType.replace(/_/g, " ")}
                </div>
                <div style={{ color:SC[selected.severity], fontSize:12, fontWeight:600, marginTop:1 }}>
                  {SEV_LABEL[selected.severity]}
                </div>
              </div>
            </div>
            <button onClick={() => setSelected(null)} aria-label="Close"
              style={{ background:"#1a1a1a", border:"1px solid #222", borderRadius:8, width:28, height:28, display:"flex", alignItems:"center", justifyContent:"center", color:"#666", fontSize:16 }}>
              ×
            </button>
          </div>
          <div style={{ color:"#888", fontSize:12, marginTop:8 }}>
            📍 {selected.address}{selected.landmark ? `, ${selected.landmark}` : ""}
          </div>
          <div style={{ color:"#555", fontSize:11, marginTop:3 }}>
            {timeAgo(selected.createdAt)} · {selected.status.replace(/_/g, " ")}
          </div>
          <button
            onClick={() => { onConfirm(selected.id); setSelected({ ...selected, upvoteCount: (selected.upvoteCount||0)+1 }); }}
            disabled={confirmed[selected.id]}
            style={{ width:"100%", marginTop:10, background:confirmed[selected.id] ? "rgba(34,197,94,0.08)" : "#1a1a1a", border:`1px solid ${confirmed[selected.id] ? "rgba(34,197,94,0.25)" : "#222"}`, borderRadius:10, padding:"10px", color:confirmed[selected.id] ? "#22C55E" : "#888", fontWeight:700, fontSize:13, fontFamily:"inherit", display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>
            {confirmed[selected.id] ? "✓ You confirmed this" : `👍 I can confirm this · ${selected.upvoteCount || 0}`}
          </button>
        </div>
      )}

      {/* Empty state */}
      {ready && pinCount === 0 && (
        <div style={{ position:"absolute", top:"50%", left:"50%", transform:"translate(-50%,-50%)", background:"rgba(10,10,10,0.88)", backdropFilter:"blur(8px)", border:"1px solid #1e1e1e", borderRadius:14, padding:"20px 24px", textAlign:"center" as const, maxWidth:240 }}>
          <div style={{ fontSize:32, marginBottom:8 }}>📍</div>
          <div style={{ color:"#fff", fontWeight:700, fontSize:14, marginBottom:4 }}>No pins yet</div>
          <div style={{ color:"#666", fontSize:12, lineHeight:1.5 }}>Report a hazard and it will appear on this map.</div>
        </div>
      )}
    </div>
  );
}
