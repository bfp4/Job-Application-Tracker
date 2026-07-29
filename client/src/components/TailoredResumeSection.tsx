"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch, apiJson } from "@/lib/api";
import { btnAi, btnAiSoft, btnSecondarySm, inputClassName } from "@/lib/ui";
import {
  AiError,
  AiPanel,
  AiProgress,
  AiProvenance,
  AiSkeleton,
  AiStateChip,
  NoResumeNotice,
  type AiState,
} from "@/components/ai";
import {
  IconDownload,
  IconPencil,
  IconRefresh,
  IconSparkles,
} from "@/components/icons";
import type { TailoredResume, TailoredResumeContent } from "@/lib/types";

interface TailoredResponse {
  tailored: TailoredResume | null;
  upToDate: boolean;
  hasResume: boolean;
}

const STEPS = [
  "Reading your resume",
  "Reading this posting",
  "Reordering for what this role wants",
  "Rewriting your bullets",
];

/**
 * "Tailored resume" — the artefact, as opposed to the tips tab's analysis.
 * The server rephrases and reorders the base resume for this posting and never
 * invents facts, so every changed bullet is shown against its original.
 */
export default function TailoredResumeSection({
  applicationId,
}: {
  applicationId: string;
}) {
  const [data, setData] = useState<TailoredResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<TailoredResumeContent | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(
        await apiJson<TailoredResponse>(
          `/api/applications/${applicationId}/tailored-resume`
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tailored resume.");
    } finally {
      setLoading(false);
    }
  }, [applicationId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleGenerate(force = false) {
    if (data?.tailored?.edited && !force) {
      if (
        !confirm("You've edited this resume. Regenerating will replace your edits. Continue?")
      ) {
        return;
      }
      force = true;
    }

    setGenerating(true);
    setError(null);
    try {
      const res = await apiFetch(
        `/api/applications/${applicationId}/tailored-resume${force ? "?force=1" : ""}`,
        { method: "POST" }
      );
      const body = (await res.json().catch(() => ({}))) as Partial<TailoredResponse> & {
        error?: string;
        needsForce?: boolean;
      };

      if (res.status === 409) {
        // Edited-and-not-forced: ask, then retry. Otherwise the view was simply
        // stale — sync to the server's state.
        if (body.needsForce) {
          setGenerating(false);
          await handleGenerate(true);
          return;
        }
        await load();
        return;
      }
      if (!res.ok) {
        throw new Error(body.error ?? `Request failed with status ${res.status}`);
      }

      setData({
        tailored: body.tailored ?? null,
        upToDate: body.upToDate ?? true,
        hasResume: body.hasResume ?? true,
      });
      setDraft(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate tailored resume.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleSaveEdits() {
    if (!draft) return;
    setError(null);
    try {
      setData(
        await apiJson<TailoredResponse>(
          `/api/applications/${applicationId}/tailored-resume`,
          { method: "PATCH", body: JSON.stringify({ content: draft }) }
        )
      );
      setDraft(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save edits.");
    }
  }

  async function handleDownload() {
    setDownloading(true);
    setError(null);
    try {
      const res = await apiFetch(
        `/api/applications/${applicationId}/tailored-resume/download?format=pdf`
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Failed to download resume.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filenameFromResponse(res) ?? "tailored-resume.pdf";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to download resume.");
    } finally {
      setDownloading(false);
    }
  }

  const tailored = data?.tailored ?? null;
  const content = draft ?? tailored?.content ?? null;
  const editing = draft !== null;
  const state = resolveState(loading, generating, data);

  return (
    <AiPanel
      title="Tailored resume"
      description={
        <>
          Your resume rewritten for this posting — same facts, retargeted wording and
          order. Specialized for your field (set in{" "}
          <Link href="/settings" className="font-semibold text-brand hover:underline">
            Settings
          </Link>
          ) and capped at one page.
        </>
      }
      status={<AiStateChip state={state} />}
      actions={
        data?.hasResume && (
          <>
            {tailored && !editing && (
              <button
                type="button"
                onClick={handleDownload}
                disabled={downloading}
                className={btnSecondarySm}
              >
                <IconDownload size={15} />
                {downloading ? "Preparing…" : "Download PDF"}
              </button>
            )}
            <button
              type="button"
              onClick={() => handleGenerate()}
              disabled={generating || (data.upToDate && !tailored?.edited)}
              title={
                data.upToDate && !tailored?.edited
                  ? "Already up to date — update your resume or this posting to regenerate."
                  : undefined
              }
              className={tailored ? btnAiSoft : btnAi}
            >
              {tailored ? <IconRefresh size={15} /> : <IconSparkles size={16} />}
              {generating ? "Building…" : tailored ? "Regenerate" : "Build tailored resume"}
            </button>
          </>
        )
      }
    >
      {error && (
        <div className="mb-4">
          <AiError message={error} />
        </div>
      )}

      {loading && <AiSkeleton lines={8} />}

      {!loading && data && !data.hasResume && (
        <NoResumeNotice action="The tailored resume" />
      )}

      {generating && !content && <AiProgress steps={STEPS} />}

      {!loading && content && (
        <div className="space-y-5">
          {generating && <AiProgress steps={STEPS} />}

          {tailored && (
            <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl bg-subtle/60 p-3">
              <p className="min-w-0 flex-1 text-sm text-muted">{content.changeNote}</p>
              <div className="flex shrink-0 gap-2">
                {editing ? (
                  <>
                    <button
                      type="button"
                      onClick={handleSaveEdits}
                      className={btnAiSoft}
                    >
                      Save edits
                    </button>
                    <button
                      type="button"
                      onClick={() => setDraft(null)}
                      className={btnSecondarySm}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setDraft(structuredClone(content))}
                    className={btnSecondarySm}
                  >
                    <IconPencil size={15} />
                    Edit wording
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Rendered as the document it is, so the preview reads like the PDF. */}
          <article className="rounded-xl border border-border p-5 sm:p-6">
            <header className="border-b border-border pb-4 text-center">
              <h3 className="text-lg font-bold text-ink">{content.header.name}</h3>
              {content.header.contact.length > 0 && (
                <p className="mt-1 text-xs text-muted">
                  {content.header.contact.join("  ·  ")}
                </p>
              )}
            </header>

            {content.summary && (
              <div className="mt-4">
                <h4 className="text-xs font-bold uppercase tracking-wide text-muted">
                  Summary
                </h4>
                {editing ? (
                  <textarea
                    value={content.summary}
                    onChange={(e) => updateSummary(draft, setDraft, e.target.value)}
                    rows={3}
                    aria-label="Summary"
                    className={`mt-2 w-full ${inputClassName}`}
                  />
                ) : (
                  <p className="mt-1.5 text-sm leading-relaxed text-ink">
                    {content.summary}
                  </p>
                )}
              </div>
            )}

            {content.sections.map((section, si) => (
              <div key={si} className="mt-5">
                <h4 className="border-b border-border pb-1 text-xs font-bold uppercase tracking-wide text-muted">
                  {section.title}
                </h4>
                <div className="mt-2.5 space-y-4">
                  {section.entries.map((entry, ei) => (
                    <div key={ei}>
                      {entry.heading && (
                        <p className="text-sm font-bold text-ink">{entry.heading}</p>
                      )}
                      <ul className="mt-1.5 space-y-2">
                        {entry.bullets.map((bullet, bi) => (
                          <li key={bi}>
                            {editing ? (
                              <textarea
                                value={bullet.after}
                                onChange={(e) =>
                                  updateBullet(draft, setDraft, si, ei, bi, e.target.value)
                                }
                                rows={2}
                                aria-label={`Bullet ${bi + 1}`}
                                className={`w-full ${inputClassName}`}
                              />
                            ) : (
                              <div className="flex gap-2.5 text-sm">
                                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-ink" />
                                <div className="min-w-0">
                                  <p className="text-ink">{bullet.after}</p>
                                  {bullet.before && bullet.before !== bullet.after && (
                                    <p className="mt-1 text-xs text-muted line-through decoration-danger/40">
                                      {bullet.before}
                                    </p>
                                  )}
                                </div>
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </article>

          {tailored && !editing && (
            <AiProvenance
              generatedAt={tailored.updatedAt}
              upToDate={data?.upToDate ?? true}
              edited={tailored.edited}
            />
          )}
        </div>
      )}

      {!loading && !content && data?.hasResume && !generating && (
        <p className="text-sm text-muted">
          Nothing built yet. Generate a version of your resume aimed at this posting,
          then review every change before you download it.
        </p>
      )}
    </AiPanel>
  );
}

function resolveState(
  loading: boolean,
  generating: boolean,
  data: TailoredResponse | null
): AiState {
  if (generating) return "working";
  if (loading || !data) return "loading";
  if (!data.hasResume) return "no-resume";
  if (!data.tailored) return "not-generated";
  if (data.tailored.edited) return "edited";
  return data.upToDate ? "up-to-date" : "stale";
}

/** Parses the download filename out of the Content-Disposition header. */
function filenameFromResponse(res: Response): string | null {
  const header = res.headers.get("Content-Disposition");
  const match = header?.match(/filename="?([^"]+)"?/i);
  return match ? match[1] : null;
}

function updateSummary(
  draft: TailoredResumeContent | null,
  setDraft: (c: TailoredResumeContent) => void,
  value: string
) {
  if (!draft) return;
  setDraft({ ...draft, summary: value });
}

function updateBullet(
  draft: TailoredResumeContent | null,
  setDraft: (c: TailoredResumeContent) => void,
  si: number,
  ei: number,
  bi: number,
  value: string
) {
  if (!draft) return;
  const next = structuredClone(draft);
  next.sections[si].entries[ei].bullets[bi].after = value;
  setDraft(next);
}
