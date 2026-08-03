-- Enforces "at most one PENDING request per user" at the database level.
-- A plain (userId, status) unique constraint won't work here — it would also
-- block a user from ever submitting a second request after an earlier one
-- was resolved (APPROVED/DENIED). A partial unique index (only over PENDING
-- rows) is the correct shape, but Prisma's schema DSL can't declare a
-- filtered/partial index, so this exists only here, not in schema.prisma.
CREATE UNIQUE INDEX "PremiumRequest_userId_pending_unique"
  ON "PremiumRequest" ("userId")
  WHERE "status" = 'PENDING';
