"use client";

import {
  useCallback,
  useEffect,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import StatusBadge from "@/components/StatusBadge";
import { apiFetch } from "@/lib/api";
import { formatDate, toDateInputValue } from "@/lib/format";
import { STATUS_ORDER, statusLabel } from "@/lib/status";
import { useAuth } from "@/context/AuthContext";
import type {
  Application,
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
    if (!authLoading && user) {
      load();
    }
  }, [authLoading, user, load]);

  async function patchApplication(body: Record<string, unknown>) {
    const res = await apiFetch(`/api/applications/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error("Update failed.");
    const data = (await res.json()) as { application: Application };
    setApplication((prev) =>
      prev ? { ...prev, ...data.application } : data.application
    );
  }

  return (
    <AppShell>
      {loading && <p className="text-sm text-gray-500">Loading application…</p>}

      {!loading && notFound && (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center">
          <p className="text-sm text-gray-500">
            This application doesn&apos;t exist or was removed.
          </p>
          <Link
            href="/applications"
            className="mt-4 inline-block rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            Back to applications
          </Link>
        </div>
      )}

      {!loading && application && (
        <ApplicationDetail
          application={application}
          error={error}
          onPatch={patchApplication}
          onDeleted={() => router.push("/applications")}
          onFilesChange={(patch) =>
            setApplication((prev) => (prev ? { ...prev, ...patch } : prev))
          }
          onContactsChange={(contacts) =>
            setApplication((prev) => (prev ? { ...prev, contacts } : prev))
          }
          onFollowUpsChange={(followUps) =>
            setApplication((prev) => (prev ? { ...prev, followUps } : prev))
          }
          onError={setError}
        />
      )}
    </AppShell>
  );
}

function ApplicationDetail({
  application,
  error,
  onPatch,
  onDeleted,
  onFilesChange,
  onContactsChange,
  onFollowUpsChange,
  onError,
}: {
  application: Application;
  error: string | null;
  onPatch: (body: Record<string, unknown>) => Promise<void>;
  onDeleted: () => void;
  onFilesChange: (patch: Partial<Application>) => void;
  onContactsChange: (contacts: Contact[]) => void;
  onFollowUpsChange: (followUps: FollowUp[]) => void;
  onError: (message: string | null) => void;
}) {
  const { jobPosting, company } = application;
  const [notes, setNotes] = useState(application.notes ?? "");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setNotes(application.notes ?? "");
  }, [application.notes]);

  async function saveNotes() {
    if ((application.notes ?? "") === notes) return;
    try {
      await onPatch({ notes: notes === "" ? null : notes });
    } catch {
      onError("Failed to save notes.");
    }
  }

  async function handleStatus(status: ApplicationStatus) {
    try {
      await onPatch({ status });
    } catch {
      onError("Failed to update status.");
    }
  }

  async function handleAppliedDate(value: string) {
    try {
      await onPatch({ appliedDate: value === "" ? null : value });
    } catch {
      onError("Failed to update applied date.");
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await apiFetch(`/api/applications/${application.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Delete failed.");
      onDeleted();
    } catch {
      onError("Failed to delete application.");
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      <Link
        href="/applications"
        className="inline-block text-sm text-gray-500 hover:text-gray-900"
      >
        ← Back to applications
      </Link>

      {error && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Header / job posting info */}
      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-gray-900">
              {jobPosting?.title ?? "Untitled role"}
            </h1>
            <p className="mt-1 text-sm text-gray-600">
              {company?.name ?? "Unknown company"}
              {jobPosting?.location ? ` · ${jobPosting.location}` : ""}
            </p>
            <p className="mt-1 text-xs text-gray-400">
              Posted {formatDate(jobPosting?.postedDate)}
              {jobPosting?.jobUrl && (
                <>
                  {" · "}
                  <a
                    href={jobPosting.jobUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-gray-600 underline hover:text-gray-900"
                  >
                    View original posting
                  </a>
                </>
              )}
            </p>
          </div>
          <StatusBadge status={application.status} />
        </div>

        {jobPosting?.description && (
          <p className="mt-4 whitespace-pre-line text-sm text-gray-600">
            {jobPosting.description}
          </p>
        )}

        <div className="mt-5 grid grid-cols-1 gap-4 border-t border-gray-100 pt-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="status"
              className="block text-xs font-medium uppercase tracking-wide text-gray-500"
            >
              Status
            </label>
            <select
              id="status"
              value={application.status}
              onChange={(e) =>
                handleStatus(e.target.value as ApplicationStatus)
              }
              className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none"
            >
              {STATUS_ORDER.map((status) => (
                <option key={status} value={status}>
                  {statusLabel(status)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              htmlFor="appliedDate"
              className="block text-xs font-medium uppercase tracking-wide text-gray-500"
            >
              Applied date
            </label>
            <input
              id="appliedDate"
              type="date"
              defaultValue={toDateInputValue(application.appliedDate)}
              onChange={(e) => handleAppliedDate(e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none"
            />
          </div>
        </div>
      </section>

      {/* Notes */}
      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-900">Notes</h2>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={saveNotes}
          rows={4}
          placeholder="Add notes about this application… (saved when you click away)"
          className="mt-2 w-full resize-y rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none"
        />
      </section>

      {/* Documents */}
      <FilesSection
        applicationId={application.id}
        resumeS3Key={application.resumeS3Key}
        coverLetterS3Key={application.coverLetterS3Key}
        onChange={onFilesChange}
        onError={onError}
      />

      {/* Contacts */}
      <ContactsSection
        companyId={application.companyId}
        contacts={application.contacts ?? []}
        onChange={onContactsChange}
        onError={onError}
      />

      {/* Follow-ups */}
      <FollowUpsSection
        applicationId={application.id}
        followUps={application.followUps ?? []}
        onChange={onFollowUpsChange}
        onError={onError}
      />

      {/* Danger zone */}
      <section className="rounded-xl border border-red-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-900">Delete application</h2>
        <p className="mt-1 text-sm text-gray-500">
          This permanently removes the application and its follow-ups.
        </p>
        {confirmingDelete ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-sm text-gray-700">Are you sure?</span>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {deleting ? "Deleting…" : "Yes, delete"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              disabled={deleting}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            className="mt-3 rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
          >
            Delete application
          </button>
        )}
      </section>
    </div>
  );
}

type FileType = "resume" | "coverLetter";

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
const PDF_CONTENT_TYPE = "application/pdf";

const FILE_LABELS: Record<FileType, string> = {
  resume: "Resume",
  coverLetter: "Cover letter",
};

function FilesSection({
  applicationId,
  resumeS3Key,
  coverLetterS3Key,
  onChange,
  onError,
}: {
  applicationId: string;
  resumeS3Key: string | null;
  coverLetterS3Key: string | null;
  onChange: (patch: Partial<Application>) => void;
  onError: (message: string | null) => void;
}) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-gray-900">Documents</h2>
      <p className="mt-1 text-sm text-gray-500">
        Upload a PDF resume and cover letter for this application (max 5MB each).
      </p>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FileUploadRow
          applicationId={applicationId}
          fileType="resume"
          s3Key={resumeS3Key}
          onChange={onChange}
          onError={onError}
        />
        <FileUploadRow
          applicationId={applicationId}
          fileType="coverLetter"
          s3Key={coverLetterS3Key}
          onChange={onChange}
          onError={onError}
        />
      </div>
    </section>
  );
}

function FileUploadRow({
  applicationId,
  fileType,
  s3Key,
  onChange,
  onError,
}: {
  applicationId: string;
  fileType: FileType;
  s3Key: string | null;
  onChange: (patch: Partial<Application>) => void;
  onError: (message: string | null) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [justUploaded, setJustUploaded] = useState(false);
  const [opening, setOpening] = useState(false);
  const inputId = `file-${fileType}`;

  async function handleSelect(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset the input so selecting the same file again re-triggers onChange.
    e.target.value = "";
    if (!file) return;

    onError(null);
    setJustUploaded(false);

    if (file.type !== PDF_CONTENT_TYPE) {
      onError(`${FILE_LABELS[fileType]} must be a PDF file.`);
      return;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      onError(`${FILE_LABELS[fileType]} must be 5MB or smaller.`);
      return;
    }

    setUploading(true);
    try {
      // 1. Ask the backend for a pre-signed PUT URL.
      const urlRes = await apiFetch("/api/files/upload-url", {
        method: "POST",
        body: JSON.stringify({
          applicationId,
          fileType,
          contentType: PDF_CONTENT_TYPE,
        }),
      });
      if (!urlRes.ok) throw new Error("Failed to start upload.");
      const { uploadUrl, key } = (await urlRes.json()) as {
        uploadUrl: string;
        key: string;
      };

      // 2. Upload the file bytes directly to S3 (no auth header, raw fetch).
      const putRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": PDF_CONTENT_TYPE },
        body: file,
      });
      if (!putRes.ok) throw new Error("Upload to storage failed.");

      // 3. Persist the key on the application.
      const saveRes = await apiFetch(
        `/api/applications/${applicationId}/files`,
        {
          method: "PATCH",
          body: JSON.stringify({ fileType, s3Key: key }),
        }
      );
      if (!saveRes.ok) throw new Error("Failed to save uploaded file.");

      onChange(
        fileType === "resume"
          ? { resumeS3Key: key }
          : { coverLetterS3Key: key }
      );
      setJustUploaded(true);
    } catch (err) {
      onError(
        err instanceof Error
          ? err.message
          : `Failed to upload ${FILE_LABELS[fileType].toLowerCase()}.`
      );
    } finally {
      setUploading(false);
    }
  }

  async function handleView() {
    if (!s3Key) return;
    setOpening(true);
    onError(null);
    try {
      const res = await apiFetch(
        `/api/files/${encodeURIComponent(s3Key)}/download-url`
      );
      if (!res.ok) throw new Error("Failed to open file.");
      const { downloadUrl } = (await res.json()) as { downloadUrl: string };
      window.open(downloadUrl, "_blank", "noopener,noreferrer");
    } catch (err) {
      onError(
        err instanceof Error ? err.message : "Failed to open file."
      );
    } finally {
      setOpening(false);
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-gray-900">
          {FILE_LABELS[fileType]}
        </span>
        {s3Key ? (
          <span className="text-xs font-medium text-green-600">Uploaded</span>
        ) : (
          <span className="text-xs text-gray-400">Not uploaded</span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label
          htmlFor={inputId}
          className={`cursor-pointer rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 ${
            uploading ? "pointer-events-none opacity-50" : ""
          }`}
        >
          {uploading
            ? "Uploading…"
            : s3Key
            ? "Replace PDF"
            : "Upload PDF"}
        </label>
        <input
          id={inputId}
          type="file"
          accept="application/pdf"
          onChange={handleSelect}
          disabled={uploading}
          className="hidden"
        />

        {s3Key && (
          <button
            type="button"
            onClick={handleView}
            disabled={opening}
            className="text-sm font-medium text-gray-600 underline hover:text-gray-900 disabled:opacity-50"
          >
            {opening ? "Opening…" : "View"}
          </button>
        )}

        {justUploaded && !uploading && (
          <span className="text-xs text-green-600">Saved ✓</span>
        )}
      </div>
    </div>
  );
}

function ContactsSection({
  companyId,
  contacts,
  onChange,
  onError,
}: {
  companyId: string;
  contacts: Contact[];
  onChange: (contacts: Contact[]) => void;
  onError: (message: string | null) => void;
}) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [email, setEmail] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    if (name.trim() === "") return;
    setSubmitting(true);
    try {
      const res = await apiFetch(`/api/companies/${companyId}/contacts`, {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          role: role.trim() || null,
          email: email.trim() || null,
          linkedinUrl: linkedinUrl.trim() || null,
          notes: notes.trim() || null,
        }),
      });
      if (!res.ok) throw new Error("Failed to add contact.");
      const data = (await res.json()) as { contact: Contact };
      onChange([...contacts, data.contact]);
      setName("");
      setRole("");
      setEmail("");
      setLinkedinUrl("");
      setNotes("");
    } catch {
      onError("Failed to add contact.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(contactId: string) {
    try {
      const res = await apiFetch(`/api/contacts/${contactId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete contact.");
      onChange(contacts.filter((c) => c.id !== contactId));
    } catch {
      onError("Failed to delete contact.");
    }
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-gray-900">Contacts</h2>

      {contacts.length === 0 ? (
        <p className="mt-2 text-sm text-gray-500">
          No contacts yet for this company.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-gray-100">
          {contacts.map((contact) => (
            <li
              key={contact.id}
              className="flex items-start justify-between gap-3 py-3"
            >
              <div className="min-w-0">
                <p className="font-medium text-gray-900">
                  {contact.name}
                  {contact.role && (
                    <span className="font-normal text-gray-500">
                      {" "}
                      · {contact.role}
                    </span>
                  )}
                </p>
                <div className="mt-0.5 space-x-3 text-sm text-gray-500">
                  {contact.email && (
                    <a
                      href={`mailto:${contact.email}`}
                      className="underline hover:text-gray-900"
                    >
                      {contact.email}
                    </a>
                  )}
                  {contact.linkedinUrl && (
                    <a
                      href={contact.linkedinUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-gray-900"
                    >
                      LinkedIn
                    </a>
                  )}
                </div>
                {contact.notes && (
                  <p className="mt-1 text-sm text-gray-500">{contact.notes}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => handleDelete(contact.id)}
                className="shrink-0 text-sm text-gray-400 hover:text-red-600"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <form
        onSubmit={handleAdd}
        className="mt-4 grid grid-cols-1 gap-3 border-t border-gray-100 pt-4 sm:grid-cols-2"
      >
        <input
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name *"
          className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none"
        />
        <input
          type="text"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          placeholder="Role (e.g. Recruiter)"
          className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none"
        />
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none"
        />
        <input
          type="url"
          value={linkedinUrl}
          onChange={(e) => setLinkedinUrl(e.target.value)}
          placeholder="LinkedIn URL"
          className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none"
        />
        <input
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes"
          className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none sm:col-span-2"
        />
        <button
          type="submit"
          disabled={submitting || name.trim() === ""}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 sm:col-span-2 sm:justify-self-start"
        >
          {submitting ? "Adding…" : "Add contact"}
        </button>
      </form>
    </section>
  );
}

function FollowUpsSection({
  applicationId,
  followUps,
  onChange,
  onError,
}: {
  applicationId: string;
  followUps: FollowUp[];
  onChange: (followUps: FollowUp[]) => void;
  onError: (message: string | null) => void;
}) {
  const [followUpDate, setFollowUpDate] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const sorted = [...followUps].sort(
    (a, b) =>
      new Date(a.followUpDate).getTime() - new Date(b.followUpDate).getTime()
  );

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    if (followUpDate === "") return;
    setSubmitting(true);
    try {
      const res = await apiFetch(
        `/api/applications/${applicationId}/follow-ups`,
        {
          method: "POST",
          body: JSON.stringify({
            followUpDate,
            note: note.trim() || null,
          }),
        }
      );
      if (!res.ok) throw new Error("Failed to add follow-up.");
      const data = (await res.json()) as { followUp: FollowUp };
      onChange([...followUps, data.followUp]);
      setFollowUpDate("");
      setNote("");
    } catch {
      onError("Failed to add follow-up.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggle(followUp: FollowUp) {
    const next = !followUp.completed;
    onChange(
      followUps.map((f) =>
        f.id === followUp.id ? { ...f, completed: next } : f
      )
    );
    try {
      const res = await apiFetch(`/api/follow-ups/${followUp.id}`, {
        method: "PATCH",
        body: JSON.stringify({ completed: next }),
      });
      if (!res.ok) throw new Error("Failed to update follow-up.");
    } catch {
      onChange(followUps);
      onError("Failed to update follow-up.");
    }
  }

  async function handleDelete(followUpId: string) {
    try {
      const res = await apiFetch(`/api/follow-ups/${followUpId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete follow-up.");
      onChange(followUps.filter((f) => f.id !== followUpId));
    } catch {
      onError("Failed to delete follow-up.");
    }
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-gray-900">Follow-ups</h2>

      {sorted.length === 0 ? (
        <p className="mt-2 text-sm text-gray-500">No follow-ups scheduled.</p>
      ) : (
        <ul className="mt-3 divide-y divide-gray-100">
          {sorted.map((followUp) => (
            <li
              key={followUp.id}
              className="flex items-start justify-between gap-3 py-3"
            >
              <label className="flex flex-1 items-start gap-3">
                <input
                  type="checkbox"
                  checked={followUp.completed}
                  onChange={() => handleToggle(followUp)}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-900"
                />
                <span className="min-w-0">
                  <span
                    className={`block text-sm font-medium ${
                      followUp.completed
                        ? "text-gray-400 line-through"
                        : "text-gray-900"
                    }`}
                  >
                    {formatDate(followUp.followUpDate)}
                  </span>
                  {followUp.note && (
                    <span
                      className={`block text-sm ${
                        followUp.completed ? "text-gray-400" : "text-gray-500"
                      }`}
                    >
                      {followUp.note}
                    </span>
                  )}
                </span>
              </label>
              <button
                type="button"
                onClick={() => handleDelete(followUp.id)}
                className="shrink-0 text-sm text-gray-400 hover:text-red-600"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <form
        onSubmit={handleAdd}
        className="mt-4 grid grid-cols-1 gap-3 border-t border-gray-100 pt-4 sm:grid-cols-[auto_1fr_auto] sm:items-center"
      >
        <input
          type="date"
          required
          value={followUpDate}
          onChange={(e) => setFollowUpDate(e.target.value)}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none"
        />
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note (optional)"
          className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none"
        />
        <button
          type="submit"
          disabled={submitting || followUpDate === ""}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {submitting ? "Adding…" : "Add"}
        </button>
      </form>
    </section>
  );
}
