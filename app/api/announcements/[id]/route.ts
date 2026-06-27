import { NextRequest, NextResponse } from "next/server";
import { getIronSession }           from "iron-session";
import { db }                        from "@/lib/db";
import type { SessionData }          from "@/types";

// ─── DELETE /api/announcements/[id] ── admin only ────────────────────────────
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const res     = NextResponse.next();
    const session = await getIronSession<SessionData>(req, res, { password: process.env.SESSION_SECRET as string, cookieName: "rw_admin_session" });
    if (!session.isLoggedIn || !session.admin) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    await db.announcement.update({ where: { id }, data: { active: false } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/announcements/[id]:", error);
    return NextResponse.json({ success: false, error: "Failed to delete announcement" }, { status: 500 });
  }
}
