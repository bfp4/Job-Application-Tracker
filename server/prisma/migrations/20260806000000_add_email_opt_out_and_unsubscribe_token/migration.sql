-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailOptOut" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
--
-- gen_random_uuid() is VOLATILE, so PostgreSQL cannot use the fast
-- store-one-default path for the existing rows: it rewrites the table and
-- evaluates the expression once per row. That is precisely what is wanted here
-- — every current user is backfilled with a *distinct* token. A non-volatile
-- default would hand every existing account the same one, and a single leaked
-- digest footer would then unsubscribe all of them.
ALTER TABLE "User" ADD COLUMN     "unsubscribeToken" TEXT NOT NULL DEFAULT (gen_random_uuid())::text;

-- CreateIndex
CREATE UNIQUE INDEX "User_unsubscribeToken_key" ON "User"("unsubscribeToken");
