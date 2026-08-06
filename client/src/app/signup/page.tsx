"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import AuthLayout from "@/components/AuthLayout";
import PasswordRules from "@/components/PasswordRules";
import { useAuth } from "@/context/AuthContext";
import { validatePassword, friendlyAuthError } from "@/lib/authErrors";
import { btnPrimary, btnSecondary, inputClassName, labelClassName } from "@/lib/ui";
import { IconGoogle, IconMail } from "@/components/icons";

export default function SignUpPage() {
  const router = useRouter();
  const { signUp, signInWithGoogle } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function handleEmailSignUp(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const passwordError = validatePassword(password);
    if (passwordError) {
      setError(passwordError);
      return;
    }

    setSubmitting(true);
    try {
      await signUp(email, password);
      setSentTo(email);
    } catch (err) {
      setError(friendlyAuthError(err, "Failed to sign up."));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGoogleSignUp() {
    setError(null);
    setSubmitting(true);
    try {
      await signInWithGoogle();
      router.push("/dashboard");
    } catch (err) {
      setError(friendlyAuthError(err, "Failed to sign up with Google."));
    } finally {
      setSubmitting(false);
    }
  }

  if (sentTo) {
    return (
      <AuthLayout
        title="Confirm your email"
        subtitle="One more step before you can sign in."
      >
        <div className="rounded-2xl border border-border bg-surface p-5 text-center shadow-card">
          <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-brand-soft text-brand">
            <IconMail size={22} />
          </span>
          <p className="mt-3 text-sm text-muted">
            We sent a verification link to{" "}
            <span className="font-semibold text-ink">{sentTo}</span>. Click it to
            activate your account, then log in.
          </p>
          <Link href="/login" className={`${btnPrimary} mt-5 w-full`}>
            Go to login
          </Link>
          <p className="mt-4 text-xs text-muted">
            Didn&apos;t get it? Check your spam folder, or resend the link from the
            login page.
          </p>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Start tracking your job applications."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" className="font-semibold text-brand hover:underline">
            Log in
          </Link>
        </>
      }
    >
      {error && (
        <div className="mb-4 rounded-xl border border-danger-ring bg-danger-soft p-3.5 text-sm font-medium text-red-700">
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={handleGoogleSignUp}
        disabled={submitting}
        className={`${btnSecondary} w-full`}
      >
        <IconGoogle size={18} />
        Continue with Google
      </button>

      <div className="my-5 flex items-center gap-3">
        <div className="h-px flex-1 bg-border" />
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">
          or
        </span>
        <div className="h-px flex-1 bg-border" />
      </div>

      <form onSubmit={handleEmailSignUp} className="space-y-4">
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

        <div>
          <label htmlFor="password" className={labelClassName}>
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={`mt-1.5 w-full ${inputClassName}`}
          />
          <PasswordRules password={password} />
        </div>

        <button type="submit" disabled={submitting} className={`${btnPrimary} w-full`}>
          {submitting ? "Creating account…" : "Create account"}
        </button>

        {/*
          Sign-in-wrap consent: the notice sits directly above the button that
          forms the agreement, so the terms are presented at the moment of
          assent rather than buried in a footer. The Google button higher up the
          page creates an account too, so this is worded to cover both.
        */}
        <p className="text-center text-xs leading-5 text-muted">
          By creating an account you agree to our{" "}
          <Link href="/terms" className="font-semibold text-brand hover:underline">
            Terms of Service
          </Link>{" "}
          and{" "}
          <Link href="/privacy" className="font-semibold text-brand hover:underline">
            Privacy Policy
          </Link>
          .
        </p>
      </form>
    </AuthLayout>
  );
}
