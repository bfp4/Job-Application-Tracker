-- CreateEnum
CREATE TYPE "UserTier" AS ENUM ('BASIC', 'PREMIUM', 'ADMIN');

-- CreateEnum
CREATE TYPE "PremiumRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'DENIED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "tier" "UserTier" NOT NULL DEFAULT 'BASIC',
    ADD COLUMN     "aiCallsUsedToday" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN     "aiCallsDate" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PremiumRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" "PremiumRequestStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "PremiumRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PremiumRequest_userId_idx" ON "PremiumRequest"("userId");

-- CreateIndex
CREATE INDEX "PremiumRequest_status_idx" ON "PremiumRequest"("status");

-- AddForeignKey
ALTER TABLE "PremiumRequest" ADD CONSTRAINT "PremiumRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: the app owner's account is the sole admin. Everyone else keeps
-- the column default (BASIC).
UPDATE "User" SET "tier" = 'ADMIN' WHERE "email" = 'generalarileverton@gmail.com';
