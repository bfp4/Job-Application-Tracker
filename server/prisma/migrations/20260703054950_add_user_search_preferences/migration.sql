-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('REMOTE', 'HYBRID', 'IN_PERSON');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "jobTypes" "JobType"[] DEFAULT ARRAY[]::"JobType"[],
ADD COLUMN     "locationPreference" TEXT;
