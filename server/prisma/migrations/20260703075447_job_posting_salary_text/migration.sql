-- AlterTable
ALTER TABLE "JobPosting" DROP COLUMN "salaryMax",
DROP COLUMN "salaryMin",
ADD COLUMN     "salary" TEXT;

