"use client";

import { useState, type FormEvent } from "react";
import CompanyInput from "@/components/CompanyInput";
import LocationInput from "@/components/LocationInput";
import { CopyField } from "@/components/CopyButton";
import { inputClassName } from "@/lib/ui";
import type { JobPosting } from "@/lib/types";

/** The posting fields a user can change after the job has been tracked. */
export interface JobPostingEdits {
  title: string;
  companyName: string;
  location: string[];
  salary: string | null;
  jobUrl: string;
  description: string | null;
}

/**
 * Edit form for a tracked posting's own details. Mirrors the add-job form on
 * the applications page, minus the fields that belong to the application
 * (status, source, notes) rather than the posting.
 *
 * The draft lives here and is only lifted on save, so cancelling discards it.
 */
export default function JobPostingForm({
  posting,
  onSave,
  onCancel,
}: {
  posting: JobPosting;
  onSave: (edits: JobPostingEdits) => Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(posting.title);
  const [companyName, setCompanyName] = useState(posting.company?.name ?? "");
  const [locations, setLocations] = useState<string[]>(posting.location ?? []);
  const [salary, setSalary] = useState(posting.salary ?? "");
  const [jobUrl, setJobUrl] = useState(posting.jobUrl);
  const [description, setDescription] = useState(posting.description ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const complete = Boolean(jobUrl.trim() && title.trim() && companyName.trim());

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!complete || saving) return;

    setSaving(true);
    setError(null);
    try {
      await onSave({
        title: title.trim(),
        companyName: companyName.trim(),
        location: locations,
        salary: salary.trim() || null,
        jobUrl: jobUrl.trim(),
        description: description.trim() || null,
      });
      // On success the parent closes the editor, unmounting this form.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save the posting.");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="edit-title" className="block text-xs font-medium text-gray-700">
            Title
          </label>
          <div className="mt-1">
            <CopyField value={title}>
              <input
                id="edit-title"
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={saving}
                className={`w-full pr-9 ${inputClassName}`}
              />
            </CopyField>
          </div>
        </div>
        <div>
          <label htmlFor="edit-company" className="block text-xs font-medium text-gray-700">
            Company
          </label>
          <div className="mt-1">
            <CompanyInput
              id="edit-company"
              required
              value={companyName}
              onChange={setCompanyName}
              disabled={saving}
            />
          </div>
        </div>
        <div>
          <label htmlFor="edit-location" className="block text-xs font-medium text-gray-700">
            Location
          </label>
          <div className="mt-1">
            <LocationInput
              id="edit-location"
              value={locations}
              onChange={setLocations}
              disabled={saving}
            />
          </div>
        </div>
        <div>
          <label htmlFor="edit-salary" className="block text-xs font-medium text-gray-700">
            Salary
          </label>
          <div className="mt-1">
            <CopyField value={salary}>
              <input
                id="edit-salary"
                type="text"
                value={salary}
                onChange={(e) => setSalary(e.target.value)}
                disabled={saving}
                placeholder="e.g. $120k–$150k, or DOE"
                className={`w-full pr-9 ${inputClassName}`}
              />
            </CopyField>
          </div>
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="edit-jobUrl" className="block text-xs font-medium text-gray-700">
            Job URL
          </label>
          <div className="mt-1">
            <CopyField value={jobUrl}>
              <input
                id="edit-jobUrl"
                type="url"
                required
                value={jobUrl}
                onChange={(e) => setJobUrl(e.target.value)}
                placeholder="https://…"
                disabled={saving}
                className={`w-full pr-9 ${inputClassName}`}
              />
            </CopyField>
          </div>
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="edit-description" className="block text-xs font-medium text-gray-700">
            Description
          </label>
          <div className="mt-1">
            <CopyField value={description} multiline>
              <textarea
                id="edit-description"
                rows={8}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={saving}
                placeholder="Paste the job description…"
                className={`w-full pr-9 ${inputClassName}`}
              />
            </CopyField>
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={saving || !complete}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          Cancel
        </button>
        {error && <p className="text-sm text-red-700">{error}</p>}
      </div>
    </form>
  );
}
