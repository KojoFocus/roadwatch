"use client";

import { useEffect, useRef } from "react";
import maplibregl             from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

const SEV_COLOR: Record<string, string> = {
  CRITICAL: "#EF4444",
  HIGH:     "#F97316",
  MEDIUM:   "#F59E0B",
  LOW:      "#22C55E",
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

interface Props {
  hazards: any[];
  height?: number;
}

export default function RouteMapGL({ hazards, height = 200 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || hazards.length === 0) return;

    const map = new maplibregl.Map({
      container:          containerRef.current,
      style:              "https://tiles.openfreemap.org/styles/liberty",
      center:             [hazards[0].longitude, hazards[0].latitude],
      zoom:               12,
      attributionControl: false,
      interactive:        false,
    });
    mapRef.current = map;

    map.on("load", () => {
      hazards.forEach(r => {
        const color = SEV_COLOR[r.severity] ?? "#F59E0B";

        const el = document.createElement("div");
        el.style.width          = "28px";
        el.style.height         = "28px";
        el.style.borderRadius   = "50% 50% 50% 0";
        el.style.transform      = "rotate(-45deg)";
        el.style.background     = color;
        el.style.border         = "1.5px solid rgba(255,255,255,0.25)";
        el.style.boxShadow      = `0 2px 8px ${color}66`;
        el.style.display        = "flex";
        el.style.alignItems     = "center";
        el.style.justifyContent = "center";

        const inner = document.createElement("span");
        inner.style.transform     = "rotate(45deg)";
        inner.style.fontSize      = "11px";
        inner.style.lineHeight    = "1";
        inner.style.pointerEvents = "none";
        inner.textContent = EMOJI[r.hazardType] ?? "⚠️";
        el.appendChild(inner);

        new maplibregl.Marker({ element: el, anchor: "bottom" })
          .setLngLat([r.longitude, r.latitude])
          .addTo(map);
      });

      if (hazards.length === 1) {
        map.flyTo({ center: [hazards[0].longitude, hazards[0].latitude], zoom: 14 });
      } else {
        const bounds = new maplibregl.LngLatBounds();
        hazards.forEach(r => bounds.extend([r.longitude, r.latitude]));
        map.fitBounds(bounds, { padding: 48, maxZoom: 14 });
      }
    });

    return () => { map.remove(); mapRef.current = null; };
  }, [hazards]);

  return (
    <div ref={containerRef}
      style={{ width: "100%", height, borderRadius: 12, overflow: "hidden", marginBottom: 14 }}
    />
  );
}
