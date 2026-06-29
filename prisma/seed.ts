import { PrismaClient, HazardType, Severity, ReportStatus } from "@prisma/client";
import bcrypt from "bcryptjs";

const db = new PrismaClient();

function rnd(min: number, max: number) { return Math.random() * (max - min) + min; }
function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }
function daysAgo(n: number) { const d = new Date(); d.setDate(d.getDate() - n); return d; }

// ── Corridor definitions ────────────────────────────────────────────────────
const CORRIDORS = [
  {
    name: "Adenta-Spintex",
    areaId: "spintex",
    region: "Greater Accra",
    district: "Ledzokuku Municipal",
    town: "Spintex",
    latRange: [5.630, 5.690] as [number,number],
    lngRange: [-0.170, -0.095] as [number,number],
    addresses: ["Spintex Road","Adenta Road","Baatsona Road","Community 18 Road","Oyarifa Link Rd"],
    landmarks: ["Baatsona Total","Community 18 Junction","Oyarifa Junction","Spintex Shell","Danquah Circle","Adenta Market"],
  },
  {
    name: "Circle-Kumasi Road",
    areaId: "kumasi-road",
    region: "Greater Accra",
    district: "Ga West Municipal",
    town: "Achimota",
    latRange: [5.545, 5.650] as [number,number],
    lngRange: [-0.270, -0.205] as [number,number],
    addresses: ["Kumasi Road","Achimota Road","Ofankor Road","Pokuase Road","Accra-Kumasi Highway"],
    landmarks: ["Achimota Overpass","Ofankor Tollbooth","Pokuase Junction","Dome Market","Achimota Forest Junction","Accra Mall Underpass"],
  },
  {
    name: "Madina-Legon",
    areaId: "haatso",
    region: "Greater Accra",
    district: "Ga East Municipal",
    town: "Madina",
    latRange: [5.630, 5.705] as [number,number],
    lngRange: [-0.195, -0.145] as [number,number],
    addresses: ["Madina Road","Legon Road","East Legon Road","Haatso Road","Atomic Junction Road"],
    landmarks: ["Madina Market","Atomic Junction","Haatso Overpass","UG Main Gate","East Legon Police Station","Tetteh Quarshie Interchange"],
  },
  {
    name: "Kaneshie-Kasoa",
    areaId: "kasoa",
    region: "Greater Accra",
    district: "Awutu Senya East Municipal",
    town: "Kasoa",
    latRange: [5.515, 5.570] as [number,number],
    lngRange: [-0.440, -0.225] as [number,number],
    addresses: ["Cape Coast Road","Kasoa Road","Weija Road","Mallam Road","Kaneshie Road"],
    landmarks: ["Kaneshie Market","Weija Dam Junction","Kasoa Interchange","Mallam Junction","Bortianor Junction","Obom Road Junction"],
  },
  {
    name: "Tema-Ashaiman",
    areaId: "tema",
    region: "Greater Accra",
    district: "Tema Metropolitan",
    town: "Tema",
    latRange: [5.645, 5.730] as [number,number],
    lngRange: [-0.045, 0.022] as [number,number],
    addresses: ["Tema Motorway","Ashaiman Road","Community 1 Main Road","Harbor Road","Valco Road"],
    landmarks: ["Tema Harbour Gate","Ashaiman Market","Motorway Roundabout","Community 18 Junction","Tema Station","Ashaiman Lorry Park"],
  },
];

const HAZARD_TYPES = Object.values(HazardType);
const SEVERITIES   = Object.values(Severity);

const DESCRIPTIONS: Record<string, string[]> = {
  POTHOLE:          ["Deep crater spanning half the lane","Pothole worsened after rain, cars swerving","Series of potholes making road impassable","Pothole swallowed a tyre this morning"],
  FLOOD:            ["Road underwater after heavy rain","Drainage overflow flooding both lanes","Water knee-deep, cars stalling","Flash flood blocking entry to road"],
  ACCIDENT:         ["Two vehicles collided, one lane blocked","Truck overturned blocking road","Minor fender-bender blocking fast lane","Bus broke down mid-road after collision"],
  DEBRIS:           ["Fallen tree across road","Building rubble on shoulder","Truck lost load of sand across road","Broken bottles across lane from accident"],
  BROKEN_LIGHT:     ["Traffic light dark for 2 days","Signal stuck on red indefinitely","All lights out at busy junction","Blinking amber only, very dangerous at night"],
  ROAD_BLOCK:       ["Illegal checkpoint slowing traffic","Road works narrowed to single lane","Vendors blocking entire shoulder","Police operation causing major jam"],
  DANGEROUS_ANIMAL: ["Herd of cattle crossing road","Dog pack on carriageway at night","Stray horse near Spintex","Goats on road near Madina junction"],
  OTHER:            ["Massive oil spill making road slippery","Street light down on road surface","Illegal dumping blocking drain causing flood","Abandoned vehicle in fast lane overnight"],
};

// ── Weight distribution (more PENDING/VERIFIED, fewer RESOLVED) ─────────────
const STATUS_WEIGHTS: [ReportStatus, number][] = [
  [ReportStatus.PENDING,   35],
  [ReportStatus.VERIFIED,  30],
  [ReportStatus.IN_REVIEW, 20],
  [ReportStatus.RESOLVED,  12],
  [ReportStatus.DISMISSED,  3],
];

function weightedStatus(): ReportStatus {
  const total = STATUS_WEIGHTS.reduce((s,[,w])=>s+w, 0);
  let r = Math.random() * total;
  for (const [status, weight] of STATUS_WEIGHTS) {
    r -= weight;
    if (r <= 0) return status;
  }
  return ReportStatus.PENDING;
}

const SEVERITY_WEIGHTS: [Severity, number][] = [
  [Severity.LOW,      15],
  [Severity.MEDIUM,   35],
  [Severity.HIGH,     35],
  [Severity.CRITICAL, 15],
];

function weightedSeverity(): Severity {
  const total = SEVERITY_WEIGHTS.reduce((s,[,w])=>s+w, 0);
  let r = Math.random() * total;
  for (const [sev, weight] of SEVERITY_WEIGHTS) {
    r -= weight;
    if (r <= 0) return sev;
  }
  return Severity.MEDIUM;
}

async function main() {
  console.log("🌱 Seeding RoadWatch Ghana...");

  // ── Admin accounts ──────────────────────────────────────────────────────────
  const superAdmin = await db.admin.upsert({
    where:  { email: "admin@roadwatch.gh" },
    update: {},
    create: {
      email:        "admin@roadwatch.gh",
      passwordHash: await bcrypt.hash("roadwatch2024", 12),
      name:         "RoadWatch Admin",
      role:         "SUPER_ADMIN",
    },
  });

  await db.admin.upsert({
    where:  { email: "moderator@roadwatch.gh" },
    update: {},
    create: {
      email:        "moderator@roadwatch.gh",
      passwordHash: await bcrypt.hash("moderator2024", 12),
      name:         "Road Moderator",
      role:         "MODERATOR",
    },
  });

  console.log("✅ Admin accounts ready");

  // ── Clear existing reports (re-seed cleanly) ────────────────────────────────
  await db.upvote.deleteMany();
  await db.activity.deleteMany();
  await db.report.deleteMany();
  console.log("🗑️  Cleared existing reports");

  // ── Generate 100 reports (20 per corridor) ──────────────────────────────────
  let total = 0;

  for (const corridor of CORRIDORS) {
    for (let i = 0; i < 20; i++) {
      const hazardType = pick(HAZARD_TYPES);
      const severity   = weightedSeverity();
      const status     = weightedStatus();
      const createdAt  = daysAgo(Math.floor(rnd(0, 14)));

      const isResolved  = status === ReportStatus.RESOLVED;
      const resolvedAt  = isResolved ? new Date(createdAt.getTime() + rnd(3_600_000, 86_400_000 * 3)) : undefined;

      const resolutionNotes: Record<string, string> = {
        POTHOLE:   "GHA patched the pothole. Road surface restored.",
        FLOOD:     "Drainage cleared. Road fully dry and passable.",
        ACCIDENT:  "Vehicles towed. Road cleared and safe.",
        DEBRIS:    "Debris removed by road crew. All lanes open.",
        BROKEN_LIGHT: "Traffic light repaired by ECG. Signal fully operational.",
        ROAD_BLOCK:"Obstruction removed. Road clear.",
        DANGEROUS_ANIMAL: "Animals moved off road. Route safe.",
        OTHER:     "Hazard cleared. Road safe for travel.",
      };

      const report = await db.report.create({
        data: {
          latitude:       rnd(...corridor.latRange),
          longitude:      rnd(...corridor.lngRange),
          address:        pick(corridor.addresses),
          landmark:       Math.random() > 0.3 ? pick(corridor.landmarks) : undefined,
          areaId:         corridor.areaId,
          region:         corridor.region,
          district:       corridor.district,
          town:           corridor.town,
          hazardType,
          severity,
          description:    pick(DESCRIPTIONS[hazardType] ?? [""]),
          status,
          reporter:       Math.random() > 0.4 ? `+233 ${pick(["55","24","20","26","59"])}•••${String(Math.floor(rnd(1000,9999)))}` : "Anonymous",
          createdAt,
          updatedAt:      createdAt,
          ...(isResolved && {
            resolvedAt,
            resolutionNote: resolutionNotes[hazardType],
            fixedBy:        pick(["GHA Roads Team","Accra Metro AMA","Ghana Police Service","ECG Maintenance","DVLA Unit"]),
          }),
        },
      });

      // Upvotes — 3-6 for CONFIRMED feel, 0-2 for others
      const isBusy    = severity === Severity.CRITICAL || severity === Severity.HIGH;
      const upvotes   = isBusy && Math.random() > 0.5
        ? Math.floor(rnd(3, 7))
        : Math.floor(rnd(0, 3));

      for (let v = 0; v < upvotes; v++) {
        await db.upvote.create({
          data: { reportId: report.id, fingerprint: `seed-${report.id}-${v}` },
        });
      }

      // Activity log for resolved/verified reports
      if (isResolved) {
        await db.activity.create({
          data: {
            reportId:  report.id,
            adminId:   superAdmin.id,
            action:    "STATUS_CHANGED",
            detail:    "IN_REVIEW → RESOLVED",
            createdAt: resolvedAt,
          },
        });
      } else if (status === ReportStatus.VERIFIED) {
        await db.activity.create({
          data: {
            reportId:  report.id,
            adminId:   superAdmin.id,
            action:    "STATUS_CHANGED",
            detail:    "PENDING → VERIFIED",
            createdAt: new Date(createdAt.getTime() + 3_600_000),
          },
        });
      }

      total++;
    }

    console.log(`✅ ${corridor.name} — 20 reports seeded`);
  }

  // ── Announcement ────────────────────────────────────────────────────────────
  await db.announcement.upsert({
    where:  { id: "launch-announcement" },
    update: {},
    create: {
      id:       "launch-announcement",
      title:    "RoadWatch Ghana is Live",
      body:     "Report road hazards in your area and help keep Ghana's roads safer for everyone.",
      type:     "INFO",
      region:   null,
      active:   true,
      adminId:  superAdmin.id,
    },
  });

  console.log(`\n✅ ${total} reports seeded across 5 corridors`);
  console.log("✅ Launch announcement created");
  console.log("\n🚦 RoadWatch Ghana seeded successfully!");
  console.log("\nAdmin credentials:");
  console.log("  admin@roadwatch.gh / roadwatch2024");
  console.log("  moderator@roadwatch.gh / moderator2024");
}

main()
  .catch(console.error)
  .finally(() => db.$disconnect());
