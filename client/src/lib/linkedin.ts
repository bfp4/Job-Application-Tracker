import type { LinkedinStatus } from "@/lib/types";

interface LinkedinStatusMeta {
  label: string;
  /** Tailwind classes for a small filled badge / select. */
  badge: string;
}

export const LINKEDIN_STATUS_META: Record<LinkedinStatus, LinkedinStatusMeta> = {
  NONE: {
    label: "Not connected",
    badge: "bg-gray-100 text-gray-700 ring-gray-200",
  },
  CONNECTION_SENT: {
    label: "Connection sent",
    badge: "bg-yellow-100 text-yellow-800 ring-yellow-200",
  },
  CONNECTED: {
    label: "Connected",
    badge: "bg-blue-100 text-blue-700 ring-blue-200",
  },
  MESSAGING: {
    label: "Messaging",
    badge: "bg-green-100 text-green-700 ring-green-200",
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
