import PDFDocument from "pdfkit";
import type { TailoredResumeContent } from "../services/tailoredResume";

// One house template, rendered with pdfkit's built-in fonts (no external font
// files, no headless browser) so it runs anywhere the API does — including the
// arm64 EC2 box. KEEP the shape it reads in sync with TailoredResumeContent.
//
// ONE-PAGE FIT: the resume is laid out as an ordered list of blocks, its total
// height is measured, and font sizes + spacing are scaled down (shrink-to-fit)
// until everything fits on a single page. Nothing is dropped — an over-long
// resume comes out smaller, not truncated.

const PAGE_MARGIN = 54; // 0.75"
const COLOR_TEXT = "#111827";
const COLOR_MUTED = "#6b7280";
const COLOR_RULE = "#d1d5db";

// Don't shrink past this — below it the text stops being readable, and it's a
// signal the resume is simply carrying too much content for one page.
const MIN_SCALE = 0.55;

interface TextStyle {
  font: string;
  size: number;
  color: string;
  align?: "left" | "center" | "right";
  lineGap?: number;
  characterSpacing?: number;
}

// A block of the resume, expressed at scale 1.0. Rendering multiplies every
// size/length by the chosen fit scale.
type Block =
  | { kind: "text"; value: string; style: TextStyle }
  | { kind: "gap"; points: number }
  | { kind: "rule"; color: string };

/**
 * Renders a tailored resume to a single-page PDF and resolves the bytes as a
 * Buffer. Only the `after` text of each bullet is rendered — `before` exists
 * for the on-screen diff, not the finished document.
 */
export function renderTailoredResumePdf(
  content: TailoredResumeContent
): Promise<Buffer> {
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

    const blocks = buildBlocks(content);

    // Measure a block's height at a given scale. Font/size must be set before
    // heightOfString so it measures with the right metrics.
    const heightOf = (block: Block, scale: number): number => {
      if (block.kind === "gap") return block.points * scale;
      if (block.kind === "rule") return 0; // drawn on the current line; no advance
      doc.font(block.style.font).fontSize(block.style.size * scale);
      return doc.heightOfString(block.value, {
        width: contentWidth,
        align: block.style.align,
        lineGap: (block.style.lineGap ?? 0) * scale,
        characterSpacing: (block.style.characterSpacing ?? 0) * scale,
      });
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
      doc.font(block.style.font).fontSize(block.style.size * scale).fillColor(block.style.color);
      const h = doc.heightOfString(block.value, {
        width: contentWidth,
        align: block.style.align,
        lineGap: (block.style.lineGap ?? 0) * scale,
        characterSpacing: (block.style.characterSpacing ?? 0) * scale,
      });
      if (doc.y + h > bottom) break; // unreachable at the fitted scale; hard backstop
      doc.text(block.value, left, doc.y, {
        width: contentWidth,
        align: block.style.align,
        lineGap: (block.style.lineGap ?? 0) * scale,
        characterSpacing: (block.style.characterSpacing ?? 0) * scale,
      });
    }

    doc.end();
  });
}

/**
 * Largest scale in [MIN_SCALE, 1] whose laid-out height fits `available`.
 * Height decreases as scale decreases, so a binary search finds the best fit.
 */
function fitScale(totalHeight: (scale: number) => number, available: number): number {
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

/** Flattens a resume into the ordered block list the renderer measures + draws. */
function buildBlocks(content: TailoredResumeContent): Block[] {
  const blocks: Block[] = [];

  blocks.push({
    kind: "text",
    value: content.header.name,
    style: { font: "Helvetica-Bold", size: 20, color: COLOR_TEXT, align: "center" },
  });

  const contact = content.header.contact.filter((c) => c.trim().length > 0);
  if (contact.length > 0) {
    blocks.push({ kind: "gap", points: 4 });
    blocks.push({
      kind: "text",
      value: contact.join("  ·  "),
      style: { font: "Helvetica", size: 9.5, color: COLOR_MUTED, align: "center" },
    });
  }

  blocks.push({ kind: "gap", points: 8 });
  blocks.push({ kind: "rule", color: COLOR_RULE });
  blocks.push({ kind: "gap", points: 8 });

  if (content.summary && content.summary.trim().length > 0) {
    blocks.push({
      kind: "text",
      value: content.summary.trim(),
      style: { font: "Helvetica", size: 10, color: COLOR_TEXT, lineGap: 2 },
    });
    blocks.push({ kind: "gap", points: 10 });
  }

  for (const section of content.sections) {
    blocks.push({ kind: "gap", points: 6 });
    blocks.push({
      kind: "text",
      value: section.title.toUpperCase(),
      style: { font: "Helvetica-Bold", size: 11.5, color: COLOR_TEXT, characterSpacing: 0.5 },
    });
    blocks.push({ kind: "gap", points: 3 });
    blocks.push({ kind: "rule", color: COLOR_RULE });
    blocks.push({ kind: "gap", points: 5 });

    for (const entry of section.entries) {
      if (entry.heading && entry.heading.trim().length > 0) {
        blocks.push({ kind: "gap", points: 4 });
        blocks.push({
          kind: "text",
          value: entry.heading.trim(),
          style: { font: "Helvetica-Bold", size: 10.5, color: COLOR_TEXT },
        });
        blocks.push({ kind: "gap", points: 2 });
      }

      for (const bullet of entry.bullets) {
        const text = bullet.after.trim();
        if (text.length === 0) continue;
        blocks.push({ kind: "gap", points: 2 });
        blocks.push({
          kind: "text",
          value: `•  ${text}`,
          style: { font: "Helvetica", size: 10, color: COLOR_TEXT, lineGap: 1.5 },
        });
      }
    }
  }

  return blocks;
}
