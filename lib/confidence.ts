import type { Report, Confidence } from "@/types";

export function getConfidence(report: {
  status:     string;
  upvoteCount: number;
  photoUrl?:  string | null;
}): Confidence {
  if (report.status === "VERIFIED" || report.status === "IN_REVIEW") return "HIGH";
  if (report.upvoteCount >= 3) return "CONFIRMED";
  if (report.photoUrl) return "MEDIUM";
  return "LOW";
}

export const CONFIDENCE_META: Record<Confidence, {
  label:        string;
  color:        string;
  bg:           string;
  border:       string;
  pinColor:     string;
  showInAreas:  boolean;
  showInRoute:  boolean;
}> = {
  LOW: {
    label:       "Unverified",
    color:       "#374151",
    bg:          "rgba(55,65,81,0.08)",
    border:      "rgba(55,65,81,0.18)",
    pinColor:    "#374151",
    showInAreas: false,
    showInRoute: false,
  },
  MEDIUM: {
    label:       "Reported",
    color:       "#F59E0B",
    bg:          "rgba(245,158,11,0.08)",
    border:      "rgba(245,158,11,0.22)",
    pinColor:    "#F59E0B",
    showInAreas: true,
    showInRoute: true,
  },
  HIGH: {
    label:       "Verified",
    color:       "#F97316",
    bg:          "rgba(249,115,22,0.08)",
    border:      "rgba(249,115,22,0.25)",
    pinColor:    "#F97316",
    showInAreas: true,
    showInRoute: true,
  },
  CONFIRMED: {
    label:       "Confirmed",
    color:       "#EF4444",
    bg:          "rgba(239,68,68,0.08)",
    border:      "rgba(239,68,68,0.28)",
    pinColor:    "#EF4444",
    showInAreas: true,
    showInRoute: true,
  },
};
