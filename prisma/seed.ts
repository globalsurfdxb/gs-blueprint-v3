import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// Three clusters — Marketing & Strategy (Aravind), Creative Studio (no Head — receives
// cross-cluster Design attachments only, never originates its own projects), and Project
// Delivery & Client Services (Preethika). Social Media is a pod within Marketing &
// Strategy, not a peer cluster.
const CLUSTERS = ["Marketing & Strategy", "Creative Studio", "Project Delivery & Client Services"] as const;

const PODS_BY_CLUSTER: Record<string, string[]> = {
  "Marketing & Strategy": [
    "SEO",
    "Performance",
    "Content",
    "Agency Marketing",
    "Social Media",
    "Photography/Production",
  ],
  "Creative Studio": ["Design"],
  // QA is NOT a separate discipline (PRD v1.18): the Development Division is one team, and
  // QA is a Contributor role inside the Dev pod. No standalone QA pod.
  "Project Delivery & Client Services": ["Dev", "Account Management"],
};

const SERVICE_TYPES = [
  "Web/App Dev",
  "SEO",
  "Performance Marketing",
  "Social Media",
  "Design/Creative",
];

// Default Content Types for the Social Media Content Calendar — Admin can add/edit/remove
// these and their lead-time values at any time via Admin > Content Types; nothing here is
// hardcoded elsewhere in the app.
const CONTENT_TYPES: { name: string; contentLeadTimeDays: number; designLeadTimeDays: number }[] = [
  { name: "Reels", contentLeadTimeDays: 5, designLeadTimeDays: 2 },
  { name: "Carousel", contentLeadTimeDays: 4, designLeadTimeDays: 2 },
  { name: "Static", contentLeadTimeDays: 3, designLeadTimeDays: 1 },
  { name: "Other", contentLeadTimeDays: 3, designLeadTimeDays: 1 },
];

async function main() {
  const clusters = new Map<string, string>();
  for (const name of CLUSTERS) {
    const cluster = await prisma.cluster.upsert({
      where: { name },
      update: {},
      create: { name },
    });
    clusters.set(name, cluster.id);

    for (const podName of PODS_BY_CLUSTER[name] ?? []) {
      await prisma.pod.upsert({
        where: { clusterId_name: { clusterId: cluster.id, name: podName } },
        update: {},
        create: { clusterId: cluster.id, name: podName },
      });
    }
  }

  for (const name of SERVICE_TYPES) {
    await prisma.serviceType.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }

  for (const ct of CONTENT_TYPES) {
    await prisma.contentType.upsert({
      where: { name: ct.name },
      update: {},
      create: ct,
    });
  }

  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!adminPassword) {
    throw new Error("SEED_ADMIN_PASSWORD env var is required to seed the Admin user.");
  }
  const passwordHash = await bcrypt.hash(adminPassword, 12);

  const admin = await prisma.user.upsert({
    where: { email: "faisal@globalsurf.ae" },
    update: {},
    create: {
      name: "Faisal Ahmad",
      email: "faisal@globalsurf.ae",
      passwordHash,
      location: "DUBAI",
    },
  });

  const existingAdminRole = await prisma.userRole.findFirst({
    where: { userId: admin.id, role: "ADMIN", clusterId: null, podId: null },
  });
  if (!existingAdminRole) {
    await prisma.userRole.create({
      data: { userId: admin.id, role: "ADMIN" },
    });
  }

  console.log("Seed complete:");
  console.log(`  Clusters: ${CLUSTERS.length}`);
  console.log(`  Service types: ${SERVICE_TYPES.length}`);
  console.log(`  Admin user: ${admin.email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
