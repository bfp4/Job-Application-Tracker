"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import AppShell from "@/components/AppShell";
import PasswordSection from "@/components/PasswordSection";
import { apiFetch, apiJson } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useAuth } from "@/context/AuthContext";
import {
  btnPrimarySm,
  cardClassName,
  labelClassName,
  selectClassName,
} from "@/lib/ui";
import { IconAlert, IconFile, IconSparkles, IconUpload } from "@/components/icons";
import type {
  BaseResume,
  CareerSpecialization,
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
  const [specializationSaved, setSpecializationSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      // apiJson surfaces the server's error message; reading .json() directly
      // would silently store `undefined` when either request fails.
      const [resumeData, userData] = await Promise.all([
        apiJson<{ baseResume: BaseResume | null }>("/api/resumes/base"),
        apiJson<{
          user: UserSettings;
          specializationOptions: SpecializationOption[];
        }>("/api/user/me"),
      ]);
      setBaseResume(resumeData.baseResume);
      setSettings(userData.user);
      setSpecializationOptions(userData.specializationOptions);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load settings.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (authLoading || !user) return;
    void loadData();
  }, [authLoading, user]);

  async function handleSpecializationChange(value: CareerSpecialization) {
    const previous = settings;
    // Optimistic: reflect the choice immediately, roll back on failure.
    setSettings((s) => (s ? { ...s, careerSpecialization: value } : s));
    setSavingSpecialization(true);
    setSpecializationSaved(false);
    setError(null);
    try {
      const res = await apiFetch("/api/user/me", {
        method: "PATCH",
        body: JSON.stringify({ careerSpecialization: value }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed to save specialization.");
      setSettings(data.user as UserSettings);
      setSpecializationSaved(true);
      setTimeout(() => setSpecializationSaved(false), 2000);
    } catch (err) {
      setSettings(previous);
      setError(err instanceof Error ? err.message : "Failed to save specialization.");
    } finally {
      setSavingSpecialization(false);
    }
  }

  async function handleFileSelected(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Replacing the resume invalidates every generated document, so this is
    // worth a confirmation rather than a silent swap.
    if (
      baseResume &&
      !confirm(
        "Replace your resume? Tailored resumes, cover letters and tips already generated will be marked out of date, and you'll be able to regenerate them."
      )
    ) {
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

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
      <div className="max-w-3xl space-y-5">
        <header>
          <h1 className="text-2xl font-bold text-ink sm:text-[28px]">Settings</h1>
          <p className="mt-1 text-sm font-medium text-muted">
            Your resume and how the AI tailors it to each job.
          </p>
        </header>

        {error && (
          <div className="rounded-xl border border-danger-ring bg-danger-soft px-4 py-3 text-sm font-medium text-red-700">
            {error}
          </div>
        )}

        {loading ? (
          <div className="space-y-4" aria-hidden>
            <div className={`${cardClassName} h-44 animate-pulse bg-subtle`} />
            <div className={`${cardClassName} h-40 animate-pulse bg-subtle`} />
          </div>
        ) : (
          <>
            <section className={`${cardClassName} p-5`}>
              <h2 className="text-base font-bold text-ink">Base resume</h2>
              <p className="mt-1 text-sm text-muted">
                A PDF, up to 10MB. Everything the AI writes is built from it — so this
                one file powers the tailored resume, cover letter, tips, drafted answers
                and LinkedIn notes.
              </p>

              {baseResume ? (
                <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-subtle/50 p-4">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface text-brand ring-1 ring-inset ring-border">
                    <IconFile size={18} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-ink">Resume on file</p>
                    <p className="text-xs text-muted">
                      Uploaded {formatDate(baseResume.createdAt)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className={btnPrimarySm}
                  >
                    <IconUpload size={15} />
                    {uploading ? "Uploading…" : "Replace"}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="mt-4 flex w-full flex-col items-center rounded-xl border border-dashed border-border px-4 py-8 text-center transition hover:border-brand hover:bg-brand-soft/40"
                >
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-soft text-brand">
                    <IconUpload size={20} />
                  </span>
                  <span className="mt-3 text-sm font-semibold text-ink">
                    {uploading ? "Uploading…" : "Upload your resume"}
                  </span>
                  <span className="mt-0.5 text-xs text-muted">PDF, up to 10MB</span>
                </button>
              )}

              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf"
                onChange={handleFileSelected}
                disabled={uploading}
                className="sr-only"
                aria-label="Resume PDF"
              />

              {!baseResume && (
                <p className="mt-3 flex items-start gap-2 text-xs text-muted">
                  <IconAlert size={14} className="mt-px shrink-0 text-amber-600" />
                  Until you add one, the five AI features stay locked.
                </p>
              )}
            </section>

            {settings && (
              <section className={`${cardClassName} p-5`}>
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-ai-soft text-ai ring-1 ring-inset ring-ai-ring">
                    <IconSparkles size={18} />
                  </span>
                  <div>
                    <h2 className="text-base font-bold text-ink">
                      Career specialization
                    </h2>
                    <p className="mt-1 text-sm text-muted">
                      Everything the AI writes follows the conventions of this field —
                      which achievements to foreground, which keywords matter, and what
                      advice is worth giving.
                    </p>
                  </div>
                </div>

                <div className="mt-4 max-w-xs">
                  <label htmlFor="specialization" className={labelClassName}>
                    Field
                  </label>
                  <select
                    id="specialization"
                    value={settings.careerSpecialization}
                    onChange={(e) =>
                      handleSpecializationChange(e.target.value as CareerSpecialization)
                    }
                    disabled={savingSpecialization}
                    className={`mt-1.5 w-full ${selectClassName}`}
                  >
                    {specializationOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <p className="mt-2 h-4 text-xs font-semibold text-emerald-600">
                    {savingSpecialization
                      ? ""
                      : specializationSaved
                        ? "Saved"
                        : ""}
                  </p>
                </div>

                <p className="text-xs text-muted">
                  Changing this affects documents you generate from now on. Anything
                  already written keeps the wording it was given — regenerate it to pick
                  up the new field.
                </p>
              </section>
            )}

            <PasswordSection />
          </>
        )}
      </div>
    </AppShell>
  );
}
