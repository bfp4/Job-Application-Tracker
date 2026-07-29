import { describe, expect, it } from "vitest";
import { lookupBrandIcon, normalizeCompany } from "./companyIcons";

/**
 * Regression guard for a bug that shipped invisibly.
 *
 * `NOISE` is a const read by `normalizeCompany`, which the module's own
 * registration loop calls at evaluation time. Declared *after* that loop it
 * sat in the temporal dead zone, so importing the module threw — and because
 * `CompanyLogo` pulls it in dynamically and only swaps the icon in on success,
 * the failure surfaced as every company silently rendering a monogram. Nothing
 * else caught it: the build never evaluates a lazily-imported module, and no
 * test imported it.
 *
 * So the important assertion here is the cheapest one — that importing this
 * module and calling into it does not throw.
 */
describe("company icon registry", () => {
  it("evaluates and answers lookups without throwing", () => {
    expect(() => lookupBrandIcon("Stripe")).not.toThrow();
    expect(() => normalizeCompany("Stripe")).not.toThrow();
  });

  it("resolves brands that are in simple-icons", () => {
    for (const name of ["Datadog", "Stripe", "Coinbase", "Dropbox", "Linear", "Figma"]) {
      const icon = lookupBrandIcon(name);
      expect(icon, name).not.toBeNull();
      // A tile needs both to render: the glyph and its brand colour.
      expect(icon!.path.length, name).toBeGreaterThan(0);
      expect(icon!.hex, name).toMatch(/^[0-9A-Fa-f]{6}$/);
    }
  });

  it("returns null rather than throwing for brands simple-icons doesn't carry", () => {
    // Removed on trademark request — these must degrade to a monogram.
    for (const name of ["Plaid", "Amazon", "Microsoft", "Deloitte", ""]) {
      expect(lookupBrandIcon(name), name).toBeNull();
    }
  });

  it("folds case, punctuation and legal suffixes to one key", () => {
    const canonical = normalizeCompany("Stripe");
    for (const variant of ["stripe", "STRIPE", "Stripe, Inc.", "  Stripe Inc  "]) {
      expect(normalizeCompany(variant), variant).toBe(canonical);
    }
  });

  it("maps aliases normalization alone can't reach", () => {
    expect(lookupBrandIcon("Alphabet")?.title).toBe("Google");
    expect(lookupBrandIcon("Twitter")?.title).toBe("X");
    expect(lookupBrandIcon("Block")?.title).toBe("Square");
    expect(lookupBrandIcon("New Relic")?.title).toBe("New Relic");
  });
});
