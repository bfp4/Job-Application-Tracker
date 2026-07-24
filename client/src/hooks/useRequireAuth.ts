"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

/**
 * Guards a client page: redirects to /login once Firebase has resolved and no
 * user is signed in — or if the signed-in user hasn't verified their email
 * (a backstop for the server's 403). Returns `{ user, loading }` so callers can
 * render a loading state while auth is resolving.
 */
export function useRequireAuth() {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && (!user || !user.emailVerified)) {
      router.replace("/login");
    }
  }, [loading, user, router]);

  return { user, loading };
}
