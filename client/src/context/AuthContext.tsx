"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  sendEmailVerification,
  sendPasswordResetEmail,
  updatePassword,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  EmailAuthProvider,
  onAuthStateChanged,
  type User,
  type UserCredential,
} from "firebase/auth";
import { auth, googleProvider } from "@/lib/firebase";
import { apiFetch } from "@/lib/api";
import { onAiUsage } from "@/lib/aiUsageEvents";
import type { UserSettings } from "@/lib/types";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  /** The backend user row (tier, quota, ...), fetched once Firebase resolves. */
  appUser: UserSettings | null;
  appUserLoading: boolean;
  /** Re-fetches appUser — call after an action that changes tier or quota. */
  refreshAppUser: () => Promise<void>;
  /**
   * Re-fetches only if the cached appUser is older than `maxAgeMs`. For
   * ambient refreshes (navigation), where being a minute stale is fine but
   * a request per navigation is not.
   */
  refreshAppUserIfStale: (maxAgeMs?: number) => Promise<void>;
  /**
   * Creates the account, emails a verification link, then signs the user out —
   * they must confirm their email before they can log in. Returns the created
   * credential so callers can show a "check your inbox" state.
   */
  signUp: (email: string, password: string) => Promise<UserCredential>;
  signIn: (email: string, password: string) => Promise<UserCredential>;
  signInWithGoogle: () => Promise<UserCredential>;
  signOut: () => Promise<void>;
  /** Re-sends the verification email to the given (just-authenticated) user. */
  resendVerification: (user: User) => Promise<void>;
  /**
   * Emails a password-reset link. Resolves even for unregistered addresses when
   * email enumeration protection is on, so callers must show the same message
   * either way. Also the recovery path for accounts created via Google: the
   * reset adds a password to that same account rather than making a new one.
   */
  requestPasswordReset: (email: string) => Promise<void>;
  /**
   * Sets a password on the signed-in account, re-authenticating first because
   * Firebase requires a recent login. Pass `currentPassword` for accounts that
   * already have one; Google-only accounts re-auth through the popup, and the
   * new password is added alongside their Google sign-in.
   */
  setPassword: (newPassword: string, currentPassword?: string) => Promise<void>;
  /** True when the signed-in account can sign in with email + password. */
  hasPasswordProvider: boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  // Tracked separately from `user` because Firebase mutates the User object in
  // place on reload() — the reference never changes, so React wouldn't re-render
  // after a password is added to a Google-only account.
  const [providerIds, setProviderIds] = useState<string[]>([]);
  const [appUser, setAppUser] = useState<UserSettings | null>(null);
  const [appUserLoading, setAppUserLoading] = useState(true);

  // Ticks on every fetch and on sign-out, so a response that resolves after a
  // newer one (or after the user signed out) is discarded instead of writing
  // stale data back. Without it, generating and immediately navigating can
  // land the pre-increment count last and under-report the usage badge.
  const fetchSeqRef = useRef(0);

  // When /api/user/me was last *attempted*, not last fetched successfully.
  // Stamping on success only made the staleness gate useless in both
  // directions: it left the ref at 0 through the provider's own load-time
  // fetch, so AppShell's mount effect always saw stale and fired a duplicate
  // concurrent request, and it left the ref untouched on failure, so once the
  // rate limiter returned a 429 every subsequent navigation re-fired — piling
  // on pressure precisely when there was already too much.
  const lastAttemptedAtRef = useRef(0);

  // Keeps the last known-good row on a transient failure. Blanking appUser on
  // any error means one network blip or one 429 from the rate limiter drops
  // the nav's admin link and usage badge mid-session — and on /admin the
  // redirect guard is itself gated on appUser, so it neither redirects nor
  // recovers. Only a real 401/403 (session gone) clears it; sign-out is
  // handled by the onAuthStateChanged effect below.
  // Stable identity (only refs and setState in scope) so the effects and the
  // context value below can depend on it without re-subscribing each render.
  const fetchAppUser = useCallback(async () => {
    const seq = ++fetchSeqRef.current;
    const isCurrent = () => seq === fetchSeqRef.current;

    // Before the first await, so the stamp is in place by the time React
    // commits the render that runs AppShell's effect — that's what stops the
    // provider's load-time fetch and the shell's mount check from both going
    // out. A failed attempt counts too: retrying it immediately is what turns
    // one 429 into a stream of them.
    lastAttemptedAtRef.current = Date.now();

    try {
      const response = await apiFetch("/api/user/me");
      if (response.status === 401 || response.status === 403) {
        // App Check rejections arrive as a 401 too, and they say nothing about
        // the session: getAppCheckToken() returns null on any hiccup
        // (throttling, a network blip, the attestation provider), apiFetch then
        // omits the header, and an enforcing server answers APP_CHECK_REQUIRED.
        // Reading those as "session gone" is the very failure described above.
        const body = (await response.json().catch(() => null)) as {
          code?: string;
        } | null;
        if (body?.code?.startsWith("APP_CHECK_")) return;
        if (isCurrent()) setAppUser(null);
        return;
      }
      if (!response.ok) return;
      const data = (await response.json()) as { user: UserSettings };
      if (!isCurrent()) return;
      setAppUser(data.user);
    } catch {
      // Network/parse failure — leave the previous value in place.
    }
  }, []);

  // Rate-limits the backstop refresh: at most one attempt per maxAgeMs,
  // whatever the last one returned. Callers that need the row to be current
  // regardless (refreshAppUser) bypass this.
  const refreshAppUserIfStale = useCallback(
    async (maxAgeMs = 60_000) => {
      if (Date.now() - lastAttemptedAtRef.current < maxAgeMs) return;
      await fetchAppUser();
    },
    [fetchAppUser]
  );

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      setProviderIds((firebaseUser?.providerData ?? []).map((p) => p.providerId));
      setLoading(false);

      if (firebaseUser && firebaseUser.emailVerified) {
        setAppUserLoading(true);
        await fetchAppUser();
        setAppUserLoading(false);
      } else {
        // Invalidate any in-flight fetch so a late response can't resurrect
        // the signed-out user's row.
        fetchSeqRef.current++;
        lastAttemptedAtRef.current = 0;
        setAppUser(null);
        setAppUserLoading(false);
      }
    });
    return unsubscribe;
  }, [fetchAppUser]);

  // Refreshes appUser right after any AI-generation call settles, wherever in
  // the app it happened — the nav's usage badge would otherwise only catch up
  // on the next page navigation.
  useEffect(() => onAiUsage(() => void fetchAppUser()), [fetchAppUser]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      appUser,
      appUserLoading,
      refreshAppUser: fetchAppUser,
      refreshAppUserIfStale,
      signUp: async (email, password) => {
        const credential = await createUserWithEmailAndPassword(
          auth,
          email,
          password
        );
        await sendEmailVerification(credential.user);
        // Don't leave an unverified user signed in on a dashboard that will
        // 401 — make them confirm, then log in.
        await firebaseSignOut(auth);
        return credential;
      },
      signIn: (email, password) =>
        signInWithEmailAndPassword(auth, email, password),
      signInWithGoogle: () => signInWithPopup(auth, googleProvider),
      signOut: () => firebaseSignOut(auth),
      resendVerification: (targetUser) => sendEmailVerification(targetUser),
      requestPasswordReset: (email) => sendPasswordResetEmail(auth, email),
      setPassword: async (newPassword, currentPassword) => {
        const current = auth.currentUser;
        if (!current) throw new Error("You need to be signed in to do that.");

        if (currentPassword && current.email) {
          await reauthenticateWithCredential(
            current,
            EmailAuthProvider.credential(current.email, currentPassword)
          );
        } else {
          await reauthenticateWithPopup(current, googleProvider);
        }
        await updatePassword(current, newPassword);
        // The password provider only shows up after a refresh from the server.
        await current.reload();
        setProviderIds(
          (auth.currentUser?.providerData ?? []).map((p) => p.providerId)
        );
      },
      hasPasswordProvider: providerIds.includes("password"),
    }),
    [user, loading, providerIds, appUser, appUserLoading, fetchAppUser, refreshAppUserIfStale]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
