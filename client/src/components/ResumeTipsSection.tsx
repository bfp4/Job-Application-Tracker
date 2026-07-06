"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiJson } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { ResumeAnalysis, ResumeTipsContent } from "@/lib/types";

interface TipsResponse {
  analysis: ResumeAnalysis | null;
  upToDate: boolean;
  hasResume: boolean;
}

/**
 * "Resume tips" card on the application detail page. Fetches the saved
 * analysis, and offers generate/regenerate — the button is disabled while
 * the saved analysis is still current for the user's resume + this posting
 * (the server enforces the same rule with a 409).
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
      const res = await apiJson<TipsResponse>(
        `/api/applications/${applicationId}/resume-tips`
      );
      setData(res);
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
      const res = await apiJson<TipsResponse>(
        `/api/applications/${applicationId}/resume-tips`,
        { method: "POST" }
      );
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate resume tips.");
    } finally {
      setGenerating(false);
    }
  }

  const analysis = data?.analysis ?? null;
  const content = analysis?.content ?? null;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Resume tips</h2>
          <p className="mt-1 text-sm text-gray-500">
            AI analysis of your resume against this posting — what to study, what&apos;s
            missing, and what to highlight.
          </p>
        </div>
        {data?.hasResume && (
          <button
            type="button"
            onClick={handleGenerate}
            disabled={generating || data.upToDate}
            title={
              data.upToDate
                ? "Already up to date — update your resume or this posting to run a new analysis."
                : undefined
            }
            className="shrink-0 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {generating ? "Analyzing…" : analysis ? "Regenerate tips" : "Get resume tips"}
          </button>
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
          to get tailored tips for this job.
        </p>
      )}

      {generating && (
        <p className="mt-3 text-sm text-gray-500">
          Reading your resume and this posting… this can take up to a minute.
        </p>
      )}

      {!loading && content && (
        <div className="mt-4 space-y-5 border-t border-gray-100 pt-4">
          <p className="text-sm text-gray-700">{content.summary}</p>

          {content.technologiesToStudy.length > 0 && (
            <TipGroup title="Technologies to study">
              <ul className="space-y-2">
                {content.technologiesToStudy.map((tech) => (
                  <li key={tech.name} className="text-sm text-gray-600">
                    <span className="font-medium text-gray-900">{tech.name}</span> —{" "}
                    {tech.reason}
                  </li>
                ))}
              </ul>
            </TipGroup>
          )}

          {content.missingFromResume.length > 0 && (
            <TipGroup title="Missing from your resume">
              <BulletList items={content.missingFromResume} />
            </TipGroup>
          )}

          {content.bulletPointSuggestions.length > 0 && (
            <TipGroup title="Bullet points to add or change">
              <ul className="space-y-3">
                {content.bulletPointSuggestions.map((suggestion, index) => (
                  <li key={index} className="rounded-md bg-gray-50 p-3 text-sm">
                    {suggestion.current && (
                      <p className="text-gray-500 line-through">{suggestion.current}</p>
                    )}
                    <p className="text-gray-900">{suggestion.suggested}</p>
                    <p className="mt-1 text-xs text-gray-500">{suggestion.reason}</p>
                  </li>
                ))}
              </ul>
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
            <p className="text-xs text-gray-400">
              Generated {formatDate(analysis.updatedAt)}
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

function TipGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-medium text-gray-900">{title}</h3>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm text-gray-600">
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}
