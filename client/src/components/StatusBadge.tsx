import type { ApplicationStatus } from "@/lib/types";
import { statusBadgeClasses, statusDotClasses, statusLabel } from "@/lib/status";

/**
 * The pipeline stage as a pill. `withDot` adds the solid status dot used
 * wherever the badge sits next to other, non-pipeline chips and needs to read
 * as a stage at a glance.
 */
export default function StatusBadge({
  status,
  withDot = false,
  className = "",
}: {
  status: ApplicationStatus;
  withDot?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${statusBadgeClasses(
        status
      )} ${className}`}
    >
      {withDot && (
        <span
          aria-hidden
          className={`h-1.5 w-1.5 rounded-full ${statusDotClasses(status)}`}
        />
      )}
      {statusLabel(status)}
    </span>
  );
}
