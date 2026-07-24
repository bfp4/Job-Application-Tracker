-- CreateTable
CREATE TABLE "TailoredResume" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "baseResumeId" TEXT NOT NULL,
    "jobPostingHash" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "edited" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TailoredResume_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TailoredResume_applicationId_key" ON "TailoredResume"("applicationId");

-- AddForeignKey
ALTER TABLE "TailoredResume" ADD CONSTRAINT "TailoredResume_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TailoredResume" ADD CONSTRAINT "TailoredResume_baseResumeId_fkey" FOREIGN KEY ("baseResumeId") REFERENCES "BaseResume"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
