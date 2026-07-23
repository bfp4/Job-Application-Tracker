"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import StatusBadge from "@/components/StatusBadge";
import LocationInput from "@/components/LocationInput";
import CompanyInput from "@/components/CompanyInput";
import { CopyField } from "@/components/CopyButton";
import SourceInput from "@/components/SourceInput";
import { apiFetch, apiJson } from "@/lib/api";
import { formatCalendarDate } from "@/lib/format";
import { STATUS_ORDER, statusLabel } from "@/lib/status";
import { inputClassName } from "@/lib/ui";
import { useAuth } from "@/context/AuthContext";
import type { Application, ApplicationStatus, JobPosting } from "@/lib/types";

const SORT_OPTIONS = [
  { value: "createdAt-desc", label: "Newest first" },
  { value: "createdAt-asc", label: "Oldest first" },
  { value: "appliedDate-desc", label: "Applied date (newest)" },
  { value: "appliedDate-asc", label: "Applied date (oldest)" },
  { value: "company-asc", label: "Company (A–Z)" },
  { value: "title-asc", label: "Title (A–Z)" },
] as const;

type SortKey = (typeof SORT_OPTIONS)[number]["value"];

function compareApplications(sortKey: SortKey, a: Application, b: Application): number {
  switch (sortKey) {
    case "createdAt-desc":
      return b.createdAt.localeCompare(a.createdAt);
    case "createdAt-asc":
      return a.createdAt.localeCompare(b.createdAt);
    case "appliedDate-desc":
    case "appliedDate-asc": {
      // Applications without an applied date sort last in either direction.
      if (!a.appliedDate && !b.appliedDate) return 0;
      if (!a.appliedDate) return 1;
      if (!b.appliedDate) return -1;
      return sortKey === "appliedDate-desc"
        ? b.appliedDate.localeCompare(a.appliedDate)
        : a.appliedDate.localeCompare(b.appliedDate);
    }
    case "company-asc":
      return (a.jobPosting?.company?.name ?? "").localeCompare(
        b.jobPosting?.company?.name ?? "",
        undefined,
        { sensitivity: "base" },
      );
    case "title-asc":
      return (a.jobPosting?.title ?? "").localeCompare(b.jobPosting?.title ?? "", undefined, {
        sensitivity: "base",
      });
  }
}

function matchesSearch(app: Application, query: string): boolean {
  const haystack = [
    app.jobPosting?.company?.name,
    app.jobPosting?.title,
    app.source,
    ...(app.jobPosting?.location ?? []),
  ];
  return haystack.some((value) => value?.toLowerCase().includes(query));
}

export default function ApplicationsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [jobUrl, setJobUrl] = useState("");
  const [title, setTitle] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [locations, setLocations] = useState<string[]>([]);
  const [salary, setSalary] = useState("");
  const [source, setSource] = useState("");
  const [description, setDescription] = useState("");
  const [addingJob, setAddingJob] = useState(false);
  const [addJobError, setAddJobError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("createdAt-desc");

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

  async function handleAddJob(e: FormEvent) {
    e.preventDefault();
    if (!jobUrl.trim() || !title.trim() || !companyName.trim()) return;

    setAddingJob(true);
    setAddJobError(null);
    try {
      const { jobPosting } = await apiJson<{ jobPosting: JobPosting }>("/api/jobs", {
        method: "POST",
        body: JSON.stringify({
          jobUrl: jobUrl.trim(),
          title: title.trim(),
          companyName: companyName.trim(),
          location: locations,
          salary: salary.trim() || null,
          description: description.trim() || null,
        }),
      });
      const { application } = await apiJson<{ application: Application }>("/api/applications", {
        method: "POST",
        body: JSON.stringify({
          jobPostingId: jobPosting.id,
          source: source.trim() || null,
        }),
      });
      // No form reset needed — navigating away unmounts this page.
      router.push(`/applications/${application.id}`);
    } catch (err) {
      setAddJobError(err instanceof Error ? err.message : "Failed to add job.");
    } finally {
      setAddingJob(false);
    }
  }

  const visibleApplications = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = query ? applications.filter((app) => matchesSearch(app, query)) : applications;
    return [...filtered].sort((a, b) => compareApplications(sortKey, a, b));
  }, [applications, search, sortKey]);

  const applicationsByStatus = useMemo(() => {
    const grouped = {} as Record<ApplicationStatus, Application[]>;
    for (const status of STATUS_ORDER) grouped[status] = [];
    for (const app of visibleApplications) grouped[app.status].push(app);
    return grouped;
  }, [visibleApplications]);

  async function handleStatusChange(id: string, status: ApplicationStatus) {
    const previous = applications;
    setApplications((apps) => apps.map((a) => (a.id === id ? { ...a, status } : a)));
    try {
      const res = await apiFetch(`/api/applications/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("Update failed.");
      // The server may auto-stamp appliedDate on the first move to APPLIED.
      const data = (await res.json()) as { application: Application };
      setApplications((apps) =>
        apps.map((a) =>
          a.id === id ? { ...a, appliedDate: data.application.appliedDate } : a
        )
      );
    } catch {
      setApplications(previous);
      setError("Failed to update status. Please try again.");
    }
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Applications</h1>
          <p className="mt-1 text-sm text-gray-500">
            Track and manage every role you&apos;re pursuing.
          </p>
        </div>

        <form
          onSubmit={handleAddJob}
          className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
        >
          <h2 className="text-sm font-medium text-gray-700">Add a job</h2>
          <p className="mt-1 text-sm text-gray-500">
            Enter the posting&apos;s details to add it to your tracker.
          </p>

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="jobUrl" className="block text-xs font-medium text-gray-700">
                Job URL
              </label>
              <div className="mt-1">
                <CopyField value={jobUrl}>
                  <input
                    id="jobUrl"
                    type="url"
                    required
                    value={jobUrl}
                    onChange={(e) => setJobUrl(e.target.value)}
                    placeholder="https://…"
                    disabled={addingJob}
                    className={`w-full pr-9 ${inputClassName}`}
                  />
                </CopyField>
              </div>
            </div>
            <div>
              <label htmlFor="title" className="block text-xs font-medium text-gray-700">
                Title
              </label>
              <div className="mt-1">
                <CopyField value={title}>
                  <input
                    id="title"
                    type="text"
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    disabled={addingJob}
                    className={`w-full pr-9 ${inputClassName}`}
                  />
                </CopyField>
              </div>
            </div>
            <div>
              <label htmlFor="companyName" className="block text-xs font-medium text-gray-700">
                Company
              </label>
              <div className="mt-1">
                <CompanyInput
                  id="companyName"
                  required
                  value={companyName}
                  onChange={setCompanyName}
                  disabled={addingJob}
                />
              </div>
            </div>
            <div>
              <label htmlFor="location" className="block text-xs font-medium text-gray-700">
                Location
              </label>
              <div className="mt-1">
                <LocationInput
                  id="location"
                  value={locations}
                  onChange={setLocations}
                  disabled={addingJob}
                />
              </div>
            </div>
            <div>
              <label htmlFor="salary" className="block text-xs font-medium text-gray-700">
                Salary
              </label>
              <div className="mt-1">
                <CopyField value={salary}>
                  <input
                    id="salary"
                    type="text"
                    value={salary}
                    onChange={(e) => setSalary(e.target.value)}
                    disabled={addingJob}
                    placeholder="e.g. $120k–$150k, or DOE"
                    className={`w-full pr-9 ${inputClassName}`}
                  />
                </CopyField>
              </div>
            </div>
            <div>
              <label htmlFor="source" className="block text-xs font-medium text-gray-700">
                Where you found it
              </label>
              <div className="mt-1">
                <SourceInput
                  id="source"
                  value={source}
                  onChange={setSource}
                  disabled={addingJob}
                />
              </div>
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="description" className="block text-xs font-medium text-gray-700">
                Description
              </label>
              <div className="mt-1">
                <CopyField value={description} multiline>
                  <textarea
                    id="description"
                    rows={3}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    disabled={addingJob}
                    className={`w-full pr-9 ${inputClassName}`}
                  />
                </CopyField>
              </div>
            </div>
          </div>

          <div className="mt-3 flex items-center gap-3">
            <button
              type="submit"
              disabled={addingJob || !jobUrl.trim() || !title.trim() || !companyName.trim()}
              className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {addingJob ? "Adding…" : "Add job"}
            </button>
            {addJobError && <p className="text-sm text-red-700">{addJobError}</p>}
          </div>
        </form>

        {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>}

        {loading && <p className="text-sm text-gray-500">Loading applications…</p>}

        {!loading && applications.length === 0 && (
          <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center">
            <p className="text-sm text-gray-500">
              No applications yet — add a job above to get started.
            </p>
          </div>
        )}

        {!loading && applications.length > 0 && (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search company, title, location, source…"
              aria-label="Search applications"
              className={`w-full sm:max-w-xs ${inputClassName}`}
            />
            <label className="flex items-center gap-2 text-sm text-gray-500">
              <span className="whitespace-nowrap">Sort by</span>
              <select
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as SortKey)}
                className={`bg-white ${inputClassName}`}
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        {!loading && applications.length > 0 && visibleApplications.length === 0 && (
          <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center">
            <p className="text-sm text-gray-500">
              No applications match &ldquo;{search.trim()}&rdquo;.
            </p>
          </div>
        )}

        {!loading && visibleApplications.length > 0 && (
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
                              {formatCalendarDate(app.appliedDate)}
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
                            Applied {formatCalendarDate(app.appliedDate)}
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
