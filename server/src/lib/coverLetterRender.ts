import type { CoverLetterContent } from "../services/coverLetter";
import {
  COLOR_MUTED,
  COLOR_RULE,
  COLOR_TEXT,
  renderFittedPdf,
  type Block,
} from "./pdfLayout";

// One house cover-letter template: a standard business letter (letterhead,
// date, addressee block, salutation, body, sign-off). Layout, shrink-to-fit,
// and the one-page cap live in lib/pdfLayout.ts; this module only decides what
// blocks a letter is made of. KEEP the shape it reads in sync with
// CoverLetterContent.

/**
 * Renders a cover letter to a single-page PDF and resolves the bytes as a
 * Buffer. The date is stamped at render time — a letter downloaded today is
 * dated today, regardless of when the draft was generated.
 */
export function renderCoverLetterPdf(
  content: CoverLetterContent,
  now: Date = new Date()
): Promise<Buffer> {
  return renderFittedPdf(buildBlocks(content, now));
}

/** Flattens a letter into the ordered block list the renderer measures + draws. */
function buildBlocks(content: CoverLetterContent, now: Date): Block[] {
  const blocks: Block[] = [];

  blocks.push({
    kind: "text",
    value: content.header.name,
    style: { font: "Helvetica-Bold", size: 18, color: COLOR_TEXT },
  });

  const contact = content.header.contact.filter((c) => c.trim().length > 0);
  if (contact.length > 0) {
    blocks.push({ kind: "gap", points: 4 });
    blocks.push({
      kind: "text",
      value: contact.join("  ·  "),
      style: { font: "Helvetica", size: 9.5, color: COLOR_MUTED },
    });
  }

  blocks.push({ kind: "gap", points: 8 });
  blocks.push({ kind: "rule", color: COLOR_RULE });
  blocks.push({ kind: "gap", points: 14 });

  blocks.push({
    kind: "text",
    value: formatLetterDate(now),
    style: { font: "Helvetica", size: 10, color: COLOR_MUTED },
  });

  // Addressee block. Every line is optional — the model leaves a field null
  // rather than guessing a name the posting never gave.
  const recipientLines = [
    content.recipient.name,
    content.recipient.title,
    content.recipient.company,
  ]
    .map((line) => line?.trim() ?? "")
    .filter((line) => line.length > 0);

  if (recipientLines.length > 0) {
    blocks.push({ kind: "gap", points: 12 });
    blocks.push({
      kind: "text",
      value: recipientLines.join("\n"),
      style: { font: "Helvetica", size: 10, color: COLOR_TEXT, lineGap: 1.5 },
    });
  }

  blocks.push({ kind: "gap", points: 16 });
  blocks.push({
    kind: "text",
    value: content.greeting.trim(),
    style: { font: "Helvetica", size: 10.5, color: COLOR_TEXT },
  });

  for (const paragraph of content.paragraphs) {
    const text = paragraph.trim();
    if (text.length === 0) continue;
    blocks.push({ kind: "gap", points: 11 });
    blocks.push({
      kind: "text",
      value: text,
      style: { font: "Helvetica", size: 10.5, color: COLOR_TEXT, lineGap: 3 },
    });
  }

  blocks.push({ kind: "gap", points: 16 });
  blocks.push({
    kind: "text",
    value: content.closing.trim(),
    style: { font: "Helvetica", size: 10.5, color: COLOR_TEXT },
  });
  blocks.push({ kind: "gap", points: 14 });
  blocks.push({
    kind: "text",
    value: content.signature.trim(),
    style: { font: "Helvetica-Bold", size: 10.5, color: COLOR_TEXT },
  });

  return blocks;
}

/** "July 27, 2026" — the conventional US business-letter date. */
export function formatLetterDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}
