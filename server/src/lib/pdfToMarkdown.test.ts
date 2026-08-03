import { describe, expect, it } from "vitest";
import PDFDocument from "pdfkit";
import {
  convertPdfToMarkdown,
  PdfParseTimeoutError,
  PDF_PARSE_TIMEOUT_MS,
} from "./pdfToMarkdown";

/** Builds a small real PDF containing the given lines of text. */
function makePdf(lines: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument();
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.fontSize(12);
    for (const line of lines) doc.text(line);
    doc.end();
  });
}

describe("convertPdfToMarkdown", () => {
  it("extracts text from a real PDF via the worker thread", async () => {
    const pdf = await makePdf(["Ari Leverton", "Full-stack engineer"]);

    const markdown = await convertPdfToMarkdown(pdf);

    expect(markdown).toContain("Ari Leverton");
    expect(markdown).toContain("Full-stack engineer");
  });

  it("rejects with PdfParseTimeoutError when the parse outruns its budget", async () => {
    const pdf = await makePdf(["anything at all"]);

    // 1ms is shorter than worker startup, so this always trips the timeout.
    await expect(convertPdfToMarkdown(pdf, 1)).rejects.toBeInstanceOf(
      PdfParseTimeoutError
    );
  });

  it("rejects rather than hanging when the buffer isn't a readable PDF", async () => {
    await expect(
      convertPdfToMarkdown(Buffer.from("%PDF-1.4 then garbage"), 5_000)
    ).rejects.toThrow();
  });

  it("keeps the event loop responsive while a PDF is being parsed", async () => {
    // The point of the worker: parsing must not block the main thread. A 300
    // page PDF takes long enough that a blocking parse would starve this timer.
    const pdf = await makePdf(Array.from({ length: 300 }, (_, i) => `Line ${i} of resume text`));

    let ticks = 0;
    const interval = setInterval(() => ticks++, 5);
    try {
      await convertPdfToMarkdown(pdf);
    } finally {
      clearInterval(interval);
    }

    expect(ticks).toBeGreaterThan(0);
  });

  it("defaults to a 20 second budget", () => {
    expect(PDF_PARSE_TIMEOUT_MS).toBe(20_000);
  });
});
