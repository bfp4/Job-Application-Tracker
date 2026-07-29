"use client";

import { useState, type FormEvent } from "react";
import { useAuth } from "@/context/AuthContext";
import {
  PASSWORD_RULES,
  validatePassword,
  friendlyAuthError,
} from "@/lib/authErrors";

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
    <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-gray-900">
        {hasPasswordProvider ? "Change password" : "Set a password"}
      </h2>
      <p className="mt-1 text-sm text-gray-500">
        {hasPasswordProvider
          ? "Enter your current password, then choose a new one."
          : "You signed in with Google. Add a password so you can also sign in with your email — your Google sign-in keeps working either way."}
      </p>

      {error && (
        <div className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}
      {note && (
        <div className="mt-4 rounded-md bg-green-50 p-3 text-sm text-green-700">{note}</div>
      )}

      <form onSubmit={handleSubmit} className="mt-4 max-w-xs space-y-4">
        {hasPasswordProvider && (
          <div>
            <label
              htmlFor="current-password"
              className="block text-sm font-medium text-gray-700"
            >
              Current password
            </label>
            <input
              id="current-password"
              type="password"
              required
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none"
            />
          </div>
        )}

        <div>
          <label
            htmlFor="new-password"
            className="block text-sm font-medium text-gray-700"
          >
            New password
          </label>
          <input
            id="new-password"
            type="password"
            required
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none"
          />
          <ul className="mt-2 space-y-1">
            {PASSWORD_RULES.map((rule) => {
              const met = rule.test(newPassword);
              return (
                <li
                  key={rule.label}
                  className={`flex items-center gap-1.5 text-xs ${
                    met ? "text-green-600" : "text-gray-400"
                  }`}
                >
                  <span aria-hidden>{met ? "✓" : "○"}</span>
                  {rule.label}
                </li>
              );
            })}
          </ul>
        </div>

        <div>
          <label
            htmlFor="confirm-password"
            className="block text-sm font-medium text-gray-700"
          >
            Confirm password
          </label>
          <input
            id="confirm-password"
            type="password"
            required
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none"
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {submitting
            ? "Saving…"
            : hasPasswordProvider
              ? "Update password"
              : "Set password"}
        </button>

        {!hasPasswordProvider && (
          <p className="text-xs text-gray-500">
            You&apos;ll be asked to confirm with Google first.
          </p>
        )}
      </form>
    </section>
  );
}
