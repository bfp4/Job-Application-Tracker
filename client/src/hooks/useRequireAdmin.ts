"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useRequireAuth } from "@/hooks/useRequireAuth";

/**
 * Guards an admin-only page: applies useRequireAuth's sign-in check, then
 * redirects to /dashboard once the backend user has loaded and isn't ADMIN.
 * Server-side routes enforce this independently (requireAdmin middleware) —
 * this is only the UX layer.
 *
 * Callers must gate both their data fetching and their content render on
 * `isAdmin`, not just on `loading`. A redirect can only be issued from an
 * effect, which runs after the first commit — so anything a page does on
 * mount would otherwise still fire for a non-admin, and its 403 would paint
 * before the router swaps the route out.
 */
export function useRequireAdmin() {
  const router = useRouter();
  const { user, loading } = useRequireAuth();
  const { appUser, appUserLoading } = useAuth();

  useEffect(() => {
    if (loading || !user || appUserLoading) return;
    // Also covers appUser === null: if the backend row can't be confirmed,
    // admin can't be confirmed either, and sitting on /admin would strand
    // the page on a skeleton that never resolves.
    if (appUser?.tier !== "ADMIN") {
      router.replace("/dashboard");
    }
  }, [loading, user, appUserLoading, appUser, router]);

  return {
    user,
    loading: loading || appUserLoading,
    isAdmin: appUser?.tier === "ADMIN",
    appUser,
  };
}
