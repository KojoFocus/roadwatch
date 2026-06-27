import { NextRequest, NextResponse } from "next/server";
import { db }                        from "@/lib/db";
import { requireAdmin }              from "@/lib/session";
import { getConfidence }             from "@/lib/confidence";

// --- GET /api/reports/[id] ---------------------------------------------------
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await requireAdmin();
    if (!admin) return NextResponse.json({ success: false, error: "Unauthorised" }, { status: 401 });

    const { id } = await params;
    const report  = await db.report.findUnique({
      where:   { id },
      include: {
        _count:     { select: { upvotes: true } },
        activities: {
          orderBy: { createdAt: "desc" },
          include: { admin: { select: { name: true, role: true } } },
        },
      },
    });
    if (!report) return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });

    return NextResponse.json({
      success: true,
      data: {
        ...report,
        createdAt:   report.createdAt.toISOString(),
        updatedAt:   report.updatedAt.toISOString(),
        resolvedAt:  report.resolvedAt?.toISOString() || null,
        upvoteCount: report._count.upvotes,
        confidence:  getConfidence({ status: report.status, upvoteCount: report._count.upvotes, photoUrl: report.photoUrl }),
        activities:  report.activities.map(a => ({
          ...a,
          createdAt: a.createdAt.toISOString(),
        })),
      },
    });
  } catch (error) {
    console.error("GET /api/reports/[id]:", error);
    return NextResponse.json({ success: false, error: "Failed to fetch report" }, { status: 500 });
  }
}

// --- PATCH /api/reports/[id] -------------------------------------------------
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await requireAdmin();
    if (!admin) return NextResponse.json({ success: false, error: "Unauthorised" }, { status: 401 });

    const { id } = await params;
    const body   = await req.json();
    const { status, adminNote, resolutionNote, fixedBy } = body;

    const existing = await db.report.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });

    if (status === "RESOLVED" && !resolutionNote?.trim()) {
      return NextResponse.json({ success: false, error: "Resolution note required" }, { status: 400 });
    }

    const updated = await db.report.update({
      where: { id },
      data: {
        ...(status         && { status }),
        ...(adminNote      && { adminNote }),
        ...(resolutionNote && { resolutionNote }),
        ...(fixedBy        && { fixedBy }),
        ...(status === "RESOLVED" && !existing.resolvedAt && { resolvedAt: new Date() }),
      },
      include: { _count: { select: { upvotes: true } } },
    });

    if (status && status !== existing.status) {
      await db.activity.create({
        data: {
          reportId: id,
          adminId:  admin.id,
          action:   "STATUS_CHANGED",
          detail:   `${existing.status} → ${status}`,
        },
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        ...updated,
        createdAt:   updated.createdAt.toISOString(),
        updatedAt:   updated.updatedAt.toISOString(),
        resolvedAt:  updated.resolvedAt?.toISOString() || null,
        upvoteCount: updated._count.upvotes,
      },
    });
  } catch (error) {
    console.error("PATCH /api/reports/[id]:", error);
    return NextResponse.json({ success: false, error: "Failed to update report" }, { status: 500 });
  }
}
