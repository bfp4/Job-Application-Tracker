"use client";

import { useCallback, useEffect, useState } from "react";
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
      loadApplications();
    }
  }, [authLoading, user, loadApplications]);

  async function handleStatusChange(
    id: string,
    status: ApplicationStatus
  ) {
    const previous = applications;
    setApplications((apps) =>
      apps.map((a) => (a.id === id ? { ...a, status } : a))
    );
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
            <h1 className="text-2xl font-semibold text-gray-900">
              Applications
            </h1>
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

        {error && (
          <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {loading && <p className="text-sm text-gray-500">Loading applications…</p>}

        {!loading && applications.length === 0 && (
          <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center">
            <p className="text-sm text-gray-500">
              No applications yet — search for jobs to get started.
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
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            {/* Desktop table */}
            <table className="hidden w-full text-left text-sm sm:table">
              <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Company</th>
                  <th className="px-4 py-3 font-medium">Title</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Applied</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {applications.map((app) => (
                  <tr
                    key={app.id}
                    onClick={() => router.push(`/applications/${app.id}`)}
                    className="cursor-pointer hover:bg-gray-50"
                  >
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {app.company?.name ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {app.jobPosting?.title ?? "—"}
                    </td>
                    <td
                      className="px-4 py-3"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center gap-2">
                        <StatusBadge status={app.status} />
                        <StatusSelect
                          value={app.status}
                          onChange={(status) =>
                            handleStatusChange(app.id, status)
                          }
                        />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {formatDate(app.appliedDate)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Mobile cards */}
            <ul className="divide-y divide-gray-100 sm:hidden">
              {applications.map((app) => (
                <li key={app.id} className="p-4">
                  <Link href={`/applications/${app.id}`} className="block">
                    <p className="font-medium text-gray-900">
                      {app.company?.name ?? "—"}
                    </p>
                    <p className="text-sm text-gray-600">
                      {app.jobPosting?.title ?? "—"}
                    </p>
                    <p className="mt-1 text-xs text-gray-400">
                      Applied {formatDate(app.appliedDate)}
                    </p>
                  </Link>
                  <div className="mt-3 flex items-center gap-2">
                    <StatusBadge status={app.status} />
                    <StatusSelect
                      value={app.status}
                      onChange={(status) => handleStatusChange(app.id, status)}
                    />
                  </div>
                </li>
              ))}
            </ul>
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
      className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 focus:border-gray-900 focus:outline-none"
    >
      {STATUS_ORDER.map((status) => (
        <option key={status} value={status}>
          {statusLabel(status)}
        </option>
      ))}
    </select>
  );
}
