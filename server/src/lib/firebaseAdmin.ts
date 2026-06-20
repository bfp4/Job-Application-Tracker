import {
  initializeApp,
  getApps,
  getApp,
  cert,
  type App,
} from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";

function getServiceAccountCredentials() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  // Private keys stored in .env have escaped newlines ("\n"); restore them.
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "Missing Firebase Admin credentials. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY in your environment."
    );
  }

  return { projectId, clientEmail, privateKey };
}

// Initialize once and reuse across hot reloads / imports.
const app: App = getApps().length
  ? getApp()
  : initializeApp({
      credential: cert(getServiceAccountCredentials()),
    });

export const adminAuth: Auth = getAuth(app);

export default app;
