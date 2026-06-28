import { NextRequest, NextResponse } from "next/server";
import webpush from "web-push";
import { db } from "@/lib/db";

export async function POST(req: NextRequest) {
  const auth = req.headers.get("x-admin-key");
  if (auth !== process.env.SESSION_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.VAPID_SUBJECT || !process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    return NextResponse.json({ error: "VAPID env vars not configured" }, { status: 500 });
  }
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT,
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  );

  try {
    const { title, body, icon } = await req.json();
    const subs = await db.pushSubscription.findMany();

    const results = await Promise.allSettled(
      subs.map(sub =>
        webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify({ title, body, icon: icon || "/icons/icon-192.svg" }),
        )
      )
    );

    const failed = subs.filter((_, i) => results[i].status === "rejected");
    if (failed.length > 0) {
      await db.pushSubscription.deleteMany({
        where: { endpoint: { in: failed.map(s => s.endpoint) } },
      });
    }

    return NextResponse.json({
      success: true,
      sent:   results.filter(r => r.status === "fulfilled").length,
      failed: failed.length,
    });
  } catch (e) {
    console.error("POST /api/push/notify:", e);
    return NextResponse.json({ success: false, error: "Failed to send notifications" }, { status: 500 });
  }
}
