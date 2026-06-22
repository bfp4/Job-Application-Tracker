import { PDFParse } from "pdf-parse";
import { generateJson } from "../lib/anthropic";
import type { ResumeStructure } from "../types/resume";

/**
 * Lenient runtime guard for the ResumeStructure shape. Kept permissive so that
 * minor omissions by the model (e.g. an empty section) do not trigger a retry,
 * while still rejecting fundamentally wrong responses (arrays, strings, etc.).
 */
export function isResumeStructure(value: unknown): value is ResumeStructure {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.personalInfo === "object" &&
    v.personalInfo !== null &&
    Array.isArray(v.experience) &&
    Array.isArray(v.education) &&
    typeof v.skills === "object" &&
    v.skills !== null &&
    Array.isArray(v.projects) &&
    Array.isArray(v.leadership)
  );
}

/**
 * Extracts the raw text content from a PDF buffer using pdf-parse.
 */
export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result.text.trim();
  } finally {
    await parser.destroy();
  }
}

const PARSE_PROMPT = `You are a resume parser. Extract the following resume text into a structured JSON object with these exact fields:
{
  personalInfo: { name, email, phone, linkedin, github, location },
  summary: string | null,
  experience: Array<{
    company: string,
    title: string,
    location: string,
    startDate: string,
    endDate: string | null,
    bullets: string[]
  }>,
  education: Array<{
    institution: string,
    degree: string,
    field: string,
    graduationDate: string
  }>,
  skills: {
    languages: string[],
    frontend: string[],
    backend: string[],
    databases: string[],
    tools: string[]
  },
  projects: Array<{
    name: string,
    technologies: string[],
    bullets: string[]
  }>,
  leadership: Array<{
    organization: string,
    role: string,
    startDate: string,
    endDate: string | null,
    bullets: string[]
  }>
}
When extracting bullets from the experience, projects, and leadership sections, preserve them exactly as written — do not rephrase, improve, or summarize. The goal is faithful extraction, not rewriting.
Return ONLY valid JSON, no explanation, no markdown backticks.`;

/**
 * Sends raw resume text to Claude and returns a structured ResumeStructure.
 * Retries once on malformed output (handled inside generateJson).
 */
export async function parseResumeIntoStructure(
  rawText: string
): Promise<ResumeStructure> {
  const prompt = `${PARSE_PROMPT}\n\nResume text:\n${rawText}`;

  return generateJson<ResumeStructure>({
    prompt,
    maxTokens: 4096,
    validate: isResumeStructure,
  });
}
