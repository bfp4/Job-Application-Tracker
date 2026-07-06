-- DropForeignKey
ALTER TABLE "SearchRun" DROP CONSTRAINT "SearchRun_baseResumeId_fkey";

-- DropForeignKey
ALTER TABLE "SearchRun" DROP CONSTRAINT "SearchRun_userId_fkey";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "jobTypes",
DROP COLUMN "locationPreference";

-- DropTable
DROP TABLE "SearchRun";

-- DropEnum
DROP TYPE "JobType";

