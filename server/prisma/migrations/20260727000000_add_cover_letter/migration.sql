-- CreateTable
CREATE TABLE "CoverLetter" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "baseResumeId" TEXT NOT NULL,
    "jobPostingHash" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "edited" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoverLetter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CoverLetter_applicationId_key" ON "CoverLetter"("applicationId");

-- AddForeignKey
ALTER TABLE "CoverLetter" ADD CONSTRAINT "CoverLetter_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoverLetter" ADD CONSTRAINT "CoverLetter_baseResumeId_fkey" FOREIGN KEY ("baseResumeId") REFERENCES "BaseResume"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
