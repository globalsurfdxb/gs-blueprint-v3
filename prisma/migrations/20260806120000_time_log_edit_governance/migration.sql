-- Cluster-Head time-log correction (PRD 8.4): flag edits visibly, snapshot originals.
ALTER TABLE "time_logs" ADD COLUMN "edited_at" TIMESTAMP(3);
ALTER TABLE "time_logs" ADD COLUMN "edited_by_id" TEXT;
ALTER TABLE "time_logs" ADD COLUMN "edit_reason" TEXT;
ALTER TABLE "time_logs" ADD COLUMN "original_start_time" TIMESTAMP(3);
ALTER TABLE "time_logs" ADD COLUMN "original_end_time" TIMESTAMP(3);
ALTER TABLE "time_logs" ADD COLUMN "original_duration_seconds" INTEGER;

ALTER TABLE "time_logs" ADD CONSTRAINT "time_logs_edited_by_id_fkey"
  FOREIGN KEY ("edited_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
