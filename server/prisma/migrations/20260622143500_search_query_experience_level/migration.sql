-- DropIndex
DROP INDEX "SearchQuery_userId_query_location_key";

-- AlterTable
ALTER TABLE "SearchQuery" ADD COLUMN     "experienceLevel" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "SearchQuery_userId_query_location_experienceLevel_key" ON "SearchQuery"("userId", "query", "location", "experienceLevel");
