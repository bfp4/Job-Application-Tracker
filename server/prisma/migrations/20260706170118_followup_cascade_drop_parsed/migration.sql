-- Follow-ups belong to their application: deleting an application previously
-- hit ON DELETE RESTRICT and 500'd whenever follow-ups existed.
ALTER TABLE "FollowUp" DROP CONSTRAINT "FollowUp_applicationId_fkey";
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- BaseResume.parsed was written as {} on every upload and never read —
-- vestigial from the removed resume-parsing feature.
ALTER TABLE "BaseResume" DROP COLUMN "parsed";
