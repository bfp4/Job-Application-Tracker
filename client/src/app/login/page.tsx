"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import AuthLayout from "@/components/AuthLayout";
import { useAuth } from "@/context/AuthContext";
import { friendlyAuthError, isBadCredentialError } from "@/lib/authErrors";
import { btnPrimary, btnSecondary, inputClassName, labelClassName } from "@/lib/ui";
import { IconGoogle } from "@/components/icons";

export default function LoginPage() {
  const router = useRouter();
  const { signIn, signInWithGoogle, signOut, resendVerification } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [resendNote, setResendNote] = useState<string | null>(null);
  const [badCredentials, setBadCredentials] = useState(false);

  async function handleEmailLogin(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNeedsVerification(false);
    setResendNote(null);
    setBadCredentials(false);
    setSubmitting(true);
    try {
      const { user } = await signIn(email, password);
      if (!user.emailVerified) {
        // Send a fresh link while we still have the authenticated user, then
        // sign back out so no unverified session lingers.
        try {
          await resendVerification(user);
        } catch {
          /* non-fatal: they can retry from the notice below */
        }
        await signOut();
        setNeedsVerification(true);
        return;
      }
      router.push("/dashboard");
    } catch (err) {
      setBadCredentials(isBadCredentialError(err));
      setError(friendlyAuthError(err, "Failed to sign in."));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResend() {
    setResendNote(null);
    setSubmitting(true);
    try {
      const { user } = await signIn(email, password);
      await resendVerification(user);
      await signOut();
      setResendNote("Verification email sent. Check your inbox.");
    } catch (err) {
      setError(friendlyAuthError(err, "Couldn't resend the email."));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGoogleLogin() {
    setError(null);
    setSubmitting(true);
    try {
      await signInWithGoogle();
      router.push("/dashboard");
    } catch (err) {
      setError(friendlyAuthError(err, "Failed to sign in with Google."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to your account."
      footer={
        <>
          Don&apos;t have an account?{" "}
          <Link href="/signup" className="font-semibold text-brand hover:underline">
            Sign up
          </Link>
        </>
      }
    >
      {error && (
        <div className="mb-4 rounded-xl border border-danger-ring bg-danger-soft p-3.5 text-sm">
          <p className="font-medium text-red-700">{error}</p>
          {/* Firebase can't tell us *why* the credential was rejected without
              leaking which emails are registered, so cover both cases: a
              forgotten password, and a Google account that has no password. */}
          {badCredentials && (
            <p className="mt-2 text-red-800">
              If you signed up with Google, use{" "}
              <span className="font-semibold">Continue with Google</span> below — or{" "}
              <Link href="/forgot-password" className="font-semibold underline">
                set a password
              </Link>{" "}
              for this email.
            </p>
          )}
        </div>
      )}

      {needsVerification && (
        <div className="mb-4 rounded-xl border border-warning-ring bg-warning-soft p-3.5 text-sm text-amber-800">
          <p className="font-medium">
            Please confirm your email before signing in — we just sent you a new link.
          </p>
          <button
            type="button"
            onClick={handleResend}
            disabled={submitting}
            className="mt-2 font-semibold underline disabled:opacity-50"
          >
            Resend verification email
          </button>
          {resendNote && (
            <p className="mt-2 font-semibold text-emerald-700">{resendNote}</p>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={handleGoogleLogin}
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

      <form onSubmit={handleEmailLogin} className="space-y-4">
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
          <div className="flex items-baseline justify-between">
            <label htmlFor="password" className={labelClassName}>
              Password
            </label>
            <Link
              href="/forgot-password"
              className="text-xs font-semibold text-brand hover:underline"
            >
              Forgot password?
            </Link>
          </div>
          <input
            id="password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={`mt-1.5 w-full ${inputClassName}`}
          />
        </div>

        <button type="submit" disabled={submitting} className={`${btnPrimary} w-full`}>
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </AuthLayout>
  );
}
