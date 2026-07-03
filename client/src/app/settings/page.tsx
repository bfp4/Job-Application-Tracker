"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import AppShell from "@/components/AppShell";
import { apiFetch } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { BaseResume } from "@/lib/types";

export default function SettingsPage() {
  const [baseResume, setBaseResume] = useState<BaseResume | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const resumeRes = await apiFetch("/api/resumes/base");
      const resumeData = (await resumeRes.json()) as { baseResume: BaseResume | null };
      setBaseResume(resumeData.baseResume);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load settings.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  async function handleFileSelected(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await apiFetch("/api/resumes/base", {
        method: "POST",
        body: formData,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error ?? "Failed to upload resume.");
      setBaseResume(data.baseResume);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload resume.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <AppShell>
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Settings</h1>
          <p className="mt-1 text-sm text-gray-500">
            Upload your resume for storage. Job search is temporarily unavailable.
          </p>
        </div>

        {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>}

        {loading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : (
          <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900">Base resume</h2>
            <p className="mt-1 text-sm text-gray-500">
              Upload a PDF resume. It will be stored securely until job search is re-enabled.
            </p>

            <div className="mt-4 flex items-center gap-3">
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf"
                onChange={handleFileSelected}
                disabled={uploading}
                className="text-sm text-gray-600 file:mr-3 file:rounded-md file:border-0 file:bg-gray-900 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-gray-800"
              />
              {uploading && <span className="text-sm text-gray-500">Uploading…</span>}
            </div>

            {baseResume ? (
              <div className="mt-6 space-y-4 border-t border-gray-100 pt-4">
                <p className="text-sm text-gray-700">Resume on file.</p>
                <p className="text-xs text-gray-500">
                  Uploaded {formatDate(baseResume.createdAt)}
                </p>
                <p className="text-sm text-amber-800">
                  Job search is temporarily unavailable while resume handling is being updated.
                </p>
              </div>
            ) : (
              <p className="mt-4 text-sm text-gray-500">No resume uploaded yet.</p>
            )}
          </section>
        )}
      </div>
    </AppShell>
  );
}
