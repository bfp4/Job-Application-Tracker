"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch, apiJson } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { TailoredResume, TailoredResumeContent } from "@/lib/types";

interface TailoredResponse {
  tailored: TailoredResume | null;
  upToDate: boolean;
  hasResume: boolean;
}

/**
 * "Tailored resume" card on the application detail page. Generates a resume
 * rewritten for this posting (rephrase/reorder only — the server never invents
 * facts), lets the user review each change and edit the wording, and downloads
 * a PDF. Separate from Resume tips: tips is analysis, this is the artifact.
 */
export default function TailoredResumeSection({ applicationId }: { applicationId: string }) {
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
      const res = await apiJson<TailoredResponse>(
        `/api/applications/${applicationId}/tailored-resume`
      );
      setData(res);
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
        !confirm(
          "You've edited this resume. Regenerating will replace your edits. Continue?"
        )
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
        // Edited-and-not-forced: ask, then retry with force. Otherwise the
        // view was simply stale — sync to the server's state.
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
      const res = await apiJson<TailoredResponse>(
        `/api/applications/${applicationId}/tailored-resume`,
        { method: "PATCH", body: JSON.stringify({ content: draft }) }
      );
      setData(res);
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

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Tailored resume</h2>
          <p className="mt-1 text-sm text-gray-500">
            Your resume rewritten for this posting — same facts, retargeted wording
            and ordering. Specialized for your field (set in{" "}
            <Link href="/settings" className="font-medium text-gray-900 underline">
              Settings
            </Link>
            ) and capped at one page. Review, tweak, and download.
          </p>
        </div>
        {data?.hasResume && (
          <div className="flex shrink-0 flex-wrap gap-2">
            {tailored && !editing && (
              <button
                type="button"
                onClick={handleDownload}
                disabled={downloading}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50 disabled:opacity-50"
              >
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
              className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {generating ? "Building…" : tailored ? "Regenerate" : "Build tailored resume"}
            </button>
          </div>
        )}
      </div>

      {error && <p className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {loading && <p className="mt-3 text-sm text-gray-500">Loading…</p>}

      {!loading && data && !data.hasResume && (
        <p className="mt-3 text-sm text-gray-500">
          Upload your resume in{" "}
          <Link href="/settings" className="font-medium text-gray-900 underline">
            Settings
          </Link>{" "}
          to build a tailored resume for this job.
        </p>
      )}

      {generating && (
        <p className="mt-3 text-sm text-gray-500">
          Rewriting your resume for this posting… this can take up to a minute.
        </p>
      )}

      {!loading && content && (
        <div className="mt-4 space-y-5 border-t border-gray-100 pt-4">
          {tailored && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-gray-700">{content.changeNote}</p>
              <div className="flex gap-2">
                {editing ? (
                  <>
                    <button
                      type="button"
                      onClick={handleSaveEdits}
                      className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800"
                    >
                      Save edits
                    </button>
                    <button
                      type="button"
                      onClick={() => setDraft(null)}
                      className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setDraft(structuredClone(content))}
                    className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Edit wording
                  </button>
                )}
              </div>
            </div>
          )}

          <div>
            <h3 className="text-base font-semibold text-gray-900">{content.header.name}</h3>
            {content.header.contact.length > 0 && (
              <p className="mt-0.5 text-xs text-gray-500">
                {content.header.contact.join("  ·  ")}
              </p>
            )}
          </div>

          {content.summary && (
            <div>
              <h4 className="text-sm font-medium text-gray-900">Summary</h4>
              {editing ? (
                <textarea
                  value={content.summary}
                  onChange={(e) => updateSummary(draft, setDraft, e.target.value)}
                  rows={3}
                  className="mt-1 w-full rounded-md border border-gray-300 p-2 text-sm text-gray-800"
                />
              ) : (
                <p className="mt-1 text-sm text-gray-700">{content.summary}</p>
              )}
            </div>
          )}

          {content.sections.map((section, si) => (
            <div key={si}>
              <h4 className="text-sm font-semibold uppercase tracking-wide text-gray-900">
                {section.title}
              </h4>
              <div className="mt-2 space-y-3">
                {section.entries.map((entry, ei) => (
                  <div key={ei}>
                    {entry.heading && (
                      <p className="text-sm font-medium text-gray-800">{entry.heading}</p>
                    )}
                    <ul className="mt-1 space-y-2">
                      {entry.bullets.map((bullet, bi) => (
                        <li key={bi} className="text-sm">
                          {editing ? (
                            <textarea
                              value={bullet.after}
                              onChange={(e) =>
                                updateBullet(draft, setDraft, si, ei, bi, e.target.value)
                              }
                              rows={2}
                              className="w-full rounded-md border border-gray-300 p-2 text-sm text-gray-800"
                            />
                          ) : (
                            <>
                              <p className="text-gray-800">{bullet.after}</p>
                              {bullet.before && bullet.before !== bullet.after && (
                                <p className="mt-0.5 text-xs text-gray-400 line-through">
                                  {bullet.before}
                                </p>
                              )}
                            </>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {tailored && !editing && (
            <p className="text-xs text-gray-400">
              Generated {formatDate(tailored.updatedAt)}
              {tailored.edited ? " · Edited by you" : ""}
              {data?.upToDate
                ? " · Up to date for your current resume and this posting."
                : " · Your resume or this posting has changed since — you can regenerate."}
            </p>
          )}
        </div>
      )}
    </div>
  );
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
