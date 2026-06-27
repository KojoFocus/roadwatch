import { NextRequest, NextResponse } from "next/server";
import { getIronSession }           from "iron-session";
import { db }                        from "@/lib/db";
import type { SessionData }          from "@/types";

// ─── GET /api/announcements ── public ─────────────────────────────────────────
export async function GET() {
  try {
    const now = new Date();
    const announcements = await db.announcement.findMany({
      where: {
        active: true,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      include: { admin: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ success: true, data: announcements.map(a => ({
      ...a,
      createdAt: a.createdAt.toISOString(),
      expiresAt: a.expiresAt?.toISOString() || null,
    }))});
  } catch (error) {
    console.error("GET /api/announcements:", error);
    return NextResponse.json({ success: false, error: "Failed to fetch announcements" }, { status: 500 });
  }
}

// ─── POST /api/announcements ── admin only ────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const res     = NextResponse.next();
    const session = await getIronSession<SessionData>(req, res, { password: process.env.SESSION_SECRET as string, cookieName: "rw_admin_session" });
    if (!session.isLoggedIn || !session.admin) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    const { title, body, type, region, expiresAt } = await req.json();
    if (!title?.trim() || !body?.trim()) return NextResponse.json({ success: false, error: "Title and body are required" }, { status: 400 });

    const announcement = await db.announcement.create({
      data: {
        title:     title.trim(),
        body:      body.trim(),
        type:      type || "INFO",
        region:    region || null,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        adminId:   session.admin.id,
      },
      include: { admin: { select: { name: true } } },
    });

    return NextResponse.json({ success: true, data: {
      ...announcement,
      createdAt: announcement.createdAt.toISOString(),
      expiresAt: announcement.expiresAt?.toISOString() || null,
    }}, { status: 201 });
  } catch (error) {
    console.error("POST /api/announcements:", error);
    return NextResponse.json({ success: false, error: "Failed to create announcement" }, { status: 500 });
  }
}
