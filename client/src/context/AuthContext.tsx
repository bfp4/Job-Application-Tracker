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
  /** Returns the current user's Firebase ID token, or null if signed out. */
  getIdToken: (forceRefresh?: boolean) => Promise<string | null>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
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
      getIdToken: (forceRefresh = false) =>
        auth.currentUser
          ? auth.currentUser.getIdToken(forceRefresh)
          : Promise.resolve(null),
    }),
    [user, loading]
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
