import { describe, expect, it } from "vitest";
import { RESUME_TIPS_FOCUS_LABELS, focusSections } from "./resumeTipsFocus";
import type { ResumeTipsContent } from "./types";

/**
 * A stored analysis carries only the two focus keys belonging to the career
 * specialization it was generated for, and nothing records which one that was
 * — so the renderer has to key off what's present. These tests pin that.
 */
const core: ResumeTipsContent = {
  summary: "Solid fit.",
  missingFromResume: [],
  bulletPointSuggestions: [],
  strengthsToHighlight: [],
  additionalTips: [],
};

describe("resume tips focus sections", () => {
  it("gives every focus key a label", () => {
    for (const label of Object.values(RESUME_TIPS_FOCUS_LABELS)) {
      expect(label.trim()).not.toBe("");
    }
  });

  it("renders the sections a software-engineering analysis carries", () => {
    const sections = focusSections({
      ...core,
      technologiesToStudy: [{ name: "Kubernetes", reason: "Named in the posting." }],
      systemsToShowcase: [{ name: "Billing pipeline", reason: "Add its scale." }],
    });

    expect(sections.map((s) => s.key)).toEqual([
      "technologiesToStudy",
      "systemsToShowcase",
    ]);
    expect(sections[0].title).toBe("Technologies to study");
  });

  it("renders a different field's sections without any engineering wording", () => {
    const sections = focusSections({
      ...core,
      certificationsToPursue: [{ name: "ACLS", reason: "Required by the posting." }],
      clinicalDetailsToAdd: [{ name: "Patient ratios", reason: "Recruiters screen on it." }],
    });

    expect(sections.map((s) => s.title)).toEqual([
      "Licenses and certifications to pursue",
      "Clinical details to add",
    ]);
  });

  it("skips empty and absent sections", () => {
    expect(focusSections({ ...core, technologiesToStudy: [] })).toEqual([]);
    expect(focusSections(core)).toEqual([]);
  });
});
