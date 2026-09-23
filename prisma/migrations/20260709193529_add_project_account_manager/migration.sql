-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "account_manager_id" TEXT;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_account_manager_id_fkey" FOREIGN KEY ("account_manager_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
