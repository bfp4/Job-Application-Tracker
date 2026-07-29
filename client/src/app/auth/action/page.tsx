"use client";

import { Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import {
  PASSWORD_RULES,
  validatePassword,
  friendlyAuthError,
} from "@/lib/authErrors";

function Card({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-sm rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
        {children}
      </div>
    </main>
  );
}

/**
 * Landing page for the links Firebase emails out (password reset, email
 * verification). Configured as the action URL on the email templates in the
 * Firebase console so users stay on our domain and our password rules apply.
 */
function AuthActionHandler() {
  const params = useSearchParams();
  const mode = params.get("mode");
  const oobCode = params.get("oobCode");

  const { verifyResetCode, completePasswordReset, applyEmailActionCode } = useAuth();

  const [checking, setChecking] = useState(true);
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [linkDead, setLinkDead] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  // applyActionCode consumes the code, so React's double-invoked dev effect
  // would report the second call as an invalid link.
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    async function run() {
      if (!oobCode || (mode !== "resetPassword" && mode !== "verifyEmail")) {
        setLinkDead(true);
        setError("This link is invalid or has already been used.");
        setChecking(false);
        return;
      }

      try {
        if (mode === "verifyEmail") {
          await applyEmailActionCode(oobCode);
          setDone(true);
        } else {
          // Checking up front means an expired link fails before the user has
          // typed a password. This does not consume the code.
          setAccountEmail(await verifyResetCode(oobCode));
        }
      } catch (err) {
        setLinkDead(true);
        setError(friendlyAuthError(err, "This link is invalid or has expired."));
      } finally {
        setChecking(false);
      }
    }

    void run();
  }, [mode, oobCode, applyEmailActionCode, verifyResetCode]);

  async function handleReset(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const passwordError = validatePassword(password);
    if (passwordError) {
      setError(passwordError);
      return;
    }
    if (password !== confirm) {
      setError("Those passwords don't match.");
      return;
    }

    setSubmitting(true);
    try {
      await completePasswordReset(oobCode!, password);
      setDone(true);
    } catch (err) {
      setError(friendlyAuthError(err, "Couldn't reset your password."));
    } finally {
      setSubmitting(false);
    }
  }

  if (checking) {
    return (
      <Card>
        <p className="text-sm text-gray-500">Checking your link…</p>
      </Card>
    );
  }

  if (linkDead) {
    return (
      <Card>
        <h1 className="text-2xl font-semibold text-gray-900">Link expired</h1>
        <p className="mt-2 text-sm text-gray-600">{error}</p>
        <Link
          href="/forgot-password"
          className="mt-6 block w-full rounded-md bg-gray-900 px-4 py-2 text-center text-sm font-medium text-white hover:bg-gray-800"
        >
          Send a new link
        </Link>
      </Card>
    );
  }

  if (done) {
    return (
      <Card>
        <h1 className="text-2xl font-semibold text-gray-900">
          {mode === "verifyEmail" ? "Email confirmed" : "Password updated"}
        </h1>
        <p className="mt-2 text-sm text-gray-600">
          {mode === "verifyEmail"
            ? "Your email is verified. You can sign in now."
            : "You can now sign in with your new password."}
        </p>
        <Link
          href="/login"
          className="mt-6 block w-full rounded-md bg-gray-900 px-4 py-2 text-center text-sm font-medium text-white hover:bg-gray-800"
        >
          Go to login
        </Link>
      </Card>
    );
  }

  return (
    <Card>
      <h1 className="text-2xl font-semibold text-gray-900">Choose a new password</h1>
      {accountEmail && (
        <p className="mt-1 text-sm text-gray-500">
          For <span className="font-medium text-gray-900">{accountEmail}</span>.
        </p>
      )}

      {error && (
        <div className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      <form onSubmit={handleReset} className="mt-6 space-y-4">
        <div>
          <label htmlFor="password" className="block text-sm font-medium text-gray-700">
            New password
          </label>
          <input
            id="password"
            type="password"
            required
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none"
          />
          <ul className="mt-2 space-y-1">
            {PASSWORD_RULES.map((rule) => {
              const met = rule.test(password);
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
          <label htmlFor="confirm" className="block text-sm font-medium text-gray-700">
            Confirm password
          </label>
          <input
            id="confirm"
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
          className="w-full rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {submitting ? "Saving…" : "Set password"}
        </button>
      </form>
    </Card>
  );
}

export default function AuthActionPage() {
  // useSearchParams needs a Suspense boundary to keep the route prerenderable.
  return (
    <Suspense
      fallback={
        <Card>
          <p className="text-sm text-gray-500">Loading…</p>
        </Card>
      }
    >
      <AuthActionHandler />
    </Suspense>
  );
}
