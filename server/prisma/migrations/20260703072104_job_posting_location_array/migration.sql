-- Convert location from a single string to an array, preserving existing
-- values as single-element arrays rather than dropping the column.
ALTER TABLE "JobPosting"
  ALTER COLUMN "location" DROP DEFAULT,
  ALTER COLUMN "location" TYPE TEXT[] USING (
    CASE WHEN "location" IS NULL THEN ARRAY[]::TEXT[] ELSE ARRAY["location"] END
  ),
  ALTER COLUMN "location" SET DEFAULT ARRAY[]::TEXT[];

