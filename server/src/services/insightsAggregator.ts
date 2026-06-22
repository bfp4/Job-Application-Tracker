import type { ApplicationStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { computeSearchScore } from "./searchScoring";

/** A company the user has applied to, with how many times. */
export interface TopCompany {
  name: string;
  count: number;
}

/** A single bucket of weekly application activity. */
export interface WeekActivity {
  /** Monday (start) of the week as an ISO date, e.g. "2026-06-15". */
  week: string;
  count: number;
}

/** A saved search ranked by recency-weighted score. */
export interface TopSearchQuery {
  query: string;
  location: string;
  score: number;
}

/**
 * The full statistics snapshot for a user, suitable for display and for handing
 * to Claude to generate insights. All numeric fields are plain numbers (rates
 * are percentages 0–100, rounded to one decimal place).
 */
export interface AggregatedStats {
  totalApplications: number;
  byStatus: Record<string, number>;
  responseRate: number;
  bySource: Record<string, number>;
  avgDaysToResponse: number | null;
  topCompanies: TopCompany[];
  applicationsByWeek: WeekActivity[];
  statusProgressionRate: Record<string, number>;
  topSearchQueries: TopSearchQuery[];
  dueFollowUps: number;
  overdueFollowUps: number;
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;
const WEEKS_TO_REPORT = 12;

// Ordinal pipeline rank used to reason about "how far" an application got.
// REJECTED is terminal and off-pipeline, so it is handled separately below.
const PIPELINE_ORDER: ApplicationStatus[] = [
  "NOT_APPLIED",
  "APPLIED",
  "PHONE_SCREEN",
  "INTERVIEW",
  "OFFER",
];

const ALL_STATUSES: ApplicationStatus[] = [...PIPELINE_ORDER, "REJECTED"];

// Statuses that count as having "moved past APPLIED" — i.e. the application got
// some response (including a rejection, which is still a response).
const RESPONDED_STATUSES = new Set<ApplicationStatus>([
  "PHONE_SCREEN",
  "INTERVIEW",
  "OFFER",
  "REJECTED",
]);

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Midnight (local) at the start of the given date. */
function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Midnight (local) at the most recent Monday on or before the given date. */
function startOfWeek(date: Date): Date {
  const d = startOfDay(date);
  // getDay(): 0 = Sunday … 6 = Saturday. Shift so Monday is the week start.
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return d;
}

function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Aggregates a user's application history into a single statistics snapshot.
 *
 * Notes on approximations: the schema stores only an application's *current*
 * status (there is no per-status history table). So:
 *  - `avgDaysToResponse` uses `updatedAt` as a proxy for the moment of first
 *    response on applications that have moved past APPLIED.
 *  - `statusProgressionRate` infers reach from the current ordinal status; a
 *    REJECTED application is only credited with having reached APPLIED, since we
 *    cannot know how far it actually progressed before the rejection.
 */
export async function aggregateUserStats(
  userId: string,
  now: Date = new Date()
): Promise<AggregatedStats> {
  const [applications, openFollowUps, searchQueries] = await Promise.all([
    prisma.application.findMany({
      where: { userId },
      select: {
        status: true,
        appliedDate: true,
        createdAt: true,
        updatedAt: true,
        company: { select: { name: true } },
        jobPosting: { select: { source: true } },
      },
    }),
    prisma.followUp.findMany({
      where: { completed: false, application: { userId } },
      select: { followUpDate: true },
    }),
    prisma.searchQuery.findMany({
      where: { userId },
      select: {
        query: true,
        location: true,
        searchCount: true,
        lastSearchedAt: true,
      },
    }),
  ]);

  const totalApplications = applications.length;

  // --- byStatus ----------------------------------------------------------
  const byStatus: Record<string, number> = {};
  for (const status of ALL_STATUSES) byStatus[status] = 0;
  for (const app of applications) byStatus[app.status] += 1;

  // --- responseRate ------------------------------------------------------
  // Denominator: applications that were actually submitted (anything but
  // NOT_APPLIED). Numerator: those that drew any response past APPLIED.
  const submitted = applications.filter((a) => a.status !== "NOT_APPLIED");
  const responded = submitted.filter((a) => RESPONDED_STATUSES.has(a.status));
  const responseRate =
    submitted.length === 0
      ? 0
      : round1((responded.length / submitted.length) * 100);

  // --- bySource ----------------------------------------------------------
  const bySource: Record<string, number> = {};
  for (const app of applications) {
    const source = app.jobPosting?.source ?? "unknown";
    bySource[source] = (bySource[source] ?? 0) + 1;
  }

  // --- avgDaysToResponse -------------------------------------------------
  const responseDurations: number[] = [];
  for (const app of applications) {
    if (!app.appliedDate) continue;
    if (!RESPONDED_STATUSES.has(app.status)) continue;
    const days =
      (app.updatedAt.getTime() - app.appliedDate.getTime()) / MS_PER_DAY;
    if (days >= 0) responseDurations.push(days);
  }
  const avgDaysToResponse =
    responseDurations.length === 0
      ? null
      : round1(
          responseDurations.reduce((sum, d) => sum + d, 0) /
            responseDurations.length
        );

  // --- topCompanies ------------------------------------------------------
  const companyCounts = new Map<string, number>();
  for (const app of applications) {
    const name = app.company?.name?.trim();
    if (!name) continue;
    companyCounts.set(name, (companyCounts.get(name) ?? 0) + 1);
  }
  const topCompanies: TopCompany[] = [...companyCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 5);

  // --- applicationsByWeek (last 12 weeks) --------------------------------
  const currentWeekStart = startOfWeek(now);
  const weekBuckets = new Map<string, number>();
  // Seed the last 12 weeks (oldest → newest) so quiet weeks still show as 0.
  const weekOrder: string[] = [];
  for (let i = WEEKS_TO_REPORT - 1; i >= 0; i--) {
    const weekStart = new Date(currentWeekStart);
    weekStart.setDate(weekStart.getDate() - i * 7);
    const key = toIsoDate(weekStart);
    weekBuckets.set(key, 0);
    weekOrder.push(key);
  }
  const earliestWeekStart = new Date(currentWeekStart);
  earliestWeekStart.setDate(
    earliestWeekStart.getDate() - (WEEKS_TO_REPORT - 1) * 7
  );
  for (const app of applications) {
    // Bucket by the date the user applied; fall back to when the row was
    // created for applications that were tracked but not yet applied to.
    const activityDate = app.appliedDate ?? app.createdAt;
    if (activityDate < earliestWeekStart) continue;
    const key = toIsoDate(startOfWeek(activityDate));
    if (weekBuckets.has(key)) {
      weekBuckets.set(key, (weekBuckets.get(key) ?? 0) + 1);
    }
  }
  const applicationsByWeek: WeekActivity[] = weekOrder.map((week) => ({
    week,
    count: weekBuckets.get(week) ?? 0,
  }));

  // --- statusProgressionRate ---------------------------------------------
  // Share of all applications that reached each pipeline stage. An application
  // "reached" a stage if its current ordinal status is at or beyond it; a
  // REJECTED application is credited only with reaching APPLIED.
  const rankOf = (status: ApplicationStatus): number =>
    PIPELINE_ORDER.indexOf(status);
  const statusProgressionRate: Record<string, number> = {};
  const progressionStages: ApplicationStatus[] = [
    "APPLIED",
    "PHONE_SCREEN",
    "INTERVIEW",
    "OFFER",
  ];
  for (const stage of progressionStages) {
    const stageRank = rankOf(stage);
    let reached = 0;
    for (const app of applications) {
      if (app.status === "REJECTED") {
        // Only known to have reached APPLIED.
        if (stage === "APPLIED") reached += 1;
        continue;
      }
      if (rankOf(app.status) >= stageRank) reached += 1;
    }
    statusProgressionRate[stage] =
      totalApplications === 0
        ? 0
        : round1((reached / totalApplications) * 100);
  }

  // --- topSearchQueries --------------------------------------------------
  const topSearchQueries: TopSearchQuery[] = searchQueries
    .map((q) => ({
      query: q.query,
      location: q.location,
      score: round1(
        computeSearchScore(q.searchCount, q.lastSearchedAt, now)
      ),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  // --- follow-ups --------------------------------------------------------
  const endOfToday = startOfDay(now);
  endOfToday.setDate(endOfToday.getDate() + 1); // exclusive upper bound
  const overdueCutoff = startOfDay(now);
  overdueCutoff.setDate(overdueCutoff.getDate() - 3); // more than 3 days late

  let dueFollowUps = 0;
  let overdueFollowUps = 0;
  for (const followUp of openFollowUps) {
    if (followUp.followUpDate < endOfToday) dueFollowUps += 1;
    if (followUp.followUpDate < overdueCutoff) overdueFollowUps += 1;
  }

  return {
    totalApplications,
    byStatus,
    responseRate,
    bySource,
    avgDaysToResponse,
    topCompanies,
    applicationsByWeek,
    statusProgressionRate,
    topSearchQueries,
    dueFollowUps,
    overdueFollowUps,
  };
}
