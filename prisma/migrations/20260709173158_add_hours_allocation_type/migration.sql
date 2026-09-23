-- CreateEnum
CREATE TYPE "HoursAllocationType" AS ENUM ('ONE_TIME', 'MONTHLY');

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "hours_allocation_type" "HoursAllocationType";
