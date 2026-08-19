/**
 * Helpers shared by the board integrations. Most boards hand back their
 * description as HTML and don't carry a display name for the company, so the
 * same two conversions are needed by every provider that isn't Ashby.
 */

/**
 * Turns an HTML fragment into readable plain text: block boundaries become
 * line breaks, every other tag is dropped, and entities in the remaining text
 * are decoded. Input must be *real* HTML — a provider that escapes its HTML
 * (Greenhouse) has to {@link decodeEntities} once before calling this.
 */
export function htmlToPlainText(html: string | undefined | null): string {
  if (!html) return "";

  const stripped = html
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\/\s*(p|div|li|ul|ol|h[1-6]|tr|table)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "");

  return decodeEntities(stripped)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Decodes the small set of HTML entities board descriptions actually use. */
export function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;|&#x0*27;/gi, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#0*160;/g, " ")
    .replace(/&#(\d+);/g, (_, d) => safeCodePoint(parseInt(d, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeCodePoint(parseInt(h, 16)))
    // Ampersand last so we don't re-trigger the named entities above.
    .replace(/&amp;/g, "&");
}

function safeCodePoint(code: number): string {
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

/**
 * Derives a readable company name from a board/tenant slug
 * (`acme-corp` -> `Acme Corp`) for the providers that don't return one. It's a
 * prefill the user can correct in the form, not an authoritative name.
 */
export function companyNameFromSlug(slug: string): string {
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
