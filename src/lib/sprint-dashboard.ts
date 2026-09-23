import "server-only";
import { prisma } from "@/lib/prisma";
import type { CurrentUser } from "@/lib/auth";
import { isAdmin, isClusterHeadOf, getClusterHeadPodRestriction } from "@/lib/permissions";
import { isBottleneck } from "@/lib/dashboard";
import { daysOverdue } from "@/lib/timezone";
import { secondsSince } from "@/lib/format";

// Sprint Progress Dashboard (PRD 8.14) — extends the 8.8 dashboards, scoped to Sprint-enabled
// Task Groups only. A Development Lead sees their own pod; a Cluster Head / Admin see per their
// existing scope (5.2). Reuses the exact 8.8 bottleneck rule (isBottleneck) and the per-user
// overdue rule (daysOverdue) — no new detection logic, no new report.

export type SprintProgressRow = {
  id: string;
  name: string;
  projectId: string;
  projectName: string;
  status: "PLANNED" | "ACTIVE" | "COMPLETED";
  totalTasks: number;
  completedTasks: number;
  completionPct: number;
  overdue: number;
  stuck: number;
};

export type SprintWorkloadRow = {
  userId: string;
  name: string;
  openTasks: number;
  loggedSeconds: number;
};

export type SprintProgressData = {
  inScope: boolean; // viewer has at least one Sprint-enabled group in scope
  sprints: SprintProgressRow[]; // Active + Planned sprints in scope
  workload: SprintWorkloadRow[]; // per-person, across ACTIVE-sprint tasks in scope
};

/** Which of the candidate Sprint-enabled groups fall in this viewer's oversight scope. */
function groupInScope(
  user: CurrentUser,
  g: { leadUserId: string; clusterId: string | null; podId: string | null; project: { clusterId: string } },
): boolean {
  if (isAdmin(user)) return true;
  // Cluster Head of the group's cluster (its snapshotted cluster, falling back to the
  // project's), honouring a pod-restricted Cluster Head's pod scope.
  const clusterId = g.clusterId ?? g.project.clusterId;
  if (isClusterHeadOf(user, clusterId)) {
    const restriction = getClusterHeadPodRestriction(user, clusterId);
    if (restriction === null) return true;
    if (g.podId !== null && restriction.includes(g.podId)) return true;
  }
  // The Lead who owns the group.
  return g.leadUserId === user.id;
}

export async function getSprintProgressData(user: CurrentUser): Promise<SprintProgressData> {
  const now = new Date();

  // Candidate Sprint-enabled groups on active (non-archived, non-completed) projects.
  const candidateGroups = await prisma.taskGroup.findMany({
    where: {
      pod: { sprintWorkflowEnabled: true },
      project: { archivedAt: null, status: { not: "COMPLETED" } },
    },
    select: {
      id: true,
      leadUserId: true,
      clusterId: true,
      podId: true,
      project: { select: { id: true, clusterId: true } },
    },
  });

  const scopedGroupIds = candidateGroups.filter((g) => groupInScope(user, g)).map((g) => g.id);
  if (scopedGroupIds.length === 0) {
    return { inScope: false, sprints: [], workload: [] };
  }

  // Top-level tasks in those groups (subtasks are personal breakdowns, not sprint items).
  const tasks = await prisma.task.findMany({
    where: { groupId: { in: scopedGroupIds }, parentTaskId: null, sprintId: { not: null } },
    select: {
      id: true,
      status: true,
      dueDate: true,
      updatedAt: true,
      assignedToId: true,
      assignedTo: { select: { name: true, location: true } },
      sprint: { select: { id: true, name: true, status: true, projectId: true, project: { select: { name: true } } } },
    },
  });

  // Per-sprint rollup (Active + Planned only — Completed sprints are historical record).
  const bySprintId = new Map<string, SprintProgressRow>();
  for (const t of tasks) {
    const s = t.sprint;
    if (!s || s.status === "COMPLETED") continue;
    let row = bySprintId.get(s.id);
    if (!row) {
      row = {
        id: s.id,
        name: s.name,
        projectId: s.projectId,
        projectName: s.project.name,
        status: s.status,
        totalTasks: 0,
        completedTasks: 0,
        completionPct: 0,
        overdue: 0,
        stuck: 0,
      };
      bySprintId.set(s.id, row);
    }
    row.totalTasks += 1;
    if (t.status === "COMPLETED") row.completedTasks += 1;
    // Overdue / stuck reuse 8.8's exact rules; On Hold is a deliberate pause, excluded from both.
    if (t.status !== "COMPLETED" && t.status !== "ON_HOLD") {
      const late = daysOverdue(t.dueDate, t.assignedTo?.location, now);
      if (late !== null && late > 0) row.overdue += 1;
    }
    if (isBottleneck(t.status, t.updatedAt, now)) row.stuck += 1;
  }
  for (const row of bySprintId.values()) {
    row.completionPct = row.totalTasks > 0 ? Math.round((row.completedTasks / row.totalTasks) * 100) : 0;
  }

  // Workload per person — across tasks in ACTIVE sprints only (the work in flight).
  const activeSprintTaskIds = tasks.filter((t) => t.sprint?.status === "ACTIVE").map((t) => t.id);
  const workloadByUser = new Map<string, SprintWorkloadRow>();
  for (const t of tasks) {
    if (t.sprint?.status !== "ACTIVE" || t.status === "COMPLETED" || !t.assignedToId) continue;
    const row = workloadByUser.get(t.assignedToId) ?? {
      userId: t.assignedToId,
      name: t.assignedTo?.name ?? "Unknown",
      openTasks: 0,
      loggedSeconds: 0,
    };
    row.openTasks += 1;
    workloadByUser.set(t.assignedToId, row);
  }

  if (activeSprintTaskIds.length > 0) {
    const logs = await prisma.timeLog.findMany({
      where: { taskId: { in: activeSprintTaskIds } },
      select: { userId: true, durationSeconds: true, startTime: true, user: { select: { name: true } } },
    });
    for (const l of logs) {
      const seconds = l.durationSeconds ?? secondsSince(l.startTime);
      const row = workloadByUser.get(l.userId) ?? {
        userId: l.userId,
        name: l.user.name,
        openTasks: 0,
        loggedSeconds: 0,
      };
      row.loggedSeconds += seconds;
      workloadByUser.set(l.userId, row);
    }
  }

  const sprints = Array.from(bySprintId.values()).sort(
    (a, b) =>
      // Active first, then Planned; within a status, by project then sprint name.
      (a.status === b.status ? 0 : a.status === "ACTIVE" ? -1 : 1) ||
      a.projectName.localeCompare(b.projectName) ||
      a.name.localeCompare(b.name),
  );
  const workload = Array.from(workloadByUser.values()).sort((a, b) => a.name.localeCompare(b.name));

  return { inScope: true, sprints, workload };
}
