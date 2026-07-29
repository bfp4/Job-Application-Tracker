"use client";

import { useEffect, useState } from "react";
import type { BrandIcon } from "@/lib/companyIcons";

/**
 * A company's brand mark as a rounded tile, from simple-icons where the brand
 * exists there and a deterministic monogram where it doesn't.
 *
 * The registry is ~100KB of SVG path data, so it's fetched as its own chunk
 * after mount rather than bundled into the first paint. The monogram renders
 * immediately and is replaced in place, which is why both variants share the
 * exact same box: swapping one for the other must never reflow the row.
 */

const SIZES = {
  sm: { box: "h-8 w-8 rounded-lg", glyph: 14, text: "text-xs" },
  md: { box: "h-10 w-10 rounded-xl", glyph: 18, text: "text-sm" },
  lg: { box: "h-14 w-14 rounded-2xl", glyph: 26, text: "text-lg" },
} as const;

export type CompanyLogoSize = keyof typeof SIZES;

/**
 * Module-level cache of the dynamic import. Every logo on a page shares one
 * request, and navigating back doesn't re-fetch.
 */
type Registry = typeof import("@/lib/companyIcons");

let registryPromise: Promise<Registry | null> | null = null;
let registry: Registry | null = null;

function loadRegistry() {
  registryPromise ??= import("@/lib/companyIcons")
    .then((mod) => {
      registry = mod;
      return mod;
    })
    .catch((err) => {
      // Falling back to monograms is the right behaviour, but it must not be
      // indistinguishable from "no brand matched" — an earlier evaluation bug
      // in that module hid itself for exactly that reason.
      console.error("[CompanyLogo] brand icon registry failed to load", err);
      return null;
    });
  return registryPromise;
}

/** Monogram palette — muted enough that a wall of them still reads as a list. */
const FALLBACK_COLORS = [
  "bg-slate-100 text-slate-600",
  "bg-blue-50 text-blue-600",
  "bg-indigo-50 text-indigo-600",
  "bg-violet-50 text-violet-600",
  "bg-teal-50 text-teal-600",
  "bg-amber-50 text-amber-600",
  "bg-rose-50 text-rose-600",
  "bg-emerald-50 text-emerald-600",
];

/** Stable per company, so a company keeps its colour across sessions. */
function fallbackColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return FALLBACK_COLORS[Math.abs(hash) % FALLBACK_COLORS.length];
}

/** Up to two initials: "Bank of America" → "BA", "Stripe" → "S". */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter((w) => /[a-z0-9]/i.test(w));
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/**
 * Perceived brightness (ITU-R BT.601). Brands with near-white marks — Snapchat,
 * Nikon — need a dark glyph on a tint instead of white-on-white.
 */
function isLight(hex: string): boolean {
  const int = parseInt(hex, 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return (r * 299 + g * 587 + b * 114) / 1000 > 205;
}

export default function CompanyLogo({
  name,
  size = "md",
  className = "",
}: {
  name: string | null | undefined;
  size?: CompanyLogoSize;
  className?: string;
}) {
  const label = name?.trim() || "Unknown company";
  const [icon, setIcon] = useState<BrandIcon | null>(() =>
    registry ? registry.lookupBrandIcon(label) : null
  );

  useEffect(() => {
    let cancelled = false;
    // Already loaded: resolve synchronously so there's no needless flash.
    if (registry) {
      setIcon(registry.lookupBrandIcon(label));
      return;
    }
    void loadRegistry().then((mod) => {
      if (!cancelled && mod) setIcon(mod.lookupBrandIcon(label));
    });
    return () => {
      cancelled = true;
    };
  }, [label]);

  const { box, glyph, text } = SIZES[size];
  const shared = `inline-flex shrink-0 items-center justify-center ring-1 ring-inset ring-black/5 ${box} ${className}`;

  if (icon) {
    const light = isLight(icon.hex);
    return (
      <span
        className={shared}
        style={{ backgroundColor: light ? `#${icon.hex}22` : `#${icon.hex}` }}
        title={label}
      >
        <svg
          role="img"
          aria-label={label}
          viewBox="0 0 24 24"
          width={glyph}
          height={glyph}
          fill={light ? `#${icon.hex}` : "#FFFFFF"}
        >
          <path d={icon.path} />
        </svg>
      </span>
    );
  }

  return (
    <span
      className={`${shared} font-bold ${text} ${fallbackColor(label)}`}
      aria-label={label}
      title={label}
      role="img"
    >
      {initials(label)}
    </span>
  );
}
