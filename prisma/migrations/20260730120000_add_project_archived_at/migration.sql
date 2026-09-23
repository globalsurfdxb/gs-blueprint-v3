-- Soft-delete for projects: nullable timestamp, hidden everywhere when set. Reversible.
ALTER TABLE "projects" ADD COLUMN "archived_at" TIMESTAMP(3);
