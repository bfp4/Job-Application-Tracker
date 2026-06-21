import type { ApplicationStatus } from "@/lib/types";

interface StatusMeta {
  label: string;
  /** Tailwind classes for a small filled badge. */
  badge: string;
}

export const STATUS_META: Record<ApplicationStatus, StatusMeta> = {
  NOT_APPLIED: {
    label: "Not applied",
    badge: "bg-gray-100 text-gray-700 ring-gray-200",
  },
  APPLIED: {
    label: "Applied",
    badge: "bg-blue-100 text-blue-700 ring-blue-200",
  },
  PHONE_SCREEN: {
    label: "Phone screen",
    badge: "bg-yellow-100 text-yellow-800 ring-yellow-200",
  },
  INTERVIEW: {
    label: "Interview",
    badge: "bg-purple-100 text-purple-700 ring-purple-200",
  },
  OFFER: {
    label: "Offer",
    badge: "bg-green-100 text-green-700 ring-green-200",
  },
  REJECTED: {
    label: "Rejected",
    badge: "bg-red-100 text-red-700 ring-red-200",
  },
};

/** Status values in the natural pipeline order. */
export const STATUS_ORDER: ApplicationStatus[] = [
  "NOT_APPLIED",
  "APPLIED",
  "PHONE_SCREEN",
  "INTERVIEW",
  "OFFER",
  "REJECTED",
];

export function statusLabel(status: ApplicationStatus): string {
  return STATUS_META[status]?.label ?? status;
}

export function statusBadgeClasses(status: ApplicationStatus): string {
  return STATUS_META[status]?.badge ?? STATUS_META.NOT_APPLIED.badge;
}
