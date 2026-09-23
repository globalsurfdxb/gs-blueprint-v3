-- QA / Bug Tracking (PRD 8.2.4). A Bug is a Task Type on the existing Task, not a new entity.
CREATE TYPE "TaskType" AS ENUM ('STANDARD', 'BUG');
CREATE TYPE "BugSeverity" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW');
CREATE TYPE "BugEnvironment" AS ENUM ('FRONTEND', 'BACKEND', 'BOTH');

ALTER TABLE "tasks" ADD COLUMN "task_type" "TaskType" NOT NULL DEFAULT 'STANDARD';
ALTER TABLE "tasks" ADD COLUMN "severity" "BugSeverity";
ALTER TABLE "tasks" ADD COLUMN "steps_to_reproduce" TEXT;
ALTER TABLE "tasks" ADD COLUMN "environment" "BugEnvironment";

-- Admin-managed per-discipline toggle; defaults off, then enabled for Dev + QA below.
ALTER TABLE "pods" ADD COLUMN "bug_tracking_enabled" BOOLEAN NOT NULL DEFAULT false;
UPDATE "pods" SET "bug_tracking_enabled" = true WHERE "name" IN ('Dev', 'QA');

-- Bug-scoped status-change log.
CREATE TABLE "task_status_events" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "status" "TaskStatus" NOT NULL,
    "changed_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "task_status_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "task_status_events_task_id_idx" ON "task_status_events"("task_id");
ALTER TABLE "task_status_events" ADD CONSTRAINT "task_status_events_task_id_fkey"
    FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_status_events" ADD CONSTRAINT "task_status_events_changed_by_id_fkey"
    FOREIGN KEY ("changed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
