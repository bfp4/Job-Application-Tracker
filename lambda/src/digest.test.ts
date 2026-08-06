import { describe, expect, it } from "vitest";
import {
  buildDigests,
  formatDigestEmail,
  type DueFollowUpRow,
  type MailingConfig,
  type NotAppliedRow,
} from "./digest.js";

const UNSUB_URL = "https://api.example.com/unsubscribe?u=tok_ari";

const CONFIG: MailingConfig = {
  unsubscribeBaseUrl: "https://api.example.com/unsubscribe",
  mailingAddress: "JobTracker, 1 Example St, Springfield, IL 62704",
};

function followUp(overrides: Partial<DueFollowUpRow> = {}): DueFollowUpRow {
  return {
    id: "fu_1",
    followUpDate: new Date("2026-07-07T00:00:00Z"),
    note: null,
    userEmail: "ari@example.com",
    unsubscribeToken: "tok_ari",
    jobTitle: "Senior Engineer",
    companyName: "Acme",
    ...overrides,
  };
}

function notApplied(overrides: Partial<NotAppliedRow> = {}): NotAppliedRow {
  return {
    applicationId: "app_1",
    createdAt: new Date("2026-06-30T00:00:00Z"),
    userEmail: "ari@example.com",
    unsubscribeToken: "tok_ari",
    jobTitle: "Platform Engineer",
    companyName: "Globex",
    ...overrides,
  };
}

describe("buildDigests", () => {
  it("returns no digests for empty input", () => {
    expect(buildDigests([], [], CONFIG)).toEqual([]);
  });

  it("groups multiple follow-ups for the same user into one digest", () => {
    const digests = buildDigests(
      [followUp({ id: "fu_1" }), followUp({ id: "fu_2", jobTitle: "Staff Engineer" })],
      [],
      CONFIG
    );
    expect(digests).toHaveLength(1);
    expect(digests[0].toAddress).toBe("ari@example.com");
    expect(digests[0].followUpIds).toEqual(["fu_1", "fu_2"]);
    expect(digests[0].body).toContain("Senior Engineer at Acme");
    expect(digests[0].body).toContain("Staff Engineer at Acme");
  });

  it("builds separate digests per user", () => {
    const digests = buildDigests(
      [followUp(), followUp({ id: "fu_2", userEmail: "other@example.com" })],
      [notApplied({ userEmail: "third@example.com" })],
      CONFIG
    );
    expect(digests.map((d) => d.toAddress).sort()).toEqual([
      "ari@example.com",
      "other@example.com",
      "third@example.com",
    ]);
  });

  it("builds a follow-ups-only digest", () => {
    const [digest] = buildDigests([followUp()], [], CONFIG);
    expect(digest.subject).toBe("Job tracker: 1 follow-up due");
    expect(digest.body).toContain("FOLLOW-UPS DUE");
    expect(digest.body).not.toContain("NOT APPLIED YET");
  });

  it("builds a not-applied-only digest with no follow-up ids to mark", () => {
    const [digest] = buildDigests([], [notApplied()], CONFIG);
    expect(digest.subject).toBe("Job tracker: 1 application to submit");
    expect(digest.body).toContain("NOT APPLIED YET");
    expect(digest.body).not.toContain("FOLLOW-UPS DUE");
    expect(digest.followUpIds).toEqual([]);
    expect(digest.applicationIds).toEqual(["app_1"]);
  });

  // The ids the handler stamps after a successful send are what stops a
  // retried invocation from re-sending the same digest.
  it("carries the application ids to stamp, per user", () => {
    const digests = buildDigests(
      [],
      [
        notApplied({ applicationId: "app_1" }),
        notApplied({ applicationId: "app_2" }),
        notApplied({ applicationId: "app_3", userEmail: "other@example.com" }),
      ],
      CONFIG
    );
    const byAddress = new Map(digests.map((d) => [d.toAddress, d]));
    expect(byAddress.get("ari@example.com")?.applicationIds).toEqual(["app_1", "app_2"]);
    expect(byAddress.get("other@example.com")?.applicationIds).toEqual(["app_3"]);
  });

  it("leaves applicationIds empty for a follow-ups-only digest", () => {
    const [digest] = buildDigests([followUp()], [], CONFIG);
    expect(digest.applicationIds).toEqual([]);
  });

  it("combines both sections and pluralizes the subject", () => {
    const [digest] = buildDigests(
      [followUp({ id: "fu_1" }), followUp({ id: "fu_2" })],
      [notApplied()],
      CONFIG
    );
    expect(digest.subject).toBe(
      "Job tracker: 2 follow-ups due, 1 application to submit"
    );
    expect(digest.body).toContain("FOLLOW-UPS DUE");
    expect(digest.body).toContain("NOT APPLIED YET");
  });
});

describe("formatDigestEmail", () => {
  it("renders follow-up lines with due date and note", () => {
    const body = formatDigestEmail(
      [followUp({ note: "ping the recruiter" })],
      [],
      CONFIG,
      UNSUB_URL
    );
    expect(body).toContain(
      "- Senior Engineer at Acme (due Jul 7, 2026) — ping the recruiter"
    );
  });

  it("omits the note suffix when there is no note", () => {
    const body = formatDigestEmail([followUp({ note: null })], [], CONFIG, UNSUB_URL);
    expect(body).toContain("- Senior Engineer at Acme (due Jul 7, 2026)");
    expect(body).not.toContain("—  ");
    expect(body.split("\n")[1]).toBe(
      "- Senior Engineer at Acme (due Jul 7, 2026)"
    );
  });

  it("falls back to 'Unknown company' when the posting has no company", () => {
    const body = formatDigestEmail([], [notApplied({ companyName: null })], CONFIG, UNSUB_URL);
    expect(body).toContain("- Platform Engineer at Unknown company (saved Jun 30, 2026)");
  });

  it("renders not-applied lines with the saved date", () => {
    const body = formatDigestEmail([], [notApplied()], CONFIG, UNSUB_URL);
    expect(body).toContain("- Platform Engineer at Globex (saved Jun 30, 2026)");
  });
});

// CAN-SPAM (15 U.S.C. §7704(a)(3)-(5)) makes the footer non-negotiable: every
// commercial message needs a working opt-out and the sender's physical postal
// address. These assert the *only* renderer can't produce a message without
// them, which is the property that keeps a future edit from quietly dropping
// one.
describe("CAN-SPAM footer", () => {
  it("puts the unsubscribe URL and mailing address in a follow-ups-only digest", () => {
    const body = formatDigestEmail([followUp()], [], CONFIG, UNSUB_URL);
    expect(body).toContain(UNSUB_URL);
    expect(body).toContain(CONFIG.mailingAddress);
  });

  it("puts them in a not-applied-only digest too", () => {
    const body = formatDigestEmail([], [notApplied()], CONFIG, UNSUB_URL);
    expect(body).toContain(UNSUB_URL);
    expect(body).toContain(CONFIG.mailingAddress);
  });

  it("explains why the recipient is getting the email", () => {
    const body = formatDigestEmail([followUp()], [], CONFIG, UNSUB_URL);
    expect(body).toContain("You're receiving this because");
  });

  it("gives each user their own unsubscribe token, never another's", () => {
    const digests = buildDigests(
      [
        followUp({ userEmail: "ari@example.com", unsubscribeToken: "tok_ari" }),
        followUp({
          id: "fu_2",
          userEmail: "other@example.com",
          unsubscribeToken: "tok_other",
        }),
      ],
      [],
      CONFIG
    );
    const byAddress = new Map(digests.map((d) => [d.toAddress, d]));

    const ari = byAddress.get("ari@example.com")!;
    const other = byAddress.get("other@example.com")!;

    expect(ari.unsubscribeUrl).toBe(
      "https://api.example.com/unsubscribe?u=tok_ari"
    );
    expect(ari.body).toContain("u=tok_ari");
    expect(ari.body).not.toContain("tok_other");

    expect(other.unsubscribeUrl).toBe(
      "https://api.example.com/unsubscribe?u=tok_other"
    );
    expect(other.body).not.toContain("tok_ari");
  });

  // The header the handler sends is built from digest.unsubscribeUrl, so the
  // link in the body and the one a mail client's own Unsubscribe button hits
  // are the same URL by construction.
  it("exposes the same URL on the digest as it renders in the body", () => {
    const [digest] = buildDigests([followUp()], [notApplied()], CONFIG);
    expect(digest.body).toContain(digest.unsubscribeUrl);
  });

  it("percent-encodes a token that would otherwise break the query string", () => {
    const [digest] = buildDigests(
      [followUp({ unsubscribeToken: "a b&c=d" })],
      [],
      CONFIG
    );
    expect(digest.unsubscribeUrl).toBe(
      "https://api.example.com/unsubscribe?u=a%20b%26c%3Dd"
    );
  });
});
