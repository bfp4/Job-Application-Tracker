"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AppShell from "@/components/AppShell";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import type {
  Application,
  ApplicationStatus,
  Insight,
  InsightType,
  InsightsResponse,
  InsightReport,
} from "@/lib/types";

const MS_PER_DAY = 1000 * 60 * 60 * 24;
const MIN_APPLICATIONS_FOR_AI = 5;

const RESPONDED: ApplicationStatus[] = [
  "PHONE_SCREEN",
  "INTERVIEW",
  "OFFER",
  "REJECTED",
];

interface Overview {
  total: number;
  responseRate: number;
  active: number;
  interviews: number;
  offers: number;
  overdueFollowUps: number;
}

function computeOverview(applications: Application[]): Overview {
  const total = applications.length;

  const submitted = applications.filter((a) => a.status !== "NOT_APPLIED");
  const responded = submitted.filter((a) => RESPONDED.includes(a.status));
  const responseRate =
    submitted.length === 0
      ? 0
      : Math.round((responded.length / submitted.length) * 1000) / 10;

  const active = applications.filter(
    (a) => a.status !== "NOT_APPLIED" && a.status !== "REJECTED"
  ).length;
  const interviews = applications.filter(
    (a) => a.status === "INTERVIEW" || a.status === "PHONE_SCREEN"
  ).length;
  const offers = applications.filter((a) => a.status === "OFFER").length;

  // Follow-ups more than 3 days overdue (matches the server aggregator).
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - 3);
  let overdueFollowUps = 0;
  for (const app of applications) {
    for (const followUp of app.followUps ?? []) {
      if (followUp.completed) continue;
      if (new Date(followUp.followUpDate) < cutoff) overdueFollowUps += 1;
    }
  }

  return { total, responseRate, active, interviews, offers, overdueFollowUps };
}

function formatRelativeTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.round(diffMs / (1000 * 60));
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins} min ago`;
  const diffHours = Math.round(diffMins / 60);
  if (diffHours < 24) return `${diffHours} hr ago`;
  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function InsightsPage() {
  const { user, loading: authLoading } = useAuth();

  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [insights, setInsights] = useState<Insight[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [aiError, setAiError] = useState(false);
  const [hasGenerated, setHasGenerated] = useState(false);

  // Load the application list (drives the always-visible overview) plus the
  // most recent saved insight report (so returning users see prior insights
  // without spending tokens). Neither call triggers Claude.
  useEffect(() => {
    if (authLoading || !user) return;

    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [appsRes, historyRes] = await Promise.all([
          apiFetch("/api/applications"),
          apiFetch("/api/insights/history"),
        ]);

        if (!appsRes.ok) throw new Error("Failed to load your stats.");
        const appsData = (await appsRes.json()) as {
          applications: Application[];
        };
        if (!cancelled) setApplications(appsData.applications);

        if (historyRes.ok) {
          const historyData = (await historyRes.json()) as {
            reports: InsightReport[];
          };
          const latest = historyData.reports?.[0];
          if (latest && !cancelled) {
            setInsights(latest.insights ?? []);
            setGeneratedAt(latest.generatedAt);
            if ((latest.insights?.length ?? 0) > 0) setHasGenerated(true);
          }
        }
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

  const overview = useMemo(
    () => computeOverview(applications),
    [applications]
  );

  const generate = useCallback(async () => {
    setGenerating(true);
    setAiError(false);
    setError(null);
    try {
      const res = await apiFetch("/api/insights");
      if (!res.ok) throw new Error("Failed to generate insights.");
      const data = (await res.json()) as InsightsResponse;
      setInsights(data.insights ?? []);
      setGeneratedAt(data.generatedAt);
      setAiError(Boolean(data.aiError));
      setHasGenerated(true);
    } catch (err) {
      setAiError(true);
      setError(err instanceof Error ? err.message : "Failed to generate.");
    } finally {
      setGenerating(false);
    }
  }, []);

  const hasEnoughData = overview.total >= MIN_APPLICATIONS_FOR_AI;

  return (
    <AppShell>
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Insights</h1>
          <p className="mt-1 text-sm text-gray-500">
            A snapshot of your job search, with AI-generated analysis of what&apos;s
            working and what to do next.
          </p>
        </div>

        {error && (
          <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {loading ? (
          <p className="text-sm text-gray-500">Loading your stats…</p>
        ) : (
          <>
            <StatsOverview overview={overview} />

            <section className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-gray-900">
                  AI insights
                </h2>
                {hasEnoughData && hasGenerated && generatedAt && !generating && (
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-500">
                      Last generated: {formatRelativeTime(generatedAt)}
                    </span>
                    <button
                      type="button"
                      onClick={generate}
                      className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                    >
                      Refresh
                    </button>
                  </div>
                )}
              </div>

              {!hasEnoughData ? (
                <EmptyState count={overview.total} />
              ) : generating ? (
                <div className="rounded-xl border border-gray-200 bg-white p-10 text-center shadow-sm">
                  <p className="text-sm font-medium text-gray-900">
                    Analyzing your application patterns…
                  </p>
                  <p className="mt-1 text-sm text-gray-500">
                    This usually takes a few seconds.
                  </p>
                </div>
              ) : !hasGenerated ? (
                <div className="rounded-xl border border-dashed border-gray-300 bg-white p-10 text-center">
                  <p className="text-sm text-gray-600">
                    Generate a fresh analysis of your application history.
                  </p>
                  <button
                    type="button"
                    onClick={generate}
                    className="mt-4 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
                  >
                    Generate insights
                  </button>
                </div>
              ) : (
                <>
                  {aiError && (
                    <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">
                      Unable to generate insights right now. Your stats are
                      still available above.
                    </div>
                  )}
                  {insights.length > 0 && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {insights.map((insight, i) => (
                        <InsightCard key={i} insight={insight} />
                      ))}
                    </div>
                  )}
                </>
              )}
            </section>
          </>
        )}
      </div>
    </AppShell>
  );
}

function StatsOverview({ overview }: { overview: Overview }) {
  const cards: Array<{ label: string; value: string; danger?: boolean }> = [
    { label: "Total applications", value: String(overview.total) },
    { label: "Response rate", value: `${overview.responseRate}%` },
    { label: "Active applications", value: String(overview.active) },
    { label: "Interviews", value: String(overview.interviews) },
    { label: "Offers received", value: String(overview.offers) },
    {
      label: "Overdue follow-ups",
      value: String(overview.overdueFollowUps),
      danger: overview.overdueFollowUps > 0,
    },
  ];

  return (
    <section>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {cards.map((card) => (
          <div
            key={card.label}
            className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
          >
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
              {card.label}
            </p>
            <p
              className={`mt-1 text-2xl font-semibold ${
                card.danger ? "text-red-600" : "text-gray-900"
              }`}
            >
              {card.value}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function EmptyState({ count }: { count: number }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-300 bg-white p-10 text-center">
      <p className="text-sm font-medium text-gray-900">
        Apply to at least {MIN_APPLICATIONS_FOR_AI} jobs to unlock AI insights.
      </p>
      <p className="mt-1 text-sm text-gray-500">
        You have {count} application{count === 1 ? "" : "s"} so far.
      </p>
    </div>
  );
}

const TYPE_META: Record<
  InsightType,
  { icon: string; iconClass: string; cardClass: string }
> = {
  positive: {
    icon: "✓",
    iconClass: "bg-green-100 text-green-700",
    cardClass: "border-green-200",
  },
  warning: {
    icon: "⚠",
    iconClass: "bg-amber-100 text-amber-700",
    cardClass: "border-amber-200",
  },
  suggestion: {
    icon: "→",
    iconClass: "bg-blue-100 text-blue-700",
    cardClass: "border-blue-200",
  },
  neutral: {
    icon: "•",
    iconClass: "bg-gray-100 text-gray-600",
    cardClass: "border-gray-200",
  },
};

function InsightCard({ insight }: { insight: Insight }) {
  const meta = TYPE_META[insight.type] ?? TYPE_META.neutral;
  return (
    <div
      className={`flex gap-3 rounded-xl border bg-white p-4 shadow-sm ${meta.cardClass}`}
    >
      <span
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${meta.iconClass}`}
        aria-hidden
      >
        {meta.icon}
      </span>
      <div className="min-w-0">
        <p className="font-semibold text-gray-900">{insight.title}</p>
        <p className="mt-1 text-sm text-gray-600">{insight.insight}</p>
      </div>
    </div>
  );
}
