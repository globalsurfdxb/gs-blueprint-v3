-- CreateTable
CREATE TABLE "project_leads" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "added_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_leads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "project_leads_project_id_user_id_key" ON "project_leads"("project_id", "user_id");

-- AddForeignKey
ALTER TABLE "project_leads" ADD CONSTRAINT "project_leads_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_leads" ADD CONSTRAINT "project_leads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_leads" ADD CONSTRAINT "project_leads_added_by_id_fkey" FOREIGN KEY ("added_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- DataMigration: carry forward existing single-lead assignments into the new roster
-- before the column is dropped, so no assignment is silently lost.
INSERT INTO "project_leads" ("id", "project_id", "user_id", "created_at")
SELECT
  'pl_' || substr(md5(random()::text || id), 1, 20),
  "id",
  "assigned_lead_id",
  CURRENT_TIMESTAMP
FROM "projects"
WHERE "assigned_lead_id" IS NOT NULL;

-- DropForeignKey
ALTER TABLE "projects" DROP CONSTRAINT "projects_assigned_lead_id_fkey";

-- AlterTable
ALTER TABLE "projects" DROP COLUMN "assigned_lead_id";
