-- Scope job postings to the user who entered them. Previously postings were
-- global rows keyed on jobUrl, so any user re-submitting a URL rewrote what
-- every other tracker of that URL saw.
--
-- Backfill strategy for existing rows:
--   1. Each posting is assigned to its earliest applicant.
--   2. Any other user tracking the same posting gets their own copy, and
--      their application is repointed at it.
--   3. Postings nobody tracks are deleted (nothing references them, and with
--      no owner they can't survive the NOT NULL constraint).

-- AlterTable (nullable first so existing rows can be backfilled)
ALTER TABLE "JobPosting" ADD COLUMN "userId" TEXT;

-- Assign each posting to its earliest applicant
UPDATE "JobPosting" p
SET "userId" = (
  SELECT a."userId"
  FROM "Application" a
  WHERE a."jobPostingId" = p."id"
  ORDER BY a."createdAt" ASC, a."id" ASC
  LIMIT 1
);

-- Give every additional tracking user their own copy of the posting and
-- repoint their application at it. (jobUrl was globally unique before, so
-- (userId, jobUrl) identifies each copy unambiguously.)
WITH created AS (
  INSERT INTO "JobPosting"
    ("id", "userId", "companyId", "title", "location", "salary", "jobUrl",
     "description", "matchScore", "matchReasons", "postedDate", "fetchedAt")
  SELECT
    gen_random_uuid()::text, a."userId", p."companyId", p."title", p."location",
    p."salary", p."jobUrl", p."description", p."matchScore", p."matchReasons",
    p."postedDate", p."fetchedAt"
  FROM "Application" a
  JOIN "JobPosting" p ON p."id" = a."jobPostingId"
  WHERE a."userId" <> p."userId"
  RETURNING "id", "userId", "jobUrl"
)
UPDATE "Application" a
SET "jobPostingId" = c."id"
FROM created c, "JobPosting" p
WHERE p."jobUrl" = c."jobUrl"
  AND a."jobPostingId" = p."id"
  AND a."userId" = c."userId";

-- Untracked postings have no owner to assign
DELETE FROM "JobPosting" WHERE "userId" IS NULL;

ALTER TABLE "JobPosting" ALTER COLUMN "userId" SET NOT NULL;

-- DropIndex
DROP INDEX "JobPosting_jobUrl_key";

-- CreateIndex
CREATE INDEX "JobPosting_userId_idx" ON "JobPosting"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "JobPosting_userId_jobUrl_key" ON "JobPosting"("userId", "jobUrl");

-- AddForeignKey
ALTER TABLE "JobPosting" ADD CONSTRAINT "JobPosting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
