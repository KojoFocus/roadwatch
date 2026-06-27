import { NextRequest, NextResponse } from "next/server";
import { db }                        from "@/lib/db";

// ─── POST /api/reports/[id]/upvote ───────────────────────────────────────────
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id }        = await params;
    const { fingerprint } = await req.json();

    if (!fingerprint) {
      return NextResponse.json(
        { success: false, error: "Fingerprint required" },
        { status: 400 }
      );
    }

    // Prevent double-voting
    const existing = await db.upvote.findUnique({
      where: {
        reportId_fingerprint: { reportId: id, fingerprint },
      },
    });

    if (existing) {
      return NextResponse.json(
        { success: false, error: "Already confirmed" },
        { status: 409 }
      );
    }

    await db.upvote.create({
      data: { reportId: id, fingerprint },
    });

    const count = await db.upvote.count({ where: { reportId: id } });

    return NextResponse.json({ success: true, data: { upvoteCount: count } });
  } catch (error) {
    console.error("POST /api/reports/[id]/upvote:", error);
    return NextResponse.json(
      { success: false, error: "Failed to confirm" },
      { status: 500 }
    );
  }
}
