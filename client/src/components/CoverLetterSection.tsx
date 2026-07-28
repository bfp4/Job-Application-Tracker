"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import CollapsibleCard, { useCollapsible } from "@/components/CollapsibleCard";
import CopyButton from "@/components/CopyButton";
import { apiFetch, apiJson } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { CoverLetter, CoverLetterContent } from "@/lib/types";

interface CoverLetterResponse {
  letter: CoverLetter | null;
  upToDate: boolean;
  hasResume: boolean;
}

/**
 * "Cover letter" card on the application detail page. Writes a letter for this
 * posting from the user's base resume (the server never invents facts), shows
 * it as it will read, and lets the user edit the wording, copy the plain text
 * into an application form, or download a formatted PDF.
 */
export default function CoverLetterSection({ applicationId }: { applicationId: string }) {
  const [data, setData] = useState<CoverLetterResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<CoverLetterContent | null>(null);
  const card = useCollapsible("cover-letter");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiJson<CoverLetterResponse>(
        `/api/applications/${applicationId}/cover-letter`
      );
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load cover letter.");
    } finally {
      setLoading(false);
    }
  }, [applicationId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleGenerate(force = false) {
    if (data?.letter?.edited && !force) {
      if (
        !confirm(
          "You've edited this letter. Regenerating will replace your edits. Continue?"
        )
      ) {
        return;
      }
      force = true;
    }

    setGenerating(true);
    setError(null);
    // The button lives in the header, so it can be pressed while collapsed —
    // open up so progress and the result are visible.
    card.setOpen(true);
    try {
      const res = await apiFetch(
        `/api/applications/${applicationId}/cover-letter${force ? "?force=1" : ""}`,
        { method: "POST" }
      );
      const body = (await res.json().catch(() => ({}))) as Partial<CoverLetterResponse> & {
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
        letter: body.letter ?? null,
        upToDate: body.upToDate ?? true,
        hasResume: body.hasResume ?? true,
      });
      setDraft(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate cover letter.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleSaveEdits() {
    if (!draft) return;
    setError(null);
    try {
      const res = await apiJson<CoverLetterResponse>(
        `/api/applications/${applicationId}/cover-letter`,
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
        `/api/applications/${applicationId}/cover-letter/download?format=pdf`
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Failed to download cover letter.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filenameFromResponse(res) ?? "cover-letter.pdf";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to download cover letter.");
    } finally {
      setDownloading(false);
    }
  }

  const letter = data?.letter ?? null;
  const content = draft ?? letter?.content ?? null;
  const editing = draft !== null;

  return (
    <CollapsibleCard
      storageKey="cover-letter"
      state={card}
      title="Cover letter"
      meta={summarizeState(loading, generating, data)}
      actions={
        data?.hasResume && (
          <>
            {letter && !editing && (
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
              disabled={generating || (data.upToDate && !letter?.edited)}
              title={
                data.upToDate && !letter?.edited
                  ? "Already up to date — update your resume or this posting to regenerate."
                  : undefined
              }
              className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {generating ? "Writing…" : letter ? "Regenerate" : "Write cover letter"}
            </button>
          </>
        )
      }
    >
      <p className="text-sm text-gray-500">
        A letter written for this posting from your resume — same facts, framed for
        this role. Specialized for your field (set in{" "}
        <Link href="/settings" className="font-medium text-gray-900 underline">
          Settings
        </Link>
        ) and kept to the length recruiters actually read. Review, tweak, then copy
        the text or download the PDF.
      </p>

      {error && <p className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {loading && <p className="mt-3 text-sm text-gray-500">Loading…</p>}

      {!loading && data && !data.hasResume && (
        <p className="mt-3 text-sm text-gray-500">
          Upload your resume in{" "}
          <Link href="/settings" className="font-medium text-gray-900 underline">
            Settings
          </Link>{" "}
          to write a cover letter for this job.
        </p>
      )}

      {generating && (
        <p className="mt-3 text-sm text-gray-500">
          Writing your letter for this posting… this can take up to a minute.
        </p>
      )}

      {!loading && content && (
        <div className="mt-4 space-y-4 border-t border-gray-100 pt-4">
          {letter && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-gray-700">{content.approachNote}</p>
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
                  <>
                    <CopyButton value={coverLetterToText(content)} label="Copy text" />
                    <button
                      type="button"
                      onClick={() => setDraft(structuredClone(content))}
                      className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                    >
                      Edit wording
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Letterhead — read-only. Name and contact come from the resume, and
              the date is stamped onto the PDF at download time. */}
          <div>
            <h3 className="text-base font-semibold text-gray-900">{content.header.name}</h3>
            {content.header.contact.length > 0 && (
              <p className="mt-0.5 text-xs text-gray-500">
                {content.header.contact.join("  ·  ")}
              </p>
            )}
            {recipientLines(content).length > 0 && (
              <p className="mt-3 whitespace-pre-line text-sm text-gray-700">
                {recipientLines(content).join("\n")}
              </p>
            )}
          </div>

          <div className="space-y-3">
            {editing ? (
              <input
                type="text"
                value={content.greeting}
                onChange={(e) => setDraft({ ...content, greeting: e.target.value })}
                className="w-full rounded-md border border-gray-300 p-2 text-sm text-gray-800"
              />
            ) : (
              <p className="text-sm text-gray-800">{content.greeting}</p>
            )}

            {content.paragraphs.map((paragraph, pi) =>
              editing ? (
                <textarea
                  key={pi}
                  value={paragraph}
                  onChange={(e) => updateParagraph(content, setDraft, pi, e.target.value)}
                  rows={5}
                  className="w-full rounded-md border border-gray-300 p-2 text-sm text-gray-800"
                />
              ) : (
                <p key={pi} className="text-sm leading-relaxed text-gray-800">
                  {paragraph}
                </p>
              )
            )}

            <div>
              <p className="text-sm text-gray-800">{content.closing}</p>
              <p className="mt-2 text-sm font-medium text-gray-900">{content.signature}</p>
            </div>
          </div>

          {letter && !editing && (
            <p className="text-xs text-gray-400">
              {wordCount(content)} words · Generated {formatDate(letter.updatedAt)}
              {letter.edited ? " · Edited by you" : ""}
              {data?.upToDate
                ? " · Up to date for your current resume and this posting."
                : " · Your resume or this posting has changed since — you can regenerate."}
            </p>
          )}
        </div>
      )}
    </CollapsibleCard>
  );
}

/** One-line status for the card header, readable while the card is collapsed. */
function summarizeState(
  loading: boolean,
  generating: boolean,
  data: CoverLetterResponse | null
): string | undefined {
  if (generating) return "Writing…";
  if (loading || !data) return undefined;
  if (!data.hasResume) return "No resume uploaded";
  if (!data.letter) return "Not written yet";
  if (data.letter.edited) return "Edited by you";
  return data.upToDate ? "Up to date" : "Posting or resume changed";
}

/** The addressee block, minus any line the posting never provided. */
function recipientLines(content: CoverLetterContent): string[] {
  return [content.recipient.name, content.recipient.title, content.recipient.company]
    .map((line) => line?.trim() ?? "")
    .filter((line) => line.length > 0);
}

/**
 * The letter as plain text, for pasting into an application form's cover-letter
 * box. Letterhead and date are left out — a form field wants the letter itself,
 * and the contact details are already elsewhere on the form.
 */
function coverLetterToText(content: CoverLetterContent): string {
  return [content.greeting, ...content.paragraphs, content.closing, content.signature]
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join("\n\n");
}

/** Body word count — the number recruiters' "keep it short" advice is about. */
function wordCount(content: CoverLetterContent): number {
  return content.paragraphs.join(" ").split(/\s+/).filter(Boolean).length;
}

/** Parses the download filename out of the Content-Disposition header. */
function filenameFromResponse(res: Response): string | null {
  const header = res.headers.get("Content-Disposition");
  const match = header?.match(/filename="?([^"]+)"?/i);
  return match ? match[1] : null;
}

function updateParagraph(
  draft: CoverLetterContent,
  setDraft: (c: CoverLetterContent) => void,
  index: number,
  value: string
) {
  const next = structuredClone(draft);
  next.paragraphs[index] = value;
  setDraft(next);
}
