-- AlterTable
ALTER TABLE "User" ADD COLUMN     "keywordsEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "resumeKeywords" JSONB;
