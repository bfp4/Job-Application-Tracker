"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import ApplicationChecklist from "@/components/ApplicationChecklist";
import CompanyLogo from "@/components/CompanyLogo";
import RowMenu from "@/components/RowMenu";
import ResumeTipsSection from "@/components/ResumeTipsSection";
import TailoredResumeSection from "@/components/TailoredResumeSection";
import CoverLetterSection from "@/components/CoverLetterSection";
import QuestionsSection from "@/components/QuestionsSection";
import ContactsSection from "@/components/ContactsSection";
import JobPostingForm, { type JobPostingEdits } from "@/components/JobPostingForm";
import { CopyField } from "@/components/CopyButton";
import SourceInput from "@/components/SourceInput";
import { apiFetch, apiJson } from "@/lib/api";
import { formatDate, relativeDayLabel, toDateInputValue, urgencyOf } from "@/lib/format";
import { STATUS_ORDER, statusLabel } from "@/lib/status";
import {
  btnPrimarySm,
  btnSecondarySm,
  cardClassName,
  inputClassName,
  labelClassName,
  selectClassName,
} from "@/lib/ui";
import { useAuth } from "@/context/AuthContext";
import {
  IconArrowLeft,
  IconCalendar,
  IconExternalLink,
  IconPencil,
  IconTrash,
} from "@/components/icons";
import type {
  Application,
  ApplicationQuestion,
  ApplicationStatus,
  Contact,
  FollowUp,
  JobPosting,
} from "@/lib/types";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "tips", label: "Resume tips" },
  { id: "resume", label: "Tailored resume" },
  { id: "letter", label: "Cover letter" },
  { id: "questions", label: "Questions" },
  { id: "contacts", label: "Contacts" },
  { id: "followups", label: "Follow-ups" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function isTabId(value: string | null): value is TabId {
  return TABS.some((tab) => tab.id === value);
}

/**
 * The workspace for one application.
 *
 * Replaces what used to be nine stacked cards: a persistent header carries the
 * facts that stay true whichever section you're in (company, role, status,
 * next follow-up), and the sections themselves become tabs so only one is on
 * screen at a time. Tabs are mounted lazily and unmounted on leave, so opening
 * this page no longer fires every section's fetch at once.
 */
export default function ApplicationDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [application, setApplication] = useState<Application | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingPosting, setEditingPosting] = useState(false);
  const [tab, setTab] = useState<TabId>("overview");
  // Bumped when a tab may have changed what the checklist reads.
  const [checklistKey, setChecklistKey] = useState(0);

  // Deep links (?tab=letter) and reloads keep their place.
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("tab");
    if (isTabId(requested)) setTab(requested);
  }, []);

  function selectTab(next: TabId) {
    setTab(next);
    const url = new URL(window.location.href);
    if (next === "overview") url.searchParams.delete("tab");
    else url.searchParams.set("tab", next);
    window.history.replaceState(null, "", url);
    // Coming back to Overview re-reads the document steps, which the tab the
    // user just left may have created.
    if (next === "overview") setChecklistKey((k) => k + 1);
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/applications/${id}`);
      if (res.status === 404) {
        setNotFound(true);
        return;
      }
      if (!res.ok) throw new Error("Failed to load application.");
      const data = (await res.json()) as { application: Application };
      setApplication(data.application);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (!authLoading && user) void load();
  }, [authLoading, user, load]);

  async function patchApplication(body: Record<string, unknown>) {
    const res = await apiFetch(`/api/applications/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error("Update failed.");
    const data = (await res.json()) as { application: Application };
    setApplication(data.application);
  }

  /**
   * Moving to Applied with no applied date on file fills in today's date. The
   * old flow left the user to remember, and the field was silently empty on
   * every application they'd advanced.
   */
  async function handleStatusChange(status: ApplicationStatus) {
    setError(null);
    const body: Record<string, unknown> = { status };
    if (status !== "NOT_APPLIED" && !application?.appliedDate) {
      body.appliedDate = new Date().toISOString().slice(0, 10);
    }
    try {
      await patchApplication(body);
      setChecklistKey((k) => k + 1);
    } catch {
      setError("Failed to update status.");
    }
  }

  async function handleSavePosting(edits: JobPostingEdits) {
    const postingId = application?.jobPosting?.id;
    if (!postingId) return;

    const { jobPosting } = await apiJson<{ jobPosting: JobPosting }>(
      `/api/jobs/${postingId}`,
      { method: "PATCH", body: JSON.stringify(edits) }
    );
    setApplication((prev) => (prev ? { ...prev, jobPosting } : prev));
    setEditingPosting(false);
  }

  async function handleDelete() {
    if (
      !confirm(
        "Delete this application? Its follow-ups, questions, contacts and generated documents go with it. This cannot be undone."
      )
    ) {
      return;
    }
    setError(null);
    try {
      const res = await apiFetch(`/api/applications/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed.");
      router.push("/applications");
    } catch {
      setError("Failed to delete application.");
    }
  }

  function setFollowUps(updater: (followUps: FollowUp[]) => FollowUp[]) {
    setApplication((prev) =>
      prev ? { ...prev, followUps: updater(prev.followUps ?? []) } : prev
    );
  }

  function setQuestions(
    updater: (questions: ApplicationQuestion[]) => ApplicationQuestion[]
  ) {
    setApplication((prev) =>
      prev ? { ...prev, questions: updater(prev.questions ?? []) } : prev
    );
  }

  function setContacts(updater: (contacts: Contact[]) => Contact[]) {
    setApplication((prev) =>
      prev ? { ...prev, contacts: updater(prev.contacts ?? []) } : prev
    );
  }

  const nextFollowUp = useMemo(() => {
    const open = (application?.followUps ?? [])
      .filter((f) => !f.completed)
      .sort(
        (a, b) => new Date(a.followUpDate).getTime() - new Date(b.followUpDate).getTime()
      );
    return open[0] ?? null;
  }, [application]);

  if (notFound) {
    return (
      <AppShell>
        <div className={`${cardClassName} p-10 text-center`}>
          <p className="text-sm font-semibold text-ink">Application not found.</p>
          <Link
            href="/applications"
            className={`${btnSecondarySm} mx-auto mt-4`}
          >
            Back to applications
          </Link>
        </div>
      </AppShell>
    );
  }

  if (loading || !application) {
    return (
      <AppShell>
        <div className="space-y-4" aria-hidden>
          <div className={`${cardClassName} h-36 animate-pulse bg-subtle`} />
          <div className={`${cardClassName} h-64 animate-pulse bg-subtle`} />
        </div>
      </AppShell>
    );
  }

  const posting = application.jobPosting;
  const company = posting?.company?.name ?? "Unknown company";

  return (
    <AppShell>
      <div className="space-y-4">
        <Link
          href="/applications"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted transition hover:text-ink"
        >
          <IconArrowLeft size={16} />
          Back to applications
        </Link>

        {error && (
          <div className="rounded-xl border border-danger-ring bg-danger-soft px-4 py-3 text-sm font-medium text-red-700">
            {error}
          </div>
        )}

        {/* Header: the facts that stay true whichever tab is open. */}
        <header className={`${cardClassName} p-5`}>
          <div className="flex flex-wrap items-start gap-4">
            <CompanyLogo name={company} size="lg" />

            <div className="min-w-0 flex-1">
              <h1 className="truncate text-xl font-bold text-ink sm:text-2xl">
                {company}
              </h1>
              <p className="truncate text-sm font-medium text-muted">
                {posting?.title ?? "—"}
                {posting?.location?.length ? ` · ${posting.location.join(", ")}` : ""}
              </p>
            </div>

            <RowMenu
              label="Application actions"
              items={[
                {
                  label: "Edit job details",
                  icon: <IconPencil size={16} />,
                  onSelect: () => {
                    selectTab("overview");
                    setEditingPosting(true);
                  },
                },
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
                  label: "Delete application",
                  danger: true,
                  icon: <IconTrash size={16} />,
                  onSelect: handleDelete,
                },
              ]}
            />
          </div>

          <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-border pt-4 sm:grid-cols-4">
            <div>
              <dt className="text-xs font-semibold text-muted">Applied</dt>
              <dd className="mt-1 text-sm font-semibold text-ink">
                {application.appliedDate ? formatDate(application.appliedDate) : "—"}
              </dd>
            </div>

            <div>
              <dt className="text-xs font-semibold text-muted">Next follow-up</dt>
              <dd className="mt-1 text-sm font-semibold text-ink">
                {nextFollowUp ? (
                  <>
                    {formatDate(nextFollowUp.followUpDate)}
                    <span
                      className={`ml-1.5 text-xs font-semibold ${
                        urgencyOf(nextFollowUp.followUpDate) === "overdue"
                          ? "text-danger"
                          : "text-muted"
                      }`}
                    >
                      {relativeDayLabel(nextFollowUp.followUpDate)}
                    </span>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => selectTab("followups")}
                    className="text-sm font-semibold text-brand hover:underline"
                  >
                    Schedule one
                  </button>
                )}
              </dd>
            </div>

            <div>
              <dt className="text-xs font-semibold text-muted">Where you found it</dt>
              <dd className="mt-1 truncate text-sm font-semibold text-ink">
                {application.source || "—"}
              </dd>
            </div>

            <div>
              <dt className={labelClassName}>
                <label htmlFor="status">Status</label>
              </dt>
              <dd className="mt-1">
                <select
                  id="status"
                  value={application.status}
                  onChange={(e) =>
                    handleStatusChange(e.target.value as ApplicationStatus)
                  }
                  className={`${selectClassName} h-9 w-full py-0 text-sm`}
                >
                  {STATUS_ORDER.map((status) => (
                    <option key={status} value={status}>
                      {statusLabel(status)}
                    </option>
                  ))}
                </select>
              </dd>
            </div>
          </dl>
        </header>

        {/*
          Tabs scroll away with the page rather than sticking. Pinned below the
          header they read as a bar floating in the middle of the content, with
          the section above them scrolling past on both sides.
          Horizontally scrollable rather than wrapped on small screens.
        */}
        <div className="-mx-4 border-b border-border px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
          <div
            role="tablist"
            aria-label="Application sections"
            className="no-scrollbar flex gap-1 overflow-x-auto"
          >
            {TABS.map((item) => {
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  role="tab"
                  type="button"
                  aria-selected={active}
                  onClick={() => selectTab(item.id)}
                  className={`shrink-0 border-b-2 px-3 py-3 text-sm font-semibold transition ${
                    active
                      ? "border-brand text-brand"
                      : "border-transparent text-muted hover:text-ink"
                  }`}
                >
                  {item.label}
                  <TabCount tab={item.id} application={application} />
                </button>
              );
            })}
          </div>
        </div>

        <div className="animate-fade-in">
          {/* min-w-0 on the two columns below, for the same reason as the
              dashboard grid: without it the track is floored at the widest
              nowrap descendant and the page overflows sideways. */}
          {tab === "overview" && (
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="min-w-0 space-y-4 lg:col-span-2">
                <OverviewPanel
                  application={application}
                  editing={editingPosting}
                  onEdit={() => setEditingPosting(true)}
                  onCancelEdit={() => setEditingPosting(false)}
                  onSavePosting={handleSavePosting}
                  onPatch={patchApplication}
                  onError={setError}
                />
              </div>

              <aside className="min-w-0 space-y-4">
                <ApplicationChecklist
                  application={application}
                  refreshKey={checklistKey}
                />
                <NotesCard
                  application={application}
                  onPatch={patchApplication}
                  onError={setError}
                />
              </aside>
            </div>
          )}

          {tab === "tips" && <ResumeTipsSection applicationId={id} />}
          {tab === "resume" && <TailoredResumeSection applicationId={id} />}
          {tab === "letter" && <CoverLetterSection applicationId={id} />}

          {tab === "questions" && (
            <QuestionsSection
              applicationId={id}
              questions={application.questions ?? []}
              setQuestions={setQuestions}
            />
          )}

          {tab === "contacts" && (
            <ContactsSection
              applicationId={id}
              contacts={application.contacts ?? []}
              setContacts={setContacts}
            />
          )}

          {tab === "followups" && (
            <FollowUpsPanel
              applicationId={id}
              followUps={application.followUps ?? []}
              setFollowUps={setFollowUps}
            />
          )}
        </div>
      </div>
    </AppShell>
  );
}

/** Small count pill on the tabs that hold a collection. */
function TabCount({
  tab,
  application,
}: {
  tab: TabId;
  application: Application;
}) {
  let count: number | null = null;
  if (tab === "questions") count = application.questions?.length ?? 0;
  if (tab === "contacts") count = application.contacts?.length ?? 0;
  if (tab === "followups") {
    count = (application.followUps ?? []).filter((f) => !f.completed).length;
  }
  if (!count) return null;

  return (
    <span className="ml-1.5 rounded-full bg-subtle px-1.5 py-0.5 text-[11px] font-bold text-muted">
      {count}
    </span>
  );
}

function OverviewPanel({
  application,
  editing,
  onEdit,
  onCancelEdit,
  onSavePosting,
  onPatch,
  onError,
}: {
  application: Application;
  editing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSavePosting: (edits: JobPostingEdits) => Promise<void>;
  onPatch: (body: Record<string, unknown>) => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const posting = application.jobPosting;
  const [sourceDraft, setSourceDraft] = useState(application.source ?? "");

  async function handleAppliedDateChange(value: string) {
    onError(null);
    try {
      await onPatch({ appliedDate: value || null });
    } catch {
      onError("Failed to update applied date.");
    }
  }

  async function handleSourceBlur() {
    if (sourceDraft.trim() === (application.source ?? "")) return;
    onError(null);
    try {
      await onPatch({ source: sourceDraft.trim() || null });
    } catch {
      onError("Failed to save source.");
    }
  }

  if (editing && posting) {
    return (
      <section className={`${cardClassName} p-5`}>
        <h2 className="mb-4 text-base font-bold text-ink">Edit job details</h2>
        <JobPostingForm
          posting={posting}
          onSave={onSavePosting}
          onCancel={onCancelEdit}
        />
      </section>
    );
  }

  return (
    <>
      <section className={`${cardClassName} p-5`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-bold text-ink">Job details</h2>
          <div className="flex gap-2">
            {posting?.jobUrl && (
              <a
                href={posting.jobUrl}
                target="_blank"
                rel="noreferrer"
                className={btnSecondarySm}
              >
                <IconExternalLink size={15} />
                View posting
              </a>
            )}
            {posting && (
              <button type="button" onClick={onEdit} className={btnSecondarySm}>
                <IconPencil size={15} />
                Edit
              </button>
            )}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="appliedDate" className={labelClassName}>
              Applied date
            </label>
            <input
              id="appliedDate"
              type="date"
              value={toDateInputValue(application.appliedDate)}
              onChange={(e) => handleAppliedDateChange(e.target.value)}
              className={`mt-1.5 w-full ${inputClassName}`}
            />
          </div>

          <div>
            <label htmlFor="source" className={labelClassName}>
              Where you found it
            </label>
            <div className="mt-1.5">
              <SourceInput
                id="source"
                value={sourceDraft}
                onChange={setSourceDraft}
                onBlur={handleSourceBlur}
              />
            </div>
          </div>
        </div>

        {(posting?.salary || posting?.location?.length) && (
          <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-3 border-t border-border pt-4">
            {posting?.location?.length ? (
              <div>
                <dt className="text-xs font-semibold text-muted">Location</dt>
                <dd className="mt-0.5 text-sm font-medium text-ink">
                  {posting.location.join(", ")}
                </dd>
              </div>
            ) : null}
            {posting?.salary && (
              <div>
                <dt className="text-xs font-semibold text-muted">Salary</dt>
                <dd className="mt-0.5 text-sm font-medium text-ink">{posting.salary}</dd>
              </div>
            )}
          </dl>
        )}
      </section>

      <section className={`${cardClassName} p-5`}>
        <h2 className="text-base font-bold text-ink">Job description</h2>
        {posting?.description ? (
          <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-muted">
            {posting.description}
          </p>
        ) : (
          <div className="mt-3">
            <p className="text-sm text-muted">
              No description saved. The AI features read this — adding it makes every
              generated document sharper.
            </p>
            <button type="button" onClick={onEdit} className={`${btnSecondarySm} mt-3`}>
              <IconPencil size={15} />
              Add a description
            </button>
          </div>
        )}
      </section>
    </>
  );
}

function NotesCard({
  application,
  onPatch,
  onError,
}: {
  application: Application;
  onPatch: (body: Record<string, unknown>) => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const [draft, setDraft] = useState(application.notes ?? "");
  const [saved, setSaved] = useState(false);

  async function handleBlur() {
    if (draft === (application.notes ?? "")) return;
    onError(null);
    try {
      await onPatch({ notes: draft || null });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      onError("Failed to save notes.");
    }
  }

  return (
    <section className={`${cardClassName} p-5`}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-ink">Notes</h2>
        {saved && (
          <span className="text-xs font-semibold text-emerald-600">Saved</span>
        )}
      </div>
      <div className="mt-3">
        <CopyField value={draft} multiline>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={handleBlur}
            rows={6}
            placeholder="Add a note…"
            aria-label="Notes"
            className={`w-full pr-9 ${inputClassName}`}
          />
        </CopyField>
      </div>
    </section>
  );
}

function FollowUpsPanel({
  applicationId,
  followUps,
  setFollowUps,
}: {
  applicationId: string;
  followUps: FollowUp[];
  setFollowUps: (updater: (followUps: FollowUp[]) => FollowUp[]) => void;
}) {
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!date) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/applications/${applicationId}/follow-ups`, {
        method: "POST",
        body: JSON.stringify({ followUpDate: date, note: note.trim() || null }),
      });
      if (!res.ok) throw new Error("Failed to add follow-up.");
      const { followUp } = (await res.json()) as { followUp: FollowUp };
      setFollowUps((items) =>
        [...items, followUp].sort((a, b) =>
          a.followUpDate.localeCompare(b.followUpDate)
        )
      );
      setDate("");
      setNote("");
    } catch {
      setError("Failed to add follow-up.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggle(followUp: FollowUp) {
    const res = await apiFetch(`/api/follow-ups/${followUp.id}`, {
      method: "PATCH",
      body: JSON.stringify({ completed: !followUp.completed }),
    });
    if (!res.ok) return;
    const { followUp: updated } = (await res.json()) as { followUp: FollowUp };
    setFollowUps((items) => items.map((f) => (f.id === updated.id ? updated : f)));
  }

  async function handleDelete(followUpId: string) {
    const res = await apiFetch(`/api/follow-ups/${followUpId}`, { method: "DELETE" });
    if (!res.ok) return;
    setFollowUps((items) => items.filter((f) => f.id !== followUpId));
  }

  const sorted = [...followUps].sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    return a.followUpDate.localeCompare(b.followUpDate);
  });

  return (
    <section className={`${cardClassName} p-5`}>
      <h2 className="text-base font-bold text-ink">Follow-ups</h2>
      <p className="mt-1 text-sm text-muted">
        Dates you want to chase this up. Anything still open shows on your dashboard,
        and the daily email reminds you from three days out.
      </p>

      {error && (
        <p className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-sm font-medium text-red-700">
          {error}
        </p>
      )}

      {sorted.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-border px-4 py-8 text-center">
          <IconCalendar size={26} className="mx-auto text-border" strokeWidth={1.5} />
          <p className="mt-2 text-sm font-medium text-muted">No follow-ups yet.</p>
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-border">
          {sorted.map((followUp) => {
            const urgency = urgencyOf(followUp.followUpDate);
            return (
              <li key={followUp.id} className="flex items-center gap-3 py-3">
                <input
                  type="checkbox"
                  checked={followUp.completed}
                  onChange={() => handleToggle(followUp)}
                  aria-label={`Mark ${formatDate(followUp.followUpDate)} follow-up complete`}
                  className="h-4 w-4 shrink-0 rounded border-border text-brand focus:ring-brand/30"
                />

                <div className="min-w-0 flex-1">
                  <p
                    className={`text-sm font-semibold ${
                      followUp.completed ? "text-muted line-through" : "text-ink"
                    }`}
                  >
                    {formatDate(followUp.followUpDate)}
                    {!followUp.completed && (
                      <span
                        className={`ml-2 text-xs font-semibold ${
                          urgency === "overdue"
                            ? "text-danger"
                            : urgency === "today"
                              ? "text-amber-600"
                              : "text-muted"
                        }`}
                      >
                        {relativeDayLabel(followUp.followUpDate)}
                      </span>
                    )}
                  </p>
                  {followUp.note && (
                    <p className="truncate text-xs text-muted">{followUp.note}</p>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => handleDelete(followUp.id)}
                  aria-label="Remove follow-up"
                  className="shrink-0 rounded-lg p-1.5 text-muted transition hover:bg-danger-soft hover:text-danger"
                >
                  <IconTrash size={16} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <form
        onSubmit={handleSubmit}
        className="mt-5 flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-end"
      >
        <div className="sm:w-44">
          <label htmlFor="followUpDate" className={labelClassName}>
            Date
          </label>
          <input
            id="followUpDate"
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={`mt-1.5 w-full ${inputClassName}`}
          />
        </div>
        <div className="flex-1">
          <label htmlFor="followUpNote" className={labelClassName}>
            Note
          </label>
          <div className="mt-1.5">
            <CopyField value={note}>
              <input
                id="followUpNote"
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Send thank-you email"
                className={`w-full pr-9 ${inputClassName}`}
              />
            </CopyField>
          </div>
        </div>
        <button type="submit" disabled={submitting || !date} className={btnPrimarySm}>
          {submitting ? "Adding…" : "Add follow-up"}
        </button>
      </form>
    </section>
  );
}
