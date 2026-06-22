import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../lib/prisma";
import { renderResumeToPdf } from "../services/resumeRenderer";
import { tailorResume } from "../services/resumeTailor";
import type { ResumeStructure } from "../types/resume";

const OUTPUT_DIR = path.join(process.cwd(), "output");

/**
 * Manual render/tailor test harness.
 *
 *   npx tsx src/scripts/testRender.ts
 *
 * Test 1 (no API key needed): re-renders the most recent TailoredResume in the
 * database with the updated renderer -> output/test-resume-v2.pdf
 *
 * Test 2 (needs ANTHROPIC_API_KEY): re-runs the tailoring step from scratch
 * against the most recent Application, so the updated Claude prompt's bullet
 * quality can be inspected -> output/test-resume-v2-retailored.pdf
 */
async function testRenderLatestTailored(): Promise<void> {
  console.log("\n=== Test 1: re-render most recent TailoredResume ===");
  const latest = await prisma.tailoredResume.findFirst({
    orderBy: { createdAt: "desc" },
  });

  if (!latest) {
    console.log("No TailoredResume rows found — skipping.");
    return;
  }

  const resume = latest.tailoredContent as unknown as ResumeStructure;
  const pdf = await renderResumeToPdf(resume);
  const outPath = path.join(OUTPUT_DIR, "test-resume-v3.pdf");
  await writeFile(outPath, pdf);

  console.log(`TailoredResume ${latest.id} (created ${latest.createdAt.toISOString()})`);
  console.log(`Wrote ${pdf.length} bytes -> ${outPath}`);
}

async function testRetailorLatestApplication(): Promise<void> {
  console.log("\n=== Test 2: re-tailor most recent Application from scratch ===");

  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("ANTHROPIC_API_KEY not set — skipping live tailoring test.");
    return;
  }

  const application = await prisma.application.findFirst({
    orderBy: { createdAt: "desc" },
    include: { jobPosting: true },
  });

  if (!application) {
    console.log("No Application rows found — skipping.");
    return;
  }

  const baseResume = await prisma.baseResume.findFirst({
    where: { userId: application.userId },
    orderBy: { createdAt: "desc" },
  });

  if (!baseResume) {
    console.log("No BaseResume for that application's user — skipping.");
    return;
  }

  const posting = application.jobPosting;
  const jobDescription = [posting?.title, posting?.location, posting?.description]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join("\n");

  if (jobDescription.trim() === "") {
    console.log("That application's job posting has no description — skipping.");
    return;
  }

  console.log(
    `Application ${application.id} -> ${posting?.title ?? "Untitled"} (re-tailoring with updated prompt)…`
  );

  const baseContent = baseResume.content as unknown as ResumeStructure;
  const { resume, changes } = await tailorResume(baseContent, jobDescription);

  console.log(`\nClaude change note: ${changes}`);

  // Surface a few bullets so the new language rules can be eyeballed.
  const sampleBullets = resume.experience?.[0]?.bullets ?? [];
  if (sampleBullets.length > 0) {
    console.log("\nSample tailored bullets (first experience entry):");
    for (const b of sampleBullets) {
      console.log(`  • [${b.length} chars] ${b}`);
    }
  }

  const pdf = await renderResumeToPdf(resume);
  const outPath = path.join(OUTPUT_DIR, "test-resume-v3-retailored.pdf");
  await writeFile(outPath, pdf);
  console.log(`\nWrote ${pdf.length} bytes -> ${outPath}`);
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });
  await testRenderLatestTailored();
  await testRetailorLatestApplication();
}

main()
  .catch((err) => {
    console.error("testRender failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
