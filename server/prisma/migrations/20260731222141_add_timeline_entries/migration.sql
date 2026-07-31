-- CreateTable
CREATE TABLE "TimelineEntry" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "status" "ApplicationStatus" NOT NULL,
    "note" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimelineEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TimelineEntry_applicationId_idx" ON "TimelineEntry"("applicationId");

-- AddForeignKey
ALTER TABLE "TimelineEntry" ADD CONSTRAINT "TimelineEntry_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: one entry per existing application that isn't still NOT_APPLIED,
-- so its history doesn't start out empty. occurredAt uses the applied date
-- when known, falling back to the row's last-updated timestamp.
INSERT INTO "TimelineEntry" ("id", "applicationId", "status", "occurredAt", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, "id", "status", COALESCE("appliedDate", "updatedAt"), "updatedAt", "updatedAt"
FROM "Application"
WHERE "status" != 'NOT_APPLIED';
