-- CreateEnum
CREATE TYPE "LinkedinStatus" AS ENUM ('NONE', 'CONNECTION_SENT', 'CONNECTED', 'MESSAGING');

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "linkedinStatus" "LinkedinStatus" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "connectMessage" TEXT;
