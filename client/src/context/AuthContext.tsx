"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
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
  verifyPasswordResetCode,
  confirmPasswordReset,
  applyActionCode,
  updatePassword,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  EmailAuthProvider,
  onAuthStateChanged,
  type User,
  type UserCredential,
} from "firebase/auth";
import { auth, googleProvider } from "@/lib/firebase";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
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
  /** Validates a reset link's code and returns the email it belongs to. */
  verifyResetCode: (oobCode: string) => Promise<string>;
  /** Completes a reset, setting the new password on the account. */
  completePasswordReset: (oobCode: string, newPassword: string) => Promise<void>;
  /** Applies a verify-email (or similar) action code from an emailed link. */
  applyEmailActionCode: (oobCode: string) => Promise<void>;
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

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setProviderIds((firebaseUser?.providerData ?? []).map((p) => p.providerId));
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
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
      verifyResetCode: (oobCode) => verifyPasswordResetCode(auth, oobCode),
      completePasswordReset: (oobCode, newPassword) =>
        confirmPasswordReset(auth, oobCode, newPassword),
      applyEmailActionCode: (oobCode) => applyActionCode(auth, oobCode),
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
    [user, loading, providerIds]
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
