"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { friendlyAuthError } from "@/lib/authErrors";

export default function LoginPage() {
  const router = useRouter();
  const { signIn, signInWithGoogle, signOut, resendVerification } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [resendNote, setResendNote] = useState<string | null>(null);

  async function handleEmailLogin(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNeedsVerification(false);
    setResendNote(null);
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
    <main className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-sm rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold text-gray-900">Welcome back</h1>
        <p className="mt-1 text-sm text-gray-500">Sign in to your account.</p>

        {error && (
          <div className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>
        )}

        {needsVerification && (
          <div className="mt-4 rounded-md bg-amber-50 p-3 text-sm text-amber-800">
            <p>Please confirm your email before signing in — we just sent you a new link.</p>
            <button
              type="button"
              onClick={handleResend}
              disabled={submitting}
              className="mt-2 font-medium underline disabled:opacity-50"
            >
              Resend verification email
            </button>
            {resendNote && <p className="mt-2 text-green-700">{resendNote}</p>}
          </div>
        )}

        <form onSubmit={handleEmailLogin} className="mt-6 space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <div className="my-4 flex items-center gap-3">
          <div className="h-px flex-1 bg-gray-200" />
          <span className="text-xs uppercase text-gray-400">or</span>
          <div className="h-px flex-1 bg-gray-200" />
        </div>

        <button
          type="button"
          onClick={handleGoogleLogin}
          disabled={submitting}
          className="w-full rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          Sign in with Google
        </button>

        <p className="mt-6 text-center text-sm text-gray-500">
          Don&apos;t have an account?{" "}
          <Link href="/signup" className="font-medium text-gray-900 underline">
            Sign up
          </Link>
        </p>
      </div>
    </main>
  );
}
