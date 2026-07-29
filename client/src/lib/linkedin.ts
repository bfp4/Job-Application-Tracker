import type { LinkedinStatus } from "@/lib/types";

interface LinkedinStatusMeta {
  label: string;
  /** Tailwind classes for a small filled badge / select. */
  badge: string;
}

/**
 * Deliberately a different axis from the application pipeline: these are
 * outline/tinted chips rather than the pipeline's filled badges, so a contact's
 * networking state never reads as an application stage.
 */
export const LINKEDIN_STATUS_META: Record<LinkedinStatus, LinkedinStatusMeta> = {
  NONE: {
    label: "Not connected",
    badge: "bg-subtle text-muted ring-border",
  },
  CONNECTION_SENT: {
    label: "Connection sent",
    badge: "bg-warning-soft text-amber-700 ring-warning-ring",
  },
  CONNECTED: {
    label: "Connected",
    badge: "bg-brand-soft text-brand ring-brand-ring",
  },
  MESSAGING: {
    label: "Messaging",
    badge: "bg-success-soft text-green-700 ring-success-ring",
  },
};

/** LinkedIn statuses in natural progression order (drives the dropdown). */
export const LINKEDIN_STATUS_ORDER: LinkedinStatus[] = [
  "NONE",
  "CONNECTION_SENT",
  "CONNECTED",
  "MESSAGING",
];

export function linkedinStatusLabel(status: LinkedinStatus): string {
  return LINKEDIN_STATUS_META[status]?.label ?? status;
}

export function linkedinStatusBadgeClasses(status: LinkedinStatus): string {
  return (LINKEDIN_STATUS_META[status] ?? LINKEDIN_STATUS_META.NONE).badge;
}
