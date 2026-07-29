"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import AuthLayout from "@/components/AuthLayout";
import { useAuth } from "@/context/AuthContext";
import { friendlyAuthError } from "@/lib/authErrors";
import { btnPrimary, inputClassName, labelClassName } from "@/lib/ui";
import { IconMail } from "@/components/icons";

export default function ForgotPasswordPage() {
  const { requestPasswordReset } = useAuth();

  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await requestPasswordReset(email);
      setSentTo(email);
    } catch (err) {
      setError(friendlyAuthError(err, "Couldn't send the reset email."));
    } finally {
      setSubmitting(false);
    }
  }

  if (sentTo) {
    return (
      <AuthLayout title="Check your inbox" subtitle="The link expires in an hour.">
        <div className="rounded-2xl border border-border bg-surface p-5 text-center shadow-card">
          <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-brand-soft text-brand">
            <IconMail size={22} />
          </span>
          {/* Deliberately says "if an account exists" — confirming the address
              is registered would let anyone enumerate our users. */}
          <p className="mt-3 text-sm text-muted">
            If an account exists for{" "}
            <span className="font-semibold text-ink">{sentTo}</span>, we&apos;ve sent a
            link to reset your password.
          </p>
          <Link href="/login" className={`${btnPrimary} mt-5 w-full`}>
            Back to login
          </Link>
          <p className="mt-4 text-xs text-muted">
            Didn&apos;t get it? Check your spam folder, or{" "}
            <button
              type="button"
              onClick={() => setSentTo(null)}
              className="font-semibold text-brand hover:underline"
            >
              try another address
            </button>
            .
          </p>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Reset your password"
      subtitle="We'll send you a link to set a new one."
      footer={
        <>
          Remembered it?{" "}
          <Link href="/login" className="font-semibold text-brand hover:underline">
            Back to login
          </Link>
        </>
      }
    >
      {error && (
        <div className="mb-4 rounded-xl border border-danger-ring bg-danger-soft p-3.5 text-sm font-medium text-red-700">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="email" className={labelClassName}>
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className={`mt-1.5 w-full ${inputClassName}`}
          />
        </div>

        <button type="submit" disabled={submitting} className={`${btnPrimary} w-full`}>
          {submitting ? "Sending…" : "Send reset link"}
        </button>
      </form>

      <p className="mt-5 rounded-xl border border-border bg-subtle p-3.5 text-xs text-muted">
        Signed up with Google? You can use this to add a password to that same
        account — both ways of signing in will work afterwards.
      </p>
    </AuthLayout>
  );
}
