-- CreateTable
CREATE TABLE "project_attachments" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "label" TEXT,
    "added_by_id" TEXT NOT NULL,
    "is_edited" BOOLEAN NOT NULL DEFAULT false,
    "edited_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_attachments_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "project_attachments" ADD CONSTRAINT "project_attachments_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_attachments" ADD CONSTRAINT "project_attachments_added_by_id_fkey" FOREIGN KEY ("added_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- DataMigration: carry forward the old single one_drive_link value into the new
-- multi-link table before the column is dropped, so no existing link is lost.
INSERT INTO "project_attachments" ("id", "project_id", "url", "added_by_id", "created_at")
SELECT
  'pa_' || substr(md5(random()::text || id), 1, 20),
  "id",
  "one_drive_link",
  "created_by_id",
  CURRENT_TIMESTAMP
FROM "projects"
WHERE "one_drive_link" IS NOT NULL;

-- AlterTable
ALTER TABLE "projects" DROP COLUMN "one_drive_link";
