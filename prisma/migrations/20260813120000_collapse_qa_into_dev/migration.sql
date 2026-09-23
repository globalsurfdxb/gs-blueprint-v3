-- QA / Bug Tracking model correction (PRD v1.18, §8.2.4 "Routing Within the Development
-- Task Group"). The original build wrongly modeled QA as its own discipline (a separate
-- QA pod / Task Group / Lead). In reality the Development Division is one team under one
-- Lead; QA is a Contributor role inside the Development pod, not a peer discipline. Collapse
-- the standalone QA pod into Dev so a QA Contributor is simply a member of the Development
-- Task Group. Bug Tracking stays enabled on Dev only (QA no longer exists as a toggleable
-- discipline). No task_groups ever referenced the QA pod, so no project data is rewritten.

-- 1. Move every QA-pod role membership to the Dev pod in the same cluster.
UPDATE "user_roles" ur
SET "pod_id" = dev."id"
FROM "pods" qa
JOIN "pods" dev ON dev."cluster_id" = qa."cluster_id" AND dev."name" = 'Dev'
WHERE ur."pod_id" = qa."id" AND qa."name" = 'QA';

-- 2. Move any Cluster-Head pod-restriction rows off QA onto Dev (none expected), skipping
--    a move that would collide with an existing (user_role, Dev) restriction, then drop any
--    QA restriction rows that couldn't be moved for that reason.
UPDATE "user_role_pods" urp
SET "pod_id" = dev."id"
FROM "pods" qa
JOIN "pods" dev ON dev."cluster_id" = qa."cluster_id" AND dev."name" = 'Dev'
WHERE urp."pod_id" = qa."id" AND qa."name" = 'QA'
  AND NOT EXISTS (
    SELECT 1 FROM "user_role_pods" other
    WHERE other."user_role_id" = urp."user_role_id" AND other."pod_id" = dev."id"
  );

DELETE FROM "user_role_pods" urp
USING "pods" qa
WHERE urp."pod_id" = qa."id" AND qa."name" = 'QA';

-- 3. Remove the now-unreferenced QA pod(s). Dev keeps bug_tracking_enabled = true; QA is gone.
DELETE FROM "pods" WHERE "name" = 'QA';
