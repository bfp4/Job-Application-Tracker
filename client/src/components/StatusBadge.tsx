import type { ApplicationStatus } from "@/lib/types";
import { statusBadgeClasses, statusLabel } from "@/lib/status";

export default function StatusBadge({
  status,
}: {
  status: ApplicationStatus;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${statusBadgeClasses(
        status
      )}`}
    >
      {statusLabel(status)}
    </span>
  );
}
