"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import StatusBadge from "@/components/StatusBadge";
import { apiFetch } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { STATUS_ORDER, statusBadgeClasses, statusLabel } from "@/lib/status";
import { useAuth } from "@/context/AuthContext";
import type { Application, ApplicationStatus, FollowUpWithApplication } from "@/lib/types";

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
        if (!followUp.completed) {
          items.push({ ...followUp, application: app });
        }
      }
    }
    return items.sort(
      (a, b) => new Date(a.followUpDate).getTime() - new Date(b.followUpDate).getTime()
    );
  }, [applications]);

  return (
    <AppShell>
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
          <p className="mt-1 text-sm text-gray-500">
            {user?.email ? `Signed in as ${user.email}` : "Welcome back"}
          </p>
        </div>

        {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>}

        {loading ? (
          <p className="text-sm text-gray-500">Loading your dashboard…</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/applications"
                className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
              >
                Add a job
              </Link>
            </div>

            <section>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                    Total applications
                  </p>
                  <p className="mt-1 text-2xl font-semibold text-gray-900">{applications.length}</p>
                </div>
                {STATUS_ORDER.map((status) => (
                  <div key={status} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${statusBadgeClasses(
                        status
                      )}`}
                    >
                      {statusLabel(status)}
                    </span>
                    <p className="mt-2 text-2xl font-semibold text-gray-900">{statusCounts[status]}</p>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-900">Upcoming follow-ups</h2>
              <div className="mt-3 rounded-xl border border-gray-200 bg-white shadow-sm">
                {upcomingFollowUps.length === 0 ? (
                  <p className="p-6 text-center text-sm text-gray-500">
                    No follow-ups scheduled. Open an application to add one.
                  </p>
                ) : (
                  <ul className="divide-y divide-gray-100">
                    {upcomingFollowUps.map((followUp) => (
                      <li key={followUp.id}>
                        <Link
                          href={`/applications/${followUp.application.id}`}
                          className="flex items-center justify-between gap-3 p-4 hover:bg-gray-50"
                        >
                          <div className="min-w-0">
                            <p className="font-medium text-gray-900">
                              {followUp.application.jobPosting?.company?.name ?? "—"}
                              <span className="font-normal text-gray-500">
                                {" "}
                                · {followUp.application.jobPosting?.title ?? "Role"}
                              </span>
                            </p>
                            {followUp.note && (
                              <p className="mt-0.5 truncate text-sm text-gray-500">{followUp.note}</p>
                            )}
                          </div>
                          <div className="flex shrink-0 items-center gap-3">
                            <StatusBadge status={followUp.application.status} />
                            <span className="text-sm text-gray-500">{formatDate(followUp.followUpDate)}</span>
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          </>
        )}
      </div>
    </AppShell>
  );
}
