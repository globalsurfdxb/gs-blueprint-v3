-- Agile Sprint Workflow enhancement (v1.29+): a static, manually-set planned-capacity field
-- at the Team (Task Group) level, hours per week. Development/QA only in the UI; the column is
-- nullable and blank by default. Feeds the still-held Developer Utilization report; idle for now.
-- Additive, nullable — no backfill.
ALTER TABLE "task_groups" ADD COLUMN "capacity_hours_per_week" DECIMAL(65,30);
