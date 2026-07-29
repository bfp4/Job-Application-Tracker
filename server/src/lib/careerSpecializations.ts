import type { CareerSpecialization } from "@prisma/client";

/**
 * The single source of truth for the "Career Specialization" setting: the enum
 * values, the labels the Settings dropdown shows, and the fallback used when a
 * user has no (or an unrecognized) specialization.
 *
 * KEEP IN SYNC with the CareerSpecialization enum in schema.prisma and the
 * mirror type in client/src/lib/types.ts.
 *
 * Every AI feature that varies by field (tailored resume, cover letter, resume
 * tips, LinkedIn notes, application answers) keeps its own guidance map keyed
 * by these values in a sibling `*Specializations.ts` module, and takes the
 * label from here so the wording can never drift between features.
 */
export const CAREER_SPECIALIZATION_LABELS: Record<CareerSpecialization, string> = {
  GENERAL: "General",
  SOFTWARE_ENGINEERING: "Software Engineering",
  FINANCE: "Finance & Banking",
  CONSULTING: "Consulting",
  MARKETING: "Marketing",
  SALES: "Sales",
  HEALTHCARE: "Healthcare & Nursing",
  DESIGN: "Design & Creative",
  DATA_ANALYTICS: "Data & Analytics",
};

/** The fallback for users who never picked a field. */
export const DEFAULT_CAREER_SPECIALIZATION: CareerSpecialization = "GENERAL";

/** All specialization values (for enum validation on the settings route). */
export const CAREER_SPECIALIZATION_VALUES = Object.keys(
  CAREER_SPECIALIZATION_LABELS
) as CareerSpecialization[];

export function isCareerSpecialization(
  value: unknown
): value is CareerSpecialization {
  return (
    typeof value === "string" &&
    (CAREER_SPECIALIZATION_VALUES as readonly string[]).includes(value)
  );
}

/**
 * Normalizes whatever the caller has — null, undefined, or a value from an
 * older client — to a specialization the guidance maps definitely have a key
 * for. Every per-feature lookup goes through this, so "no specialization set"
 * degrades to the General guidance instead of an undefined prompt fragment.
 */
export function resolveCareerSpecialization(
  value: CareerSpecialization | null | undefined
): CareerSpecialization {
  return value && isCareerSpecialization(value)
    ? value
    : DEFAULT_CAREER_SPECIALIZATION;
}

/** The Settings-dropdown label for a specialization. */
export function careerSpecializationLabel(
  value: CareerSpecialization | null | undefined
): string {
  return CAREER_SPECIALIZATION_LABELS[resolveCareerSpecialization(value)];
}
