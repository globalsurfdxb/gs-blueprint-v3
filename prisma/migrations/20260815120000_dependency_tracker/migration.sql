-- Dependency Tracker (PRD 8.13, v1.26): a second, separate per-project designation alongside
-- Project Account Manager. A view-only coordinator who sees only this project's cross-group-
-- linked tasks. Additive, nullable FK — no data backfill.
ALTER TABLE "projects" ADD COLUMN "dependency_tracker_id" TEXT;
ALTER TABLE "projects"
  ADD CONSTRAINT "projects_dependency_tracker_id_fkey"
  FOREIGN KEY ("dependency_tracker_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
