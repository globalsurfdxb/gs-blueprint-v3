-- Project Milestones (PRD — agency-wide): a manually-created, ordered checklist of a project's
-- real checkpoints, independent of Task Groups / Tasks / handoff. Additive.
CREATE TABLE "milestones" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "due_date" TIMESTAMP(3) NOT NULL,
  "completed" BOOLEAN NOT NULL DEFAULT false,
  "order" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "milestones_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "milestones_project_id_idx" ON "milestones"("project_id");

ALTER TABLE "milestones"
  ADD CONSTRAINT "milestones_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
