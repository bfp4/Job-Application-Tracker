"use client";

import { useId, useState } from "react";
import type { ApplicationStatus } from "@/lib/types";
import { STATUS_ORDER, statusHex, statusLabel } from "@/lib/status/status";

/**
 * Applications by pipeline stage, as a donut with the total in the hole.
 *
 * Part-to-whole is the actual question here ("how is my pipeline distributed"),
 * and exact magnitudes are already answered by the stat tiles above it — so the
 * donut is doing shape, not measurement. The legend still carries every count
 * and percentage, which is also what lets this palette ship: the two closest
 * hues under protanopia sit in the validator's floor band, legal only with
 * secondary encoding, and the labels plus the 2px segment gaps supply it.
 */

const SIZE = 176;
const STROKE = 22;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
/** Surface-colored gap between neighbouring segments, in px of arc. */
const GAP = 2;

export interface StatusDatum {
  status: ApplicationStatus;
  count: number;
}

export default function StatusDonut({
  counts,
  total,
}: {
  counts: Record<ApplicationStatus, number>;
  total: number;
}) {
  const titleId = useId();
  const [active, setActive] = useState<ApplicationStatus | null>(null);

  const data: StatusDatum[] = STATUS_ORDER.map((status) => ({
    status,
    count: counts[status] ?? 0,
  }));
  const present = data.filter((d) => d.count > 0);

  // One non-zero stage would otherwise draw a full ring with a gap cut out of
  // it for no reason; render it as an unbroken ring instead.
  const single = present.length === 1;

  let offset = 0;
  const segments = present.map((datum) => {
    const fraction = datum.count / total;
    const length = fraction * CIRCUMFERENCE;
    const dash = single ? length : Math.max(length - GAP, 1);
    const segment = { ...datum, dash, offset, fraction };
    offset += length;
    return segment;
  });

  return (
    <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center sm:gap-8">
      <div className="relative shrink-0">
        <svg
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          role="img"
          aria-labelledby={titleId}
          className="-rotate-90"
        >
          <title id={titleId}>
            {`Applications by status: ${present
              .map((d) => `${statusLabel(d.status)} ${d.count}`)
              .join(", ")}`}
          </title>

          {/* Track, so an empty or sparse pipeline still reads as a ring. */}
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke="#F1F5F9"
            strokeWidth={STROKE}
          />

          {segments.map((segment) => (
            <circle
              key={segment.status}
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              stroke={statusHex(segment.status)}
              strokeWidth={STROKE}
              strokeDasharray={`${segment.dash} ${CIRCUMFERENCE - segment.dash}`}
              strokeDashoffset={-segment.offset}
              className="transition-opacity duration-200"
              opacity={active && active !== segment.status ? 0.35 : 1}
              onMouseEnter={() => setActive(segment.status)}
              onMouseLeave={() => setActive(null)}
            />
          ))}
        </svg>

        {/* The hole carries the headline number the ring is a breakdown of. */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-bold tabular-nums text-ink">
            {active ? counts[active] : total}
          </span>
          <span className="mt-0.5 max-w-[6rem] text-center text-[11px] font-semibold uppercase tracking-wide text-muted">
            {active ? statusLabel(active) : "Total"}
          </span>
        </div>
      </div>

      <ul className="w-full space-y-1.5">
        {data.map((datum) => {
          const percent = total > 0 ? Math.round((datum.count / total) * 100) : 0;
          return (
            <li
              key={datum.status}
              onMouseEnter={() => setActive(datum.status)}
              onMouseLeave={() => setActive(null)}
              className={`flex items-center gap-2.5 rounded-md px-2 py-1 text-sm transition ${
                active === datum.status ? "bg-subtle" : ""
              }`}
            >
              <span
                aria-hidden
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: statusHex(datum.status) }}
              />
              <span className="min-w-0 flex-1 truncate font-medium text-muted">
                {statusLabel(datum.status)}
              </span>
              <span className="shrink-0 font-semibold tabular-nums text-ink">
                {datum.count}
              </span>
              <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted">
                {percent}%
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
