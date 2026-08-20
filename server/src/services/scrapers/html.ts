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

/**
 * Matches an embedded base64 data URI, with the square brackets Ashby wraps
 * them in when it flattens an `<img>` into plain text.
 *
 * Two deliberate limits: the payload charset excludes whitespace, so a
 * malformed blob can't swallow the rest of the description; and the surrounding
 * whitespace is left in place, so an image on its own line leaves blank lines
 * for the collapse in {@link stripDataUris} to tidy, while one sitting
 * mid-sentence can't weld its neighbours together ("A [img] B" must not become
 * "AB").
 */
const BASE64_DATA_URI =
  /\[?data:[a-z0-9.+-]+\/[a-z0-9.+-]+(?:;[a-z0-9.+-]+=[^;,\s]*)*;base64,[a-z0-9+/=]+\]?/gi;

/**
 * Strips embedded images out of a description.
 *
 * Providers that hand back pre-flattened plain text don't remove inline images
 * — they inline the whole file as a base64 data URI. One real Ashby posting
 * carried a 229KB PNG inside a 2.8KB description. That bloats the stored row,
 * and every AI feature (tailored resume, cover letter, resume tips) sends the
 * description to the model, so the blob would be paid for on each call while
 * crowding out the actual posting text.
 *
 * Providers that return HTML don't need this: {@link htmlToPlainText} drops
 * whole tags, so an `<img src="data:...">` disappears with the tag itself.
 *
 * Blank lines left behind by the removal are collapsed, so a stripped image
 * leaves no visible gap.
 */
export function stripDataUris(text: string): string {
  return text
    .replace(BASE64_DATA_URI, "")
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
