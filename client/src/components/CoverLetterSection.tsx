"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import CopyButton from "@/components/CopyButton";
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
import type { CoverLetter, CoverLetterContent } from "@/lib/types";

interface CoverLetterResponse {
  letter: CoverLetter | null;
  upToDate: boolean;
  hasResume: boolean;
}

const STEPS = [
  "Reading your resume",
  "Reading this posting",
  "Finding what to lead with",
  "Writing your letter",
];

/**
 * "Cover letter" — written for this posting from the base resume, following
 * the conventions of the user's field, and never claiming anything the resume
 * doesn't say.
 *
 * Two outputs on purpose: "Copy text" yields just the letter body for pasting
 * into a web form (which collects contact details itself), while the PDF is
 * the full letterhead version, dated the day it's downloaded.
 */
export default function CoverLetterSection({
  applicationId,
}: {
  applicationId: string;
}) {
  const [data, setData] = useState<CoverLetterResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<CoverLetterContent | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(
        await apiJson<CoverLetterResponse>(
          `/api/applications/${applicationId}/cover-letter`
        )
      );
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
        !confirm("You've edited this letter. Regenerating will replace your edits. Continue?")
      ) {
        return;
      }
      force = true;
    }

    setGenerating(true);
    setError(null);
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
      setData(
        await apiJson<CoverLetterResponse>(
          `/api/applications/${applicationId}/cover-letter`,
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
  const state = resolveState(loading, generating, data);

  return (
    <AiPanel
      title="Cover letter"
      description={
        <>
          A letter for this posting, written from your resume and framed for this role.
          Specialized for your field (set in{" "}
          <Link href="/settings" className="font-semibold text-brand hover:underline">
            Settings
          </Link>
          ) and kept to the length recruiters actually read.
        </>
      }
      status={<AiStateChip state={state} />}
      actions={
        data?.hasResume && (
          <>
            {letter && !editing && (
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
              disabled={generating || (data.upToDate && !letter?.edited)}
              title={
                data.upToDate && !letter?.edited
                  ? "Already up to date — update your resume or this posting to regenerate."
                  : undefined
              }
              className={letter ? btnAiSoft : btnAi}
            >
              {letter ? <IconRefresh size={15} /> : <IconSparkles size={16} />}
              {generating ? "Writing…" : letter ? "Regenerate" : "Write cover letter"}
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

      {loading && <AiSkeleton lines={7} />}

      {!loading && data && !data.hasResume && (
        <NoResumeNotice action="The cover letter" />
      )}

      {generating && !content && <AiProgress steps={STEPS} />}

      {!loading && content && (
        <div className="space-y-5">
          {generating && <AiProgress steps={STEPS} />}

          {letter && (
            <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl bg-subtle/60 p-3">
              <p className="min-w-0 flex-1 text-sm text-muted">{content.approachNote}</p>
              <div className="flex shrink-0 gap-2">
                {editing ? (
                  <>
                    <button type="button" onClick={handleSaveEdits} className={btnAiSoft}>
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
                  <>
                    <CopyButton value={coverLetterToText(content)} label="Copy text" />
                    <button
                      type="button"
                      onClick={() => setDraft(structuredClone(content))}
                      className={btnSecondarySm}
                    >
                      <IconPencil size={15} />
                      Edit wording
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          <article className="rounded-xl border border-border p-5 sm:p-8">
            {/* Letterhead is read-only: name and contact come from the resume,
                and the date is stamped onto the PDF at download time. */}
            <header>
              <h3 className="text-base font-bold text-ink">{content.header.name}</h3>
              {content.header.contact.length > 0 && (
                <p className="mt-0.5 text-xs text-muted">
                  {content.header.contact.join("  ·  ")}
                </p>
              )}
              {recipientLines(content).length > 0 && (
                <p className="mt-5 whitespace-pre-line text-sm text-ink">
                  {recipientLines(content).join("\n")}
                </p>
              )}
            </header>

            <div className="mt-5 space-y-4">
              {editing ? (
                <input
                  type="text"
                  value={content.greeting}
                  onChange={(e) => setDraft({ ...content, greeting: e.target.value })}
                  aria-label="Greeting"
                  className={`w-full ${inputClassName}`}
                />
              ) : (
                <p className="text-sm text-ink">{content.greeting}</p>
              )}

              {content.paragraphs.map((paragraph, pi) =>
                editing ? (
                  <textarea
                    key={pi}
                    value={paragraph}
                    onChange={(e) => updateParagraph(content, setDraft, pi, e.target.value)}
                    rows={5}
                    aria-label={`Paragraph ${pi + 1}`}
                    className={`w-full ${inputClassName}`}
                  />
                ) : (
                  <p key={pi} className="text-sm leading-relaxed text-ink">
                    {paragraph}
                  </p>
                )
              )}

              <div className="pt-1">
                <p className="text-sm text-ink">{content.closing}</p>
                <p className="mt-3 text-sm font-bold text-ink">{content.signature}</p>
              </div>
            </div>
          </article>

          {letter && !editing && (
            <AiProvenance
              generatedAt={letter.updatedAt}
              upToDate={data?.upToDate ?? true}
              edited={letter.edited}
              extra={`${wordCount(content)} words`}
            />
          )}
        </div>
      )}

      {!loading && !content && data?.hasResume && !generating && (
        <p className="text-sm text-muted">
          Nothing written yet. Generate a letter for this posting, then copy the text
          into an application form or download the formatted PDF.
        </p>
      )}
    </AiPanel>
  );
}

function resolveState(
  loading: boolean,
  generating: boolean,
  data: CoverLetterResponse | null
): AiState {
  if (generating) return "working";
  if (loading || !data) return "loading";
  if (!data.hasResume) return "no-resume";
  if (!data.letter) return "not-generated";
  if (data.letter.edited) return "edited";
  return data.upToDate ? "up-to-date" : "stale";
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
