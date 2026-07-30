-- Lets POST /api/contacts/:id/connect-message refuse a regenerate whose inputs
-- (contact fields, posting, application status/notes, resume, specialization)
-- haven't changed, the way the resume-tips, tailored-resume, and cover-letter
-- routes already do. Without it every click bills a model call.
--
-- Existing notes get NULL, which never equals a computed hash, so the first
-- regenerate per contact after this deploy is allowed through and gated after.
-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "connectMessageHash" TEXT;
