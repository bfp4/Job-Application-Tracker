"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import CollapsibleCard, { Chevron, useCollapsible } from "@/components/CollapsibleCard";
import StatusBadge from "@/components/StatusBadge";
import LocationInput from "@/components/LocationInput";
import CompanyInput from "@/components/CompanyInput";
import { CopyField } from "@/components/CopyButton";
import SourceInput from "@/components/SourceInput";
import { apiFetch, apiJson } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { STATUS_ORDER, statusLabel } from "@/lib/status";
import { inputClassName } from "@/lib/ui";
import { useAuth } from "@/context/AuthContext";
import type { Application, ApplicationStatus, JobPosting, ScrapedPosting } from "@/lib/types";

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
  const [scraping, setScraping] = useState(false);
  const [autofillNote, setAutofillNote] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("createdAt-desc");

  // Collapsed by default so the list is the first thing on the page; the empty
  // state offers a button that opens it.
  const addJobCard = useCollapsible("add-job", false);

  // The dashboard's "Add a job" button links here with ?add=1 — honour it so the
  // form is open on arrival. Read from `window` rather than `useSearchParams` to
  // keep this page statically prerenderable.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("add") === "1") {
      addJobCard.setOpen(true);
    }
    // Mount-only: a later collapse by the user must stick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  async function handleAutofill() {
    const url = jobUrl.trim();
    if (!url || scraping || addingJob) return;

    setScraping(true);
    setAutofillNote(null);
    setAddJobError(null);
    try {
      const { jobPosting } = await apiJson<{ source: string; jobPosting: ScrapedPosting }>(
        "/api/jobs/scrape",
        { method: "POST", body: JSON.stringify({ url }) },
      );
      setTitle(jobPosting.title);
      setCompanyName(jobPosting.companyName);
      setLocations(jobPosting.location);
      setSalary(jobPosting.salary ?? "");
      setDescription(jobPosting.description ?? "");
      // Prefer the board's canonical URL over whatever the user pasted.
      if (jobPosting.jobUrl) setJobUrl(jobPosting.jobUrl);
      setAutofillNote("Filled in from the posting — review the details before saving.");
    } catch (err) {
      setAddJobError(
        err instanceof Error ? err.message : "Couldn't autofill from that URL.",
      );
    } finally {
      setScraping(false);
    }
  }

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

        <CollapsibleCard
          storageKey="add-job"
          state={addJobCard}
          padding="sm"
          title="Add a job"
          titleClassName="text-sm font-medium text-gray-700"
          meta={addJobCard.open ? undefined : "Paste a link or enter the details"}
        >
          <form onSubmit={handleAddJob}>
            <p className="text-sm text-gray-500">
              Enter the posting&apos;s details to add it to your tracker.
            </p>

            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label htmlFor="jobUrl" className="block text-xs font-medium text-gray-700">
                  Job URL
                </label>
                <div className="mt-1 flex gap-2">
                  <div className="flex-1">
                    <CopyField value={jobUrl}>
                      <input
                        id="jobUrl"
                        type="url"
                        required
                        value={jobUrl}
                        onChange={(e) => setJobUrl(e.target.value)}
                        placeholder="https://…"
                        disabled={addingJob || scraping}
                        className={`w-full pr-9 ${inputClassName}`}
                      />
                    </CopyField>
                  </div>
                  <button
                    type="button"
                    onClick={handleAutofill}
                    disabled={addingJob || scraping || !jobUrl.trim()}
                    className="shrink-0 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {scraping ? "Autofilling…" : "Autofill"}
                  </button>
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  Paste an AshbyHQ or Greenhouse job link and we&apos;ll fill in the details
                  for you.
                </p>
                {autofillNote && <p className="mt-1 text-xs text-green-700">{autofillNote}</p>}
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
        </CollapsibleCard>

        {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>}

        {loading && <p className="text-sm text-gray-500">Loading applications…</p>}

        {!loading && applications.length === 0 && (
          <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center">
            <p className="text-sm text-gray-500">No applications yet.</p>
            <button
              type="button"
              onClick={() => addJobCard.setOpen(true)}
              className="mt-3 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
            >
              Add your first job
            </button>
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
                <StatusSection
                  key={status}
                  status={status}
                  applications={apps}
                  onStatusChange={handleStatusChange}
                />
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}

/**
 * One status group in the list — a collapsible section (state remembered per
 * status) whose rows expand in place to show the rest of the posting without
 * leaving the page.
 */
function StatusSection({
  status,
  applications,
  onStatusChange,
}: {
  status: ApplicationStatus;
  applications: Application[];
  onStatusChange: (id: string, status: ApplicationStatus) => void;
}) {
  const router = useRouter();
  const { open, toggle } = useCollapsible(`status-${status}`, true);
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const bodyId = `status-group-${status}`;

  function toggleExpanded(id: string) {
    setExpandedIds((ids) =>
      ids.includes(id) ? ids.filter((current) => current !== id) : [...ids, id]
    );
  }

  return (
    <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={bodyId}
        className={`flex w-full items-center gap-2 bg-gray-50 px-4 py-3 text-left ${
          open ? "border-b border-gray-200" : ""
        }`}
      >
        <Chevron open={open} />
        <StatusBadge status={status} />
        <span className="text-sm text-gray-500">
          {applications.length} {applications.length === 1 ? "application" : "applications"}
        </span>
      </button>

      <div id={bodyId} hidden={!open}>
        <table className="hidden w-full table-fixed text-left text-sm sm:table">
          <colgroup>
            <col className="w-10" />
            <col />
            <col />
            <col className="w-40" />
            <col className="w-32" />
          </colgroup>
          <thead className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-2 py-3">
                <span className="sr-only">Expand</span>
              </th>
              <th className="px-4 py-3 font-medium">Company</th>
              <th className="px-4 py-3 font-medium">Title</th>
              <th className="px-4 py-3 font-medium">Move to</th>
              <th className="px-4 py-3 font-medium">Applied</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {applications.map((app) => {
              const companyName = app.jobPosting?.company?.name ?? "—";
              const jobTitle = app.jobPosting?.title ?? "—";
              const expanded = expandedIds.includes(app.id);

              return (
                <Fragment key={app.id}>
                  <tr
                    onClick={() => router.push(`/applications/${app.id}`)}
                    className="cursor-pointer hover:bg-gray-50"
                  >
                    <td className="px-2 py-3" onClick={(e) => e.stopPropagation()}>
                      <ExpandButton
                        expanded={expanded}
                        label={`${expanded ? "Hide" : "Show"} details for ${jobTitle} at ${companyName}`}
                        controls={`${bodyId}-details-${app.id}`}
                        onClick={() => toggleExpanded(app.id)}
                      />
                    </td>
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
                        onChange={(nextStatus) => onStatusChange(app.id, nextStatus)}
                      />
                    </td>
                    <td className="truncate px-4 py-3 text-gray-500">
                      {formatDate(app.appliedDate)}
                    </td>
                  </tr>
                  {expanded && (
                    <tr id={`${bodyId}-details-${app.id}`} className="bg-gray-50">
                      <td colSpan={5} className="px-4 py-4">
                        <ApplicationDetails application={app} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>

        <ul className="divide-y divide-gray-100 sm:hidden">
          {applications.map((app) => {
            const expanded = expandedIds.includes(app.id);

            return (
              <li key={app.id} className="p-4">
                <div className="flex items-start gap-2">
                  <Link href={`/applications/${app.id}`} className="block min-w-0 flex-1">
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
                  <ExpandButton
                    expanded={expanded}
                    label={`${expanded ? "Hide" : "Show"} details for ${
                      app.jobPosting?.title ?? "this job"
                    }`}
                    controls={`${bodyId}-mobile-details-${app.id}`}
                    onClick={() => toggleExpanded(app.id)}
                  />
                </div>
                {expanded && (
                  <div
                    id={`${bodyId}-mobile-details-${app.id}`}
                    className="mt-3 rounded-lg bg-gray-50 p-3"
                  >
                    <ApplicationDetails application={app} />
                  </div>
                )}
                <div className="mt-3">
                  <StatusSelect
                    value={app.status}
                    onChange={(nextStatus) => onStatusChange(app.id, nextStatus)}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

/** The chevron that expands a single job's details inside the list. */
function ExpandButton({
  expanded,
  label,
  controls,
  onClick,
}: {
  expanded: boolean;
  label: string;
  controls: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={expanded}
      aria-controls={expanded ? controls : undefined}
      aria-label={label}
      title={label}
      className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
    >
      <Chevron open={expanded} />
    </button>
  );
}

/**
 * The posting details that don't fit in a list row — everything the list
 * endpoint already returns, so expanding costs no extra request.
 */
function ApplicationDetails({ application }: { application: Application }) {
  const posting = application.jobPosting;
  const allFacts: { label: string; value: string | null }[] = [
    { label: "Location", value: posting?.location?.length ? posting.location.join(", ") : null },
    { label: "Salary", value: posting?.salary ?? null },
    { label: "Where you found it", value: application.source },
    {
      label: "Applied",
      value: application.appliedDate ? formatDate(application.appliedDate) : null,
    },
    { label: "Posted", value: posting?.postedDate ? formatDate(posting.postedDate) : null },
    { label: "Added", value: formatDate(application.createdAt) },
  ];
  const facts = allFacts.filter(
    (fact): fact is { label: string; value: string } => fact.value !== null
  );

  const openFollowUps = (application.followUps ?? []).filter((followUp) => !followUp.completed);

  return (
    <div className="space-y-3 text-sm">
      {facts.length > 0 && (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
          {facts.map((fact) => (
            <div key={fact.label} className="min-w-0">
              <dt className="text-xs uppercase tracking-wide text-gray-400">{fact.label}</dt>
              <dd className="truncate text-gray-700" title={fact.value}>
                {fact.value}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {openFollowUps.length > 0 && (
        <DetailBlock label="Open follow-ups">
          <ul className="space-y-1 text-gray-700">
            {openFollowUps.map((followUp) => (
              <li key={followUp.id}>
                {formatDate(followUp.followUpDate)}
                {followUp.note ? ` — ${followUp.note}` : ""}
              </li>
            ))}
          </ul>
        </DetailBlock>
      )}

      {application.notes && (
        <DetailBlock label="Notes">
          <p className="whitespace-pre-line text-gray-700">{application.notes}</p>
        </DetailBlock>
      )}

      {posting?.description && (
        <DetailBlock label="Description">
          <p className="max-h-40 overflow-y-auto whitespace-pre-line text-gray-700">
            {posting.description}
          </p>
        </DetailBlock>
      )}

      <div className="flex flex-wrap items-center gap-4">
        <Link
          href={`/applications/${application.id}`}
          className="font-medium text-gray-900 underline"
        >
          Open application
        </Link>
        {posting?.jobUrl && (
          <a
            href={posting.jobUrl}
            target="_blank"
            rel="noreferrer"
            className="text-gray-500 underline hover:text-gray-900"
          >
            View posting ↗
          </a>
        )}
      </div>
    </div>
  );
}

function DetailBlock({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-gray-400">{label}</p>
      <div className="mt-1">{children}</div>
    </div>
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
