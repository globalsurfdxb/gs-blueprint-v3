-- Hand-authored (see CLAUDE session convention): add the pod-restriction join table and
-- TaskGroup.podId, then re-establish Creative Studio as a real cluster (no Head) by moving
-- the Design pod (and its Lead/Contributor) off Project Delivery & Client Services, then
-- backfill/re-sync existing TaskGroup rows, then apply Ashna's Social Media pod restriction.

-- CreateTable
CREATE TABLE "user_role_pods" (
    "id" TEXT NOT NULL,
    "user_role_id" TEXT NOT NULL,
    "pod_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_role_pods_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_role_pods_user_role_id_pod_id_key" ON "user_role_pods"("user_role_id", "pod_id");

-- AddForeignKey
ALTER TABLE "user_role_pods" ADD CONSTRAINT "user_role_pods_user_role_id_fkey" FOREIGN KEY ("user_role_id") REFERENCES "user_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role_pods" ADD CONSTRAINT "user_role_pods_pod_id_fkey" FOREIGN KEY ("pod_id") REFERENCES "pods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "task_groups" ADD COLUMN "pod_id" TEXT;

-- AddForeignKey
ALTER TABLE "task_groups" ADD CONSTRAINT "task_groups_pod_id_fkey" FOREIGN KEY ("pod_id") REFERENCES "pods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- DataMigration: re-establish "Creative Studio" as a real cluster with no Head (structural
-- correction — Social Media is a pod within Marketing & Strategy, not a peer cluster;
-- Creative Studio is a peer cluster whose sole pod is Design).
INSERT INTO "clusters" ("id", "name")
SELECT gen_random_uuid()::text, 'Creative Studio'
WHERE NOT EXISTS (SELECT 1 FROM "clusters" WHERE "name" = 'Creative Studio');

-- DataMigration: move the Design pod from Project Delivery & Client Services to Creative Studio.
UPDATE "pods" p
SET "cluster_id" = (SELECT "id" FROM "clusters" WHERE "name" = 'Creative Studio')
WHERE p."name" = 'Design'
  AND p."cluster_id" = (SELECT "id" FROM "clusters" WHERE "name" = 'Project Delivery & Client Services');

-- DataMigration: every UserRole scoped to the Design pod (its Lead and Contributors)
-- follows the pod to Creative Studio — their cluster scope must match their pod's cluster.
UPDATE "user_roles" ur
SET "cluster_id" = (SELECT "id" FROM "clusters" WHERE "name" = 'Creative Studio')
WHERE ur."pod_id" = (SELECT "id" FROM "pods" WHERE "name" = 'Design');

-- DataMigration: backfill TaskGroup.podId from the attached Lead's own UserRole pod —
-- the pod-scoping this field exists for was never captured before this migration.
UPDATE "task_groups" tg
SET "pod_id" = ur."pod_id"
FROM "user_roles" ur
WHERE ur."user_id" = tg."lead_user_id" AND ur."pod_id" IS NOT NULL;

-- DataMigration: re-sync TaskGroup.clusterId (a snapshot of the Lead's home cluster taken
-- at attach time) for any existing group whose Lead's cluster just moved above — this only
-- affects Design-pod Task Groups (Mobin), now homed under Creative Studio.
UPDATE "task_groups" tg
SET "cluster_id" = ur."cluster_id"
FROM "user_roles" ur
WHERE ur."user_id" = tg."lead_user_id"
  AND ur."cluster_id" IS NOT NULL
  AND tg."cluster_id" IS DISTINCT FROM ur."cluster_id";

-- DataMigration: Ashna's Cluster Head role narrows to the Social Media pod only — she must
-- not see or manage Aravind's SEO, Performance Marketing, or Content work.
INSERT INTO "user_role_pods" ("id", "user_role_id", "pod_id", "created_at")
SELECT gen_random_uuid()::text, ur."id", p."id", CURRENT_TIMESTAMP
FROM "user_roles" ur
JOIN "users" u ON u."id" = ur."user_id"
JOIN "pods" p ON p."name" = 'Social Media'
WHERE u."name" ILIKE 'Ashna%' AND ur."role" = 'CLUSTER_HEAD'
ON CONFLICT DO NOTHING;
