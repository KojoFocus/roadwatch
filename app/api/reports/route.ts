import { NextRequest, NextResponse } from "next/server";
import { db }                        from "@/lib/db";
import { getConfidence }             from "@/lib/confidence";

// ─── In-memory rate limit store (1 report per IP per 60s) ────────────────────
const rateMap = new Map<string, number>();
setInterval(() => rateMap.clear(), 60_000);

function getIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

// ─── GET /api/reports ─────────────────────────────────────────────────────────
export async function GET() {
  try {
    const reports = await db.report.findMany({
      include: { _count: { select: { upvotes: true } } },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({
      success: true,
      data: reports.map(r => ({
        ...r,
        createdAt:   r.createdAt.toISOString(),
        updatedAt:   r.updatedAt.toISOString(),
        resolvedAt:  r.resolvedAt?.toISOString() || null,
        upvoteCount: r._count.upvotes,
        confidence:  getConfidence({
          status:      r.status,
          upvoteCount: r._count.upvotes,
          photoUrl:    r.photoUrl,
        }),
      })),
    });
  } catch (error) {
    console.error("GET /api/reports:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch reports" },
      { status: 500 }
    );
  }
}

// ─── POST /api/reports ────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    // Rate limit: 1 new report per IP per 60 seconds
    const ip   = getIp(req);
    const last = rateMap.get(ip);
    if (last && Date.now() - last < 60_000) {
      return NextResponse.json(
        { success: false, error: "Too many reports. Please wait a moment." },
        { status: 429 }
      );
    }
    rateMap.set(ip, Date.now());

    const body = await req.json();
    const {
      latitude, longitude, address, landmark,
      hazardType, severity, description,
      photoUrl, voiceUrl, transcript,
      reporter, areaId,
    } = body;

    if (!latitude || !longitude || !hazardType || !severity) {
      return NextResponse.json(
        { success: false, error: "latitude, longitude, hazardType and severity are required" },
        { status: 400 }
      );
    }

    const report = await db.report.create({
      data: {
        latitude:    parseFloat(String(latitude)),
        longitude:   parseFloat(String(longitude)),
        address:     address    || "Accra",
        landmark:    landmark   || null,
        hazardType,
        severity,
        description: description || null,
        photoUrl:    photoUrl   || null,
        voiceUrl:    voiceUrl   || null,
        transcript:  transcript || null,
        reporter:    reporter   || "Anonymous",
        areaId:      areaId     || null,
      },
      include: { _count: { select: { upvotes: true } } },
    });

    return NextResponse.json({
      success: true,
      data: {
        ...report,
        createdAt:   report.createdAt.toISOString(),
        updatedAt:   report.updatedAt.toISOString(),
        resolvedAt:  report.resolvedAt?.toISOString() || null,
        upvoteCount: report._count.upvotes,
        confidence:  getConfidence({
          status:      report.status,
          upvoteCount: report._count.upvotes,
          photoUrl:    report.photoUrl,
        }),
      },
    }, { status: 201 });
  } catch (error) {
    console.error("POST /api/reports:", error);
    return NextResponse.json(
      { success: false, error: "Failed to create report" },
      { status: 500 }
    );
  }
}
