-- CreateEnum
CREATE TYPE "ScrapedStatus" AS ENUM ('NOT_SCRAPED', 'PENDING', 'DONE', 'FAILED');

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "scrapedAt" TIMESTAMP(3),
ADD COLUMN     "scrapedStatus" "ScrapedStatus" NOT NULL DEFAULT 'NOT_SCRAPED';
