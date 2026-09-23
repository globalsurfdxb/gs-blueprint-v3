-- Hand-authored (see CLAUDE session convention): additive enum value first, then create
-- the new task_groups table, backfill it from project_leads before dropping that table,
-- then extend tasks and backfill group_id where unambiguous.

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'TASK_HANDOFF_RECEIVED';

-- CreateTable
CREATE TABLE "task_groups" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lead_user_id" TEXT NOT NULL,
    "cluster_id" TEXT,
    "added_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_groups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "task_groups_project_id_lead_user_id_key" ON "task_groups"("project_id", "lead_user_id");

-- AddForeignKey
ALTER TABLE "task_groups" ADD CONSTRAINT "task_groups_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_groups" ADD CONSTRAINT "task_groups_lead_user_id_fkey" FOREIGN KEY ("lead_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_groups" ADD CONSTRAINT "task_groups_cluster_id_fkey" FOREIGN KEY ("cluster_id") REFERENCES "clusters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_groups" ADD CONSTRAINT "task_groups_added_by_id_fkey" FOREIGN KEY ("added_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- DataMigration: one task_groups row per existing project_leads row, reusing its id.
-- Discipline name/cluster is derived from the lead's own LEAD-role UserRole scoped to the
-- project's home cluster if one exists, else any LEAD-role of theirs, else "General".
INSERT INTO "task_groups" ("id", "project_id", "name", "lead_user_id", "cluster_id", "added_by_id", "created_at")
SELECT
    pl."id",
    pl."project_id",
    COALESCE(
        (
            SELECT CONCAT(c."name", ' · ', p."name")
            FROM "user_roles" ur
            LEFT JOIN "clusters" c ON c."id" = ur."cluster_id"
            LEFT JOIN "pods" p ON p."id" = ur."pod_id"
            JOIN "projects" proj ON proj."id" = pl."project_id"
            WHERE ur."user_id" = pl."user_id" AND ur."role" = 'LEAD' AND ur."cluster_id" = proj."cluster_id"
            ORDER BY ur."created_at" ASC
            LIMIT 1
        ),
        (
            SELECT COALESCE(CONCAT(c."name", ' · ', p."name"), c."name", 'General')
            FROM "user_roles" ur
            LEFT JOIN "clusters" c ON c."id" = ur."cluster_id"
            LEFT JOIN "pods" p ON p."id" = ur."pod_id"
            WHERE ur."user_id" = pl."user_id" AND ur."role" = 'LEAD'
            ORDER BY ur."created_at" ASC
            LIMIT 1
        ),
        'General'
    ),
    pl."user_id",
    (
        SELECT ur."cluster_id"
        FROM "user_roles" ur
        WHERE ur."user_id" = pl."user_id" AND ur."role" = 'LEAD'
        ORDER BY ur."created_at" ASC
        LIMIT 1
    ),
    pl."added_by_id",
    pl."created_at"
FROM "project_leads" pl;

-- DropForeignKey
ALTER TABLE "project_leads" DROP CONSTRAINT "project_leads_added_by_id_fkey";

-- DropForeignKey
ALTER TABLE "project_leads" DROP CONSTRAINT "project_leads_project_id_fkey";

-- DropForeignKey
ALTER TABLE "project_leads" DROP CONSTRAINT "project_leads_user_id_fkey";

-- DropTable
DROP TABLE "project_leads";

-- DropForeignKey
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_assigned_to_id_fkey";

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "completed_at" TIMESTAMP(3),
ADD COLUMN     "description" TEXT,
ADD COLUMN     "group_id" TEXT,
ADD COLUMN     "predecessor_task_id" TEXT,
ALTER COLUMN "assigned_to_id" DROP NOT NULL;

-- DataMigration: backfill group_id onto existing tasks only where the project has
-- exactly one task_group (the common case pre-feature) — genuinely ambiguous cases
-- (multi-group projects created before this feature) are left ungrouped rather than guessed.
UPDATE "tasks" t
SET "group_id" = tg."id"
FROM "task_groups" tg
WHERE tg."project_id" = t."project_id"
  AND (SELECT COUNT(*) FROM "task_groups" tg2 WHERE tg2."project_id" = t."project_id") = 1;

-- CreateIndex
CREATE UNIQUE INDEX "tasks_predecessor_task_id_key" ON "tasks"("predecessor_task_id");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "task_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_predecessor_task_id_fkey" FOREIGN KEY ("predecessor_task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
