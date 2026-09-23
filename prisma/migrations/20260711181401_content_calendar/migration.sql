-- Social Media Content Calendar (v1, Social Media pod only): admin-managed Content Types,
-- one Monthly Brief per Project+Month+Year, and calendar metadata on Task so the
-- Cross-Group Handoff can auto-calculate the Design task's due date on carry-forward.

-- CreateTable
CREATE TABLE "content_types" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "content_lead_time_days" INTEGER NOT NULL,
    "design_lead_time_days" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_types_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "content_types_name_key" ON "content_types"("name");

-- CreateTable
CREATE TABLE "monthly_briefs" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "monthly_briefs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "monthly_briefs_project_id_month_year_key" ON "monthly_briefs"("project_id", "month", "year");

-- AddForeignKey
ALTER TABLE "monthly_briefs" ADD CONSTRAINT "monthly_briefs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monthly_briefs" ADD CONSTRAINT "monthly_briefs_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN "publish_date" TIMESTAMP(3),
ADD COLUMN "content_type_id" TEXT,
ADD COLUMN "monthly_brief_id" TEXT;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_content_type_id_fkey" FOREIGN KEY ("content_type_id") REFERENCES "content_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_monthly_brief_id_fkey" FOREIGN KEY ("monthly_brief_id") REFERENCES "monthly_briefs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- DataMigration: default Content Types (Admin can add/edit/remove afterward — no values
-- stay hardcoded in application code). Lead times are placeholders; Admin should review.
INSERT INTO "content_types" ("id", "name", "content_lead_time_days", "design_lead_time_days")
VALUES
    (gen_random_uuid()::text, 'Reels', 5, 2),
    (gen_random_uuid()::text, 'Carousel', 4, 2),
    (gen_random_uuid()::text, 'Static', 3, 1),
    (gen_random_uuid()::text, 'Other', 3, 1)
ON CONFLICT ("name") DO NOTHING;
