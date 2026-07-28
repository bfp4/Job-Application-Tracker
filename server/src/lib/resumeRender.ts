import type { TailoredResumeContent } from "../services/tailoredResume";
import {
  COLOR_MUTED,
  COLOR_RULE,
  COLOR_TEXT,
  renderFittedPdf,
  type Block,
} from "./pdfLayout";

// One house resume template. Layout, shrink-to-fit, and the one-page cap live
// in lib/pdfLayout.ts; this module only decides what blocks a resume is made
// of. KEEP the shape it reads in sync with TailoredResumeContent.

/**
 * Renders a tailored resume to a single-page PDF and resolves the bytes as a
 * Buffer. Only the `after` text of each bullet is rendered — `before` exists
 * for the on-screen diff, not the finished document.
 */
export function renderTailoredResumePdf(
  content: TailoredResumeContent
): Promise<Buffer> {
  return renderFittedPdf(buildBlocks(content));
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
