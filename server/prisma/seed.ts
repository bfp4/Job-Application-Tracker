import { PrismaClient, ApplicationStatus } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database...");

  // 1 user
  const user = await prisma.user.upsert({
    where: { email: "demo@jobtracker.dev" },
    update: {},
    create: {
      firebaseUid: "seed-firebase-uid-001",
      email: "demo@jobtracker.dev",
    },
  });

  // 2 companies
  const acme = await prisma.company.create({
    data: {
      name: "Acme Corp",
      website: "https://acme.example.com",
    },
  });

  const globex = await prisma.company.create({
    data: {
      name: "Globex Inc",
      website: "https://globex.example.com",
    },
  });

  // 3 job postings
  const frontendJob = await prisma.jobPosting.create({
    data: {
      companyId: acme.id,
      title: "Frontend Engineer",
      description: "Build delightful UIs with React and Next.js.",
      location: "Remote",
      jobUrl: "https://acme.example.com/jobs/frontend-engineer",
      source: "greenhouse",
      externalId: "acme-fe-001",
      postedDate: new Date("2026-06-01"),
    },
  });

  await prisma.jobPosting.create({
    data: {
      companyId: acme.id,
      title: "Backend Engineer",
      description: "Design and scale REST APIs with Node.js and Postgres.",
      location: "New York, NY",
      jobUrl: "https://acme.example.com/jobs/backend-engineer",
      source: "greenhouse",
      externalId: "acme-be-001",
      postedDate: new Date("2026-06-05"),
    },
  });

  await prisma.jobPosting.create({
    data: {
      companyId: globex.id,
      title: "Full-Stack Developer",
      description: "Own features end-to-end across the stack.",
      location: "San Francisco, CA",
      jobUrl: "https://globex.example.com/careers/full-stack",
      source: "lever",
      externalId: "globex-fs-001",
      postedDate: new Date("2026-06-10"),
    },
  });

  // 1 application (for the frontend job at Acme)
  await prisma.application.create({
    data: {
      userId: user.id,
      jobPostingId: frontendJob.id,
      companyId: acme.id,
      status: ApplicationStatus.APPLIED,
      appliedDate: new Date("2026-06-12"),
      notes: "Applied via referral from a former colleague.",
    },
  });

  console.log("Seeding complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
