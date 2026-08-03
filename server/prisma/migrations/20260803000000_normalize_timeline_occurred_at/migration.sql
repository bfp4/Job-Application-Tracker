-- occurredAt is a calendar date, stored as UTC midnight like every other date
-- column here (the client renders them all with timeZone: "UTC"). Two paths
-- had been writing a real instant into it instead: the column's now() default,
-- which the auto-log on a status change relied on, and this table's backfill,
-- which fell back to "updatedAt" when an application had no applied date.
--
-- Truncating changes no rendered date (formatDate already reads these in UTC)
-- but makes the stored values uniform, so ordering within a day no longer
-- depends on an invisible time-of-day that puts hand-added entries (midnight)
-- ahead of auto-logged ones from the same day. Idempotent: rows already at
-- midnight are untouched.
UPDATE "TimelineEntry"
SET "occurredAt" = date_trunc('day', "occurredAt")
WHERE "occurredAt" <> date_trunc('day', "occurredAt");
