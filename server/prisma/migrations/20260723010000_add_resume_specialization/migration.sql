-- CreateEnum
CREATE TYPE "ResumeSpecialization" AS ENUM ('GENERAL', 'SOFTWARE_ENGINEERING', 'FINANCE', 'CONSULTING', 'MARKETING', 'SALES', 'HEALTHCARE', 'DESIGN', 'DATA_ANALYTICS');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "resumeSpecialization" "ResumeSpecialization" NOT NULL DEFAULT 'GENERAL';
