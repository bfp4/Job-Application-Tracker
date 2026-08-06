import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";
import {
  createClient,
  fetchDueFollowUps,
  fetchNotAppliedApplications,
} from "./db.js";
import { RDS_CA_BUNDLE } from "./rdsCaBundle.js";

const ENDPOINT = "postgresql://app:secret@db.abc123.us-east-2.rds.amazonaws.com:5432/jobtracker";

/**
 * The TLS options pg actually ends up with, not the ones we passed in — the
 * connection string is merged over the client config, so only the resolved
 * value proves verification survived.
 */
function resolvedSsl(client: pg.Client): Record<string, unknown> {
  const { connectionParameters } = client as unknown as {
    connectionParameters: { ssl: Record<string, unknown> };
  };
  return connectionParameters.ssl;
}

describe("createClient", () => {
  const original = process.env.DATABASE_URL;

  beforeEach(() => {
    process.env.DATABASE_URL = ENDPOINT;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = original;
  });

  it("throws when DATABASE_URL is not set", () => {
    delete process.env.DATABASE_URL;
    expect(() => createClient()).toThrow("DATABASE_URL is not set");
  });

  it("verifies the database certificate against the bundled RDS roots", () => {
    const ssl = resolvedSsl(createClient());
    expect(ssl.ca).toBe(RDS_CA_BUNDLE);
    expect(ssl.rejectUnauthorized).toBe(true);
  });

  it.each(["sslmode=require", "sslmode=no-verify", "sslrootcert=/tmp/ca.pem", "ssl=true"])(
    "refuses to connect when DATABASE_URL carries %s",
    (param) => {
      process.env.DATABASE_URL = `${ENDPOINT}?${param}`;
      expect(() => createClient()).toThrow(/would discard the bundled\s+RDS CA/);
    }
  );

  it("still pins the session timezone to UTC", () => {
    const { connectionParameters } = createClient() as unknown as {
      connectionParameters: { options: string };
    };
    expect(connectionParameters.options).toBe("-c TimeZone=UTC");
  });
});

/**
 * Captures the SQL a fetch function issues, without a database.
 *
 * These assert on query *text*, which is normally a brittle thing to test. It
 * earns its place here because the opt-out predicate is the whole of this
 * project's CAN-SPAM compliance and it lives nowhere else: the handler happily
 * emails whatever rows come back, so if the WHERE clause is ever dropped or
 * refactored away, nothing else in the codebase notices and the first symptom
 * is mail to people who unsubscribed.
 */
function recordingClient(): { client: pg.Client; sql: () => string } {
  let captured = "";
  const client = {
    query(text: string) {
      captured = text;
      return Promise.resolve({ rows: [] });
    },
  } as unknown as pg.Client;
  return { client, sql: () => captured };
}

describe("digest queries honor the email opt-out", () => {
  it("excludes unsubscribed users from the follow-up query", async () => {
    const { client, sql } = recordingClient();
    await fetchDueFollowUps(client);
    expect(sql()).toContain('u."emailOptOut" = false');
  });

  it("excludes unsubscribed users from the not-applied query", async () => {
    const { client, sql } = recordingClient();
    await fetchNotAppliedApplications(client);
    expect(sql()).toContain('u."emailOptOut" = false');
  });

  it("selects the unsubscribe token both digests need for their footer", async () => {
    const followUps = recordingClient();
    await fetchDueFollowUps(followUps.client);
    expect(followUps.sql()).toContain('u."unsubscribeToken"');

    const notApplied = recordingClient();
    await fetchNotAppliedApplications(notApplied.client);
    expect(notApplied.sql()).toContain('u."unsubscribeToken"');
  });
});

describe("RDS_CA_BUNDLE", () => {
  it("holds the three us-east-2 root certificates", () => {
    expect(RDS_CA_BUNDLE.match(/-----BEGIN CERTIFICATE-----/g)).toHaveLength(3);
    expect(RDS_CA_BUNDLE.match(/-----END CERTIFICATE-----/g)).toHaveLength(3);
  });
});
