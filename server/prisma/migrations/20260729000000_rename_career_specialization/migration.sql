-- The setting now drives every AI feature (tailored resume, cover letter,
-- resume tips, LinkedIn notes, application answers), not just the resume, so
-- it is renamed "Career Specialization". Renames preserve the column's values,
-- NOT NULL constraint, and DEFAULT 'GENERAL'.

-- AlterEnum
ALTER TYPE "ResumeSpecialization" RENAME TO "CareerSpecialization";

-- AlterTable
ALTER TABLE "User" RENAME COLUMN "resumeSpecialization" TO "careerSpecialization";
