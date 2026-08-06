import type { ReactNode } from "react";
import Link from "next/link";
import { IconAlert, IconBriefcase } from "@/components/icons";
import {
  LEGAL_LAST_UPDATED,
  PLACEHOLDER,
  hasUnfilledPlaceholders,
} from "@/lib/legal";

/**
 * Chrome for /privacy and /terms.
 *
 * Both are reachable signed out — a visitor has to be able to read what they
 * are agreeing to before they create an account, and Google's Maps Platform
 * terms require the privacy policy to be publicly linked.
 */
export default function LegalPage({
  title,
  intro,
  children,
}: {
  title: string;
  intro: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex h-16 w-full max-w-3xl items-center px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2 font-bold text-ink">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand text-white shadow-sm">
              <IconBriefcase size={16} />
            </span>
            JobTracker
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
        <h1 className="text-3xl font-bold tracking-tight text-ink">{title}</h1>
        <p className="mt-2 text-sm font-medium text-muted">
          Last updated {LEGAL_LAST_UPDATED}
        </p>

        {/*
          Renders only while lib/legal.ts still holds a placeholder, and
          disappears by itself once both values are real. Deliberately loud and
          in the document body rather than a code comment: a policy with a blank
          where the governing state or the mailing address should be is worse
          than no policy, and this is the one thing a reader would notice.
        */}
        {hasUnfilledPlaceholders() && (
          <div className="mt-6 flex items-start gap-2.5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <IconAlert size={16} className="mt-0.5 shrink-0" />
            <span>
              <strong className="font-semibold">Draft — not yet in force.</strong>{" "}
              This document still contains <code>{PLACEHOLDER}</code> markers. Fill
              in <code>client/src/lib/legal.ts</code> and redeploy; this banner
              disappears on its own.
            </span>
          </div>
        )}

        <p className="mt-6 text-[15px] leading-7 text-muted">{intro}</p>

        <div className="mt-8 space-y-8">{children}</div>

        <footer className="mt-14 border-t border-border pt-6 text-sm font-medium text-muted">
          <Link href="/privacy" className="hover:text-ink">
            Privacy Policy
          </Link>
          <span className="px-2">·</span>
          <Link href="/terms" className="hover:text-ink">
            Terms of Service
          </Link>
          <span className="px-2">·</span>
          <Link href="/login" className="hover:text-ink">
            Sign in
          </Link>
        </footer>
      </main>
    </div>
  );
}

/** One numbered section of a legal document. */
export function LegalSection({
  heading,
  children,
}: {
  heading: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h2 className="text-lg font-bold text-ink">{heading}</h2>
      <div className="mt-3 space-y-3 text-[15px] leading-7 text-muted">
        {children}
      </div>
    </section>
  );
}

/** A bulleted list inside a section, with consistent spacing. */
export function LegalList({ children }: { children: ReactNode }) {
  return (
    <ul className="ml-5 list-disc space-y-2 marker:text-border">{children}</ul>
  );
}
