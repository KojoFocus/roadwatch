// RoadWatch Ghana — Shared Types

export type HazardType =
  | "POTHOLE"
  | "FLOOD"
  | "ACCIDENT"
  | "DEBRIS"
  | "BROKEN_LIGHT"
  | "ROAD_BLOCK"
  | "DANGEROUS_ANIMAL"
  | "OTHER";

export type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type ReportStatus =
  | "PENDING"
  | "VERIFIED"
  | "IN_REVIEW"
  | "RESOLVED"
  | "DISMISSED";

export type AdminRole = "SUPER_ADMIN" | "MODERATOR" | "VIEWER";

export type Confidence = "LOW" | "MEDIUM" | "HIGH" | "CONFIRMED";

// ─── Report ───────────────────────────────────────────────────────────────────
export interface Report {
  id:             string;
  createdAt:      string;
  updatedAt:      string;

  // Location
  latitude:       number;
  longitude:      number;
  address:        string;
  landmark?:      string;
  areaId?:        string;
  region:         string;

  // Hazard
  hazardType:     HazardType;
  severity:       Severity;
  description?:   string;

  // Media
  photoUrl?:      string;
  voiceUrl?:      string;
  transcript?:    string;

  // Identity
  reporter?:      string;

  // Status
  status:         ReportStatus;
  resolvedAt?:    string;
  resolutionNote?: string;
  fixedBy?:       string;
  adminNote?:     string;

  // Computed
  upvoteCount:    number;
  confidence:     Confidence;
}

// ─── Admin ────────────────────────────────────────────────────────────────────
export interface Admin {
  id:        string;
  email:     string;
  name:      string;
  role:      AdminRole;
  lastLogin?: string;
}

// ─── Area ─────────────────────────────────────────────────────────────────────
export interface Area {
  id:       string;
  name:     string;
  region:   string;
  district: string;
  kw:       string[];
}

// ─── Announcement ─────────────────────────────────────────────────────────────
export type AnnouncementType = "INFO" | "WARNING" | "ROAD_CLOSURE" | "MAINTENANCE" | "EMERGENCY";

export interface Announcement {
  id:        string;
  createdAt: string;
  title:     string;
  body:      string;
  type:      AnnouncementType;
  region:    string | null;
  expiresAt: string | null;
  admin:     { name: string };
}

export type AreaSafetyScore = "CLEAR" | "ADVISORY" | "CAUTION" | "DANGER";

export interface AreaSafety {
  score:   AreaSafetyScore;
  label:   string;
  color:   string;
  count:   number;
  reports: Report[];
}

// ─── API Responses ────────────────────────────────────────────────────────────
export interface ApiResponse<T> {
  data?:    T;
  error?:   string;
  success:  boolean;
}

export interface TranscribeResponse {
  transcript:   string;
  hazardType?:  HazardType;
  severity?:    Severity;
  locationHint?: string;
  language:     string;
  confidence:   number;
}

// ─── Session ──────────────────────────────────────────────────────────────────
export interface SessionData {
  admin?: {
    id:    string;
    email: string;
    name:  string;
    role:  AdminRole;
  };
  isLoggedIn: boolean;
}
