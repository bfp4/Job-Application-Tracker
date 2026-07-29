"use client";

import { useState, type FormEvent } from "react";
import PasswordRules from "@/components/PasswordRules";
import { useAuth } from "@/context/AuthContext";
import { validatePassword, friendlyAuthError } from "@/lib/authErrors";
import {
  btnPrimarySm,
  cardClassName,
  inputClassName,
  labelClassName,
} from "@/lib/ui";

/**
 * Lets a signed-in user change their password — or, for someone who created
 * their account with Google and therefore has none, add one. Adding a password
 * doesn't replace Google sign-in; both work on the account afterwards.
 */
export default function PasswordSection() {
  const { user, hasPasswordProvider, setPassword } = useAuth();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!user) return null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNote(null);

    const passwordError = validatePassword(newPassword);
    if (passwordError) {
      setError(passwordError);
      return;
    }
    if (newPassword !== confirm) {
      setError("Those passwords don't match.");
      return;
    }

    setSubmitting(true);
    try {
      await setPassword(newPassword, hasPasswordProvider ? currentPassword : undefined);
      setNote(
        hasPasswordProvider
          ? "Password updated."
          : "Password set. You can now sign in with your email and password, or with Google."
      );
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
    } catch (err) {
      setError(friendlyAuthError(err, "Couldn't update your password."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className={`${cardClassName} p-5`}>
      <h2 className="text-base font-bold text-ink">
        {hasPasswordProvider ? "Change password" : "Set a password"}
      </h2>
      <p className="mt-1 text-sm text-muted">
        {hasPasswordProvider
          ? "Enter your current password, then choose a new one."
          : "You signed in with Google. Add a password so you can also sign in with your email — your Google sign-in keeps working either way."}
      </p>

      {error && (
        <div className="mt-4 rounded-xl border border-danger-ring bg-danger-soft p-3.5 text-sm font-medium text-red-700">
          {error}
        </div>
      )}
      {note && (
        <div className="mt-4 rounded-xl border border-success-ring bg-success-soft p-3.5 text-sm font-medium text-emerald-700">
          {note}
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-4 max-w-xs space-y-4">
        {hasPasswordProvider && (
          <div>
            <label htmlFor="current-password" className={labelClassName}>
              Current password
            </label>
            <input
              id="current-password"
              type="password"
              required
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className={`mt-1.5 w-full ${inputClassName}`}
            />
          </div>
        )}

        <div>
          <label htmlFor="new-password" className={labelClassName}>
            New password
          </label>
          <input
            id="new-password"
            type="password"
            required
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className={`mt-1.5 w-full ${inputClassName}`}
          />
          <PasswordRules password={newPassword} />
        </div>

        <div>
          <label htmlFor="confirm-password" className={labelClassName}>
            Confirm password
          </label>
          <input
            id="confirm-password"
            type="password"
            required
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className={`mt-1.5 w-full ${inputClassName}`}
          />
        </div>

        <button type="submit" disabled={submitting} className={btnPrimarySm}>
          {submitting
            ? "Saving…"
            : hasPasswordProvider
              ? "Update password"
              : "Set password"}
        </button>

        {!hasPasswordProvider && (
          <p className="text-xs text-muted">
            You&apos;ll be asked to confirm with Google first.
          </p>
        )}
      </form>
    </section>
  );
}
