-- Dedupes the reminder Lambda's "not applied yet" nudge within a day, the same
-- way FollowUp.reminderSentAt dedupes follow-up reminders. Without it a retried
-- invocation re-sent the nudge section to every user.
-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "nudgeSentAt" TIMESTAMP(3);

-- The Lambda filters NOT_APPLIED applications on (status, nudgeSentAt); the
-- existing status-only index no longer covers the added predicate.
-- CreateIndex
CREATE INDEX "Application_status_nudgeSentAt_idx" ON "Application"("status", "nudgeSentAt");

-- DropIndex
DROP INDEX "Application_status_idx";

-- Drop columns left behind by the removed job-search agent (migration
-- 20260703065148_remove_job_search_agent). Nothing reads or writes them.
-- AlterTable
ALTER TABLE "JobPosting" DROP COLUMN "matchScore",
DROP COLUMN "matchReasons";

-- AlterTable
ALTER TABLE "Company" DROP COLUMN "website";
