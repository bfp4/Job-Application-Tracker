import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";
import { AuthProvider } from "@/context/AuthContext";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "JobTracker",
    template: "%s · JobTracker",
  },
  description:
    "Track applications, write better with AI, and get more offers — your AI-powered job search workspace.",
};

/**
 * `viewportFit: cover` plus the safe-area padding in AppShell keeps the mobile
 * tab bar clear of the iOS home indicator.
 */
export const viewport: Viewport = {
  themeColor: "#7C3AED",
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <AuthProvider>{children}</AuthProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
