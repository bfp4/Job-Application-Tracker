-- CreateTable
CREATE TABLE "SearchResultsCache" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "postedWithin" TEXT,
    "experienceLevel" TEXT NOT NULL DEFAULT '',
    "keywordsUsed" BOOLEAN NOT NULL,
    "page" INTEGER NOT NULL,
    "pageSize" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "cachedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SearchResultsCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SearchResultsCache_expiresAt_idx" ON "SearchResultsCache"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "SearchResultsCache_userId_query_location_postedWithin_exper_key" ON "SearchResultsCache"("userId", "query", "location", "postedWithin", "experienceLevel", "keywordsUsed", "page", "pageSize");

-- AddForeignKey
ALTER TABLE "SearchResultsCache" ADD CONSTRAINT "SearchResultsCache_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
