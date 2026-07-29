"use client";

import { useEffect, useState } from "react";
import { apiJson } from "@/lib/api";
import { cardClassName } from "@/lib/ui";
import { IconCheckCircle, IconCircle } from "@/components/icons";
import type { Application } from "@/lib/types";

interface ChecklistItem {
  label: string;
  done: boolean;
  /** Shown under the label when the step isn't done yet. */
  hint?: string;
}

/**
 * "Application checklist" — how close this application is to being finished.
 *
 * The three document steps live behind their own endpoints, so this fetches
 * them itself rather than lifting all three sections' state into the page.
 * `refreshKey` lets the parent re-run those reads after the user generates
 * something in another tab.
 */
export default function ApplicationChecklist({
  application,
  refreshKey = 0,
}: {
  application: Application;
  refreshKey?: number;
}) {
  const [hasResume, setHasResume] = useState(false);
  const [hasLetter, setHasLetter] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // A failed read just leaves the step unticked — the checklist is a
      // progress hint, never a blocker.
      const [tailored, letter] = await Promise.allSettled([
        apiJson<{ tailored: unknown | null }>(
          `/api/applications/${application.id}/tailored-resume`
        ),
        apiJson<{ letter: unknown | null }>(
          `/api/applications/${application.id}/cover-letter`
        ),
      ]);

      if (cancelled) return;
      setHasResume(tailored.status === "fulfilled" && tailored.value.tailored !== null);
      setHasLetter(letter.status === "fulfilled" && letter.value.letter !== null);
    })();

    return () => {
      cancelled = true;
    };
  }, [application.id, refreshKey]);

  const questions = application.questions ?? [];
  const answered = questions.filter((q) => (q.answer ?? "").trim() !== "").length;
  const followUps = application.followUps ?? [];

  const items: ChecklistItem[] = [
    {
      label: "Tailored resume",
      done: hasResume,
      hint: "Rewrite your resume for this posting",
    },
    {
      label: "Cover letter",
      done: hasLetter,
      hint: "Write one from your resume",
    },
    {
      label: "Application questions",
      done: questions.length > 0 && answered === questions.length,
      hint:
        questions.length === 0
          ? "Add any questions the form asks"
          : `${answered} of ${questions.length} answered`,
    },
    {
      label: "Submitted",
      done: application.status !== "NOT_APPLIED",
      hint: "Mark the status once you apply",
    },
    {
      label: "Follow-up scheduled",
      done: followUps.length > 0,
      hint: "Set a date to chase this up",
    },
  ];

  const done = items.filter((item) => item.done).length;

  return (
    <section className={cardClassName}>
      <div className="flex items-center justify-between gap-2 px-5 py-4">
        <h2 className="text-sm font-bold text-ink">Application checklist</h2>
        <span className="shrink-0 text-xs font-semibold tabular-nums text-muted">
          {done}/{items.length}
        </span>
      </div>

      {/* Progress bar doubles as the "how done am I" glance. */}
      <div className="px-5">
        <div className="h-1.5 overflow-hidden rounded-full bg-subtle">
          <div
            className="h-full rounded-full bg-emerald-600 transition-all duration-300"
            style={{ width: `${(done / items.length) * 100}%` }}
          />
        </div>
      </div>

      <ul className="space-y-0.5 px-3 py-3">
        {items.map((item) => (
          <li key={item.label} className="flex items-start gap-2.5 rounded-lg px-2 py-1.5">
            {item.done ? (
              <IconCheckCircle size={17} className="mt-px shrink-0 text-emerald-600" />
            ) : (
              <IconCircle size={17} className="mt-px shrink-0 text-border" />
            )}
            <div className="min-w-0">
              <p
                className={`text-sm font-medium ${
                  item.done ? "text-muted line-through" : "text-ink"
                }`}
              >
                {item.label}
              </p>
              {!item.done && item.hint && (
                <p className="text-xs text-muted">{item.hint}</p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
