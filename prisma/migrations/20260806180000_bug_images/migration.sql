-- Screenshot Attachments on Bugs (PRD 8.2.4): image refs only; binaries live in Vercel Blob.
CREATE TABLE "bug_images" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "pathname" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "added_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "bug_images_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "bug_images_task_id_idx" ON "bug_images"("task_id");
ALTER TABLE "bug_images" ADD CONSTRAINT "bug_images_task_id_fkey"
    FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bug_images" ADD CONSTRAINT "bug_images_added_by_id_fkey"
    FOREIGN KEY ("added_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
