/*
  Warnings:

  - Made the column `postedWithin` on table `SearchResultsCache` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "SearchResultsCache" ALTER COLUMN "postedWithin" SET NOT NULL,
ALTER COLUMN "postedWithin" SET DEFAULT '';
