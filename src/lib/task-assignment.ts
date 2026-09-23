import "server-only";
import { prisma } from "@/lib/prisma";
import type { CurrentUser } from "@/lib/auth";
import type { Task } from "@/generated/prisma/client";
import { canReassignTask, canReassignBugWithinGroup, canAssignHandoffTask } from "@/lib/permissions";

// Shared assignee-pool resolution for a task, used by both the full task-detail page and the
// Dev/QA quick-edit drawer so the eligible pool and the reassign/bug rules never drift between
// the two surfaces. Mirrors the pool logic that used to live inline in the detail page.

type GroupForAssign = {
  leadUserId: string;
  podId: string | null;
  clusterId: string | null;
  pod?: { bugTrackingEnabled?: boolean } | null;
} | null;

export type TaskAssigneeContext = {
  canAssign: boolean; // unassigned handoff task can be assigned by this user
  canReassign: boolean; // already-assigned task can be reassigned (Lead/oversight)
  canReassignBug: boolean; // Contributor bug hand-off within the group (PRD v1.18)
  assignees: { id: string; name: string }[];
};

export async function resolveTaskAssigneeContext(
  user: CurrentUser,
  project: { clusterId: string },
  group: GroupForAssign,
  task: Task,
): Promise<TaskAssigneeContext> {
  const canAssign = !task.assignedToId && group !== null && canAssignHandoffTask(user, group);
  const canReassign = !!task.assignedToId && canReassignTask(user, group, task);
  const canReassignBug =
    !!task.assignedToId &&
    !canReassign &&
    canReassignBugWithinGroup(
      user,
      group
        ? { leadUserId: group.leadUserId, podId: group.podId, clusterId: group.clusterId, bugTrackingEnabled: group.pod?.bugTrackingEnabled }
        : null,
      task,
    );

  let assignees: { id: string; name: string }[] = [];
  if ((canAssign || canReassign || canReassignBug) && group) {
    // Your own team — the pod's actual members, plus the Lead — not the whole cluster.
    // Falls back to cluster-wide only for a legacy group with no snapshotted pod.
    const podMembers = await prisma.userRole.findMany({
      where: group.podId ? { podId: group.podId } : { clusterId: group.clusterId ?? project.clusterId },
      include: { user: true },
      distinct: ["userId"],
    });
    // A Contributor's bug hand-off may only target another Contributor — never the Lead.
    const eligible =
      canReassignBug && !canReassign && !canAssign ? podMembers.filter((r) => r.role === "CONTRIBUTOR") : podMembers;
    const byId = new Map(eligible.filter((r) => r.user.isActive).map((r) => [r.user.id, r.user]));
    assignees = Array.from(byId.values()).map((u) => ({ id: u.id, name: u.name }));
  }

  return { canAssign, canReassign, canReassignBug, assignees };
}
