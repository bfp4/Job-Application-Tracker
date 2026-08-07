import { describe, expect, it } from "vitest";
import { formatLetterDate, renderCoverLetterPdf } from "./coverLetterRender";
import { makeCoverLetterContent } from "../../test-helpers/fixtures";
import type { CoverLetterContent } from "../../services/agents/coverLetter/coverLetter";

/** Counts page objects in a PDF (excludes the /Pages tree node and /PageN refs). */
function countPages(pdf: Buffer): number {
  const matches = pdf.toString("latin1").match(/\/Type\s*\/Page(?![sR])/g);
  return matches ? matches.length : 0;
}

const content = () => makeCoverLetterContent() as unknown as CoverLetterContent;

describe("renderCoverLetterPdf", () => {
  it("produces a non-empty single-page PDF with the right magic bytes", async () => {
    const pdf = await renderCoverLetterPdf(content());

    expect(pdf.length).toBeGreaterThan(0);
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(countPages(pdf)).toBe(1);
  });

  it("hard-caps at a single page even for a wildly over-length letter", async () => {
    const overLong = makeCoverLetterContent({
      paragraphs: Array.from(
        { length: 12 },
        (_, i) => `Paragraph ${i + 1}. ${"I did a great many measurable things. ".repeat(12)}`
      ),
    }) as unknown as CoverLetterContent;

    expect(countPages(await renderCoverLetterPdf(overLong))).toBe(1);
  });

  it("renders when the posting named no recipient and the resume no contact lines", async () => {
    const sparse = makeCoverLetterContent({
      header: { name: "Ada Lovelace", contact: [] },
      recipient: { name: null, title: null, company: null },
    }) as unknown as CoverLetterContent;

    const pdf = await renderCoverLetterPdf(sparse);

    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("formats the stamped date as a US business letter date", () => {
    expect(formatLetterDate(new Date("2026-07-27T12:00:00Z"))).toBe("July 27, 2026");
  });
});
