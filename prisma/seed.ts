import { PrismaClient, HazardType, Severity, ReportStatus } from "@prisma/client";
import bcrypt from "bcryptjs";

const db = new PrismaClient();

async function main() {
  console.log("🌱 Seeding RoadWatch Ghana...");

  // ── Admin accounts ──────────────────────────────────────────────────────────
  const superAdmin = await db.admin.upsert({
    where: { email: "admin@roadwatch.gh" },
    update: {},
    create: {
      email:        "admin@roadwatch.gh",
      passwordHash: await bcrypt.hash("roadwatch2024", 12),
      name:         "RoadWatch Admin",
      role:         "SUPER_ADMIN",
    },
  });

  await db.admin.upsert({
    where: { email: "moderator@roadwatch.gh" },
    update: {},
    create: {
      email:        "moderator@roadwatch.gh",
      passwordHash: await bcrypt.hash("moderator2024", 12),
      name:         "Road Moderator",
      role:         "MODERATOR",
    },
  });

  console.log("✅ Admin accounts created");

  // ── Seed reports ────────────────────────────────────────────────────────────
  const reports = [
    {
      latitude:    5.6279, longitude:  -0.1694,
      address:     "Spintex Road", landmark: "near Total Filling Station",
      areaId:      "spintex",
      hazardType:  HazardType.POTHOLE,
      severity:    Severity.HIGH,
      status:      ReportStatus.VERIFIED,
      description: "Deep pothole swallowed a tyre. Extremely dangerous at night.",
      photoUrl:    "https://images.unsplash.com/photo-1515162816999-a0c47dc192f7?w=600&q=80",
      reporter:    "+233 55•••1234",
    },
    {
      latitude:    5.5502, longitude:  -0.2174,
      address:     "Kwame Nkrumah Ave", landmark: "Accra Central",
      areaId:      "accra-central",
      hazardType:  HazardType.FLOOD,
      severity:    Severity.CRITICAL,
      status:      ReportStatus.IN_REVIEW,
      description: "Road completely flooded after rain. Cars stalling mid-road.",
      photoUrl:    "https://images.unsplash.com/photo-1574482620826-40685ca5eef2?w=600&q=80",
      reporter:    "Anonymous",
    },
    {
      latitude:    5.5993, longitude:  -0.1875,
      address:     "Liberation Road", landmark: "Airport Residential",
      areaId:      "liberation",
      hazardType:  HazardType.ACCIDENT,
      severity:    Severity.HIGH,
      status:      ReportStatus.PENDING,
      description: "Two vehicles involved. One lane blocked.",
      photoUrl:    null,
      reporter:    "+233 24•••8891",
    },
    {
      latitude:    5.6500, longitude:  -0.1750,
      address:     "Adenta Road", landmark: "Oyarifa Junction",
      areaId:      "adenta",
      hazardType:  HazardType.BROKEN_LIGHT,
      severity:    Severity.MEDIUM,
      status:      ReportStatus.PENDING,
      description: "Traffic light off for 3 days. Near-miss accidents at night.",
      photoUrl:    null,
      reporter:    "Anonymous",
    },
    {
      latitude:    5.5720, longitude:  -0.2063,
      address:     "Ring Road Central", landmark: "Ministries",
      areaId:      "ring-road",
      hazardType:  HazardType.DEBRIS,
      severity:    Severity.MEDIUM,
      status:      ReportStatus.RESOLVED,
      description: "Fallen tree blocked left lane.",
      photoUrl:    null,
      reporter:    "+233 20•••5523",
      resolvedAt:  new Date("2026-06-26T10:00:00Z"),
      resolutionNote: "Road crew removed fallen tree. Both lanes now clear and safe.",
      fixedBy:     "GHA Roads Team",
    },
    {
      latitude:    5.6100, longitude:  -0.0520,
      address:     "Tema Motorway", landmark: "Km 14, Ashaiman",
      areaId:      "tema",
      hazardType:  HazardType.POTHOLE,
      severity:    Severity.CRITICAL,
      status:      ReportStatus.IN_REVIEW,
      description: "Series of craters across both lanes. Night driving extremely risky.",
      photoUrl:    "https://images.unsplash.com/photo-1515162816999-a0c47dc192f7?w=600&q=80",
      reporter:    "+233 55•••7714",
    },
    {
      latitude:    5.6320, longitude:  -0.2120,
      address:     "Kumasi Road", landmark: "Ofankor tollbooth",
      areaId:      "kumasi-road",
      hazardType:  HazardType.ROAD_BLOCK,
      severity:    Severity.HIGH,
      status:      ReportStatus.RESOLVED,
      description: "Illegal vendors blocking shoulder.",
      photoUrl:    null,
      reporter:    "Anonymous",
      resolvedAt:  new Date("2026-06-25T09:00:00Z"),
      resolutionNote: "Police cleared vendors. Road shoulder now fully accessible.",
      fixedBy:     "Ghana Police Service",
    },
    {
      latitude:    5.6180, longitude:  -0.2010,
      address:     "Haatso", landmark: "Atomic Junction",
      areaId:      "haatso",
      hazardType:  HazardType.FLOOD,
      severity:    Severity.HIGH,
      status:      ReportStatus.VERIFIED,
      description: "Drainage overflow. Impassable for saloon cars after rain.",
      photoUrl:    "https://images.unsplash.com/photo-1574482620826-40685ca5eef2?w=600&q=80",
      reporter:    "+233 26•••0021",
    },
  ];

  for (const data of reports) {
    const report = await db.report.create({ data });

    // Add upvotes to some reports
    const upvoteCount = Math.floor(Math.random() * 20) + 1;
    for (let i = 0; i < upvoteCount; i++) {
      await db.upvote.create({
        data: {
          reportId:    report.id,
          fingerprint: `seed-fp-${report.id}-${i}`,
        },
      });
    }

    // Add activity for resolved reports
    if (data.status === ReportStatus.RESOLVED) {
      await db.activity.create({
        data: {
          reportId: report.id,
          adminId:  superAdmin.id,
          action:   "STATUS_CHANGED",
          detail:   "IN_REVIEW → RESOLVED",
        },
      });
    }
  }

  console.log(`✅ ${reports.length} reports seeded with upvotes`);
  console.log("\n🚦 RoadWatch Ghana seeded successfully!");
  console.log("\nAdmin credentials:");
  console.log("  Email: admin@roadwatch.gh");
  console.log("  Password: roadwatch2024");
}

main()
  .catch(console.error)
  .finally(() => db.$disconnect());
