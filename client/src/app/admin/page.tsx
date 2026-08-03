"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import AppShell from "@/components/AppShell";
import { useRequireAdmin } from "@/hooks/useRequireAdmin";
import { apiFetch, apiJson } from "@/lib/api";
import { formatDate } from "@/lib/format";
import {
  type AdminPremiumRequest,
  type AdminUser,
  visibleRequests,
} from "@/lib/adminList";
import {
  btnPrimarySm,
  btnSecondarySm,
  cardClassName,
  emptyStateClassName,
  inputClassName,
} from "@/lib/ui";
import { IconCheck, IconClock, IconClose, IconSearch, IconUsers } from "@/components/icons";
import type { UserTier } from "@/lib/types";

type Tab = "users" | "requests";

/** Matches the server's default; the rest are the sizes the picker offers. */
const DEFAULT_PAGE_SIZE = 25;
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

interface UsersPage {
  users: AdminUser[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export default function AdminPage() {
  const { user, loading: authLoading, isAdmin } = useRequireAdmin();

  const [activeTab, setActiveTab] = useState<Tab>("users");
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [requests, setRequests] = useState<AdminPremiumRequest[] | null>(null);
  const [usersSearch, setUsersSearch] = useState("");
  const [requestsSearch, setRequestsSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [totalUsers, setTotalUsers] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [usersBusy, setUsersBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // The search box drives a server query, so it's debounced — otherwise every
  // keystroke is a request. The Requests tab filters in memory and needs none.
  const debouncedUsersSearch = useDebounced(usersSearch, 300);

  // Ticks on every load, so a response that resolves after a newer one is
  // discarded instead of painting stale rows. The pager is disabled while a
  // request is in flight but the search box isn't, so typing "a" then "ab"
  // puts two requests in the air 300ms apart — if the first is slower it
  // lands last, and the grid then shows results for a query the box no
  // longer contains, with `total`/`totalPages` from that stale page too.
  // Same guard AuthContext uses on /api/user/me.
  const usersSeqRef = useRef(0);

  async function loadUsers() {
    const seq = ++usersSeqRef.current;
    const isCurrent = () => seq === usersSeqRef.current;

    setUsersBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(pageSize) });
      if (debouncedUsersSearch.trim()) params.set("search", debouncedUsersSearch.trim());

      const data = await apiJson<UsersPage>(`/api/admin/users?${params}`);
      if (!isCurrent()) return;
      setUsers(data.users);
      setTotalUsers(data.total);
      setTotalPages(data.totalPages);
    } catch (err) {
      // A superseded request's failure isn't the user's problem — banners
      // from it would outlive the query that caused them.
      if (!isCurrent()) return;
      setError(err instanceof Error ? err.message : "Failed to load users.");
    } finally {
      // Leave the spinner up for whichever request is still outstanding.
      if (isCurrent()) setUsersBusy(false);
    }
  }

  async function loadRequests() {
    try {
      const data = await apiJson<{ requests: AdminPremiumRequest[] }>(
        "/api/admin/premium-requests"
      );
      setRequests(data.requests);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load premium requests.");
    }
  }

  // Gated on isAdmin, not just on auth: a non-admin who lands here is being
  // redirected from an effect, which still lets this one run. Firing it would
  // 403 and paint the error banner before the route swaps out. Staying in the
  // skeleton state (`loading` is only cleared here) covers the frame or two
  // until the redirect commits.
  useEffect(() => {
    if (authLoading || !user || !isAdmin) return;
    void Promise.all([loadUsers(), loadRequests()]).then(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user, isAdmin]);

  // Re-queries when the page controls move. Skipped during the first load,
  // which the effect above already covers.
  useEffect(() => {
    if (loading) return;
    void loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, debouncedUsersSearch]);

  const filteredRequests = useMemo(
    () => visibleRequests(requests ?? [], requestsSearch),
    [requests, requestsSearch]
  );

  async function handleResolveRequest(request: AdminPremiumRequest, action: "approve" | "deny") {
    setBusyId(request.id);
    setError(null);
    try {
      const res = await apiFetch(`/api/admin/premium-requests/${request.id}`, {
        method: "PATCH",
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed to resolve request.");

      setRequests((prev) => (prev ?? []).filter((r) => r.id !== request.id));
      setUsers((prev) =>
        (prev ?? []).map((u) =>
          u.id === request.user.id
            ? {
                ...u,
                // Mirrors the server: approving an ADMIN's stale request
                // resolves it without touching their tier.
                tier: action === "approve" && u.tier !== "ADMIN" ? "PREMIUM" : u.tier,
                hasPendingPremiumRequest: false,
              }
            : u
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resolve request.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleToggleTier(targetUser: AdminUser) {
    const nextTier: UserTier = targetUser.tier === "PREMIUM" ? "BASIC" : "PREMIUM";
    setBusyId(targetUser.id);
    setError(null);
    try {
      const res = await apiFetch(`/api/admin/users/${targetUser.id}/tier`, {
        method: "PATCH",
        body: JSON.stringify({ tier: nextTier }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed to update tier.");

      // Take the server's recomputed row rather than patching the old one.
      // Downgrading has to surface a quota the client can't know: a PREMIUM
      // row carries aiCallsRemaining: null, so carrying that value over left
      // the card rendering " calls left today" with no number. The response
      // also reflects that upgrading resolves any pending request server-side
      // (see PATCH /api/admin/users/:id/tier).
      const updated = data.user as AdminUser;
      setUsers((prev) => (prev ?? []).map((u) => (u.id === targetUser.id ? updated : u)));
      if (nextTier === "PREMIUM") {
        setRequests((prev) => (prev ?? []).filter((r) => r.user.id !== targetUser.id));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update tier.");
    } finally {
      setBusyId(null);
    }
  }

  const pendingCount = requests?.length ?? 0;

  return (
    <AppShell>
      <div className="max-w-5xl space-y-5">
        <header>
          <h1 className="text-2xl font-bold text-ink sm:text-[28px]">Admin</h1>
          <p className="mt-1 text-sm font-medium text-muted">
            Manage user tiers and review premium requests.
          </p>
        </header>

        {error && (
          <div className="rounded-xl border border-danger-ring bg-danger-soft px-4 py-3 text-sm font-medium text-red-700">
            {error}
          </div>
        )}

        {loading ? (
          <div className="space-y-4" aria-hidden>
            <div className={`${cardClassName} h-32 animate-pulse bg-subtle`} />
            <div className={`${cardClassName} h-64 animate-pulse bg-subtle`} />
          </div>
        ) : (
          <>
            <div className="inline-flex gap-1 rounded-lg border border-border bg-subtle p-1">
              <TabButton active={activeTab === "users"} onClick={() => setActiveTab("users")}>
                Users
              </TabButton>
              <TabButton
                active={activeTab === "requests"}
                onClick={() => setActiveTab("requests")}
              >
                Requests{pendingCount > 0 && ` (${pendingCount})`}
              </TabButton>
            </div>

            {activeTab === "users" ? (
              <section className={`${cardClassName} p-5`}>
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
                    <IconUsers size={18} />
                  </span>
                  <h2 className="text-base font-bold text-ink">All users</h2>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <div className="relative min-w-0 flex-1 sm:max-w-sm">
                    <IconSearch
                      size={16}
                      className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
                    />
                    <input
                      type="search"
                      value={usersSearch}
                      onChange={(e) => {
                        setUsersSearch(e.target.value);
                        // A narrower result set may not have the page we're on.
                        setPage(1);
                      }}
                      placeholder="Search by email…"
                      aria-label="Search users"
                      className={`w-full pl-9 ${inputClassName}`}
                    />
                  </div>

                  <label className="flex items-center gap-2 text-xs font-semibold text-muted">
                    Show
                    <select
                      value={pageSize}
                      onChange={(e) => {
                        setPageSize(Number(e.target.value));
                        setPage(1);
                      }}
                      aria-label="Users per page"
                      className={`w-auto py-1.5 ${inputClassName}`}
                    >
                      {PAGE_SIZE_OPTIONS.map((size) => (
                        <option key={size} value={size}>
                          {size}
                        </option>
                      ))}
                    </select>
                    per page
                  </label>
                </div>

                {(users?.length ?? 0) === 0 ? (
                  <div className={`mt-4 ${emptyStateClassName}`}>
                    <p className="text-sm text-muted">
                      {usersSearch.trim() ? "No users match your search." : "No users yet."}
                    </p>
                  </div>
                ) : (
                  <div
                    className={`mt-4 grid grid-cols-1 gap-3 transition-opacity sm:grid-cols-2 lg:grid-cols-3 ${
                      usersBusy ? "opacity-60" : ""
                    }`}
                  >
                    {(users ?? []).map((u) => (
                      <UserCard
                        key={u.id}
                        user={u}
                        busy={busyId === u.id}
                        onToggleTier={() => handleToggleTier(u)}
                      />
                    ))}
                  </div>
                )}

                <Pagination
                  page={page}
                  totalPages={totalPages}
                  total={totalUsers}
                  shown={users?.length ?? 0}
                  pageSize={pageSize}
                  busy={usersBusy}
                  onChange={setPage}
                />
              </section>
            ) : (
              <section className={`${cardClassName} p-5`}>
                <h2 className="text-base font-bold text-ink">Pending premium requests</h2>

                <div className="relative mt-4 max-w-sm">
                  <IconSearch
                    size={16}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
                  />
                  <input
                    type="search"
                    value={requestsSearch}
                    onChange={(e) => setRequestsSearch(e.target.value)}
                    placeholder="Search by email or message…"
                    aria-label="Search premium requests"
                    className={`w-full pl-9 ${inputClassName}`}
                  />
                </div>

                {filteredRequests.length === 0 ? (
                  <div className={`mt-4 ${emptyStateClassName}`}>
                    <p className="text-sm text-muted">
                      {requests && requests.length > 0
                        ? "No requests match your search."
                        : "No pending requests."}
                    </p>
                  </div>
                ) : (
                  <ul className="mt-4 space-y-3">
                    {filteredRequests.map((request) => (
                      <li
                        key={request.id}
                        className="rounded-xl border border-border bg-subtle/50 p-4"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-ink">
                              {request.user.email}
                            </p>
                            <p className="text-xs text-muted">
                              Requested {formatDate(request.createdAt)}
                            </p>
                          </div>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => handleResolveRequest(request, "approve")}
                              disabled={busyId === request.id}
                              className={btnPrimarySm}
                            >
                              <IconCheck size={15} />
                              Approve
                            </button>
                            <button
                              type="button"
                              onClick={() => handleResolveRequest(request, "deny")}
                              disabled={busyId === request.id}
                              className={btnSecondarySm}
                            >
                              <IconClose size={15} />
                              Deny
                            </button>
                          </div>
                        </div>
                        <p className="mt-2 whitespace-pre-wrap text-sm text-muted">
                          {request.message}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}

/** Value that only catches up once `delay` has passed without a change. */
function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}

/**
 * Prev/next controls for the user grid, with the range currently on screen.
 * Renders nothing when everything fits on one page — the grid is then just a
 * list, and a lone disabled control pair is noise.
 */
function Pagination({
  page,
  totalPages,
  total,
  shown,
  pageSize,
  busy,
  onChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  shown: number;
  pageSize: number;
  busy: boolean;
  onChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;

  // `shown` can be 0 on a page past the end — reachable if the set shrinks
  // while someone is paging through it.
  const first = (page - 1) * pageSize + 1;
  const range = shown === 0 ? "0" : `${first}–${first + shown - 1}`;

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
      <p className="text-xs font-medium text-muted">
        Showing {range} of {total}
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onChange(page - 1)}
          disabled={busy || page <= 1}
          className={btnSecondarySm}
        >
          Previous
        </button>
        <span className="text-xs font-semibold text-muted">
          Page {page} of {totalPages}
        </span>
        <button
          type="button"
          onClick={() => onChange(page + 1)}
          disabled={busy || page >= totalPages}
          className={btnSecondarySm}
        >
          Next
        </button>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${
        active ? "bg-brand-soft text-brand" : "text-muted hover:bg-surface hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function UserCard({
  user,
  busy,
  onToggleTier,
}: {
  user: AdminUser;
  busy: boolean;
  onToggleTier: () => void;
}) {
  return (
    <div className={`${cardClassName} p-4`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink" title={user.email}>
            {user.email}
          </p>
          <p className="text-xs text-muted">Joined {formatDate(user.createdAt)}</p>
        </div>
        <TierBadge tier={user.tier} />
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {user.tier === "BASIC" && (
          <span className="rounded-full bg-subtle px-2.5 py-1 text-xs font-semibold text-muted ring-1 ring-inset ring-border">
            {user.aiCallsRemaining} calls left today
          </span>
        )}
        {user.hasPendingPremiumRequest && (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 ring-1 ring-inset ring-amber-200">
            <IconClock size={12} />
            Requested premium
          </span>
        )}
      </div>

      {user.tier !== "ADMIN" && (
        <button
          type="button"
          onClick={onToggleTier}
          disabled={busy}
          className={`mt-3 w-full ${btnSecondarySm}`}
        >
          {user.tier === "PREMIUM" ? "Downgrade to Basic" : "Upgrade to Premium"}
        </button>
      )}
    </div>
  );
}

function TierBadge({ tier }: { tier: UserTier }) {
  const styles: Record<UserTier, string> = {
    ADMIN: "bg-ai-soft text-ai ring-ai-ring",
    PREMIUM: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    BASIC: "bg-subtle text-muted ring-border",
  };
  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${styles[tier]}`}
    >
      {tier}
    </span>
  );
}
