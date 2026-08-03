import type { UserTier } from "@/lib/types";

/**
 * Types and search filtering for the admin page's Requests tab. Lives here
 * rather than in the page component so it can be exercised directly, without
 * mounting the page and its Next.js/Firebase dependencies. Mirrors the
 * convention in lib/applicationList.ts.
 *
 * The Users tab has no equivalent here: it's paginated, so both its search
 * and its slicing happen server-side (GET /api/admin/users) — filtering the
 * loaded array would only ever search the page currently on screen.
 */

export interface AdminUser {
  id: string;
  email: string;
  tier: UserTier;
  createdAt: string;
  /** null for PREMIUM/ADMIN (unlimited). */
  aiCallsRemaining: number | null;
  hasPendingPremiumRequest: boolean;
}

export interface AdminPremiumRequest {
  id: string;
  message: string;
  createdAt: string;
  user: { id: string; email: string };
}

/** `query` is expected pre-trimmed and lowercased by the caller. */
export function matchesRequestSearch(request: AdminPremiumRequest, query: string): boolean {
  return (
    request.user.email.toLowerCase().includes(query) ||
    request.message.toLowerCase().includes(query)
  );
}

export function visibleRequests(
  requests: AdminPremiumRequest[],
  search: string
): AdminPremiumRequest[] {
  const query = search.trim().toLowerCase();
  return query ? requests.filter((r) => matchesRequestSearch(r, query)) : requests;
}
