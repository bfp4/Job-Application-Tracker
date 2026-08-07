"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, apiJson } from "@/lib/api";
import { focusSections } from "@/lib/resumeTipsFocus/resumeTipsFocus";
import { btnAi, btnAiSoft } from "@/lib/ui";
import {
  AiDiff,
  AiError,
  AiPanel,
  AiProgress,
  AiProvenance,
  AiSkeleton,
  AiStateChip,
  NoResumeNotice,
  type AiState,
} from "@/components/ai";
import { IconRefresh, IconSparkles } from "@/components/icons";
import type { ResumeAnalysis } from "@/lib/types";

interface TipsResponse {
  analysis: ResumeAnalysis | null;
  upToDate: boolean;
  hasResume: boolean;
}

const STEPS = [
  "Reading your resume",
  "Reading this posting",
  "Comparing them against your field",
  "Writing your tips",
];

/**
 * "Resume tips" — coaching, not an artefact: what to study, what's missing,
 * what to highlight. Read-only by design; the two editable documents live in
 * their own tabs.
 *
 * Generation is gated server-side while the saved analysis still matches the
 * resume and posting it came from, and the button mirrors that with a 409 as
 * the backstop.
 */
export default function ResumeTipsSection({ applicationId }: { applicationId: string }) {
  const [data, setData] = useState<TipsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await apiJson<TipsResponse>(`/api/applications/${applicationId}/resume-tips`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load resume tips.");
    } finally {
      setLoading(false);
    }
  }, [applicationId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/applications/${applicationId}/resume-tips`, {
        method: "POST",
      });
      const body = (await res.json().catch(() => ({}))) as Partial<TipsResponse> & {
        error?: string;
      };

      // 409 means this view was stale (already regenerated elsewhere, or a run
      // is in flight) — sync to the server instead of surfacing an error.
      if (res.status === 409) {
        await load();
        return;
      }
      if (!res.ok) {
        throw new Error(body.error ?? `Request failed with status ${res.status}`);
      }

      setData({
        analysis: body.analysis ?? null,
        upToDate: body.upToDate ?? true,
        hasResume: body.hasResume ?? true,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate resume tips.");
    } finally {
      setGenerating(false);
    }
  }

  const analysis = data?.analysis ?? null;
  const content = analysis?.content ?? null;
  const state = resolveState(loading, generating, data);

  return (
    <AiPanel
      title="Resume tips"
      description="How your resume reads against this posting — what to study, what's missing, and what to lead with."
      status={<AiStateChip state={state} />}
      actions={
        data?.hasResume && (
          <button
            type="button"
            onClick={handleGenerate}
            disabled={generating || data.upToDate}
            title={
              data.upToDate
                ? "Already up to date — update your resume or this posting to run a new analysis."
                : undefined
            }
            className={analysis ? btnAiSoft : btnAi}
          >
            {analysis ? <IconRefresh size={15} /> : <IconSparkles size={16} />}
            {generating ? "Analyzing…" : analysis ? "Regenerate" : "Get resume tips"}
          </button>
        )
      }
    >
      {error && (
        <div className="mb-4">
          <AiError message={error} />
        </div>
      )}

      {loading && <AiSkeleton lines={6} />}

      {!loading && data && !data.hasResume && (
        <NoResumeNotice action="Resume tips" />
      )}

      {generating && !content && <AiProgress steps={STEPS} />}

      {!loading && content && (
        <div className={`space-y-6 ${generating ? "opacity-50" : ""}`}>
          {generating && <AiProgress steps={STEPS} />}

          <p className="text-sm leading-relaxed text-ink">{content.summary}</p>

          {/* Which sections appear depends on the career specialization the
              analysis was generated for — technologies for engineers, licences
              for nurses — so headings are never hard-coded here. */}
          {focusSections(content).map((section) => (
            <TipGroup key={section.key} title={section.title}>
              <ul className="space-y-2.5">
                {section.items.map((item) => (
                  <li key={item.name} className="flex gap-2.5 text-sm">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-ai" />
                    <span className="text-muted">
                      <span className="font-semibold text-ink">{item.name}</span> —{" "}
                      {item.reason}
                    </span>
                  </li>
                ))}
              </ul>
            </TipGroup>
          ))}

          {content.missingFromResume.length > 0 && (
            <TipGroup title="Missing from your resume">
              <BulletList items={content.missingFromResume} />
            </TipGroup>
          )}

          {content.bulletPointSuggestions.length > 0 && (
            <TipGroup title="Bullet points to add or change">
              <div className="space-y-2.5">
                {content.bulletPointSuggestions.map((suggestion, index) => (
                  <AiDiff
                    key={index}
                    before={suggestion.current}
                    after={suggestion.suggested}
                    reason={suggestion.reason}
                  />
                ))}
              </div>
            </TipGroup>
          )}

          {content.strengthsToHighlight.length > 0 && (
            <TipGroup title="Strengths to highlight">
              <BulletList items={content.strengthsToHighlight} />
            </TipGroup>
          )}

          {content.additionalTips.length > 0 && (
            <TipGroup title="Other tips">
              <BulletList items={content.additionalTips} />
            </TipGroup>
          )}

          {analysis && (
            <AiProvenance
              generatedAt={analysis.updatedAt}
              upToDate={data?.upToDate ?? true}
            />
          )}
        </div>
      )}

      {!loading && !content && data?.hasResume && !generating && (
        <p className="text-sm text-muted">
          Nothing generated yet. Run the analysis to see how this posting lines up
          against your resume.
        </p>
      )}
    </AiPanel>
  );
}

function resolveState(
  loading: boolean,
  generating: boolean,
  data: TipsResponse | null
): AiState {
  if (generating) return "working";
  if (loading || !data) return "loading";
  if (!data.hasResume) return "no-resume";
  if (!data.analysis) return "not-generated";
  return data.upToDate ? "up-to-date" : "stale";
}

function TipGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-bold text-ink">{title}</h3>
      <div className="mt-2.5">{children}</div>
    </div>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-2">
      {items.map((item, index) => (
        <li key={index} className="flex gap-2.5 text-sm text-muted">
          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-border" />
          {item}
        </li>
      ))}
    </ul>
  );
}
