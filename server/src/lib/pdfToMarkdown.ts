import pdf2md from "@opendocsg/pdf2md";

/**
 * Converts a PDF buffer into a Markdown string using pdf2md, preserving
 * headings/lists structure. Plain text extraction only — no LLM involved.
 */
export async function convertPdfToMarkdown(buffer: Buffer): Promise<string> {
  const markdown = await pdf2md(buffer);
  return markdown.trim();
}
