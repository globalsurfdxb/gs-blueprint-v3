import "server-only";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/format";
import type { CurrentUser } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { daysOverdue, getLocalDateString } from "@/lib/timezone";
import { secondsSince } from "@/lib/format";
import type { Prisma } from "@/generated/prisma/client";

// PRD 8.8 Dashboards. Admin sees agency-wide; a Cluster Head sees the identical widget set
// scoped to their own cluster (a pod-restricted Cluster Head narrows further to their pods).
// One role per user is enforced, so a viewer is either Admin or Cluster Head of exactly one
// cluster — no multi-scope merging needed.

// A task that hasn't moved out of these statuses in longer than this is flagged as a
// bottleneck. Deliberately a display heuristic, not a stored field — cheap to tune later.
export const BOTTLENECK_DAYS = 3;

/**
 * Section 8.8 bottleneck ("stuck") rule — the single source of truth. A task counts as stuck
 * when it has sat in IN_PROGRESS or REVIEW without any update for longer than BOTTLENECK_DAYS.
 * The Dependency Tracker KPI band (8.13) reuses this so its "Stuck" figure can never drift from
 * the Admin/Cluster-Head dashboard's.
 */
export function isBottleneck(status: string, updatedAt: Date, now: Date): boolean {
  const cutoff = new Date(now.getTime() - BOTTLENECK_DAYS * 24 * 60 * 60 * 1000);
  return (status === "IN_PROGRESS" || status === "REVIEW") && updatedAt < cutoff;
}
// Projects at or above this fraction of their Max Allocated Hours surface on the hours-risk
// widget; above 1.0 they read as "exceeded" rather than "approaching".
const HOURS_RISK_THRESHOLD = 0.8;
// Timezone for computing "overdue" on an unassigned task (no assignee to key off) — the
// agency's Dubai HQ day, so an unassigned past-due task still surfaces rather than vanishing.
const FALLBACK_LOCATION = "DUBAI";

export type DashTask = {
  id: string;
  projectId: string;
  name: string;
  projectName: string;
  assigneeName: string | null;
  dueDate: string;
  status: string;
  revisionCount: number;
  daysLate: number | null;
};

export type HoursRisk = {
  projectId: string;
  name: string;
  clientName: string;
  loggedHours: number;
  maxHours: number;
  allocationType: string | null;
  pct: number;
};

export type OnTrackRow = { label: string; onTrack: number; notOnTrack: number };

export type RunningTimerRow = {
  taskId: string;
  projectId: string;
  taskName: string;
  userName: string;
};

export type DashboardData = {
  scopeLabel: string;
  overdueTasks: DashTask[];
  revisionTasks: DashTask[];
  hoursRisk: HoursRisk[];
  bottlenecks: DashTask[];
  onTrack: OnTrackRow[];
  onTrackGrouping: "cluster" | "pod";
  // PRD 8.8 summary widgets, scoped identically to the rest of the dashboard.
  activeCount: number;
  completedCount: number;
  dueTodayTasks: DashTask[];
  runningTimers: RunningTimerRow[];
  // Distinct project counts, independent of grouping — the pod-by-pod rows deliberately
  // count a multi-pod project once per pod, so their sum would over-count. These give the
  // honest headline figure for the KPI card.
  projectsOnTrack: number;
  projectsNotOnTrack: number;
};

const ACTIVE_PROJECT_STATUSES = ["PLANNING", "ACTIVE", "PAUSED"] as const;

export async function getDashboardData(user: CurrentUser): Promise<DashboardData> {
  const admin = isAdmin(user);
  const chRole = user.roles.find((r) => r.role === "CLUSTER_HEAD") ?? null;
  const restriction =
    chRole && chRole.restrictedPodIds.length > 0 ? chRole.restrictedPodIds : null;

  const now = new Date();

  // ---- Scope filters ----------------------------------------------------------------
  // Tasks are scoped by their Task Group's cluster/pod snapshot; projects by home cluster
  // (or, for a pod-restricted Cluster Head, by having a group in one of their pods).
  // A CLUSTER_HEAD role always carries a clusterId (the column is nullable only because
  // Admin/Accountant roles have none), so it's safe to assert here.
  const chClusterId = chRole?.clusterId ?? "";
  const taskGroupWhere: Prisma.TaskGroupWhereInput | null = admin
    ? null
    : { clusterId: chClusterId, ...(restriction ? { podId: { in: restriction } } : {}) };

  // Archived projects (and their tasks) drop out of every dashboard widget.
  const taskScope: Prisma.TaskWhereInput = admin
    ? { project: { archivedAt: null } }
    : { group: taskGroupWhere!, project: { archivedAt: null } };
  const projectScope: Prisma.ProjectWhereInput = {
    archivedAt: null,
    ...(admin
      ? {}
      : restriction
        ? { taskGroups: { some: { podId: { in: restriction } } } }
        : { clusterId: chClusterId }),
  };

  // ---- Task-level widgets (overdue / revisions / bottleneck) -------------------------
  // Top-level tasks only — subtasks are personal single-owner items (PRD 8.2), so counting
  // them here would double-count a deliverable against its own breakdown.
  const openTasks = await prisma.task.findMany({
    where: { ...taskScope, parentTaskId: null, status: { not: "COMPLETED" } },
    include: { assignedTo: { select: { name: true, location: true } }, project: { select: { name: true } } },
    orderBy: { dueDate: "asc" },
  });

  const toDashTask = (t: (typeof openTasks)[number]): DashTask => ({
    id: t.id,
    projectId: t.projectId,
    name: t.name,
    projectName: t.project.name,
    assigneeName: t.assignedTo?.name ?? null,
    dueDate: formatDate(t.dueDate),
    status: t.status,
    revisionCount: t.revisionCount,
    daysLate: daysOverdue(t.dueDate, t.assignedTo?.location ?? FALLBACK_LOCATION, now),
  });

  const overdueTasks: DashTask[] = [];
  const revisionTasks: DashTask[] = [];
  const bottlenecks: DashTask[] = [];

  for (const t of openTasks) {
    const d = toDashTask(t);
    // On Hold is a deliberate pause, so it's excluded from both "overdue" and "stuck" —
    // it isn't silently slipping, someone chose to park it.
    if (t.status !== "ON_HOLD" && d.daysLate !== null && d.daysLate > 0) overdueTasks.push(d);
    if (t.revisionCount >= 1) revisionTasks.push(d);
    if (isBottleneck(t.status, t.updatedAt, now)) bottlenecks.push(d);
  }
  revisionTasks.sort((a, b) => b.revisionCount - a.revisionCount);

  // ---- Summary widgets (PRD 8.8): Active / Completed / Due Today / Running Timers ----
  // Top-level tasks only, same convention as the widgets above (subtasks are personal
  // breakdowns, not standalone deliverables to tally).
  const dashTodayStr = getLocalDateString(user.location, now);
  const activeCount = openTasks.length; // openTasks is already "not Completed" in scope
  const dueTodayTasks = openTasks
    .filter((t) => t.dueDate.toISOString().slice(0, 10) === dashTodayStr)
    .map(toDashTask);

  const [completedCount, runningLogs] = await Promise.all([
    prisma.task.count({ where: { ...taskScope, parentTaskId: null, status: "COMPLETED" } }),
    prisma.timeLog.findMany({
      where: { endTime: null, task: taskScope },
      select: {
        task: { select: { id: true, name: true, projectId: true } },
        user: { select: { name: true } },
      },
    }),
  ]);
  const runningTimers: RunningTimerRow[] = runningLogs.map((l) => ({
    taskId: l.task.id,
    projectId: l.task.projectId,
    taskName: l.task.name,
    userName: l.user.name,
  }));

  // ---- Hours-risk widget ------------------------------------------------------------
  const hoursProjects = await prisma.project.findMany({
    where: { ...projectScope, maxAllocatedHours: { not: null } },
    select: { id: true, name: true, maxAllocatedHours: true, hoursAllocationType: true, client: { select: { name: true } } },
  });
  const hoursRisk: HoursRisk[] = [];
  if (hoursProjects.length > 0) {
    const logs = await prisma.timeLog.findMany({
      where: { task: { projectId: { in: hoursProjects.map((p) => p.id) } } },
      select: { durationSeconds: true, startTime: true, task: { select: { projectId: true } } },
    });
    const secondsByProject = new Map<string, number>();
    for (const l of logs) {
      const secs = l.durationSeconds ?? secondsSince(l.startTime);
      secondsByProject.set(l.task.projectId, (secondsByProject.get(l.task.projectId) ?? 0) + secs);
    }
    for (const p of hoursProjects) {
      const maxHours = Number(p.maxAllocatedHours);
      if (!maxHours) continue;
      const loggedHours = (secondsByProject.get(p.id) ?? 0) / 3600;
      const pct = loggedHours / maxHours;
      if (pct >= HOURS_RISK_THRESHOLD) {
        hoursRisk.push({
          projectId: p.id,
          name: p.name,
          clientName: p.client.name,
          loggedHours,
          maxHours,
          allocationType: p.hoursAllocationType,
          pct,
        });
      }
    }
    hoursRisk.sort((a, b) => b.pct - a.pct);
  }

  // ---- On-track vs not-on-track -----------------------------------------------------
  // A project is "not on track" if it has any overdue task, or its own deadline has passed
  // while it's still active (confirmed v1 default). Grouped cluster-by-cluster for Admin,
  // pod-by-pod for a Cluster Head.
  const trackProjects = await prisma.project.findMany({
    where: { ...projectScope, status: { in: [...ACTIVE_PROJECT_STATUSES] } },
    select: {
      id: true,
      deadline: true,
      cluster: { select: { name: true } },
      taskGroups: { select: { podId: true, clusterId: true, pod: { select: { name: true } } } },
      tasks: {
        where: { parentTaskId: null, status: { notIn: ["COMPLETED", "ON_HOLD"] } },
        select: { dueDate: true, assignedTo: { select: { location: true } } },
      },
    },
  });

  const todayStr = getLocalDateString(FALLBACK_LOCATION, now);
  const isProjectOnTrack = (p: (typeof trackProjects)[number]): boolean => {
    if (p.deadline && p.deadline.toISOString().slice(0, 10) < todayStr) return false;
    for (const t of p.tasks) {
      const late = daysOverdue(t.dueDate, t.assignedTo?.location ?? FALLBACK_LOCATION, now);
      if (late !== null && late > 0) return false;
    }
    return true;
  };

  const onTrackGrouping: "cluster" | "pod" = admin ? "cluster" : "pod";
  const buckets = new Map<string, { onTrack: number; notOnTrack: number }>();
  const bump = (label: string, ok: boolean) => {
    const b = buckets.get(label) ?? { onTrack: 0, notOnTrack: 0 };
    if (ok) b.onTrack += 1;
    else b.notOnTrack += 1;
    buckets.set(label, b);
  };

  // Distinct project tallies, counted once each regardless of how many pods a project spans.
  let projectsOnTrack = 0;
  let projectsNotOnTrack = 0;
  for (const p of trackProjects) {
    if (isProjectOnTrack(p)) projectsOnTrack += 1;
    else projectsNotOnTrack += 1;
  }

  if (admin) {
    for (const p of trackProjects) bump(p.cluster.name, isProjectOnTrack(p));
  } else {
    // Pod-by-pod: a project counts under each of the viewer's in-scope pods it has a group
    // in — so a project spanning two of the Cluster Head's pods appears in both pod rows.
    const podNames = await prisma.pod.findMany({
      where: { clusterId: chClusterId, ...(restriction ? { id: { in: restriction } } : {}) },
      select: { id: true, name: true },
    });
    const inScopePodIds = new Set(podNames.map((p) => p.id));
    for (const pod of podNames) buckets.set(pod.name, { onTrack: 0, notOnTrack: 0 });
    for (const p of trackProjects) {
      const ok = isProjectOnTrack(p);
      const podsTouched = new Set(
        p.taskGroups.filter((g) => g.podId && inScopePodIds.has(g.podId)).map((g) => g.pod!.name),
      );
      for (const podName of podsTouched) bump(podName, ok);
    }
  }

  const onTrack: OnTrackRow[] = Array.from(buckets.entries())
    .map(([label, v]) => ({ label, ...v }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return {
    scopeLabel: admin ? "Agency-wide" : chRole!.cluster?.name ?? "Your cluster",
    overdueTasks,
    revisionTasks,
    hoursRisk,
    bottlenecks,
    onTrack,
    onTrackGrouping,
    activeCount,
    completedCount,
    dueTodayTasks,
    runningTimers,
    projectsOnTrack,
    projectsNotOnTrack,
  };
}
