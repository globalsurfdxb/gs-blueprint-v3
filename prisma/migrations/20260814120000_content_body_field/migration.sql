-- Content Body field (PRD 8.12) — a rich-text copy field on Task, scoped to the Content
-- discipline via a per-pod Admin toggle (same pattern as bug_tracking_enabled). Additive only.

-- Per-discipline toggle: which pods show the Content Body field. Default off, then enabled
-- for Content below (the only discipline that gets it in v1).
ALTER TABLE "pods" ADD COLUMN "content_body_enabled" BOOLEAN NOT NULL DEFAULT false;
UPDATE "pods" SET "content_body_enabled" = true WHERE "name" = 'Content';

-- The copy itself — sanitized HTML, null until the assignee writes something. No history table:
-- editing overwrites, and Revision Count already conveys how many feedback rounds occurred.
ALTER TABLE "tasks" ADD COLUMN "content_body" TEXT;
