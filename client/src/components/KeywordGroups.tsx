import type { ResumeKeywords } from "@/lib/types";

const GROUPS: Array<{ key: keyof ResumeKeywords; label: string }> = [
  { key: "technologies", label: "Technologies" },
  { key: "roles", label: "Roles" },
  { key: "domains", label: "Domains" },
];

/**
 * Renders extracted resume keywords grouped by category (Technologies, Roles,
 * Domains). The searchTerms array is intentionally not shown — it's used to
 * enrich queries, not displayed to the user.
 */
export default function KeywordGroups({
  keywords,
}: {
  keywords: ResumeKeywords;
}) {
  return (
    <dl className="space-y-1.5">
      {GROUPS.map(({ key, label }) => {
        const values = keywords[key] ?? [];
        if (values.length === 0) return null;
        return (
          <div key={key} className="flex gap-2 text-sm">
            <dt className="shrink-0 font-medium text-gray-900">{label}:</dt>
            <dd className="text-gray-600">{values.join(", ")}</dd>
          </div>
        );
      })}
    </dl>
  );
}
