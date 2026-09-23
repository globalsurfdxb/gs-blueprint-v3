-- Defensive de-dup before enforcing one-role-per-user: if any user somehow holds more
-- than one UserRole row, keep their most recently created one and drop the rest, rather
-- than letting the new unique constraint fail the migration outright.
DELETE FROM "user_roles" ur
WHERE ur."id" NOT IN (
    SELECT DISTINCT ON ("user_id") "id"
    FROM "user_roles"
    ORDER BY "user_id", "created_at" DESC
);

-- DropIndex
DROP INDEX "user_roles_user_id_role_cluster_id_pod_id_key";

-- CreateIndex
CREATE UNIQUE INDEX "user_roles_user_id_key" ON "user_roles"("user_id");
