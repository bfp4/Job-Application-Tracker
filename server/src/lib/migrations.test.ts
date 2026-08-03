import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards the DB-only constraints that `schema.prisma` can't express, and that
 * `prisma migrate dev` will therefore try to delete.
 *
 * Migrate diffs a shadow DB (built by replaying every migration) against
 * schema.prisma and writes SQL to reconcile the two. Anything created by a
 * hand-written migration but absent from the schema looks to it like drift, so
 * the next generated migration includes a DROP for it — silently, with no
 * error. These tests replay the migrations the same way and assert the
 * constraint is still standing at the end, so that DROP fails CI instead of
 * quietly removing a guarantee the application code depends on.
 */
const MIGRATIONS_DIR = resolve(process.cwd(), "prisma", "migrations");

/** Migration SQL in apply order (Prisma applies its directories lexicographically). */
function readMigrationsInOrder(): { name: string; sql: string }[] {
  expect(
    existsSync(MIGRATIONS_DIR),
    `Expected prisma/migrations at ${MIGRATIONS_DIR} — run this suite from the server package root.`
  ).toBe(true);

  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((name) => ({
      name,
      // Strip `--` comments so prose about an index (like the header in the
      // migration that creates this one) can't read as a statement.
      sql: readFileSync(join(MIGRATIONS_DIR, name, "migration.sql"), "utf8").replace(
        /--[^\n]*/g,
        ""
      ),
    }));
}

describe("PremiumRequest_userId_pending_unique", () => {
  const INDEX = "PremiumRequest_userId_pending_unique";

  it("still exists after the last migration is applied", () => {
    const created = new RegExp(`CREATE\\s+(UNIQUE\\s+)?INDEX[^;]*"${INDEX}"`, "i");
    const dropped = new RegExp(`DROP\\s+INDEX[^;]*"${INDEX}"`, "i");

    // Replay rather than just grepping for a DROP: a legitimate future
    // migration may drop and re-create the index in one file, and that's fine.
    // What matters is the state we end up in.
    let exists = false;
    let lastTouchedBy = "";
    for (const { name, sql } of readMigrationsInOrder()) {
      for (const statement of sql.split(";")) {
        if (created.test(statement)) {
          exists = true;
          lastTouchedBy = name;
        } else if (dropped.test(statement)) {
          exists = false;
          lastTouchedBy = name;
        }
      }
    }

    expect(
      exists,
      `Migration "${lastTouchedBy}" leaves ${INDEX} dropped. It is the only real guard ` +
        `against a user holding two PENDING premium requests (the findFirst check in ` +
        `routes/user.ts is racy by design and relies on the P2002 this index raises), and ` +
        `it can't live in schema.prisma because Prisma can't declare partial indexes. If ` +
        `"prisma migrate dev" generated that DROP as phantom drift, delete the line from ` +
        `the migration before applying it.`
    ).toBe(true);
  });

  it("is partial — scoped to PENDING rows only", () => {
    const creating = readMigrationsInOrder()
      .flatMap(({ sql }) => sql.split(";"))
      .filter((statement) => new RegExp(`CREATE[^;]*INDEX[^;]*"${INDEX}"`, "i").test(statement));

    expect(creating.length).toBeGreaterThan(0);
    for (const statement of creating) {
      // Without the WHERE clause this becomes a plain unique index on userId,
      // which would let the first request a user ever makes block every later
      // one — including after that request was approved or denied.
      expect(statement).toMatch(/WHERE\s+"status"\s*=\s*'PENDING'/i);
      expect(statement).toMatch(/UNIQUE/i);
    }
  });
});
