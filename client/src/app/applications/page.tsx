"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import StatusBadge from "@/components/StatusBadge";
import { apiFetch } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { STATUS_ORDER, statusLabel } from "@/lib/status";
import { useAuth } from "@/context/AuthContext";
import type { Application, ApplicationStatus } from "@/lib/types";

export default function ApplicationsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadApplications = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/api/applications");
      if (!res.ok) throw new Error("Failed to load applications.");
      const data = (await res.json()) as { applications: Application[] };
      setApplications(data.applications);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authLoading && user) {
      void loadApplications();
    }
  }, [authLoading, user, loadApplications]);

  const applicationsByStatus = useMemo(() => {
    const grouped = {} as Record<ApplicationStatus, Application[]>;
    for (const status of STATUS_ORDER) grouped[status] = [];
    for (const app of applications) grouped[app.status].push(app);
    return grouped;
  }, [applications]);

  async function handleStatusChange(id: string, status: ApplicationStatus) {
    const previous = applications;
    setApplications((apps) => apps.map((a) => (a.id === id ? { ...a, status } : a)));
    try {
      const res = await apiFetch(`/api/applications/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("Update failed.");
    } catch {
      setApplications(previous);
      setError("Failed to update status. Please try again.");
    }
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Applications</h1>
            <p className="mt-1 text-sm text-gray-500">
              Track and manage every role you&apos;re pursuing.
            </p>
          </div>
          <Link
            href="/search"
            className="shrink-0 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            Find jobs
          </Link>
        </div>

        {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>}

        {loading && <p className="text-sm text-gray-500">Loading applications…</p>}

        {!loading && applications.length === 0 && (
          <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center">
            <p className="text-sm text-gray-500">
              No applications yet — go find some jobs that match your resume.
            </p>
            <Link
              href="/search"
              className="mt-4 inline-block rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
            >
              Search jobs
            </Link>
          </div>
        )}

        {!loading && applications.length > 0 && (
          <div className="space-y-6">
            {STATUS_ORDER.map((status) => {
              const apps = applicationsByStatus[status];
              if (apps.length === 0) return null;

              return (
                <section
                  key={status}
                  className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm"
                >
                  <div className="flex items-center gap-2 border-b border-gray-200 bg-gray-50 px-4 py-3">
                    <StatusBadge status={status} />
                    <span className="text-sm text-gray-500">
                      {apps.length} {apps.length === 1 ? "application" : "applications"}
                    </span>
                  </div>

                  <table className="hidden w-full table-fixed text-left text-sm sm:table">
                    <colgroup>
                      <col className="w-1/4" />
                      <col className="w-1/4" />
                      <col className="w-1/4" />
                      <col className="w-1/4" />
                    </colgroup>
                    <thead className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
                      <tr>
                        <th className="w-1/4 px-4 py-3 font-medium">Company</th>
                        <th className="w-1/4 px-4 py-3 font-medium">Title</th>
                        <th className="w-1/4 px-4 py-3 font-medium">Move to</th>
                        <th className="w-1/4 px-4 py-3 font-medium">Applied</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {apps.map((app) => {
                        const companyName = app.jobPosting?.company?.name ?? "—";
                        const jobTitle = app.jobPosting?.title ?? "—";

                        return (
                          <tr
                            key={app.id}
                            onClick={() => router.push(`/applications/${app.id}`)}
                            className="cursor-pointer hover:bg-gray-50"
                          >
                            <td
                              className="max-w-0 truncate px-4 py-3 font-medium text-gray-900"
                              title={companyName}
                            >
                              {companyName}
                            </td>
                            <td className="max-w-0 truncate px-4 py-3 text-gray-700" title={jobTitle}>
                              {jobTitle}
                            </td>
                            <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                              <StatusSelect
                                value={app.status}
                                onChange={(nextStatus) => handleStatusChange(app.id, nextStatus)}
                              />
                            </td>
                            <td className="truncate px-4 py-3 text-gray-500">
                              {formatDate(app.appliedDate)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>

                  <ul className="divide-y divide-gray-100 sm:hidden">
                    {apps.map((app) => (
                      <li key={app.id} className="p-4">
                        <Link href={`/applications/${app.id}`} className="block min-w-0">
                          <p
                            className="truncate font-medium text-gray-900"
                            title={app.jobPosting?.company?.name ?? undefined}
                          >
                            {app.jobPosting?.company?.name ?? "—"}
                          </p>
                          <p
                            className="truncate text-sm text-gray-600"
                            title={app.jobPosting?.title ?? undefined}
                          >
                            {app.jobPosting?.title ?? "—"}
                          </p>
                          <p className="mt-1 text-xs text-gray-400">
                            Applied {formatDate(app.appliedDate)}
                          </p>
                        </Link>
                        <div className="mt-3">
                          <StatusSelect
                            value={app.status}
                            onChange={(nextStatus) => handleStatusChange(app.id, nextStatus)}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function StatusSelect({
  value,
  onChange,
}: {
  value: ApplicationStatus;
  onChange: (status: ApplicationStatus) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as ApplicationStatus)}
      className="w-full max-w-full rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 focus:border-gray-900 focus:outline-none"
    >
      {STATUS_ORDER.map((status) => (
        <option key={status} value={status}>
          {statusLabel(status)}
        </option>
      ))}
    </select>
  );
}
