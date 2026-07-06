-- AlterTable
ALTER TABLE "JobPosting" DROP COLUMN "salary",
ADD COLUMN     "salaryMax" INTEGER,
ADD COLUMN     "salaryMin" INTEGER;

