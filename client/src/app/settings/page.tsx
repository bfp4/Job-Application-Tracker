"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import AppShell from "@/components/AppShell";
import { apiFetch } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useAuth } from "@/context/AuthContext";
import type {
  BaseResume,
  ResumeSpecialization,
  SpecializationOption,
  UserSettings,
} from "@/lib/types";

export default function SettingsPage() {
  const { user, loading: authLoading } = useAuth();

  const [baseResume, setBaseResume] = useState<BaseResume | null>(null);
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [specializationOptions, setSpecializationOptions] = useState<
    SpecializationOption[]
  >([]);
  const [savingSpecialization, setSavingSpecialization] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const [resumeRes, userRes] = await Promise.all([
        apiFetch("/api/resumes/base"),
        apiFetch("/api/user/me"),
      ]);
      const resumeData = (await resumeRes.json()) as { baseResume: BaseResume | null };
      setBaseResume(resumeData.baseResume);
      const userData = (await userRes.json()) as {
        user: UserSettings;
        specializationOptions: SpecializationOption[];
      };
      setSettings(userData.user);
      setSpecializationOptions(userData.specializationOptions);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load settings.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSpecializationChange(value: ResumeSpecialization) {
    const previous = settings;
    // Optimistic: reflect the choice immediately, roll back on failure.
    setSettings((s) => (s ? { ...s, resumeSpecialization: value } : s));
    setSavingSpecialization(true);
    setError(null);
    try {
      const res = await apiFetch("/api/user/me", {
        method: "PATCH",
        body: JSON.stringify({ resumeSpecialization: value }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed to save specialization.");
      setSettings(data.user as UserSettings);
    } catch (err) {
      setSettings(previous);
      setError(err instanceof Error ? err.message : "Failed to save specialization.");
    } finally {
      setSavingSpecialization(false);
    }
  }

  useEffect(() => {
    if (authLoading || !user) return;
    void loadData();
  }, [authLoading, user]);

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
            Manage your resume and how it&apos;s tailored to each job.
          </p>
        </div>

        {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>}

        {loading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : (
          <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900">Base resume</h2>
            <p className="mt-1 text-sm text-gray-500">
              Upload a PDF resume. It will be stored securely.
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
              <div className="mt-6 space-y-1 border-t border-gray-100 pt-4">
                <p className="text-sm text-gray-700">Resume on file.</p>
                <p className="text-xs text-gray-500">Uploaded {formatDate(baseResume.createdAt)}</p>
              </div>
            ) : (
              <p className="mt-4 text-sm text-gray-500">No resume uploaded yet.</p>
            )}
          </section>
        )}

        {!loading && settings && (
          <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900">Resume specialization</h2>
            <p className="mt-1 text-sm text-gray-500">
              Tailored resumes are rewritten using the conventions of this field —
              which achievements to foreground, which keywords matter, how to order
              sections. Every tailored resume is capped at one page.
            </p>

            <div className="mt-4 max-w-xs">
              <label
                htmlFor="specialization"
                className="block text-sm font-medium text-gray-700"
              >
                Field
              </label>
              <select
                id="specialization"
                value={settings.resumeSpecialization}
                onChange={(e) =>
                  handleSpecializationChange(e.target.value as ResumeSpecialization)
                }
                disabled={savingSpecialization}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 disabled:opacity-50"
              >
                {specializationOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              {savingSpecialization && (
                <p className="mt-2 text-xs text-gray-500">Saving…</p>
              )}
            </div>
          </section>
        )}
      </div>
    </AppShell>
  );
}
