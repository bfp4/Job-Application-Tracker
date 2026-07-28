import PDFDocument from "pdfkit";

// Shared single-page PDF layout engine, used by the tailored-resume and
// cover-letter renderers. Both need the same thing: an ordered list of text
// blocks that must fit on one US Letter page, rendered with pdfkit's built-in
// fonts (no external font files, no headless browser) so it runs anywhere the
// API does — including the arm64 EC2 box.
//
// ONE-PAGE FIT: the document's total height is measured and font sizes +
// spacing are scaled down (shrink-to-fit) until everything fits. Nothing is
// dropped — over-long content comes out smaller, not truncated.

export const PAGE_MARGIN = 54; // 0.75"
export const COLOR_TEXT = "#111827";
export const COLOR_MUTED = "#6b7280";
export const COLOR_RULE = "#d1d5db";

// Don't shrink past this — below it the text stops being readable, and it's a
// signal the document is simply carrying too much content for one page.
const MIN_SCALE = 0.55;

export interface TextStyle {
  font: string;
  size: number;
  color: string;
  align?: "left" | "center" | "right";
  lineGap?: number;
  characterSpacing?: number;
}

/** A block of the document, expressed at scale 1.0. */
export type Block =
  | { kind: "text"; value: string; style: TextStyle }
  | { kind: "gap"; points: number }
  | { kind: "rule"; color: string };

/**
 * Lays the blocks out on a single US Letter page, shrinking to fit, and
 * resolves the PDF bytes as a Buffer.
 */
export function renderFittedPdf(blocks: Block[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "LETTER",
      margins: {
        top: PAGE_MARGIN,
        bottom: PAGE_MARGIN,
        left: PAGE_MARGIN,
        right: PAGE_MARGIN,
      },
    });

    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const left = doc.page.margins.left;
    const contentWidth =
      doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const available =
      doc.page.height - doc.page.margins.top - doc.page.margins.bottom;

    const textOptions = (block: Block & { kind: "text" }, scale: number) => ({
      width: contentWidth,
      align: block.style.align,
      lineGap: (block.style.lineGap ?? 0) * scale,
      characterSpacing: (block.style.characterSpacing ?? 0) * scale,
    });

    // Measure a block's height at a given scale. Font/size must be set before
    // heightOfString so it measures with the right metrics.
    const heightOf = (block: Block, scale: number): number => {
      if (block.kind === "gap") return block.points * scale;
      if (block.kind === "rule") return 0; // drawn on the current line; no advance
      doc.font(block.style.font).fontSize(block.style.size * scale);
      return doc.heightOfString(block.value, textOptions(block, scale));
    };

    const totalHeight = (scale: number): number =>
      blocks.reduce((sum, b) => sum + heightOf(b, scale), 0);

    const scale = fitScale(totalHeight, available);

    // Draw. A tiny epsilon guards against a last-block rounding overflow forcing
    // a second page; at the fitted scale this never trims visible content.
    const bottom = doc.page.height - doc.page.margins.bottom + 0.5;
    for (const block of blocks) {
      if (block.kind === "gap") {
        doc.y += block.points * scale;
        continue;
      }
      if (block.kind === "rule") {
        const y = doc.y;
        doc
          .save()
          .strokeColor(block.color)
          .lineWidth(0.75)
          .moveTo(left, y)
          .lineTo(left + contentWidth, y)
          .stroke()
          .restore();
        continue;
      }
      doc
        .font(block.style.font)
        .fontSize(block.style.size * scale)
        .fillColor(block.style.color);
      const options = textOptions(block, scale);
      const h = doc.heightOfString(block.value, options);
      if (doc.y + h > bottom) break; // unreachable at the fitted scale; hard backstop
      doc.text(block.value, left, doc.y, options);
    }

    doc.end();
  });
}

/**
 * Largest scale in [MIN_SCALE, 1] whose laid-out height fits `available`.
 * Height decreases as scale decreases, so a binary search finds the best fit.
 */
function fitScale(
  totalHeight: (scale: number) => number,
  available: number
): number {
  if (totalHeight(1) <= available) return 1;
  if (totalHeight(MIN_SCALE) > available) return MIN_SCALE;

  let lo = MIN_SCALE; // known to fit
  let hi = 1; // known not to fit
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (totalHeight(mid) <= available) lo = mid;
    else hi = mid;
  }
  return lo;
}
