/**
 * Defensive headers for every page.
 *
 * `frame-ancestors 'none'` (plus X-Frame-Options for older browsers) is the one
 * that closes a real hole: without it, an attacker's page can load /admin in an
 * invisible iframe and trick a signed-in admin into clicking Approve or Delete.
 *
 * Deliberately no `script-src`/`default-src` here. The app pulls in Google Maps
 * Places (which injects further scripts of its own), Firebase App Check's
 * reCAPTCHA, Clearbit autocomplete, and Next's inline bootstrap — a guessed
 * policy would break those in production without closing anything, since there
 * is no known XSS sink to defend. Adding one is a deliberate project with a
 * report-only rollout, not a config tweak.
 */
const securityHeaders = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
