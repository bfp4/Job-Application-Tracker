"use client";

import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import StatusBadge from "@/components/StatusBadge";
import { apiFetch } from "@/lib/api";
import { formatDate } from "@/lib/format";
import {
  JOBS_CSV_TEMPLATE,
  parseJobsCsv,
  type ParsedJobRow,
} from "@/lib/parseJobsCsv";
import { STATUS_ORDER, statusLabel } from "@/lib/status";
import { useAuth } from "@/context/AuthContext";
import type { Application, ApplicationStatus } from "@/lib/types";

const inputClassName =
  "rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none";

export default function ApplicationsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

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

  const applicationsByStatus = useMemo(() => {
    const grouped = {} as Record<ApplicationStatus, Application[]>;
    for (const status of STATUS_ORDER) grouped[status] = [];
    for (const app of applications) grouped[app.status].push(app);
    return grouped;
  }, [applications]);

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
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setShowAddForm((open) => !open)}
              className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              {showAddForm ? "Cancel" : "Add job"}
            </button>
            <Link
              href="/search"
              className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
            >
              Find jobs
            </Link>
          </div>
        </div>

        {showAddForm && (
          <AddJobPanel
            onCancel={() => setShowAddForm(false)}
            onSingleSuccess={(application) => {
              setShowAddForm(false);
              setApplications((apps) => [application, ...apps]);
              router.push(`/applications/${application.id}`);
            }}
            onImportSuccess={(imported, failed) => {
              setApplications((apps) => [...imported, ...apps]);
              if (failed.length === 0) {
                setShowAddForm(false);
              } else {
                setError(
                  `Imported ${imported.length} job${imported.length === 1 ? "" : "s"}. ${failed.length} row${failed.length === 1 ? "" : "s"} failed — see details below.`
                );
              }
            }}
            onError={setError}
          />
        )}

        {error && (
          <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {loading && <p className="text-sm text-gray-500">Loading applications…</p>}

        {!loading && applications.length === 0 && !showAddForm && (
          <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center">
            <p className="text-sm text-gray-500">
              No applications yet — search for jobs or add one manually.
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => setShowAddForm(true)}
                className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Add job manually
              </button>
              <Link
                href="/search"
                className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
              >
                Search jobs
              </Link>
            </div>
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
                      {apps.length}{" "}
                      {apps.length === 1 ? "application" : "applications"}
                    </span>
                  </div>

                  {/* Desktop table */}
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
                        const companyName = app.company?.name ?? "—";
                        const jobTitle = app.jobPosting?.title ?? "—";

                        return (
                          <tr
                            key={app.id}
                            onClick={() =>
                              router.push(`/applications/${app.id}`)
                            }
                            className="cursor-pointer hover:bg-gray-50"
                          >
                            <td
                              className="max-w-0 truncate px-4 py-3 font-medium text-gray-900"
                              title={companyName}
                            >
                              {companyName}
                            </td>
                            <td
                              className="max-w-0 truncate px-4 py-3 text-gray-700"
                              title={jobTitle}
                            >
                              {jobTitle}
                            </td>
                            <td
                              className="px-4 py-3"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <StatusSelect
                                value={app.status}
                                onChange={(nextStatus) =>
                                  handleStatusChange(app.id, nextStatus)
                                }
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

                  {/* Mobile cards */}
                  <ul className="divide-y divide-gray-100 sm:hidden">
                    {apps.map((app) => (
                      <li key={app.id} className="p-4">
                        <Link
                          href={`/applications/${app.id}`}
                          className="block min-w-0"
                        >
                          <p
                            className="truncate font-medium text-gray-900"
                            title={app.company?.name ?? undefined}
                          >
                            {app.company?.name ?? "—"}
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
                            onChange={(nextStatus) =>
                              handleStatusChange(app.id, nextStatus)
                            }
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

function AddJobPanel({
  onCancel,
  onSingleSuccess,
  onImportSuccess,
  onError,
}: {
  onCancel: () => void;
  onSingleSuccess: (application: Application) => void;
  onImportSuccess: (
    applications: Application[],
    failed: { row: number; error: string }[]
  ) => void;
  onError: (message: string | null) => void;
}) {
  const [mode, setMode] = useState<"single" | "csv">("single");

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Add jobs</h2>
          <p className="mt-1 text-sm text-gray-500">
            Enter one role at a time or import many from a CSV file.
          </p>
        </div>
        <div className="flex rounded-lg border border-gray-200 p-1 text-sm">
          <button
            type="button"
            onClick={() => setMode("single")}
            className={`rounded-md px-3 py-1.5 font-medium ${
              mode === "single"
                ? "bg-gray-900 text-white"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            Single job
          </button>
          <button
            type="button"
            onClick={() => setMode("csv")}
            className={`rounded-md px-3 py-1.5 font-medium ${
              mode === "csv"
                ? "bg-gray-900 text-white"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            Import CSV
          </button>
        </div>
      </div>

      <div className="mt-4">
        {mode === "single" ? (
          <AddJobForm
            embedded
            onCancel={onCancel}
            onSuccess={onSingleSuccess}
            onError={onError}
          />
        ) : (
          <ImportJobsCsvForm
            onCancel={onCancel}
            onSuccess={onImportSuccess}
            onError={onError}
          />
        )}
      </div>
    </section>
  );
}

function AddJobForm({
  onCancel,
  onSuccess,
  onError,
  embedded = false,
}: {
  onCancel: () => void;
  onSuccess: (application: Application) => void;
  onError: (message: string | null) => void;
  embedded?: boolean;
}) {
  const [companyName, setCompanyName] = useState("");
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [jobUrl, setJobUrl] = useState("");
  const [status, setStatus] = useState<ApplicationStatus>("NOT_APPLIED");
  const [appliedDate, setAppliedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    onError(null);
    setSubmitting(true);

    try {
      const res = await apiFetch("/api/applications", {
        method: "POST",
        body: JSON.stringify({
          companyName: companyName.trim(),
          title: title.trim(),
          location: location.trim() || null,
          jobUrl: jobUrl.trim() || null,
          status,
          appliedDate: appliedDate || null,
          notes: notes.trim() || null,
        }),
      });

      const data = (await res.json()) as {
        application?: Application;
        error?: string;
      };

      if (!res.ok || !data.application) {
        throw new Error(data.error ?? "Failed to add job.");
      }

      onSuccess(data.application);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to add job.";
      setFormError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      {!embedded && (
        <>
          <h2 className="text-base font-semibold text-gray-900">Add job manually</h2>
          <p className="mt-1 text-sm text-gray-500">
            Track a role you found outside the app — referral, company site, or
            anywhere else.
          </p>
        </>
      )}

      {formError && (
        <div className={`${embedded ? "mt-0" : "mt-4"} rounded-md bg-red-50 p-3 text-sm text-red-700`}>
          {formError}
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className={`grid grid-cols-1 gap-3 sm:grid-cols-2 ${embedded ? "" : "mt-4"}`}
      >
        <input
          type="text"
          required
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
          placeholder="Company name *"
          className={inputClassName}
        />
        <input
          type="text"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Job title *"
          className={inputClassName}
        />
        <input
          type="text"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="Location"
          className={inputClassName}
        />
        <input
          type="url"
          value={jobUrl}
          onChange={(e) => setJobUrl(e.target.value)}
          placeholder="Job posting URL"
          className={inputClassName}
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as ApplicationStatus)}
          className={inputClassName}
        >
          {STATUS_ORDER.map((option) => (
            <option key={option} value={option}>
              {statusLabel(option)}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={appliedDate}
          onChange={(e) => setAppliedDate(e.target.value)}
          className={inputClassName}
          aria-label="Applied date"
        />
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes"
          rows={3}
          className={`${inputClassName} sm:col-span-2`}
        />
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          <button
            type="submit"
            disabled={
              submitting || companyName.trim() === "" || title.trim() === ""
            }
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {submitting ? "Adding…" : "Add application"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

function ImportJobsCsvForm({
  onCancel,
  onSuccess,
  onError,
}: {
  onCancel: () => void;
  onSuccess: (
    applications: Application[],
    failed: { row: number; error: string }[]
  ) => void;
  onError: (message: string | null) => void;
}) {
  const [parsedJobs, setParsedJobs] = useState<ParsedJobRow[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [importSummary, setImportSummary] = useState<{
    created: number;
    failed: { row: number; error: string }[];
  } | null>(null);

  function downloadTemplate() {
    const blob = new Blob([JOBS_CSV_TEMPLATE], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "jobs-template.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setFormError(null);
    setImportSummary(null);
    onError(null);

    if (!file) {
      setParsedJobs([]);
      setParseErrors([]);
      setFileName(null);
      return;
    }

    try {
      const text = await file.text();
      const result = parseJobsCsv(text);
      setParsedJobs(result.jobs);
      setParseErrors(result.errors);
      setFileName(file.name);
    } catch {
      setParsedJobs([]);
      setParseErrors(["Failed to read CSV file."]);
      setFileName(file.name);
    }

    e.target.value = "";
  }

  async function handleImport() {
    if (parsedJobs.length === 0) return;

    setSubmitting(true);
    setFormError(null);
    setImportSummary(null);
    onError(null);

    try {
      const res = await apiFetch("/api/applications/import", {
        method: "POST",
        body: JSON.stringify({ jobs: parsedJobs }),
      });

      const data = (await res.json()) as {
        created?: Application[];
        failed?: { row: number; error: string }[];
        summary?: { total: number; created: number; failed: number };
        error?: string;
      };

      const created = data.created ?? [];
      const failed = data.failed ?? [];

      // Pure server error (e.g. bad request before any rows were processed)
      if (!res.ok && created.length === 0 && failed.length === 0) {
        throw new Error(data.error ?? "Failed to import jobs.");
      }

      setImportSummary({ created: created.length, failed });

      if (created.length > 0) {
        onSuccess(created, failed);
      } else {
        setFormError("No jobs were imported. Fix the errors below and try again.");
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to import jobs.";
      setFormError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md bg-gray-50 p-4 text-sm text-gray-600">
        <p>
          Upload a CSV with a header row. Required columns:{" "}
          <span className="font-medium text-gray-900">company</span>,{" "}
          <span className="font-medium text-gray-900">title</span>.
        </p>
        <p className="mt-2">
          Optional columns: location, job_url, status, applied_date, notes.
          Status values can be enum names (APPLIED) or labels (Phone screen).
        </p>
        <button
          type="button"
          onClick={downloadTemplate}
          className="mt-3 text-sm font-medium text-gray-900 underline hover:no-underline"
        >
          Download template CSV
        </button>
      </div>

      <input
        type="file"
        accept=".csv,text/csv"
        onChange={handleFileChange}
        className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-md file:border-0 file:bg-gray-900 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-gray-800"
      />

      {fileName && (
        <p className="text-sm text-gray-500">
          Selected file: <span className="font-medium text-gray-700">{fileName}</span>
        </p>
      )}

      {parseErrors.length > 0 && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          <p className="font-medium">CSV errors</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {parseErrors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      )}

      {parsedJobs.length > 0 && parseErrors.length === 0 && (
        <div className="rounded-md border border-gray-200">
          <div className="border-b border-gray-200 bg-gray-50 px-4 py-2 text-sm text-gray-600">
            {parsedJobs.length}{" "}
            {parsedJobs.length === 1 ? "job ready" : "jobs ready"} to import
          </div>
          <div className="max-h-48 overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-gray-100 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Company</th>
                  <th className="px-4 py-2 font-medium">Title</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {parsedJobs.slice(0, 8).map((job, index) => (
                  <tr key={`${job.companyName}-${job.title}-${index}`}>
                    <td className="max-w-0 truncate px-4 py-2">{job.companyName}</td>
                    <td className="max-w-0 truncate px-4 py-2">{job.title}</td>
                    <td className="px-4 py-2 text-gray-500">
                      {job.status ? statusLabel(job.status) : "Not applied"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {parsedJobs.length > 8 && (
            <p className="border-t border-gray-100 px-4 py-2 text-xs text-gray-400">
              And {parsedJobs.length - 8} more…
            </p>
          )}
        </div>
      )}

      {formError && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          {formError}
        </div>
      )}

      {importSummary && importSummary.failed.length > 0 && (
        <div className="rounded-md bg-yellow-50 p-3 text-sm text-yellow-800">
          <p>
            Imported {importSummary.created} job
            {importSummary.created === 1 ? "" : "s"}. {importSummary.failed.length}{" "}
            row{importSummary.failed.length === 1 ? "" : "s"} failed.
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {importSummary.failed.map((failure) => (
              <li key={`${failure.row}-${failure.error}`}>
                Row {failure.row}: {failure.error}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleImport}
          disabled={submitting || parsedJobs.length === 0 || parseErrors.length > 0}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {submitting ? "Importing…" : parsedJobs.length > 0 ? `Import ${parsedJobs.length} jobs` : "Import jobs"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
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
