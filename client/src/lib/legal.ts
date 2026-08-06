/**
 * Facts the Privacy Policy and Terms both state, in one place so the two
 * documents can never disagree with each other.
 *
 * If any value below is ever reset to a PLACEHOLDER, both legal pages render a
 * visible draft banner (LegalPage) rather than quietly publishing a document
 * with a blank in it.
 */

/** Marks a value that is not yet real. Kept as a prefix so it is greppable. */
export const PLACEHOLDER = "[FILL IN]";

/**
 * The sender's physical postal address.
 *
 * Also required in every marketing email under CAN-SPAM §7704(a)(5) — but the
 * email's copy lives in the Lambda's MAILING_ADDRESS environment variable
 * (set from SSM by infra/09-lambda.sh), not here, because the two deploy
 * separately. Keep them the same address.
 */
export const MAILING_ADDRESS = "421 Hudson Ave, Albany, NY 12203";

/** The US state whose law governs the Terms and where disputes are heard. */
export const GOVERNING_STATE = "New York";

/** Where privacy, deletion, and legal requests go. */
export const CONTACT_EMAIL = "arilevertonswe+jbsupport@gmail.com";

/** The name the service is operated under. */
export const SERVICE_NAME = "JobTracker";

/**
 * Shown as "Last updated" on both documents. Bump this whenever either
 * document changes in substance.
 */
export const LEGAL_LAST_UPDATED = "August 6, 2026";

/** True while any value above is still a placeholder. */
export function hasUnfilledPlaceholders(): boolean {
  return [MAILING_ADDRESS, GOVERNING_STATE].some((value) =>
    value.includes(PLACEHOLDER)
  );
}
