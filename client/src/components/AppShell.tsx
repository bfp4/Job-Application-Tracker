"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import LegalFooter from "@/components/LegalFooter";
import {
  IconBriefcase,
  IconDashboard,
  IconLogOut,
  IconSettings,
  IconUsers,
} from "@/components/icons";

const BASE_NAV_LINKS = [
  { href: "/dashboard", label: "Dashboard", Icon: IconDashboard },
  { href: "/applications", label: "Applications", Icon: IconBriefcase },
  { href: "/settings", label: "Settings", Icon: IconSettings },
];

const ADMIN_NAV_LINK = { href: "/admin", label: "Admin", Icon: IconUsers };

/** The nav destinations for the current user — Admin only shows for tier ADMIN. */
function useNavLinks() {
  const { appUser } = useAuth();
  return appUser?.tier === "ADMIN" ? [...BASE_NAV_LINKS, ADMIN_NAV_LINK] : BASE_NAV_LINKS;
}

/**
 * Layout for every authenticated page: redirects signed-out visitors to
 * /login, then renders the app chrome around `children`.
 *
 * Two navigation shapes, not one responsive compromise — a fixed left sidebar
 * from `lg` up, and on smaller screens a top bar plus a thumb-reachable bottom
 * tab bar. Both render the same three destinations from NAV_LINKS.
 */
export default function AppShell({ children }: { children: ReactNode }) {
  const { user, loading } = useRequireAuth();
  const { refreshAppUserIfStale } = useAuth();
  const pathname = usePathname();

  // Backstop for drift the app can't observe locally — a tier changed by an
  // admin, or a call spent in another tab. The badge's own accuracy is
  // already handled by the onAiUsage subscription in AuthContext, which
  // refreshes the moment a generation succeeds anywhere.
  //
  // Deliberately staleness-gated rather than firing per navigation: that made
  // every in-app navigation a GET /api/user/me (plus its premiumRequest
  // lookup) and duplicated the fetch AuthProvider already does on load, which
  // pushed an active session toward the 300-req/15-min per-IP limiter — where
  // a 429 breaks unrelated requests, not just this one.
  useEffect(() => {
    if (!loading && user) void refreshAppUserIfStale();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, loading, user]);

  if (loading || !user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-canvas">
        <div className="flex items-center gap-3 text-sm font-medium text-muted">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-brand" />
          Loading…
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-canvas">
      <Sidebar />
      <TopBar />

      <main className="lg:pl-60">
        {/* pb clears the mobile tab bar; lg drops it since the bar is gone. */}
        <div className="mx-auto w-full max-w-6xl px-4 pb-28 pt-6 sm:px-6 lg:px-8 lg:pb-12">
          {children}
          <LegalFooter className="mt-12 border-t border-border pt-6" />
        </div>
      </main>

      <MobileTabBar />
    </div>
  );
}

function Wordmark({ className = "" }: { className?: string }) {
  return (
    <Link
      href="/dashboard"
      className={`flex items-center gap-2 font-bold text-ink ${className}`}
    >
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand text-white shadow-sm">
        <IconBriefcase size={16} />
      </span>
      JobTracker
    </Link>
  );
}

/** Matches the section, so /applications/abc keeps "Applications" active. */
function useIsActive() {
  const pathname = usePathname();
  return (href: string) => pathname === href || pathname.startsWith(`${href}/`);
}

function Sidebar() {
  const isActive = useIsActive();
  const navLinks = useNavLinks();

  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-border bg-surface lg:flex">
      <div className="flex h-16 items-center px-5">
        <Wordmark />
      </div>

      <nav className="flex-1 space-y-1 px-3 py-2">
        {navLinks.map(({ href, label, Icon }) => {
          const active = isActive(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold transition ${
                active
                  ? "bg-brand-soft text-brand"
                  : "text-muted hover:bg-subtle hover:text-ink"
              }`}
            >
              <Icon size={18} />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-border p-3">
        <SignOutButton className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold text-muted transition hover:bg-subtle hover:text-ink" />
      </div>
    </aside>
  );
}

/**
 * Page header. On mobile it carries the wordmark (the sidebar that would
 * normally hold it is hidden); on desktop only the account menu, right-aligned
 * over the content column.
 *
 * Sits at the top of the document and scrolls away with the page — nothing in
 * the content column tracks the scroll. `relative z-20` is only there so the
 * account dropdown layers above the cards below it.
 */
function TopBar() {
  return (
    <header className="relative z-20 border-b border-border bg-canvas lg:border-none">
      <div className="lg:pl-60">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Wordmark className="lg:hidden" />
          <div className="ml-auto flex items-center gap-3">
            <UsageBadge />
            <AccountMenu />
          </div>
        </div>
      </div>
    </header>
  );
}

function MobileTabBar() {
  const isActive = useIsActive();
  const navLinks = useNavLinks();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 backdrop-blur lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Primary"
    >
      <div className="flex">
        {navLinks.map(({ href, label, Icon }) => {
          const active = isActive(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-semibold transition ${
                active ? "text-brand" : "text-muted"
              }`}
            >
              <Icon size={20} />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/**
 * Persistent "X/10 AI calls left today" pill for Basic-tier users — Premium
 * and Admin are unlimited, so it renders nothing for them.
 */
function UsageBadge() {
  const { appUser } = useAuth();

  if (!appUser || appUser.tier !== "BASIC") return null;

  const used = appUser.aiCallsUsedToday;

  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-subtle px-3 py-1.5 text-xs font-semibold text-muted"
      title={`${used} of 10 AI calls used today`}
    >
      {used}/10 <span className="hidden sm:inline">AI calls used today</span>
      <span className="sm:hidden">today</span>
    </span>
  );
}

/** First letter of the email, or two initials when the local part has a dot. */
function avatarInitials(email: string | null | undefined): string {
  const local = email?.split("@")[0] ?? "";
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function AccountMenu() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Account menu"
        className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-xs font-bold text-white transition hover:opacity-90"
      >
        {avatarInitials(user?.email)}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-2 w-60 animate-fade-in overflow-hidden rounded-xl border border-border bg-surface shadow-pop"
        >
          <div className="border-b border-border px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">
              Signed in as
            </p>
            <p className="mt-0.5 truncate text-sm font-semibold text-ink" title={user?.email ?? ""}>
              {user?.email}
            </p>
          </div>
          <SignOutButton
            role="menuitem"
            className="flex w-full items-center gap-2.5 px-4 py-3 text-sm font-semibold text-muted transition hover:bg-subtle hover:text-ink"
          />
        </div>
      )}
    </div>
  );
}

function SignOutButton({
  className,
  role,
}: {
  className: string;
  role?: string;
}) {
  const router = useRouter();
  const { signOut } = useAuth();

  async function handleSignOut() {
    await signOut();
    router.replace("/login");
  }

  return (
    <button type="button" role={role} onClick={handleSignOut} className={className}>
      <IconLogOut size={18} />
      Sign out
    </button>
  );
}
