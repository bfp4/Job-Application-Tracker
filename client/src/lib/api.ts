import { auth, getAppCheckToken } from "@/lib/firebase";
import { notifyAiUsage } from "@/lib/aiUsageEvents";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000";

// POST-only path suffixes for the 5 AI-generation endpoints (resume tips,
// tailored resume, cover letter, question answer, connect message). Matched
// by suffix + method so e.g. PATCH .../tailored-resume (saving an edit, not
// generating) doesn't false-positive.
const AI_GENERATION_PATH_SUFFIXES = [
  "/resume-tips",
  "/tailored-resume",
  "/cover-letter",
  "/answer",
  "/connect-message",
];

function isAiGenerationRequest(url: string, method: string | undefined): boolean {
  if ((method ?? "GET").toUpperCase() !== "POST") return false;
  const path = url.split("?")[0];
  return AI_GENERATION_PATH_SUFFIXES.some((suffix) => path.endsWith(suffix));
}

/**
 * Wrapper around fetch that automatically attaches the current Firebase user's
 * ID token as an `Authorization: Bearer <token>` header.
 *
 * `url` may be an absolute URL or a path (e.g. "/api/applications"), in which
 * case it is resolved against NEXT_PUBLIC_API_URL.
 */
export async function apiFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = auth.currentUser ? await auth.currentUser.getIdToken() : null;
  const appCheckToken = await getAppCheckToken();

  const headers = new Headers(options.headers);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  if (appCheckToken) {
    headers.set("X-Firebase-AppCheck", appCheckToken);
  }
  if (
    options.body !== undefined &&
    !(options.body instanceof FormData) &&
    !headers.has("Content-Type")
  ) {
    headers.set("Content-Type", "application/json");
  }

  const resolvedUrl = /^https?:\/\//i.test(url)
    ? url
    : `${API_BASE_URL}${url.startsWith("/") ? url : `/${url}`}`;

  const response = await fetch(resolvedUrl, { ...options, headers });

  // Every settled AI-generation request, not only a successful one. A failure
  // raised after Claude already answered — a refusal, a max_tokens truncation,
  // a write that fails once the tokens are spent — deliberately keeps its
  // quota reservation (see releaseAiCallOnFailure on the server), so gating
  // this on `ok` left the badge under-reporting until the next navigation
  // aged the cached row out. The listener re-reads the authoritative count
  // from /api/user/me, so notifying for a request that turned out to cost
  // nothing (a 404, a 409, a refunded transport error) is one wasted GET
  // rather than a wrong number.
  if (isAiGenerationRequest(url, options.method)) {
    notifyAiUsage();
  }

  return response;
}

/** Parses a JSON response, throwing with the server's error message on failure. */
export async function apiJson<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await apiFetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error ?? `Request failed with status ${response.status}`);
  }
  return data as T;
}
