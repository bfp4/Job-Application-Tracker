"use client";

import type { ReactNode } from "react";
import Navbar from "@/components/Navbar";
import { useRequireAuth } from "@/hooks/useRequireAuth";

/**
 * Layout wrapper for authenticated pages. Redirects unauthenticated users to
 * /login, shows a loading state while auth resolves, and renders the shared
 * Navbar above page content.
 */
export default function AppShell({ children }: { children: ReactNode }) {
  const { user, loading } = useRequireAuth();

  if (loading || !user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50">
        <p className="text-sm text-gray-500">Loading…</p>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}
