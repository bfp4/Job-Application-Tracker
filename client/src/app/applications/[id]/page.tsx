"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import StatusBadge from "@/components/StatusBadge";
import ResumeTipsSection from "@/components/ResumeTipsSection";
import QuestionsSection from "@/components/QuestionsSection";
import ContactsSection from "@/components/ContactsSection";
import SourceInput from "@/components/SourceInput";
import { apiFetch } from "@/lib/api";
import { formatDate, toDateInputValue } from "@/lib/format";
import { STATUS_ORDER, statusLabel } from "@/lib/status";
import { inputClassName } from "@/lib/ui";
import { useAuth } from "@/context/AuthContext";
import type {
  Application,
  ApplicationQuestion,
  ApplicationStatus,
  Contact,
  FollowUp,
} from "@/lib/types";

export default function ApplicationDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [application, setApplication] = useState<Application | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState("");
  const [sourceDraft, setSourceDraft] = useState("");

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
      setNotesDraft(data.application.notes ?? "");
      setSourceDraft(data.application.source ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (!authLoading && user) {
      void load();
    }
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

  async function handleStatusChange(status: ApplicationStatus) {
    setError(null);
    try {
      await patchApplication({ status });
    } catch {
      setError("Failed to update status.");
    }
  }

  async function handleAppliedDateChange(value: string) {
    setError(null);
    try {
      await patchApplication({ appliedDate: value || null });
    } catch {
      setError("Failed to update applied date.");
    }
  }

  async function handleSourceBlur() {
    if (!application || sourceDraft.trim() === (application.source ?? "")) return;
    setError(null);
    try {
      await patchApplication({ source: sourceDraft.trim() || null });
    } catch {
      setError("Failed to save source.");
    }
  }

  async function handleNotesBlur() {
    if (!application || notesDraft === (application.notes ?? "")) return;
    setError(null);
    try {
      await patchApplication({ notes: notesDraft || null });
    } catch {
      setError("Failed to save notes.");
    }
  }

  async function handleDelete() {
    if (!confirm("Delete this application? This cannot be undone.")) return;
    setError(null);
    try {
      const res = await apiFetch(`/api/applications/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed.");
      router.push("/applications");
    } catch {
      setError("Failed to delete application.");
    }
  }

  // Follow-up mutations patch local state from the response instead of
  // re-fetching the whole application graph on every toggle.
  function setFollowUps(updater: (followUps: FollowUp[]) => FollowUp[]) {
    setApplication((prev) =>
      prev ? { ...prev, followUps: updater(prev.followUps ?? []) } : prev
    );
  }

  // Same pattern for application-form questions.
  function setQuestions(
    updater: (questions: ApplicationQuestion[]) => ApplicationQuestion[]
  ) {
    setApplication((prev) =>
      prev ? { ...prev, questions: updater(prev.questions ?? []) } : prev
    );
  }

  // Same pattern for contacts.
  function setContacts(updater: (contacts: Contact[]) => Contact[]) {
    setApplication((prev) =>
      prev ? { ...prev, contacts: updater(prev.contacts ?? []) } : prev
    );
  }

  async function handleAddFollowUp(followUpDate: string, note: string) {
    const res = await apiFetch(`/api/applications/${id}/follow-ups`, {
      method: "POST",
      body: JSON.stringify({ followUpDate, note: note || null }),
    });
    if (!res.ok) throw new Error("Failed to add follow-up.");
    const { followUp } = (await res.json()) as { followUp: FollowUp };
    setFollowUps((followUps) =>
      [...followUps, followUp].sort((a, b) => a.followUpDate.localeCompare(b.followUpDate))
    );
  }

  async function handleToggleFollowUp(followUp: FollowUp) {
    const res = await apiFetch(`/api/follow-ups/${followUp.id}`, {
      method: "PATCH",
      body: JSON.stringify({ completed: !followUp.completed }),
    });
    if (!res.ok) return;
    const { followUp: updated } = (await res.json()) as { followUp: FollowUp };
    setFollowUps((followUps) => followUps.map((f) => (f.id === updated.id ? updated : f)));
  }

  async function handleDeleteFollowUp(followUpId: string) {
    const res = await apiFetch(`/api/follow-ups/${followUpId}`, { method: "DELETE" });
    if (!res.ok) return;
    setFollowUps((followUps) => followUps.filter((f) => f.id !== followUpId));
  }

  if (notFound) {
    return (
      <AppShell>
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
          <p className="text-sm text-gray-500">Application not found.</p>
          <Link href="/applications" className="mt-4 inline-block text-sm font-medium text-gray-900 underline">
            Back to applications
          </Link>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <Link href="/applications" className="text-sm text-gray-500 hover:text-gray-900">
          ← Back to applications
        </Link>

        {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>}

        {loading || !application ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : (
          <>
            <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h1 className="text-xl font-semibold text-gray-900">
                    {application.jobPosting?.title ?? "—"}
                  </h1>
                  <p className="mt-1 text-sm text-gray-600">
                    {application.jobPosting?.company?.name ?? "—"}
                    {application.jobPosting?.location?.length
                      ? ` · ${application.jobPosting.location.join(", ")}`
                      : ""}
                  </p>
                  {application.jobPosting?.salary && (
                    <p className="mt-1 text-sm text-gray-600">{application.jobPosting.salary}</p>
                  )}
                  {application.jobPosting?.description && (
                    <p className="mt-3 whitespace-pre-line text-sm text-gray-600">
                      {application.jobPosting.description}
                    </p>
                  )}
                  {application.jobPosting?.jobUrl && (
                    <a
                      href={application.jobPosting.jobUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 inline-block text-sm text-gray-900 underline"
                    >
                      View posting
                    </a>
                  )}
                </div>
                <StatusBadge status={application.status} />
              </div>

              <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Status</label>
                  <select
                    value={application.status}
                    onChange={(e) => handleStatusChange(e.target.value as ApplicationStatus)}
                    className={`mt-1 w-full ${inputClassName}`}
                  >
                    {STATUS_ORDER.map((status) => (
                      <option key={status} value={status}>
                        {statusLabel(status)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Applied date</label>
                  <input
                    type="date"
                    value={toDateInputValue(application.appliedDate)}
                    onChange={(e) => handleAppliedDateChange(e.target.value)}
                    className={`mt-1 w-full ${inputClassName}`}
                  />
                </div>
                <div>
                  <label htmlFor="source" className="block text-sm font-medium text-gray-700">
                    Where you found it
                  </label>
                  <div className="mt-1">
                    <SourceInput
                      id="source"
                      value={sourceDraft}
                      onChange={setSourceDraft}
                      onBlur={handleSourceBlur}
                    />
                  </div>
                </div>
              </div>

              <div className="mt-4">
                <label className="block text-sm font-medium text-gray-700">Notes</label>
                <textarea
                  value={notesDraft}
                  onChange={(e) => setNotesDraft(e.target.value)}
                  onBlur={handleNotesBlur}
                  rows={4}
                  className={`mt-1 w-full ${inputClassName}`}
                  placeholder="Notes on this application…"
                />
              </div>
            </div>

            <ResumeTipsSection applicationId={id} />

            <QuestionsSection
              applicationId={id}
              questions={application.questions ?? []}
              setQuestions={setQuestions}
            />

            <ContactsSection
              applicationId={id}
              contacts={application.contacts ?? []}
              setContacts={setContacts}
            />

            <FollowUpsSection
              followUps={application.followUps ?? []}
              onAdd={handleAddFollowUp}
              onToggle={handleToggleFollowUp}
              onDelete={handleDeleteFollowUp}
            />

            <div className="rounded-xl border border-red-200 bg-white p-6 shadow-sm">
              <h2 className="text-sm font-semibold text-red-700">Danger zone</h2>
              <p className="mt-1 text-sm text-gray-500">Permanently delete this application.</p>
              <button
                type="button"
                onClick={handleDelete}
                className="mt-3 rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
              >
                Delete application
              </button>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}

function FollowUpsSection({
  followUps,
  onAdd,
  onToggle,
  onDelete,
}: {
  followUps: FollowUp[];
  onAdd: (followUpDate: string, note: string) => Promise<void>;
  onToggle: (followUp: FollowUp) => Promise<void>;
  onDelete: (followUpId: string) => Promise<void>;
}) {
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!date) return;
    setSubmitting(true);
    setFormError(null);
    try {
      await onAdd(date, note.trim());
      setDate("");
      setNote("");
    } catch {
      setFormError("Failed to add follow-up.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-gray-900">Follow-ups</h2>

      {followUps.length === 0 ? (
        <p className="mt-3 text-sm text-gray-500">No follow-ups yet.</p>
      ) : (
        <ul className="mt-3 divide-y divide-gray-100">
          {followUps.map((followUp) => (
            <li key={followUp.id} className="flex items-center justify-between gap-3 py-3">
              <label className="flex min-w-0 items-center gap-3">
                <input
                  type="checkbox"
                  checked={followUp.completed}
                  onChange={() => onToggle(followUp)}
                  className="h-4 w-4 rounded border-gray-300"
                />
                <span className="min-w-0">
                  <span
                    className={`block text-sm ${followUp.completed ? "text-gray-400 line-through" : "text-gray-900"}`}
                  >
                    {formatDate(followUp.followUpDate)}
                  </span>
                  {followUp.note && (
                    <span className="block truncate text-xs text-gray-500">{followUp.note}</span>
                  )}
                </span>
              </label>
              <button
                type="button"
                onClick={() => onDelete(followUp.id)}
                className="shrink-0 text-sm text-gray-400 hover:text-red-600"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {formError && <p className="mt-3 text-sm text-red-700">{formError}</p>}

      <form onSubmit={handleSubmit} className="mt-4 flex flex-wrap items-end gap-2">
        <div>
          <label className="block text-xs font-medium text-gray-700">Date</label>
          <input
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={`mt-1 ${inputClassName}`}
          />
        </div>
        <div className="flex-1">
          <label className="block text-xs font-medium text-gray-700">Note</label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Send thank-you email"
            className={`mt-1 w-full ${inputClassName}`}
          />
        </div>
        <button
          type="submit"
          disabled={submitting || !date}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {submitting ? "Adding…" : "Add"}
        </button>
      </form>
    </div>
  );
}
