"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import CompanyLogo from "@/components/CompanyLogo";
import RowMenu from "@/components/RowMenu";
import { Chevron, useCollapsible } from "@/components/CollapsibleCard";
import LocationInput from "@/components/LocationInput";
import CompanyInput from "@/components/CompanyInput";
import { CopyField } from "@/components/CopyButton";
import SourceInput from "@/components/SourceInput";
import { apiFetch, apiJson } from "@/lib/api";
import { formatDate, todayInputValue } from "@/lib/format/format";
import {
  SORT_OPTIONS,
  visibleApplications as selectVisibleApplications,
  type SortKey,
} from "@/lib/applicationList/applicationList";
import { STATUS_ORDER, statusDotClasses, statusLabel } from "@/lib/status/status";
import {
  btnPrimary,
  btnPrimarySm,
  btnSecondary,
  cardClassName,
  emptyStateClassName,
  inputClassName,
  labelClassName,
  selectClassName,
} from "@/lib/ui";
import { useAuth } from "@/context/AuthContext";
import {
  IconBriefcase,
  IconClose,
  IconExternalLink,
  IconPlus,
  IconSearch,
  IconSparkles,
  IconTrash,
} from "@/components/icons";
import type {
  Application,
  ApplicationStatus,
  JobPosting,
  ScrapedPosting,
} from "@/lib/types";

type StatusFilter = ApplicationStatus | "ALL";

export default function ApplicationsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("createdAt-desc");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");

  // Collapsed by default so the list is the first thing on the page.
  const addJobCard = useCollapsible("add-job", false);

  /**
   * Honour the query the dashboard links in with — ?add=1 opens the form,
   * ?status=INTERVIEW preselects the filter (the stat tiles drill in that way).
   * Read from `window` rather than `useSearchParams` to keep this page
   * statically prerenderable.
   */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("add") === "1") addJobCard.setOpen(true);

    const status = params.get("status");
    if (status && (STATUS_ORDER as string[]).includes(status)) {
      setStatusFilter(status as ApplicationStatus);
    }
    // Mount-only: later changes by the user must stick.
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
    if (!authLoading && user) void loadApplications();
  }, [authLoading, user, loadApplications]);

  const visibleApplications = useMemo(
    () => selectVisibleApplications(applications, search, sortKey),
    [applications, search, sortKey]
  );

  const applicationsByStatus = useMemo(() => {
    const grouped = {} as Record<ApplicationStatus, Application[]>;
    for (const status of STATUS_ORDER) grouped[status] = [];
    for (const app of visibleApplications) grouped[app.status].push(app);
    return grouped;
  }, [visibleApplications]);

  const shownStatuses = STATUS_ORDER.filter(
    (status) => statusFilter === "ALL" || statusFilter === status
  );
  const matchCount = shownStatuses.reduce(
    (total, status) => total + applicationsByStatus[status].length,
    0
  );
  const filtered = search.trim() !== "" || statusFilter !== "ALL";

  async function handleStatusChange(id: string, status: ApplicationStatus) {
    const previous = applications;
    setApplications((apps) => apps.map((a) => (a.id === id ? { ...a, status } : a)));
    try {
      const res = await apiFetch(`/api/applications/${id}`, {
        method: "PATCH",
        // occurredAt dates the timeline entry the server logs for this change.
        // Sent from here because only the browser knows the user's calendar
        // day — the server's UTC day is already tomorrow for an evening change
        // west of UTC.
        body: JSON.stringify({ status, occurredAt: todayInputValue() }),
      });
      if (!res.ok) throw new Error("Update failed.");
    } catch {
      setApplications(previous);
      setError("Failed to update status. Please try again.");
    }
  }

  async function handleDelete(app: Application) {
    const label = app.jobPosting?.company?.name ?? "this application";
    if (
      !confirm(
        `Delete ${label}? Its follow-ups, questions, contacts and generated documents go with it. This cannot be undone.`
      )
    ) {
      return;
    }

    const previous = applications;
    setApplications((apps) => apps.filter((a) => a.id !== app.id));
    try {
      const res = await apiFetch(`/api/applications/${app.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed.");
    } catch {
      setApplications(previous);
      setError("Failed to delete that application.");
    }
  }

  return (
    <AppShell>
      <div className="space-y-5">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-ink sm:text-[28px]">Applications</h1>
            <p className="mt-1 text-sm font-medium text-muted">
              Track and manage every role you&apos;re pursuing.
            </p>
          </div>
          <button
            type="button"
            onClick={() => addJobCard.setOpen(!addJobCard.open)}
            className={btnPrimarySm}
            aria-expanded={addJobCard.open}
          >
            {addJobCard.open ? <IconClose size={16} /> : <IconPlus size={16} />}
            {addJobCard.open ? "Close" : "Add application"}
          </button>
        </header>

        {/*
          Hidden rather than unmounted: the header button is a toggle, and
          closing it must not throw away a typed URL or the posting an autofill
          scrape just fetched.
        */}
        <div hidden={!addJobCard.open}>
          <AddJobForm
            onAdded={(application) => router.push(`/applications/${application.id}`)}
          />
        </div>

        {error && (
          <div className="rounded-xl border border-danger-ring bg-danger-soft px-4 py-3 text-sm font-medium text-red-700">
            {error}
          </div>
        )}

        {loading && <ListSkeleton />}

        {!loading && applications.length === 0 && (
          <div className={emptyStateClassName}>
            <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-subtle text-muted">
              <IconBriefcase size={22} />
            </span>
            <p className="mt-3 text-sm font-semibold text-ink">No applications yet</p>
            <p className="mt-1 text-sm text-muted">
              Paste a job link and we&apos;ll fill in the details for you.
            </p>
            <button
              type="button"
              onClick={() => addJobCard.setOpen(true)}
              className={`${btnPrimary} mx-auto mt-4`}
            >
              <IconPlus size={16} />
              Add your first job
            </button>
          </div>
        )}

        {!loading && applications.length > 0 && (
          <>
            {/*
              Search takes its own row on mobile with the two selects paired
              beneath it; `sm:contents` dissolves that pairing wrapper so all
              three sit on one row from `sm` up.
            */}
            <div className="space-y-2.5 sm:flex sm:items-center sm:gap-2.5 sm:space-y-0">
              <div className="relative flex-1">
                <IconSearch
                  size={16}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
                />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search companies, roles, or keywords…"
                  aria-label="Search applications"
                  className={`w-full pl-9 ${inputClassName}`}
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5 sm:contents">
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                  aria-label="Filter by status"
                  className={`${selectClassName} w-full sm:w-44`}
                >
                  <option value="ALL">All statuses</option>
                  {STATUS_ORDER.map((status) => (
                    <option key={status} value={status}>
                      {statusLabel(status)}
                    </option>
                  ))}
                </select>

                <select
                  value={sortKey}
                  onChange={(e) => setSortKey(e.target.value as SortKey)}
                  aria-label="Sort applications"
                  className={`${selectClassName} w-full sm:w-52`}
                >
                  {SORT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      Sort: {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {matchCount === 0 ? (
              <div className={emptyStateClassName}>
                <p className="text-sm font-semibold text-ink">No matching applications</p>
                <p className="mt-1 text-sm text-muted">
                  {search.trim()
                    ? `Nothing matches “${search.trim()}”.`
                    : `Nothing is in ${statusLabel(statusFilter as ApplicationStatus)} yet.`}
                </p>
                {filtered && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearch("");
                      setStatusFilter("ALL");
                    }}
                    className={`${btnSecondary} mx-auto mt-4`}
                  >
                    Clear filters
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                {shownStatuses.map((status) => {
                  const apps = applicationsByStatus[status];
                  if (apps.length === 0) return null;
                  return (
                    <StatusGroup
                      key={status}
                      status={status}
                      applications={apps}
                      onStatusChange={handleStatusChange}
                      onDelete={handleDelete}
                    />
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}

/** One status section: a collapsible heading over its application rows. */
function StatusGroup({
  status,
  applications,
  onStatusChange,
  onDelete,
}: {
  status: ApplicationStatus;
  applications: Application[];
  onStatusChange: (id: string, status: ApplicationStatus) => void;
  onDelete: (application: Application) => void;
}) {
  const { open, toggle } = useCollapsible(`status-${status}`, true);
  const bodyId = `status-group-${status}`;

  return (
    <section>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={bodyId}
        className="group mb-2 flex items-center gap-2 rounded-lg px-1 py-1 text-left"
      >
        <Chevron open={open} />
        <span
          aria-hidden
          className={`h-2 w-2 rounded-full ${statusDotClasses(status)}`}
        />
        <span className="text-sm font-bold text-ink">{statusLabel(status)}</span>
        <span className="text-sm font-semibold text-muted">
          ({applications.length})
        </span>
      </button>

      <div id={bodyId} hidden={!open}>
        {/*
          No `overflow-hidden` here: it would clip the row overflow menu open
          on the last row. The rows round their own outer corners instead, so
          the hover fill still stops at the card's radius.
        */}
        <ul className={`${cardClassName} divide-y divide-border`}>
          {applications.map((app) => (
            <ApplicationRow
              key={app.id}
              application={app}
              onStatusChange={onStatusChange}
              onDelete={onDelete}
            />
          ))}
        </ul>
      </div>
    </section>
  );
}

function ApplicationRow({
  application,
  onStatusChange,
  onDelete,
}: {
  application: Application;
  onStatusChange: (id: string, status: ApplicationStatus) => void;
  onDelete: (application: Application) => void;
}) {
  const posting = application.jobPosting;
  const company = posting?.company?.name ?? "Unknown company";
  const meta = [posting?.location?.join(", "), posting?.salary, application.source]
    .filter(Boolean)
    .join(" · ");

  return (
    <li className="relative transition first:rounded-t-2xl last:rounded-b-2xl hover:bg-subtle/60">
      {/* The row is one big link; the controls on top of it stop propagation. */}
      <Link
        href={`/applications/${application.id}`}
        className="absolute inset-0 z-0"
        aria-label={`${posting?.title ?? "Role"} at ${company}`}
      />

      <div className="pointer-events-none relative z-10 flex items-center gap-3 px-4 py-3">
        <CompanyLogo name={company} size="md" />

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-ink">{company}</p>
          <p className="truncate text-xs font-medium text-muted">
            {posting?.title ?? "—"}
          </p>
          {meta && (
            <p className="mt-0.5 hidden truncate text-xs text-muted sm:block">{meta}</p>
          )}
        </div>

        <p className="hidden shrink-0 text-xs font-medium text-muted lg:block">
          {application.appliedDate
            ? `Applied ${formatDate(application.appliedDate)}`
            : `Added ${formatDate(application.createdAt)}`}
        </p>

        <div className="pointer-events-auto flex shrink-0 items-center gap-1.5">
          <select
            value={application.status}
            onChange={(e) =>
              onStatusChange(application.id, e.target.value as ApplicationStatus)
            }
            onClick={(e) => e.stopPropagation()}
            aria-label={`Status for ${company}`}
            className={`${selectClassName} h-8 w-[7.5rem] py-0 text-xs sm:w-36`}
          >
            {STATUS_ORDER.map((status) => (
              <option key={status} value={status}>
                {statusLabel(status)}
              </option>
            ))}
          </select>

          <RowMenu
            label={`Actions for ${company}`}
            items={[
              ...(posting?.jobUrl
                ? [
                    {
                      label: "View posting",
                      href: posting.jobUrl,
                      external: true,
                      icon: <IconExternalLink size={16} />,
                    },
                  ]
                : []),
              {
                label: "Delete",
                danger: true,
                icon: <IconTrash size={16} />,
                onSelect: () => onDelete(application),
              },
            ]}
          />
        </div>
      </div>
    </li>
  );
}

/**
 * The add-a-job panel. Two writes, not one transaction: if tracking fails
 * after the posting is saved, that posting is left with no application. It
 * stays invisible and costs nothing — POST /api/jobs upserts on (user, jobUrl),
 * so retrying this form reuses the same row rather than adding another.
 */
function AddJobForm({ onAdded }: { onAdded: (application: Application) => void }) {
  const [jobUrl, setJobUrl] = useState("");
  const [title, setTitle] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [locations, setLocations] = useState<string[]>([]);
  const [salary, setSalary] = useState("");
  const [source, setSource] = useState("");
  const [description, setDescription] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scraping, setScraping] = useState(false);
  const [autofillNote, setAutofillNote] = useState<string | null>(null);

  async function handleAutofill() {
    const url = jobUrl.trim();
    if (!url || scraping || adding) return;

    setScraping(true);
    setAutofillNote(null);
    setError(null);
    try {
      const { jobPosting } = await apiJson<{ source: string; jobPosting: ScrapedPosting }>(
        "/api/jobs/scrape",
        { method: "POST", body: JSON.stringify({ url }) }
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
      setError(err instanceof Error ? err.message : "Couldn't autofill from that URL.");
    } finally {
      setScraping(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!jobUrl.trim() || !title.trim() || !companyName.trim()) return;

    setAdding(true);
    setError(null);
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
      const { application } = await apiJson<{ application: Application }>(
        "/api/applications",
        {
          method: "POST",
          body: JSON.stringify({
            jobPostingId: jobPosting.id,
            source: source.trim() || null,
          }),
        }
      );
      onAdded(application);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add job.");
    } finally {
      setAdding(false);
    }
  }

  const canSubmit =
    jobUrl.trim() !== "" && title.trim() !== "" && companyName.trim() !== "";

  return (
    <form
      onSubmit={handleSubmit}
      className={`${cardClassName} animate-fade-in space-y-4 p-5`}
    >
      <div>
        <label htmlFor="jobUrl" className={labelClassName}>
          Job URL
        </label>
        <div className="mt-1.5 flex gap-2">
          <div className="flex-1">
            <CopyField value={jobUrl}>
              <input
                id="jobUrl"
                type="url"
                required
                value={jobUrl}
                onChange={(e) => setJobUrl(e.target.value)}
                placeholder="https://…"
                disabled={adding || scraping}
                className={`w-full pr-9 ${inputClassName}`}
              />
            </CopyField>
          </div>
          <button
            type="button"
            onClick={handleAutofill}
            disabled={adding || scraping || !jobUrl.trim()}
            className={btnSecondary}
          >
            <IconSparkles size={16} className={scraping ? "animate-pulse" : ""} />
            {scraping ? "Autofilling…" : "Autofill"}
          </button>
        </div>
        <p className="mt-1.5 text-xs font-medium text-muted">
          Paste an AshbyHQ or Greenhouse link and we&apos;ll fill in the rest.
        </p>
        {autofillNote && (
          <p className="mt-1.5 text-xs font-semibold text-emerald-700">{autofillNote}</p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="title" className={labelClassName}>
            Title
          </label>
          <div className="mt-1.5">
            <CopyField value={title}>
              <input
                id="title"
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={adding}
                placeholder="e.g. Software Engineer"
                className={`w-full pr-9 ${inputClassName}`}
              />
            </CopyField>
          </div>
        </div>

        <div>
          <label htmlFor="companyName" className={labelClassName}>
            Company
          </label>
          <div className="mt-1.5">
            <CompanyInput
              id="companyName"
              required
              value={companyName}
              onChange={setCompanyName}
              disabled={adding}
            />
          </div>
        </div>

        <div>
          <label htmlFor="location" className={labelClassName}>
            Location
          </label>
          <div className="mt-1.5">
            <LocationInput
              id="location"
              value={locations}
              onChange={setLocations}
              disabled={adding}
            />
          </div>
        </div>

        <div>
          <label htmlFor="salary" className={labelClassName}>
            Salary
          </label>
          <div className="mt-1.5">
            <CopyField value={salary}>
              <input
                id="salary"
                type="text"
                value={salary}
                onChange={(e) => setSalary(e.target.value)}
                disabled={adding}
                placeholder="e.g. $120k–$150k, or DOE"
                className={`w-full pr-9 ${inputClassName}`}
              />
            </CopyField>
          </div>
        </div>

        <div>
          <label htmlFor="source" className={labelClassName}>
            Where you found it
          </label>
          <div className="mt-1.5">
            <SourceInput
              id="source"
              value={source}
              onChange={setSource}
              disabled={adding}
            />
          </div>
        </div>
      </div>

      <div>
        <label htmlFor="description" className={labelClassName}>
          Description
        </label>
        <div className="mt-1.5">
          <CopyField value={description} multiline>
            <textarea
              id="description"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={adding}
              placeholder="Paste the posting text — the AI features read this."
              className={`w-full pr-9 ${inputClassName}`}
            />
          </CopyField>
        </div>
      </div>

      {error && (
        <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm font-medium text-red-700">
          {error}
        </p>
      )}

      <button type="submit" disabled={adding || !canSubmit} className={btnPrimary}>
        {adding ? "Adding…" : "Add job"}
      </button>
    </form>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      {Array.from({ length: 2 }).map((_, group) => (
        <div key={group}>
          <div className="mb-2 h-4 w-32 animate-pulse rounded bg-subtle" />
          <div className={`${cardClassName} divide-y divide-border`}>
            {Array.from({ length: 3 }).map((_, row) => (
              <div key={row} className="flex items-center gap-3 px-4 py-3">
                <div className="h-10 w-10 animate-pulse rounded-xl bg-subtle" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-32 animate-pulse rounded bg-subtle" />
                  <div className="h-3 w-48 animate-pulse rounded bg-subtle" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
