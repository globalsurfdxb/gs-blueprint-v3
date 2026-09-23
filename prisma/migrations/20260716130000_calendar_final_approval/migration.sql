-- Final calendar sign-off: closes the loop back to the Social Media Lead once the
-- Design-stage task (the last link in the Content Calendar chain) has been completed.

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN "calendar_approved_at" TIMESTAMP(3),
ADD COLUMN "calendar_approved_by_id" TEXT;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_calendar_approved_by_id_fkey" FOREIGN KEY ("calendar_approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
