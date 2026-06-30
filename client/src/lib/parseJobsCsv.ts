import type { ApplicationStatus } from "@/lib/types";
import { STATUS_META, STATUS_ORDER } from "@/lib/status";

export interface ParsedJobRow {
  companyName: string;
  title: string;
  location?: string | null;
  jobUrl?: string | null;
  description?: string | null;
  status?: ApplicationStatus;
  appliedDate?: string | null;
  notes?: string | null;
}

export interface CsvParseResult {
  jobs: ParsedJobRow[];
  errors: string[];
}

const HEADER_ALIASES: Record<string, keyof ParsedJobRow | "ignore"> = {
  company: "companyName",
  company_name: "companyName",
  "company name": "companyName",
  title: "title",
  job_title: "title",
  "job title": "title",
  role: "title",
  location: "location",
  job_url: "jobUrl",
  url: "jobUrl",
  link: "jobUrl",
  "job url": "jobUrl",
  status: "status",
  applied_date: "appliedDate",
  "applied date": "appliedDate",
  applied: "appliedDate",
  notes: "notes",
  description: "description",
};

const STATUS_BY_LABEL = Object.fromEntries(
  STATUS_ORDER.flatMap((status) => [
    [status.toLowerCase(), status],
    [STATUS_META[status].label.toLowerCase(), status],
    [STATUS_META[status].label.toLowerCase().replace(/\s+/g, "_"), status],
  ])
) as Record<string, ApplicationStatus>;

/** Parses a CSV file into job rows ready for bulk import. */
export function parseJobsCsv(text: string): CsvParseResult {
  const { rows, unclosedQuote } = parseCsvRows(text);
  const errors: string[] = [];
  const jobs: ParsedJobRow[] = [];

  if (unclosedQuote) {
    errors.push("CSV contains an unclosed quoted field — check for a missing closing quote.");
  }

  if (rows.length === 0) {
    return { jobs, errors: errors.length > 0 ? errors : ["CSV file is empty."] };
  }

  const [headerRow, ...dataRows] = rows;
  const columnMap = mapHeaders(headerRow);

  if (!columnMap.companyName) {
    errors.push('Missing required column: company (or "company_name").');
  }
  if (!columnMap.title) {
    errors.push('Missing required column: title (or "job_title").');
  }
  if (errors.length > 0) {
    return { jobs, errors };
  }

  dataRows.forEach((row, index) => {
    const rowNumber = index + 2;
    if (row.every((cell) => cell.trim() === "")) return;

    const companyName = getCell(row, columnMap.companyName!).trim();
    const title = getCell(row, columnMap.title!).trim();

    if (!companyName || !title) {
      errors.push(`Row ${rowNumber}: company and title are required.`);
      return;
    }

    const parsed: ParsedJobRow = { companyName, title };

    if (columnMap.location !== undefined) {
      const value = getCell(row, columnMap.location).trim();
      parsed.location = value || null;
    }
    if (columnMap.jobUrl !== undefined) {
      const value = getCell(row, columnMap.jobUrl).trim();
      parsed.jobUrl = value || null;
    }
    if (columnMap.description !== undefined) {
      const value = getCell(row, columnMap.description).trim();
      parsed.description = value || null;
    }
    if (columnMap.notes !== undefined) {
      const value = getCell(row, columnMap.notes).trim();
      parsed.notes = value || null;
    }
    if (columnMap.appliedDate !== undefined) {
      const value = getCell(row, columnMap.appliedDate).trim();
      if (value) {
        const normalized = normalizeDate(value);
        if (!normalized) {
          errors.push(`Row ${rowNumber}: invalid applied date "${value}".`);
          return;
        }
        parsed.appliedDate = normalized;
      }
    }
    if (columnMap.status !== undefined) {
      const value = getCell(row, columnMap.status).trim();
      if (value) {
        const status = parseStatus(value);
        if (!status) {
          errors.push(`Row ${rowNumber}: invalid status "${value}".`);
          return;
        }
        parsed.status = status;
      }
    }

    jobs.push(parsed);
  });

  if (jobs.length === 0 && errors.length === 0) {
    errors.push("No job rows found in CSV.");
  }

  return { jobs, errors };
}

export const JOBS_CSV_TEMPLATE = [
  "company,title,location,job_url,status,applied_date,notes",
  "Acme Corp,Software Engineer,Remote,https://example.com/jobs/1,APPLIED,2026-01-15,Referral from Alex",
  "Globex,Product Manager,New York,,NOT_APPLIED,,",
].join("\n");

function mapHeaders(headerRow: string[]) {
  const columnMap: Partial<Record<keyof ParsedJobRow, number>> = {};

  headerRow.forEach((header, index) => {
    const normalized = header.trim().toLowerCase();
    const field = HEADER_ALIASES[normalized];
    if (field && field !== "ignore") {
      columnMap[field] = index;
    }
  });

  return columnMap;
}

function getCell(row: string[], index: number): string {
  return row[index] ?? "";
}

function parseStatus(value: string): ApplicationStatus | null {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, "_");
  return STATUS_BY_LABEL[normalized] ?? STATUS_BY_LABEL[value.trim().toLowerCase()] ?? null;
}

function normalizeDate(value: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;

  // Use local date parts to avoid UTC offset shifting the date for UTC+ users.
  const y = parsed.getFullYear();
  const m = String(parsed.getMonth() + 1).padStart(2, "0");
  const d = String(parsed.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Minimal RFC 4180-style CSV row parser. */
function parseCsvRows(text: string): { rows: string[][]; unclosedQuote: boolean } {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char === "\r") {
      if (next === "\n") i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return { rows, unclosedQuote: inQuotes };
}
