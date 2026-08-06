"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import {
  btnSecondarySm,
  cardClassName,
  inputClassName,
  labelClassName,
} from "@/lib/ui";
import { IconAlert, IconDownload, IconTrash } from "@/components/icons";

/** What the user must type to arm the delete button. Case-sensitive. */
const DELETE_CONFIRMATION = "DELETE";

/**
 * "Your data" — the export and account-deletion controls (GDPR Art. 15/17/20,
 * CCPA §1798.105/.110). Separate from the rest of Settings because deletion is
 * the one irreversible action in the app.
 */
export default function AccountDataSection() {
  const router = useRouter();
  const { signOut } = useAuth();

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleExport() {
    setExporting(true);
    setExportError(null);
    try {
      const response = await apiFetch("/api/user/me/export");
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error ?? "Failed to export your data.");
      }

      // Saved through an object URL rather than by navigating to the endpoint:
      // the request needs an Authorization header (and an App Check token), so
      // a plain link or window.open would arrive unauthenticated and 401.
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `jobtracker-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Failed to export your data.");
    } finally {
      setExporting(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      const response = await apiFetch("/api/user/me", { method: "DELETE" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error ?? "Failed to delete your account.");
      }

      // The server reports this when the data is gone but the Firebase login
      // survived. Surface it instead of signing out silently — otherwise the
      // user's next sign-in lands in a new empty account with no explanation.
      if (data?.firebaseUserRemoved === false && data?.warning) {
        alert(data.warning);
      }

      await signOut();
      router.replace("/");
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : "Failed to delete your account."
      );
      setDeleting(false);
    }
  }

  return (
    <section className={`${cardClassName} p-5`}>
      <h2 className="text-base font-bold text-ink">Your data</h2>
      <p className="mt-1 text-sm text-muted">
        Everything JobTracker holds about you is yours to take or erase.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-subtle/50 p-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">Download your data</p>
          <p className="text-xs text-muted">
            A JSON file with your applications, contacts, follow-ups, notes,
            generated documents and resume text.
          </p>
        </div>
        <button
          type="button"
          onClick={handleExport}
          disabled={exporting}
          className={btnSecondarySm}
        >
          <IconDownload size={15} />
          {exporting ? "Preparing…" : "Export"}
        </button>
      </div>
      {exportError && (
        <p className="mt-2 text-xs font-semibold text-red-600">{exportError}</p>
      )}

      <div className="mt-5 rounded-xl border border-danger-ring bg-danger-soft/50 p-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-red-700">
          <IconAlert size={15} />
          Delete your account
        </p>
        <p className="mt-1 text-xs text-red-700/80">
          Permanently erases your account, resumes, applications, saved
          contacts and every generated document. This cannot be undone, and
          support cannot recover it. Export your data first if you want a copy.
        </p>

        {confirmingDelete ? (
          <div className="mt-4">
            <label htmlFor="delete-confirm" className={labelClassName}>
              Type {DELETE_CONFIRMATION} to confirm
            </label>
            <input
              id="delete-confirm"
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              autoComplete="off"
              className={`mt-1.5 w-full max-w-xs ${inputClassName}`}
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting || confirmText !== DELETE_CONFIRMATION}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-red-600 px-3 text-[13px] font-semibold text-white shadow-sm transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <IconTrash size={15} />
                {deleting ? "Deleting…" : "Permanently delete"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmingDelete(false);
                  setConfirmText("");
                  setDeleteError(null);
                }}
                disabled={deleting}
                className={btnSecondarySm}
              >
                Cancel
              </button>
            </div>
            {deleteError && (
              <p className="mt-2 text-xs font-semibold text-red-600">{deleteError}</p>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            className="mt-3 inline-flex h-9 items-center gap-2 rounded-lg border border-red-300 bg-surface px-3 text-[13px] font-semibold text-red-700 shadow-sm transition hover:bg-red-50"
          >
            <IconTrash size={15} />
            Delete account
          </button>
        )}
      </div>
    </section>
  );
}
