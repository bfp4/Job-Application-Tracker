import { auth } from "@/lib/firebase";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000";

/**
 * Wrapper around fetch that automatically attaches the current Firebase user's
 * ID token as an `Authorization: Bearer <token>` header.
 *
 * `url` may be an absolute URL or a path (e.g. "/api/me"), in which case it is
 * resolved against NEXT_PUBLIC_API_URL.
 */
export async function apiFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = auth.currentUser
    ? await auth.currentUser.getIdToken()
    : null;

  const headers = new Headers(options.headers);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
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

  return fetch(resolvedUrl, { ...options, headers });
}
