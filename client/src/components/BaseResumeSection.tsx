"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import KeywordGroups from "@/components/KeywordGroups";
import type {
  BaseResume,
  ResumeStructure,
  ResumeExperience,
  ResumeEducation,
  ResumeProject,
  ResumeLeadership,
  ResumeSkills,
  ResumeKeywords,
} from "@/lib/types";

const PDF_CONTENT_TYPE = "application/pdf";
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

export default function BaseResumeSection() {
  const { user, loading: authLoading } = useAuth();

  const [baseResume, setBaseResume] = useState<BaseResume | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const [keywords, setKeywords] = useState<ResumeKeywords | null>(null);
  const [extractingKeywords, setExtractingKeywords] = useState(false);

  const loadKeywords = useCallback(async () => {
    try {
      const res = await apiFetch("/api/user/keywords");
      if (!res.ok) return;
      const data = (await res.json()) as { keywords: ResumeKeywords | null };
      setKeywords(data.keywords);
    } catch {
      // Non-fatal: keyword display is best-effort.
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/api/resumes/base");
      if (!res.ok) throw new Error("Failed to load your resume.");
      const data = (await res.json()) as {
        baseResume: BaseResume | null;
        downloadUrl: string | null;
      };
      setBaseResume(data.baseResume);
      setDownloadUrl(data.downloadUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authLoading && user) {
      load();
      loadKeywords();
    }
  }, [authLoading, user, load, loadKeywords]);

  /**
   * Keyword extraction runs in the background server-side after upload, so poll
   * for it briefly (every 2s, up to 10s) and show the results once they land.
   */
  const pollForKeywords = useCallback(async () => {
    setExtractingKeywords(true);
    try {
      for (let attempt = 0; attempt < 5; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        try {
          const res = await apiFetch("/api/user/keywords");
          if (res.ok) {
            const data = (await res.json()) as {
              keywords: ResumeKeywords | null;
            };
            if (data.keywords && data.keywords.technologies.length > 0) {
              setKeywords(data.keywords);
              break;
            }
          }
        } catch {
          // Ignore and retry on the next tick.
        }
      }
    } finally {
      setExtractingKeywords(false);
    }
  }, []);

  async function handleFile(file: File) {
    setError(null);

    if (file.type !== PDF_CONTENT_TYPE) {
      setError("Your resume must be a PDF file.");
      return;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setError("Your resume PDF must be 10MB or smaller.");
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await apiFetch("/api/resumes/base", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Failed to upload resume.");
      }
      await load();
      setReplacing(false);
      // Fresh upload re-extracts keywords; clear stale ones and poll for new.
      setKeywords(null);
      void pollForKeywords();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload resume.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <section>
      <h2 className="text-lg font-semibold text-gray-900">Base resume</h2>
      <p className="mt-1 max-w-2xl text-sm text-gray-500">
        Upload your resume once. We extract and structure it with AI so you can
        generate job-specific tailored versions from any application.
      </p>

      {error && (
        <div className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading && (
        <p className="mt-4 text-sm text-gray-500">Loading your resume…</p>
      )}

      {!loading && (!baseResume || replacing) && (
        <div className="mt-4">
          <UploadDropzone
            uploading={uploading}
            onFile={handleFile}
            onCancel={
              baseResume && !uploading ? () => setReplacing(false) : undefined
            }
          />
        </div>
      )}

      {!loading && baseResume && !replacing && (
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <div>
              <p className="text-sm font-semibold text-gray-900">
                Parsed resume
              </p>
              <p className="mt-0.5 text-sm text-gray-500">
                Review the structured version we tailor for each role.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowPreview((v) => !v)}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                {showPreview ? "Hide preview" : "Show preview"}
              </button>
              {downloadUrl && (
                <a
                  href={downloadUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  View original PDF
                </a>
              )}
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setReplacing(true);
                }}
                className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
              >
                Update resume
              </button>
            </div>
          </div>

          <KeywordsCard
            extracting={extractingKeywords}
            keywords={keywords}
          />

          {showPreview && <ResumePreview resume={baseResume.content} />}
        </div>
      )}
    </section>
  );
}

/**
 * Shows the search keywords extracted from the resume. While extraction is in
 * flight (right after an upload) it shows a loading indicator instead.
 */
function KeywordsCard({
  extracting,
  keywords,
}: {
  extracting: boolean;
  keywords: ResumeKeywords | null;
}) {
  if (extracting && !keywords) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <p className="text-sm font-semibold text-gray-900">
          ✨ Search keywords
        </p>
        <p className="mt-1 text-sm text-gray-500">
          Extracting search keywords from your resume…
        </p>
      </div>
    );
  }

  if (!keywords || keywords.technologies.length === 0) return null;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-semibold text-gray-900">✨ Search keywords</p>
      <p className="mt-0.5 text-sm text-gray-500">
        We use these to enhance your job searches when Smart Search is on.
      </p>
      <div className="mt-3">
        <KeywordGroups keywords={keywords} />
      </div>
      <p className="mt-2 text-xs text-gray-400">
        These were extracted from your resume. Re-upload your resume to update
        them.
      </p>
    </div>
  );
}

function UploadDropzone({
  uploading,
  onFile,
  onCancel,
}: {
  uploading: boolean;
  onFile: (file: File) => void;
  onCancel?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function handleSelect(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) onFile(file);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    if (uploading) return;
    const file = e.dataTransfer.files?.[0];
    if (file) onFile(file);
  }

  if (uploading) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 bg-white p-10 text-center">
        <p className="text-sm font-medium text-gray-900">
          Extracting and parsing your resume with AI…
        </p>
        <p className="mt-1 text-sm text-gray-500">
          This usually takes a few seconds.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-10 text-center transition-colors ${
          dragging
            ? "border-gray-900 bg-gray-50"
            : "border-gray-300 bg-white hover:border-gray-400"
        }`}
      >
        <p className="text-sm font-medium text-gray-900">
          Drag &amp; drop your resume PDF here
        </p>
        <p className="mt-1 text-sm text-gray-500">
          or click to browse · PDF only · max 10MB
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          onChange={handleSelect}
          className="hidden"
        />
      </div>
      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="text-sm font-medium text-gray-500 hover:text-gray-900"
        >
          Cancel
        </button>
      )}
    </div>
  );
}

function ResumePreview({ resume }: { resume: ResumeStructure }) {
  const { personalInfo } = resume;
  const contactParts = [
    personalInfo?.location,
    personalInfo?.phone,
    personalInfo?.email,
    personalInfo?.linkedin,
    personalInfo?.github,
  ].filter((part): part is string => Boolean(part && part.trim()));

  return (
    <div className="space-y-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <header>
        <h3 className="text-lg font-semibold text-gray-900">
          {personalInfo?.name || "Unnamed"}
        </h3>
        {contactParts.length > 0 && (
          <p className="mt-1 text-sm text-gray-500">
            {contactParts.join("  ·  ")}
          </p>
        )}
      </header>

      {resume.summary && resume.summary.trim() && (
        <PreviewSection title="Summary">
          <p className="text-sm text-gray-700">{resume.summary}</p>
        </PreviewSection>
      )}

      {resume.experience?.length > 0 && (
        <PreviewSection title="Experience">
          <div className="space-y-4">
            {resume.experience.map((exp, i) => (
              <ExperienceItem key={i} exp={exp} />
            ))}
          </div>
        </PreviewSection>
      )}

      {resume.projects?.length > 0 && (
        <PreviewSection title="Projects">
          <div className="space-y-4">
            {resume.projects.map((project, i) => (
              <ProjectItem key={i} project={project} />
            ))}
          </div>
        </PreviewSection>
      )}

      {hasSkills(resume.skills) && (
        <PreviewSection title="Skills">
          <SkillsList skills={resume.skills} />
        </PreviewSection>
      )}

      {resume.education?.length > 0 && (
        <PreviewSection title="Education">
          <div className="space-y-3">
            {resume.education.map((edu, i) => (
              <EducationItem key={i} edu={edu} />
            ))}
          </div>
        </PreviewSection>
      )}

      {resume.leadership?.length > 0 && (
        <PreviewSection title="Leadership">
          <div className="space-y-4">
            {resume.leadership.map((lead, i) => (
              <LeadershipItem key={i} lead={lead} />
            ))}
          </div>
        </PreviewSection>
      )}
    </div>
  );
}

function PreviewSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h4 className="border-b border-gray-200 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
        {title}
      </h4>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function dateRange(start: string, end: string | null): string {
  const startClean = (start ?? "").trim();
  const endClean = (end ?? "").trim() || "Present";
  if (!startClean && !end) return "";
  if (!startClean) return endClean;
  return `${startClean} – ${endClean}`;
}

function Bullets({ bullets }: { bullets: string[] }) {
  if (!bullets?.length) return null;
  return (
    <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm text-gray-700">
      {bullets.map((bullet, i) => (
        <li key={i}>{bullet}</li>
      ))}
    </ul>
  );
}

function ExperienceItem({ exp }: { exp: ResumeExperience }) {
  const subtitle = [exp.title, exp.location].filter(Boolean).join(" · ");
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-semibold text-gray-900">{exp.company}</p>
        <p className="shrink-0 text-xs text-gray-500">
          {dateRange(exp.startDate, exp.endDate)}
        </p>
      </div>
      {subtitle && <p className="text-sm italic text-gray-600">{subtitle}</p>}
      <Bullets bullets={exp.bullets} />
    </div>
  );
}

function ProjectItem({ project }: { project: ResumeProject }) {
  return (
    <div>
      <p className="text-sm font-semibold text-gray-900">
        {project.name}
        {project.technologies?.length > 0 && (
          <span className="font-normal text-gray-500">
            {" — "}
            {project.technologies.join(", ")}
          </span>
        )}
      </p>
      <Bullets bullets={project.bullets} />
    </div>
  );
}

function EducationItem({ edu }: { edu: ResumeEducation }) {
  const detail = [edu.degree, edu.field].filter(Boolean).join(", ");
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-semibold text-gray-900">{edu.institution}</p>
        <p className="shrink-0 text-xs text-gray-500">{edu.graduationDate}</p>
      </div>
      {detail && <p className="text-sm text-gray-600">{detail}</p>}
    </div>
  );
}

function LeadershipItem({ lead }: { lead: ResumeLeadership }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-semibold text-gray-900">
          {lead.organization}
        </p>
        <p className="shrink-0 text-xs text-gray-500">
          {dateRange(lead.startDate, lead.endDate)}
        </p>
      </div>
      {lead.role && <p className="text-sm italic text-gray-600">{lead.role}</p>}
      <Bullets bullets={lead.bullets} />
    </div>
  );
}

const SKILL_CATEGORIES: Array<{ key: keyof ResumeSkills; label: string }> = [
  { key: "languages", label: "Languages" },
  { key: "frontend", label: "Frontend" },
  { key: "backend", label: "Backend" },
  { key: "databases", label: "Databases" },
  { key: "tools", label: "Tools" },
];

function hasSkills(skills: ResumeSkills | undefined): boolean {
  if (!skills) return false;
  return SKILL_CATEGORIES.some(({ key }) => (skills[key] ?? []).length > 0);
}

function SkillsList({ skills }: { skills: ResumeSkills }) {
  return (
    <dl className="space-y-1.5">
      {SKILL_CATEGORIES.map(({ key, label }) => {
        const values = skills[key] ?? [];
        if (values.length === 0) return null;
        return (
          <div key={key} className="flex gap-2 text-sm">
            <dt className="shrink-0 font-medium text-gray-900">{label}:</dt>
            <dd className="text-gray-700">{values.join(", ")}</dd>
          </div>
        );
      })}
    </dl>
  );
}
