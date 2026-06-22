import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { ResumeStructure, ResumeSkills } from "../types/resume";

// US Letter, 0.75 inch margins.
const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 54;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const CENTER_X = PAGE_WIDTH / 2;

// Fixed font sizes (Harvard Career Services template proportions). Only the
// bullet text size flexes during single-page auto-shrink.
const NAME_SIZE = 18;
const CONTACT_SIZE = 8.5;
const SECTION_SIZE = 10.5;
const COMPANY_SIZE = 10;
const TITLE_SIZE = 10;
const DATE_SIZE = 9.5;
const BODY_SIZE = 10; // skills + education degree lines
const MIN_BULLET_SIZE = 7.5;

const LINE_FACTOR = 1.18;
const RULE_THICKNESS = 0.75;

// Bullet geometry: the glyph and the text each have a FIXED x position so the
// gap between them is always identical and never depends on string contents.
// The bullet glyph sits 10pt past the margin; text starts at a fixed 18pt past
// the margin (a clear, consistent ~one-space gap) and wrapped lines align under
// the text, not the bullet.
const BULLET_GLYPH_X = MARGIN + 10;
const BULLET_TEXT_X = MARGIN + 18;
const BULLET_TEXT_WIDTH = CONTENT_WIDTH - 18;

// Base spacing (points). Scaled down by the `spacing` factor during shrink.
const GAP_AFTER_HEADER_BLOCK = 10; // after name + contact + rule
const GAP_BETWEEN_SECTIONS = 10;
const GAP_BETWEEN_ENTRIES = 5;
const GAP_COMPANY_TO_BULLET = 3;
const GAP_BETWEEN_BULLETS = 2;
const GAP_AFTER_HEADER_RULE = 4;

const BLACK = rgb(0, 0, 0);

const SKILL_CATEGORIES: Array<{ key: keyof ResumeSkills; label: string }> = [
  { key: "languages", label: "Languages" },
  { key: "frontend", label: "Frontend" },
  { key: "backend", label: "Backend" },
  { key: "databases", label: "Databases" },
  { key: "tools", label: "Tools" },
];

interface LayoutParams {
  bulletSize: number;
  spacing: number; // multiplier applied to inter-element gaps
  includeLeadership: boolean;
}

/**
 * Replaces typographic punctuation with ASCII and drops characters that the
 * WinAnsi-encoded standard fonts cannot represent, so drawing never throws.
 */
function sanitize(text: string): string {
  return (text ?? "")
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ")
    .replace(/[^\x20-\x7E\xA1-\xFF]/g, "");
}

function wrapText(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number
): string[] {
  const words = sanitize(text).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current === "" || font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Removes any leading bullet markers or whitespace the model may have baked
 * into a bullet string (e.g. "• Built", "- Built", " Built"), so the renderer's
 * own fixed-position glyph is the only bullet and spacing stays consistent.
 */
function stripBulletPrefix(text: string): string {
  return (text ?? "").replace(/^[\s\u2022\u2023\u25AA\u25E6\u2043\u00B7*-]+/, "").trim();
}

function formatDateRange(start: string, end: string | null): string {
  const startClean = (start ?? "").trim();
  const endClean = (end ?? "").trim() || "Present";
  if (!startClean && !end) return "";
  if (!startClean) return endClean;
  return `${startClean} - ${endClean}`;
}

export async function renderResumeToPdf(
  resume: ResumeStructure
): Promise<Buffer> {
  try {
    const doc = await PDFDocument.create();
    const regular = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const italic = await doc.embedFont(StandardFonts.HelveticaOblique);

    const info = resume.personalInfo ?? ({} as ResumeStructure["personalInfo"]);
    const contactParts = [
      info.location,
      info.phone,
      info.email,
      info.linkedin,
      info.github,
    ].filter((part): part is string => Boolean(part && part.trim()));

    const hasSkills =
      !!resume.skills &&
      SKILL_CATEGORIES.some(({ key }) => (resume.skills[key] ?? []).length > 0);

    /**
     * Runs a full layout pass. When `page` is null the pass only advances the
     * cursor (measurement); when a page is provided it also draws. Returns the
     * final y position so callers can check whether the content fit on one page.
     */
    function layout(params: LayoutParams, page: PDFPage | null): number {
      const draw = page !== null;
      const { bulletSize, spacing } = params;
      let y = PAGE_HEIGHT - MARGIN;

      const gap = (value: number): void => {
        y -= value * spacing;
      };

      function lineCentered(
        text: string,
        size: number,
        font: PDFFont
      ): void {
        const clean = sanitize(text);
        const width = font.widthOfTextAtSize(clean, size);
        if (draw) {
          page!.drawText(clean, {
            x: CENTER_X - width / 2,
            y: y - size,
            size,
            font,
            color: BLACK,
          });
        }
        y -= size * LINE_FACTOR;
      }

      function lineLeft(
        text: string,
        x: number,
        size: number,
        font: PDFFont
      ): void {
        if (draw) {
          page!.drawText(sanitize(text), { x, y: y - size, size, font, color: BLACK });
        }
        y -= size * LINE_FACTOR;
      }

      function fullRule(): void {
        if (draw) {
          page!.drawLine({
            start: { x: MARGIN, y: y - 1 },
            end: { x: MARGIN + CONTENT_WIDTH, y: y - 1 },
            thickness: RULE_THICKNESS,
            color: BLACK,
          });
        }
        y -= RULE_THICKNESS + 1;
      }

      function sectionHeader(title: string): void {
        gap(GAP_BETWEEN_SECTIONS);
        const baseline = y - SECTION_SIZE;
        if (draw) {
          page!.drawText(sanitize(title.toUpperCase()), {
            x: MARGIN,
            y: baseline,
            size: SECTION_SIZE,
            font: bold,
            color: BLACK,
          });
        }
        y -= SECTION_SIZE * LINE_FACTOR;
        fullRule();
        gap(GAP_AFTER_HEADER_RULE);
      }

      // Bold left text + regular right-aligned text sharing one baseline.
      function rowLeftRight(
        left: string,
        leftFont: PDFFont,
        leftSize: number,
        right: string,
        rightSize: number
      ): void {
        const baseline = y - leftSize;
        const rightClean = sanitize(right);
        const rightWidth = rightClean
          ? regular.widthOfTextAtSize(rightClean, rightSize)
          : 0;
        const leftMax = CONTENT_WIDTH - rightWidth - (rightClean ? 8 : 0);
        const leftLines = wrapText(left, leftFont, leftSize, leftMax);

        if (draw) {
          page!.drawText(leftLines[0] ?? "", {
            x: MARGIN,
            y: baseline,
            size: leftSize,
            font: leftFont,
            color: BLACK,
          });
          if (rightClean) {
            page!.drawText(rightClean, {
              x: MARGIN + CONTENT_WIDTH - rightWidth,
              y: baseline,
              size: rightSize,
              font: regular,
              color: BLACK,
            });
          }
        }
        y -= leftSize * LINE_FACTOR;
        for (let i = 1; i < leftLines.length; i++) {
          lineLeft(leftLines[i], MARGIN, leftSize, leftFont);
        }
      }

      function bullet(text: string, size: number): void {
        const lines = wrapText(stripBulletPrefix(text), regular, size, BULLET_TEXT_WIDTH);
        lines.forEach((line, i) => {
          const baseline = y - size;
          if (draw) {
            if (i === 0) {
              page!.drawText("\u2022", {
                x: BULLET_GLYPH_X,
                y: baseline,
                size,
                font: regular,
                color: BLACK,
              });
            }
            page!.drawText(line, {
              x: BULLET_TEXT_X,
              y: baseline,
              size,
              font: regular,
              color: BLACK,
            });
          }
          y -= size * LINE_FACTOR;
        });
      }

      function skillLine(label: string, value: string): void {
        const labelText = `${label}: `;
        const labelWidth = bold.widthOfTextAtSize(labelText, BODY_SIZE);
        const lines = wrapText(value, regular, BODY_SIZE, CONTENT_WIDTH - labelWidth);
        lines.forEach((line, i) => {
          const baseline = y - BODY_SIZE;
          if (draw) {
            if (i === 0) {
              page!.drawText(labelText, {
                x: MARGIN,
                y: baseline,
                size: BODY_SIZE,
                font: bold,
                color: BLACK,
              });
            }
            page!.drawText(line, {
              x: MARGIN + labelWidth,
              y: baseline,
              size: BODY_SIZE,
              font: regular,
              color: BLACK,
            });
          }
          y -= BODY_SIZE * LINE_FACTOR;
        });
      }

      function bulletBlock(bullets: string[]): void {
        (bullets ?? []).forEach((b, i) => {
          if (i > 0) gap(GAP_BETWEEN_BULLETS);
          bullet(b, bulletSize);
        });
      }

      // ---- Header (name + contact + rule) ----
      if (info.name) lineCentered(info.name, NAME_SIZE, bold);
      if (contactParts.length > 0) {
        for (const line of wrapText(
          contactParts.join(" | "),
          regular,
          CONTACT_SIZE,
          CONTENT_WIDTH
        )) {
          lineCentered(line, CONTACT_SIZE, regular);
        }
      }
      gap(2);
      fullRule();
      gap(GAP_AFTER_HEADER_BLOCK);

      // ---- Summary (only if present) ----
      if (resume.summary && resume.summary.trim()) {
        sectionHeader("Summary");
        for (const line of wrapText(resume.summary, regular, bulletSize, CONTENT_WIDTH)) {
          lineLeft(line, MARGIN, bulletSize, regular);
        }
      }

      // ---- Experience ----
      if (resume.experience?.length) {
        sectionHeader("Experience");
        resume.experience.forEach((exp, idx) => {
          if (idx > 0) gap(GAP_BETWEEN_ENTRIES);
          rowLeftRight(
            exp.company ?? "",
            bold,
            COMPANY_SIZE,
            formatDateRange(exp.startDate, exp.endDate),
            DATE_SIZE
          );
          if ((exp.title && exp.title.trim()) || (exp.location && exp.location.trim())) {
            rowLeftRight(exp.title ?? "", italic, TITLE_SIZE, exp.location ?? "", DATE_SIZE);
          }
          gap(GAP_COMPANY_TO_BULLET);
          bulletBlock(exp.bullets ?? []);
        });
      }

      // ---- Projects ----
      if (resume.projects?.length) {
        sectionHeader("Projects");
        resume.projects.forEach((project, idx) => {
          if (idx > 0) gap(GAP_BETWEEN_ENTRIES);
          const tech = (project.technologies ?? []).join(", ");
          const heading = tech ? `${project.name} - ${tech}` : project.name ?? "";
          for (const line of wrapText(heading, bold, COMPANY_SIZE, CONTENT_WIDTH)) {
            lineLeft(line, MARGIN, COMPANY_SIZE, bold);
          }
          gap(GAP_COMPANY_TO_BULLET);
          bulletBlock(project.bullets ?? []);
        });
      }

      // ---- Skills ----
      if (hasSkills) {
        sectionHeader("Skills");
        SKILL_CATEGORIES.forEach(({ key, label }) => {
          const values = resume.skills[key] ?? [];
          if (values.length > 0) skillLine(label, values.join(", "));
        });
      }

      // ---- Education ----
      if (resume.education?.length) {
        sectionHeader("Education");
        resume.education.forEach((edu, idx) => {
          if (idx > 0) gap(GAP_BETWEEN_ENTRIES);
          rowLeftRight(
            edu.institution ?? "",
            bold,
            COMPANY_SIZE,
            edu.graduationDate ?? "",
            DATE_SIZE
          );
          const degreeParts = [edu.degree, edu.field].filter(
            (p): p is string => Boolean(p && p.trim())
          );
          if (degreeParts.length > 0) {
            lineLeft(degreeParts.join(", "), MARGIN, BODY_SIZE, regular);
          }
        });
      }

      // ---- Leadership (first section dropped under heavy overflow) ----
      if (params.includeLeadership && resume.leadership?.length) {
        sectionHeader("Leadership");
        resume.leadership.forEach((lead, idx) => {
          if (idx > 0) gap(GAP_BETWEEN_ENTRIES);
          rowLeftRight(
            lead.organization ?? "",
            bold,
            COMPANY_SIZE,
            formatDateRange(lead.startDate, lead.endDate),
            DATE_SIZE
          );
          if (lead.role && lead.role.trim()) {
            lineLeft(lead.role, MARGIN, TITLE_SIZE, italic);
          }
          gap(GAP_COMPANY_TO_BULLET);
          bulletBlock(lead.bullets ?? []);
        });
      }

      return y;
    }

    // Build candidate configurations in priority order: shrink bullet text
    // first (full spacing), then tighten spacing at the minimum bullet size,
    // and only as a last resort drop the Leadership section.
    const bulletSteps = [10, 9.5, 9, 8.5, 8, MIN_BULLET_SIZE];
    const spacingSteps = [0.85, 0.7, 0.55];
    const candidates: LayoutParams[] = [];
    for (const includeLeadership of [true, false]) {
      for (const bulletSize of bulletSteps) {
        candidates.push({ bulletSize, spacing: 1, includeLeadership });
      }
      for (const spacing of spacingSteps) {
        candidates.push({ bulletSize: MIN_BULLET_SIZE, spacing, includeLeadership });
      }
    }

    let chosen: LayoutParams = candidates[candidates.length - 1];
    for (const candidate of candidates) {
      const finalY = layout(candidate, null);
      if (finalY >= MARGIN) {
        chosen = candidate;
        break;
      }
    }

    const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    layout(chosen, page);

    const bytes = await doc.save();
    return Buffer.from(bytes);
  } catch (err) {
    console.error("Failed to render resume PDF:", err);
    throw new Error("Failed to render resume PDF.");
  }
}
