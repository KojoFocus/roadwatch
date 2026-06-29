import { NextRequest, NextResponse } from "next/server";
import { db }                        from "@/lib/db";

// ─── POST /api/route-check ────────────────────────────────────────────────────
// Body: { from: [lng, lat], to: [lng, lat] }
// 1. Fetches the real driving route from OSRM (free, no key).
// 2. Uses PostGIS ST_DWithin to find active hazards within 50m of that route.
export async function POST(req: NextRequest) {
  try {
    const { from, to } = await req.json();
    if (!Array.isArray(from) || !Array.isArray(to) || from.length !== 2 || to.length !== 2) {
      return NextResponse.json({ error: "from and to must be [lng, lat] pairs" }, { status: 400 });
    }

    const osrmRes = await fetch(
      `https://router.project-osrm.org/route/v1/driving/${from[0]},${from[1]};${to[0]},${to[1]}?geometries=geojson&overview=full`
    );
    if (!osrmRes.ok) {
      return NextResponse.json({ error: "Routing service unavailable" }, { status: 502 });
    }
    const osrmData = await osrmRes.json();
    const route = osrmData.routes?.[0];
    if (!route) {
      return NextResponse.json({ error: "No route found between these points" }, { status: 404 });
    }

    const geojsonStr = JSON.stringify(route.geometry);

    const hazards = await db.$queryRaw<any[]>`
      SELECT
        r.id, r."hazardType", r.severity, r.address, r.landmark, r.status,
        r.latitude, r.longitude, r."createdAt",
        COALESCE(u.cnt, 0)::int AS "upvoteCount"
      FROM "Report" r
      LEFT JOIN (
        SELECT "reportId", COUNT(*) AS cnt FROM "Upvote" GROUP BY "reportId"
      ) u ON u."reportId" = r.id
      WHERE r.status != 'RESOLVED' AND r.status != 'DISMISSED'
        AND ST_DWithin(
          ST_SetSRID(ST_MakePoint(r.longitude, r.latitude), 4326)::geography,
          ST_SetSRID(ST_GeomFromGeoJSON(${geojsonStr}), 4326)::geography,
          50
        )
      ORDER BY CASE r.severity
        WHEN 'CRITICAL' THEN 1
        WHEN 'HIGH'     THEN 2
        WHEN 'MEDIUM'   THEN 3
        ELSE 4
      END
    `;

    return NextResponse.json({
      route: {
        geometry:        route.geometry,
        distanceMeters:  route.distance,
        durationSeconds: route.duration,
      },
      hazards,
    });
  } catch (e) {
    console.error("POST /api/route-check:", e);
    return NextResponse.json({ error: "Failed to check route" }, { status: 500 });
  }
}
