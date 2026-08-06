import type { ReactNode } from "react";
import LegalFooter from "@/components/LegalFooter";
import { IconBriefcase, IconSparkles } from "@/components/icons";

/**
 * Shared chrome for the signed-out pages: a brand panel beside the form.
 *
 * The panel is the only place the product pitches itself — `/` redirects
 * straight to sign-in, so this is a first-time visitor's sole explanation of
 * what they're signing into. It's hidden below `lg`, where the screen belongs
 * entirely to the form.
 */
export default function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex min-h-screen w-full bg-canvas">
      <aside className="relative hidden w-[42%] max-w-lg flex-col justify-between overflow-hidden border-r border-border bg-brand-soft p-10 lg:flex">
        {/* Faint violet blooms give the tint some depth without darkening it. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-brand/10 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-32 -left-16 h-80 w-80 rounded-full bg-brand/10 blur-3xl"
        />

        <div className="relative flex items-center gap-2.5 text-lg font-bold text-ink">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand text-white shadow-sm">
            <IconBriefcase size={20} />
          </span>
          JobTracker
        </div>

        <div className="relative">
          <h2 className="text-4xl font-bold leading-[1.15] tracking-tight text-ink">
            Track applications.
            <br />
            Write better.
            <br />
            Get more offers.
          </h2>
          <p className="mt-4 max-w-sm text-sm font-medium text-muted">
            Your AI-powered job search workspace — tailored resumes, cover letters and
            answers written for the one job in front of you.
          </p>
        </div>

        <ul className="relative space-y-3 text-sm font-medium text-muted">
          {[
            "Resume and cover letter tailored per posting",
            "Coaching on what your resume is missing",
            "Follow-up reminders so nothing goes cold",
          ].map((item) => (
            <li key={item} className="flex items-center gap-2.5">
              <IconSparkles size={15} className="shrink-0 text-brand" />
              {item}
            </li>
          ))}
        </ul>
      </aside>

      {/*
        A column, not a centered row. As a row's flex item the form got
        min-width:auto — its longest unwrappable line then beat `w-full` and
        pushed the card past the viewport on phones. Stacking makes width the
        cross axis, where max-w behaves.
      */}
      <main className="flex min-w-0 flex-1 flex-col justify-center px-4 py-10 sm:px-8">
        <div className="mx-auto w-full max-w-sm">
          {/* Wordmark for small screens, where the brand panel is hidden. */}
          <div className="mb-8 flex items-center gap-2 font-bold text-ink lg:hidden">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-white">
              <IconBriefcase size={17} />
            </span>
            JobTracker
          </div>

          <h1 className="text-2xl font-bold text-ink">{title}</h1>
          <p className="mt-1 text-sm font-medium text-muted">{subtitle}</p>

          <div className="mt-6">{children}</div>

          {footer && (
            <div className="mt-6 text-center text-sm font-medium text-muted">
              {footer}
            </div>
          )}

          {/*
            On every signed-out page, not just signup: a visitor has to be able
            to read what they're agreeing to before they hand over an email
            address, and Google's Maps Platform terms require the privacy policy
            to be publicly reachable.
          */}
          <LegalFooter className="mt-8 text-center" />
        </div>
      </main>
    </div>
  );
}
