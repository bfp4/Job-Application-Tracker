import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";
import { createClient } from "./db.js";
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

describe("RDS_CA_BUNDLE", () => {
  it("holds the three us-east-2 root certificates", () => {
    expect(RDS_CA_BUNDLE.match(/-----BEGIN CERTIFICATE-----/g)).toHaveLength(3);
    expect(RDS_CA_BUNDLE.match(/-----END CERTIFICATE-----/g)).toHaveLength(3);
  });
});
