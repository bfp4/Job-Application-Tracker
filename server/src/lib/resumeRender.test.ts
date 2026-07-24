import { describe, expect, it } from "vitest";
import { renderTailoredResumePdf } from "./resumeRender";
import { makeTailoredContent } from "../test-helpers/fixtures";
import type { TailoredResumeContent } from "../services/tailoredResume";

/** Counts page objects in a PDF (excludes the /Pages tree node and /PageN refs). */
function countPages(pdf: Buffer): number {
  const matches = pdf.toString("latin1").match(/\/Type\s*\/Page(?![sR])/g);
  return matches ? matches.length : 0;
}

describe("renderTailoredResumePdf", () => {
  it("produces a non-empty PDF with the right magic bytes", async () => {
    const pdf = await renderTailoredResumePdf(
      makeTailoredContent() as unknown as TailoredResumeContent
    );

    expect(pdf.length).toBeGreaterThan(0);
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("shrinks a realistic full-length resume onto one page (no truncation)", async () => {
    // Roughly the content that previously overflowed and got cut off: summary,
    // a 5-group skills section, three jobs with several bullets each, plus
    // projects and education. Shrink-to-fit must keep it all on one page.
    const content = {
      header: {
        name: "Ari Leverton",
        contact: [
          "New York, NY",
          "(609) 508-6343",
          "ari@example.com",
          "linkedin.com/in/ari",
          "github.com/ari",
        ],
      },
      summary:
        "Full-stack engineer skilled in React, TypeScript, and PostgreSQL, with internship experience building data-driven analytics dashboards for enterprise clients. Comfortable across the stack from REST API design to modern TypeScript UI development.",
      sections: [
        {
          title: "Technical Skills",
          entries: [
            { heading: "Languages", bullets: [{ before: null, after: "JavaScript, TypeScript, Python, Java, HTML, CSS" }] },
            { heading: "Frontend", bullets: [{ before: null, after: "React, Redux, Next.js, Tailwind CSS, React Native" }] },
            { heading: "Backend", bullets: [{ before: null, after: "Node.js, Express, REST APIs, Firebase, Prisma" }] },
            { heading: "Databases", bullets: [{ before: null, after: "PostgreSQL, Firestore, MongoDB" }] },
            { heading: "Tools", bullets: [{ before: null, after: "Git, GitHub Actions, Azure DevOps, Puppeteer, Amplitude, GA4" }] },
          ],
        },
        {
          title: "Work Experience",
          entries: [
            {
              heading: "Cyabra — Fullstack Engineer Intern, Aug 2025 – Dec 2025",
              bullets: [
                { before: null, after: "Built a data-analysis-driven analytics dashboard in React (TypeScript) with Next.js, visualizing account data via Recharts and a TanStack Table grid." },
                { before: null, after: "Implemented TanStack Query fetching across millions of accounts and a custom API endpoint powering advanced search." },
                { before: null, after: "Engineered a client-facing CSV upload pipeline processing 1,000+ profiles per upload with Zod validation." },
                { before: null, after: "Resolved critical React bugs in white-label deployments, protecting 10+ high-value client relationships." },
              ],
            },
            {
              heading: "Rewire Group — Fullstack Engineer Intern, Nov 2023 – Jul 2025",
              bullets: [
                { before: null, after: "Built the core energy-monitoring dashboard using reusable React/TypeScript components with Redux Toolkit and Tailwind CSS." },
                { before: null, after: "Unified user identity across Amplitude and GA4 and built a typed event-tracking abstraction, fixing a duplicate-GUID bug." },
                { before: null, after: "Led a codebase-wide TypeScript refactor across 100+ files and contributed reusable form components." },
              ],
            },
            {
              heading: "Pongspace — Website Manager Intern, Jul 2022 – Aug 2022",
              bullets: [
                { before: null, after: "Automated venue data entry with Node.js and Puppeteer, de-duplicating thousands of records." },
              ],
            },
          ],
        },
        {
          title: "Project Experience",
          entries: [
            {
              heading: "Job Application Tracker",
              bullets: [
                { before: null, after: "Built a full-stack job tracker with Next.js, Express, Prisma, and PostgreSQL deployed on AWS." },
                { before: null, after: "Implemented Firebase auth, S3 uploads, and a daily reminder Lambda with SES email." },
              ],
            },
          ],
        },
        {
          title: "Education",
          entries: [
            {
              heading: "B.S. Computer Science — SUNY, 2023",
              bullets: [{ before: null, after: "Coursework: Algorithms, Software Engineering, Database Systems." }],
            },
          ],
        },
      ],
      changeNote: "test",
    } as unknown as TailoredResumeContent;

    const pdf = await renderTailoredResumePdf(content);

    expect(countPages(pdf)).toBe(1);
  });

  it("hard-caps at a single page even for wildly over-length content", async () => {
    const sections = Array.from({ length: 8 }, (_, s) => ({
      title: `Section ${s + 1}`,
      entries: Array.from({ length: 4 }, (_, e) => ({
        heading: `Role ${e + 1} @ Company ${e + 1} · 2020–2024`,
        bullets: Array.from({ length: 5 }, (_, b) => ({
          before: null,
          after: `Bullet ${b + 1}: ${"delivered measurable impact across systems ".repeat(4)}`,
        })),
      })),
    }));

    const pdf = await renderTailoredResumePdf({
      header: { name: "Ada Lovelace", contact: ["ada@example.com"] },
      summary: "A very long summary. ".repeat(30),
      sections,
      changeNote: "test",
    } as unknown as TailoredResumeContent);

    expect(countPages(pdf)).toBe(1);
  });

  it("renders when optional fields are empty (null summary, no contact/heading)", async () => {
    const content = makeTailoredContent({
      summary: null,
      header: { name: "Ada Lovelace", contact: [] },
      sections: [
        {
          title: "Skills",
          entries: [{ heading: null, bullets: [{ before: null, after: "TypeScript" }] }],
        },
      ],
    }) as unknown as TailoredResumeContent;

    const pdf = await renderTailoredResumePdf(content);

    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });
});
