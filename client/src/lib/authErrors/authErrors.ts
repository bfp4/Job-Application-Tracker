/** Password policy: at least 8 chars, one uppercase letter, one special char. */
export const PASSWORD_RULES = [
  { test: (p: string) => p.length >= 8, label: "At least 8 characters" },
  { test: (p: string) => /[A-Z]/.test(p), label: "One uppercase letter" },
  {
    test: (p: string) => /[^A-Za-z0-9]/.test(p),
    label: "One special character",
  },
] as const;

/** Returns null when the password meets every rule, otherwise the first miss. */
export function validatePassword(password: string): string | null {
  const failed = PASSWORD_RULES.find((rule) => !rule.test(password));
  return failed ? `Password needs: ${failed.label.toLowerCase()}.` : null;
}

function errorCode(err: unknown): string {
  return typeof err === "object" && err !== null && "code" in err
    ? String((err as { code: unknown }).code)
    : "";
}

const BAD_CREDENTIAL_CODES = [
  "auth/invalid-credential",
  "auth/wrong-password",
  "auth/user-not-found",
];

/**
 * True when a sign-in failed because the email/password pair was rejected. The
 * UI uses this to offer the reset flow, which is also the only way out for
 * someone who signed up with Google and so has no password at all.
 */
export function isBadCredentialError(err: unknown): boolean {
  return BAD_CREDENTIAL_CODES.includes(errorCode(err));
}

/** Maps raw Firebase auth error codes to friendly, non-leaky copy. */
export function friendlyAuthError(err: unknown, fallback: string): string {
  const code = errorCode(err);

  switch (code) {
    case "auth/email-already-in-use":
      return "An account with this email already exists.";
    case "auth/invalid-email":
      return "That doesn't look like a valid email address.";
    case "auth/weak-password":
      return "Please choose a stronger password.";
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Incorrect email or password.";
    case "auth/too-many-requests":
      return "Too many attempts. Please wait a moment and try again.";
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return "Sign-in was cancelled.";
    case "auth/popup-blocked":
      return "Your browser blocked the sign-in popup. Allow popups and try again.";
    case "auth/user-disabled":
      return "This account has been disabled.";
    case "auth/requires-recent-login":
      return "For your security, please sign in again before changing your password.";
    case "auth/user-mismatch":
      return "That account doesn't match the one you're signed in as.";
    case "auth/network-request-failed":
      return "Network error. Check your connection and try again.";
    default:
      return fallback;
  }
}
