-- Agile Sprint Workflow, core mechanics (PRD 8.14, v1.29) — Development/QA only. Additive.

-- Sprint lifecycle enum.
CREATE TYPE "SprintStatus" AS ENUM ('PLANNED', 'ACTIVE', 'COMPLETED');

-- Per-discipline toggle: which pods get the Sprint Workflow (same pattern as
-- bug_tracking_enabled / content_body_enabled). Default off, then enabled for Development.
ALTER TABLE "pods" ADD COLUMN "sprint_workflow_enabled" BOOLEAN NOT NULL DEFAULT false;
UPDATE "pods" SET "sprint_workflow_enabled" = true WHERE "name" = 'Dev';

-- Sprint entity — project-scoped, variable length. Dates set once, don't change until complete.
CREATE TABLE "sprints" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "start_date" TIMESTAMP(3) NOT NULL,
  "end_date" TIMESTAMP(3) NOT NULL,
  "status" "SprintStatus" NOT NULL DEFAULT 'PLANNED',
  "created_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sprints_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "sprints"
  ADD CONSTRAINT "sprints_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sprints"
  ADD CONSTRAINT "sprints_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "sprints_project_id_idx" ON "sprints"("project_id");

-- Task's optional Sprint FK — null = Backlog. Never a workflow gate.
ALTER TABLE "tasks" ADD COLUMN "sprint_id" TEXT;
ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_sprint_id_fkey"
  FOREIGN KEY ("sprint_id") REFERENCES "sprints"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "tasks_sprint_id_idx" ON "tasks"("sprint_id");
