"use client";

import { useEffect, useRef } from "react";
import maplibregl             from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

// ─── Pin config by confidence ─────────────────────────────────────────────────
const PIN_CFG: Record<string, { color: string; size: number; opacity: number; pulse: boolean }> = {
  LOW:       { color: "#374151", size: 22, opacity: 0.4,  pulse: false },
  MEDIUM:    { color: "#F59E0B", size: 28, opacity: 1,    pulse: false },
  HIGH:      { color: "#F97316", size: 32, opacity: 1,    pulse: false },
  CONFIRMED: { color: "#EF4444", size: 36, opacity: 1,    pulse: true  },
};

const EMOJI: Record<string, string> = {
  POTHOLE:          "🕳️",
  FLOOD:            "🌊",
  ACCIDENT:         "🚗",
  DEBRIS:           "🪨",
  BROKEN_LIGHT:     "🚦",
  ROAD_BLOCK:       "🚧",
  DANGEROUS_ANIMAL: "🐘",
  OTHER:            "⚠️",
};

function getConf(r: any): string {
  if (r.confidence)                           return r.confidence;
  if (r.status === "VERIFIED" || r.status === "IN_REVIEW") return "HIGH";
  if ((r.upvoteCount || 0) >= 3)              return "CONFIRMED";
  if (r.photoUrl)                             return "MEDIUM";
  return "LOW";
}

function resolvedOpacity(r: any): number {
  if (!r.resolvedAt) return 0.6;
  const hrs = (Date.now() - new Date(r.resolvedAt).getTime()) / 3_600_000;
  return hrs > 24 ? 0.25 : 0.65;
}

// Inject pulse keyframe once
function ensurePulseStyle() {
  if (typeof document === "undefined" || document.getElementById("rw-pin-pulse")) return;
  const s = document.createElement("style");
  s.id = "rw-pin-pulse";
  s.textContent = `
    @keyframes rwPinPulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(239,68,68,0.55), 0 4px 14px rgba(239,68,68,0.6); }
      60%       { box-shadow: 0 0 0 9px rgba(239,68,68,0),  0 4px 14px rgba(239,68,68,0.6); }
    }
    .rw-pin-confirmed { animation: rwPinPulse 1.8s ease-in-out infinite; }
  `;
  document.head.appendChild(s);
}

interface Props {
  reports:    any[];
  selectedId?: string;
  onSelect:   (r: any) => void;
}

export default function AdminMapGL({ reports, selectedId, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<maplibregl.Map | null>(null);
  const markersRef   = useRef<Map<string, { marker: maplibregl.Marker; el: HTMLDivElement }>>(new Map());
  const onSelectRef  = useRef(onSelect);
  const hasFitRef    = useRef(false);

  // Keep callback ref fresh without triggering re-renders
  useEffect(() => { onSelectRef.current = onSelect; });

  // Init map once
  useEffect(() => {
    if (!containerRef.current) return;
    ensurePulseStyle();

    const map = new maplibregl.Map({
      container:        containerRef.current,
      style:            "https://tiles.openfreemap.org/styles/liberty",
      center:           [-0.187, 5.6037],
      zoom:             11,
      attributionControl: false,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    mapRef.current = map;

    return () => {
      markersRef.current.forEach(v => v.marker.remove());
      markersRef.current.clear();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Sync markers whenever reports or selection changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const sync = () => {
      const live = new Set(reports.map(r => r.id));

      // Remove stale
      markersRef.current.forEach((v, id) => {
        if (!live.has(id)) { v.marker.remove(); markersRef.current.delete(id); }
      });

      reports.forEach(r => {
        const conf    = getConf(r);
        const isRes   = r.status === "RESOLVED";
        const cfg     = PIN_CFG[conf] ?? PIN_CFG.MEDIUM;
        const color   = isRes ? "#22C55E" : cfg.color;
        const isSel   = r.id === selectedId;
        const size    = isSel ? cfg.size + 8 : cfg.size;
        const opacity = isRes ? resolvedOpacity(r) : cfg.opacity;
        const shadow  = isSel
          ? `0 0 0 3px ${color}55, 0 5px 18px ${color}99`
          : !isRes && conf !== "LOW" ? `0 2px 8px ${color}66` : "none";

        const existing = markersRef.current.get(r.id);
        if (existing) {
          const el = existing.el;
          el.style.width      = `${size}px`;
          el.style.height     = `${size}px`;
          el.style.opacity    = String(opacity);
          el.style.border     = isSel ? "2.5px solid #fff" : "1.5px solid rgba(255,255,255,0.2)";
          el.style.boxShadow  = conf === "CONFIRMED" ? "" : shadow;
          if (conf === "CONFIRMED") el.classList.add("rw-pin-confirmed");
          else                      el.classList.remove("rw-pin-confirmed");
        } else {
          const el = document.createElement("div") as HTMLDivElement;
          el.style.width        = `${size}px`;
          el.style.height       = `${size}px`;
          el.style.borderRadius = "50% 50% 50% 0";
          el.style.transform    = "rotate(-45deg)";
          el.style.background   = color;
          el.style.opacity      = String(opacity);
          el.style.border       = isSel ? "2.5px solid #fff" : "1.5px solid rgba(255,255,255,0.2)";
          el.style.boxShadow    = shadow;
          el.style.display      = "flex";
          el.style.alignItems   = "center";
          el.style.justifyContent = "center";
          el.style.cursor       = "pointer";
          el.style.userSelect   = "none";
          el.style.transition   = "transform 0.15s, width 0.15s, height 0.15s";
          if (conf === "CONFIRMED") el.classList.add("rw-pin-confirmed");

          const inner = document.createElement("span");
          inner.style.transform   = "rotate(45deg)";
          inner.style.fontSize    = conf === "LOW" ? "9px" : "11px";
          inner.style.lineHeight  = "1";
          inner.style.pointerEvents = "none";
          inner.textContent = isRes ? "✅" : (EMOJI[r.hazardType] ?? "⚠️");
          el.appendChild(inner);

          if ((r.upvoteCount || 0) > 8 && conf !== "LOW" && !isRes) {
            const badge = document.createElement("div");
            badge.style.cssText = `
              position:absolute; top:-5px; right:-10px;
              background:${color}; border-radius:8px; padding:1px 5px;
              font-size:8px; color:#000; font-weight:900;
              border:1.5px solid #0A0A0A; pointer-events:none; white-space:nowrap;
            `;
            badge.textContent = String(r.upvoteCount);
            el.style.position = "relative";
            el.appendChild(badge);
          }

          el.addEventListener("click",      e => { e.stopPropagation(); onSelectRef.current(r); });
          el.addEventListener("mouseenter", () => { el.style.transform = "rotate(-45deg) scale(1.15)"; });
          el.addEventListener("mouseleave", () => { el.style.transform = "rotate(-45deg)"; });

          const marker = new maplibregl.Marker({ element: el, anchor: "bottom" })
            .setLngLat([r.longitude, r.latitude])
            .addTo(map);

          markersRef.current.set(r.id, { marker, el });
        }
      });

      // Fit all markers on first load
      if (!hasFitRef.current && reports.length > 0) {
        hasFitRef.current = true;
        if (reports.length === 1) {
          map.flyTo({ center: [reports[0].longitude, reports[0].latitude], zoom: 14 });
        } else {
          const bounds = new maplibregl.LngLatBounds();
          reports.forEach(r => bounds.extend([r.longitude, r.latitude]));
          map.fitBounds(bounds, { padding: 60, maxZoom: 14, duration: 800 });
        }
      }
    };

    if (map.loaded()) sync();
    else map.once("load", sync);
  }, [reports, selectedId]);

  // Fly to selected report
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedId) return;
    const r = reports.find(x => x.id === selectedId);
    if (!r) return;
    const fly = () =>
      map.flyTo({ center: [r.longitude, r.latitude], zoom: Math.max(map.getZoom(), 13), duration: 500 });
    if (map.loaded()) fly(); else map.once("load", fly);
  }, [selectedId, reports]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <div ref={containerRef} style={{ width: "100%", height: "100%" }}/>
      <div style={{ position: "absolute", top: 10, left: 12, pointerEvents: "none",
        fontSize: 8, fontWeight: 900, color: "#1e4060", letterSpacing: 2.5 }}>
        ACCRA METROPOLITAN
      </div>
    </div>
  );
}
