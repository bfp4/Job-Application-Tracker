"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import CompanyLogo from "@/components/CompanyLogo";
import StatusDonut from "@/components/StatusDonut";
import { apiFetch } from "@/lib/api";
import { formatDate, relativeDayLabel, urgencyOf, type Urgency } from "@/lib/format/format";
import {
  STATUS_ORDER,
  statusLabel,
  statusTileClasses,
  statusValueClasses,
} from "@/lib/status/status";
import { cardClassName, btnPrimarySm } from "@/lib/ui";
import { useAuth } from "@/context/AuthContext";
import {
  IconArrowRight,
  IconCalendar,
  IconPlus,
  IconTarget,
} from "@/components/icons";
import type { Application, ApplicationStatus, FollowUpWithApplication } from "@/lib/types";

/** How many follow-ups the panel lists before collapsing to a count. */
const FOLLOW_UP_LIMIT = 5;

export default function DashboardPage() {
  const { user, loading: authLoading } = useAuth();

  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading || !user) return;

    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const appsRes = await apiFetch("/api/applications");
        if (!appsRes.ok) throw new Error("Failed to load dashboard.");
        const data = (await appsRes.json()) as { applications: Application[] };
        if (!cancelled) setApplications(data.applications);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authLoading, user]);

  const statusCounts = useMemo(() => {
    const counts = {} as Record<ApplicationStatus, number>;
    for (const status of STATUS_ORDER) counts[status] = 0;
    for (const app of applications) counts[app.status] += 1;
    return counts;
  }, [applications]);

  const upcomingFollowUps = useMemo<FollowUpWithApplication[]>(() => {
    const items: FollowUpWithApplication[] = [];
    for (const app of applications) {
      for (const followUp of app.followUps ?? []) {
        if (!followUp.completed) items.push({ ...followUp, application: app });
      }
    }
    return items.sort(
      (a, b) => new Date(a.followUpDate).getTime() - new Date(b.followUpDate).getTime()
    );
  }, [applications]);

  return (
    <AppShell>
      <div className="space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-ink sm:text-[28px]">
              {greeting()}, {firstName(user?.email)} <span aria-hidden>👋</span>
            </h1>
            <p className="mt-1 text-sm font-medium text-muted">
              Here&apos;s what&apos;s happening with your job search.
            </p>
          </div>
          <Link href="/applications?add=1" className={btnPrimarySm}>
            <IconPlus size={16} />
            Add application
          </Link>
        </header>

        {error && (
          <div className="rounded-xl border border-danger-ring bg-danger-soft px-4 py-3 text-sm font-medium text-red-700">
            {error}
          </div>
        )}

        {loading ? (
          <DashboardSkeleton />
        ) : (
          <>
            <section aria-label="Pipeline">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                {STATUS_ORDER.map((status) => (
                  <StatTile
                    key={status}
                    status={status}
                    count={statusCounts[status]}
                  />
                ))}
              </div>
            </section>

            {/*
              `min-w-0` on both cards is load-bearing. A grid item defaults to
              min-width:auto, so the track is floored at the item's min-content
              — and `truncate` inside the follow-up rows sets white-space:nowrap,
              making that min-content the full untruncated string. The column
              was resolving to 481px inside a 358px container, pushing the page
              (and the fixed mobile tab bar) wider than the screen.
            */}
            <div className="grid gap-4 lg:grid-cols-5">
              <section className={`${cardClassName} min-w-0 lg:col-span-3`}>
                <div className="flex items-center justify-between gap-3 px-5 py-4">
                  <h2 className="text-base font-bold text-ink">Upcoming follow-ups</h2>
                  {upcomingFollowUps.length > 0 && (
                    <span className="rounded-full bg-subtle px-2 py-0.5 text-xs font-semibold text-muted">
                      {upcomingFollowUps.length}
                    </span>
                  )}
                </div>

                {upcomingFollowUps.length === 0 ? (
                  <div className="px-5 pb-8 pt-2 text-center">
                    <IconCalendar
                      size={28}
                      className="mx-auto text-border"
                      strokeWidth={1.5}
                    />
                    <p className="mt-2 text-sm font-medium text-muted">
                      No follow-ups scheduled.
                    </p>
                    <p className="mt-0.5 text-xs text-muted">
                      Open an application to add one.
                    </p>
                  </div>
                ) : (
                  <>
                    <ul className="divide-y divide-border border-t border-border">
                      {upcomingFollowUps.slice(0, FOLLOW_UP_LIMIT).map((followUp) => (
                        <FollowUpRow key={followUp.id} followUp={followUp} />
                      ))}
                    </ul>
                    {upcomingFollowUps.length > FOLLOW_UP_LIMIT && (
                      <p className="border-t border-border px-5 py-3 text-xs font-semibold text-muted">
                        +{upcomingFollowUps.length - FOLLOW_UP_LIMIT} more scheduled
                      </p>
                    )}
                  </>
                )}
              </section>

              <section className={`${cardClassName} min-w-0 lg:col-span-2`}>
                <div className="px-5 py-4">
                  <h2 className="text-base font-bold text-ink">Applications by status</h2>
                </div>
                <div className="border-t border-border px-5 py-5">
                  {applications.length === 0 ? (
                    <p className="py-8 text-center text-sm font-medium text-muted">
                      Nothing to chart yet.
                    </p>
                  ) : (
                    <StatusDonut counts={statusCounts} total={applications.length} />
                  )}
                </div>
              </section>
            </div>

            <InsightBanner
              applications={applications}
              counts={statusCounts}
              followUps={upcomingFollowUps}
              name={firstName(user?.email)}
            />
          </>
        )}
      </div>
    </AppShell>
  );
}

function greeting(now: Date = new Date()): string {
  const hour = now.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** "ari.leverton@…" → "Ari". Falls back to a neutral address. */
function firstName(email: string | null | undefined): string {
  const local = email?.split("@")[0] ?? "";
  const first = local.split(/[._-]+/).filter(Boolean)[0];
  if (!first) return "there";
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

/**
 * A pipeline count. Clicking through filters the applications list — the
 * counts are the most obvious place a user tries to drill in from.
 */
function StatTile({
  status,
  count,
}: {
  status: ApplicationStatus;
  count: number;
}) {
  return (
    <Link
      href={`/applications?status=${status}`}
      className={`${cardClassName} group flex items-center justify-between gap-2 px-4 py-3.5 transition duration-200 hover:-translate-y-0.5 hover:shadow-card-hover`}
    >
      <div className="min-w-0">
        <p className="truncate text-xs font-semibold text-muted">
          {statusLabel(status)}
        </p>
        {/* The count carries the stage's colour, as in the mockup — it makes
            the row scannable without reading a single label. */}
        <p
          className={`mt-1 text-2xl font-bold tabular-nums ${statusValueClasses(status)}`}
        >
          {count}
        </p>
      </div>
      {/* Always visible: revealing the arrow on hover left phones looking at
          an empty coloured square, since there is no hover to reveal it. */}
      <span
        aria-hidden
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${statusTileClasses(
          status
        )}`}
      >
        <IconArrowRight size={14} className="opacity-70 transition group-hover:opacity-100" />
      </span>
    </Link>
  );
}

/** Tailwind classes for the due-date chip, by how urgent it is. */
const URGENCY_STYLES: Record<Urgency, string> = {
  overdue: "bg-danger-soft text-red-700 ring-danger-ring",
  today: "bg-warning-soft text-amber-700 ring-warning-ring",
  soon: "bg-brand-soft text-brand ring-brand-ring",
  later: "bg-subtle text-muted ring-border",
};

function FollowUpRow({ followUp }: { followUp: FollowUpWithApplication }) {
  const posting = followUp.application.jobPosting;
  const company = posting?.company?.name ?? "Unknown company";
  const urgency = urgencyOf(followUp.followUpDate);

  return (
    <li>
      <Link
        href={`/applications/${followUp.application.id}`}
        className="flex items-center gap-3 px-5 py-3 transition hover:bg-subtle"
      >
        <CompanyLogo name={company} size="sm" />

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink">{company}</p>
          <p className="truncate text-xs font-medium text-muted">
            {posting?.title ?? "Role"}
            {followUp.note ? ` · ${followUp.note}` : ""}
          </p>
        </div>

        <div className="shrink-0 text-right">
          <span
            className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${URGENCY_STYLES[urgency]}`}
          >
            {relativeDayLabel(followUp.followUpDate)}
          </span>
          <p className="mt-0.5 hidden text-[11px] font-medium text-muted sm:block">
            {formatDate(followUp.followUpDate)}
          </p>
        </div>
      </Link>
    </li>
  );
}

/**
 * A computed nudge from the user's own numbers.
 *
 * Violet-tinted to match the mockup, but pointedly without the sparkle glyph
 * or a "Generated by AI" badge — those two marks are what identify model
 * output in this product, and nothing here involves a model.
 */
function InsightBanner({
  applications,
  counts,
  followUps,
  name,
}: {
  applications: Application[];
  counts: Record<ApplicationStatus, number>;
  followUps: FollowUpWithApplication[];
  name: string;
}) {
  const overdue = followUps.filter((f) => urgencyOf(f.followUpDate) === "overdue").length;
  const notApplied = counts.NOT_APPLIED;
  const submitted = applications.length - notApplied;

  let message: string;
  if (applications.length === 0) {
    message = "Add your first job to start tracking. Paste a link and we'll fill in the details.";
  } else if (overdue > 0) {
    message = `You have ${overdue} overdue follow-${overdue === 1 ? "up" : "ups"}. Chasing them is the highest-value thing you can do today.`;
  } else if (notApplied > 0) {
    message = `${notApplied} saved ${notApplied === 1 ? "job is" : "jobs are"} still waiting to be submitted. Pick one and finish it.`;
  } else if (counts.OFFER > 0) {
    message = `${counts.OFFER} offer${counts.OFFER === 1 ? "" : "s"} on the table — nice work, ${name}.`;
  } else {
    message = `Keep going, ${name}. You've applied to ${submitted} ${submitted === 1 ? "opportunity" : "opportunities"} — consistency is what turns into offers.`;
  }

  return (
    <aside className="flex items-center gap-3 rounded-2xl border border-brand-ring bg-brand-soft px-5 py-4">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface text-brand ring-1 ring-inset ring-brand-ring">
        <IconTarget size={18} />
      </span>
      <p className="text-sm font-medium text-ink">{message}</p>
    </aside>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className={`${cardClassName} h-[76px] animate-pulse bg-subtle`} />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-5">
        <div className={`${cardClassName} h-72 animate-pulse bg-subtle lg:col-span-3`} />
        <div className={`${cardClassName} h-72 animate-pulse bg-subtle lg:col-span-2`} />
      </div>
    </div>
  );
}
