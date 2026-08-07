"use client";

import { useState, type FormEvent } from "react";
import { apiFetch } from "@/lib/api";
import { CopyField } from "@/components/CopyButton";
import {
  btnPrimarySm,
  cardClassName,
  inputClassName,
  labelClassName,
  selectClassName,
} from "@/lib/ui";
import { IconClock, IconTrash } from "@/components/icons";
import {
  STATUS_ORDER,
  statusBadgeClasses,
  statusDotClasses,
  statusLabel,
} from "@/lib/status/status";
import { formatDate, toDateInputValue, todayInputValue } from "@/lib/format/format";
import type { ApplicationStatus, TimelineEntry } from "@/lib/types";

/**
 * The stages an application has moved through, each with its own date and an
 * editable note (what came up on the phone screen, how an interview round
 * went, ...). Entries are logged automatically when the status dropdown in
 * the header changes; this section is where you annotate or backfill them.
 */
export default function TimelineSection({
  applicationId,
  entries,
  setEntries,
}: {
  applicationId: string;
  entries: TimelineEntry[];
  setEntries: (updater: (entries: TimelineEntry[]) => TimelineEntry[]) => void;
}) {
  const [error, setError] = useState<string | null>(null);

  function replaceEntry(updated: TimelineEntry) {
    setEntries((items) => items.map((e) => (e.id === updated.id ? updated : e)));
  }

  async function handleSaveNote(entry: TimelineEntry, note: string) {
    const res = await apiFetch(`/api/timeline-entries/${entry.id}`, {
      method: "PATCH",
      body: JSON.stringify({ note: note.trim() === "" ? null : note }),
    });
    if (!res.ok) throw new Error("Failed to save note.");
    const { timelineEntry } = (await res.json()) as { timelineEntry: TimelineEntry };
    replaceEntry(timelineEntry);
  }

  async function handleDateChange(entry: TimelineEntry, occurredAt: string) {
    if (!occurredAt) return;
    setError(null);
    try {
      const res = await apiFetch(`/api/timeline-entries/${entry.id}`, {
        method: "PATCH",
        body: JSON.stringify({ occurredAt }),
      });
      if (!res.ok) throw new Error("Failed to update date.");
      const { timelineEntry } = (await res.json()) as { timelineEntry: TimelineEntry };
      replaceEntry(timelineEntry);
    } catch {
      setError("Failed to update date.");
    }
  }

  async function handleAdd(status: ApplicationStatus, occurredAt: string, note: string) {
    const res = await apiFetch(`/api/applications/${applicationId}/timeline-entries`, {
      method: "POST",
      body: JSON.stringify({ status, occurredAt, note: note.trim() || null }),
    });
    if (!res.ok) throw new Error("Failed to add entry.");
    const { timelineEntry } = (await res.json()) as { timelineEntry: TimelineEntry };
    setEntries((items) =>
      [...items, timelineEntry].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
    );
  }

  async function handleDelete(entryId: string) {
    const res = await apiFetch(`/api/timeline-entries/${entryId}`, { method: "DELETE" });
    if (!res.ok) throw new Error("Failed to remove entry.");
    setEntries((items) => items.filter((e) => e.id !== entryId));
  }

  const sorted = [...entries].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));

  return (
    <section className={cardClassName}>
      <div className="p-5">
        <h2 className="text-base font-bold text-ink">Timeline</h2>
        <p className="mt-1 text-sm text-muted">
          Every stage this application has passed through, logged automatically as you
          change its status. Add a note for what happened at each step.
        </p>
      </div>

      <div className="space-y-4 border-t border-border p-5">
        {error && (
          <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm font-medium text-red-700">
            {error}
          </p>
        )}

        {sorted.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center">
            <IconClock size={26} className="mx-auto text-border" strokeWidth={1.5} />
            <p className="mt-2 text-sm font-medium text-muted">No timeline entries yet.</p>
          </div>
        ) : (
          <ol className="space-y-3">
            {sorted.map((entry) => (
              <TimelineItem
                key={entry.id}
                entry={entry}
                onSaveNote={handleSaveNote}
                onDateChange={handleDateChange}
                onDelete={handleDelete}
                setError={setError}
              />
            ))}
          </ol>
        )}

        <AddEntryForm onAdd={handleAdd} setError={setError} />
      </div>
    </section>
  );
}

function TimelineItem({
  entry,
  onSaveNote,
  onDateChange,
  onDelete,
  setError,
}: {
  entry: TimelineEntry;
  onSaveNote: (entry: TimelineEntry, note: string) => Promise<void>;
  onDateChange: (entry: TimelineEntry, occurredAt: string) => Promise<void>;
  onDelete: (entryId: string) => Promise<void>;
  setError: (error: string | null) => void;
}) {
  const [noteDraft, setNoteDraft] = useState(entry.note ?? "");
  // Tracks the last server-confirmed note so blur only PATCHes real edits.
  const [savedNote, setSavedNote] = useState(entry.note ?? "");

  if ((entry.note ?? "") !== savedNote) {
    setSavedNote(entry.note ?? "");
    setNoteDraft(entry.note ?? "");
  }

  async function handleBlur() {
    if (noteDraft === savedNote) return;
    setError(null);
    try {
      await onSaveNote(entry, noteDraft);
    } catch {
      setError("Failed to save note.");
    }
  }

  return (
    <li className="rounded-xl border border-border bg-subtle/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${statusDotClasses(entry.status)}`} />
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${statusBadgeClasses(entry.status)}`}
          >
            {statusLabel(entry.status)}
          </span>
          <span className="text-xs font-medium text-muted">
            {formatDate(entry.occurredAt)}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="date"
            value={toDateInputValue(entry.occurredAt)}
            onChange={(e) => void onDateChange(entry, e.target.value)}
            aria-label={`Date for ${statusLabel(entry.status)}`}
            className={`h-8 py-0 text-xs ${inputClassName}`}
          />
          <button
            type="button"
            onClick={() => {
              setError(null);
              void onDelete(entry.id).catch(() => setError("Failed to remove entry."));
            }}
            aria-label="Remove timeline entry"
            className="shrink-0 rounded-lg p-1.5 text-muted transition hover:bg-danger-soft hover:text-danger"
          >
            <IconTrash size={16} />
          </button>
        </div>
      </div>

      <div className="mt-3">
        <CopyField value={noteDraft} multiline>
          <textarea
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            onBlur={handleBlur}
            rows={2}
            placeholder="What happened at this stage…"
            aria-label={`Note for ${statusLabel(entry.status)}`}
            className={`w-full pr-9 ${inputClassName}`}
          />
        </CopyField>
      </div>
    </li>
  );
}

function AddEntryForm({
  onAdd,
  setError,
}: {
  onAdd: (status: ApplicationStatus, occurredAt: string, note: string) => Promise<void>;
  setError: (error: string | null) => void;
}) {
  const [status, setStatus] = useState<ApplicationStatus>(STATUS_ORDER[0]);
  const [date, setDate] = useState(todayInputValue());
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!date) return;
    setSubmitting(true);
    setError(null);
    try {
      await onAdd(status, date, note);
      setNote("");
    } catch {
      setError("Failed to add entry.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-end"
    >
      <div className="sm:w-40">
        <label htmlFor="timelineStatus" className={labelClassName}>
          Stage
        </label>
        <select
          id="timelineStatus"
          value={status}
          onChange={(e) => setStatus(e.target.value as ApplicationStatus)}
          className={`mt-1.5 h-9 w-full py-0 text-sm ${selectClassName}`}
        >
          {STATUS_ORDER.map((s) => (
            <option key={s} value={s}>
              {statusLabel(s)}
            </option>
          ))}
        </select>
      </div>

      <div className="sm:w-40">
        <label htmlFor="timelineDate" className={labelClassName}>
          Date
        </label>
        <input
          id="timelineDate"
          type="date"
          required
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className={`mt-1.5 w-full ${inputClassName}`}
        />
      </div>

      <div className="flex-1">
        <label htmlFor="timelineNote" className={labelClassName}>
          Note
        </label>
        <div className="mt-1.5">
          <CopyField value={note}>
            <input
              id="timelineNote"
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Recruiter call, went well"
              className={`w-full pr-9 ${inputClassName}`}
            />
          </CopyField>
        </div>
      </div>

      <button type="submit" disabled={submitting || !date} className={btnPrimarySm}>
        {submitting ? "Adding…" : "Add entry"}
      </button>
    </form>
  );
}
