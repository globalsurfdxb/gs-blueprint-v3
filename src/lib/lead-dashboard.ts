import "server-only";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/format";
import type { CurrentUser } from "@/lib/auth";
import { daysOverdue } from "@/lib/timezone";
import type { DashTask } from "@/lib/dashboard";

// The Lead's own operational view (a lean counterpart to the Admin/Cluster Head oversight
// dashboard, PRD 8.8). Scoped to the Task Groups this user personally leads, aggregated
// across every project — the cross-project roll-up of their pod's work they can't get from
// My Tasks (their own work) or My Reviews (their action queue) alone.

const BOTTLENECK_DAYS = 3;
const FALLBACK_LOCATION = "DUBAI";

export type TeamMemberLoad = {
  id: string;
  name: string;
  open: number;
  inProgress: number;
  overdue: number;
};

export type LeadDashboardData = {
  hasGroups: boolean;
  reviewCount: number;
  unassignedCount: number;
  flaggedCount: number;
  overdueTasks: DashTask[];
  bottlenecks: DashTask[];
  revisionTasks: DashTask[];
  team: TeamMemberLoad[];
};

export async function getLeadDashboardData(user: CurrentUser): Promise<LeadDashboardData> {
  const now = new Date();

  const groups = await prisma.taskGroup.findMany({
    where: { leadUserId: user.id },
    select: { id: true, podId: true, clusterId: true },
  });

  const empty: LeadDashboardData = {
    hasGroups: false,
    reviewCount: 0,
    unassignedCount: 0,
    flaggedCount: 0,
    overdueTasks: [],
    bottlenecks: [],
    revisionTasks: [],
    team: [],
  };
  if (groups.length === 0) return empty;

  const groupIds = groups.map((g) => g.id);
  const podIds = groups.map((g) => g.podId).filter((id): id is string => id !== null);

  // Top-level, still-open tasks across all the Lead's groups. Subtasks are excluded — they're
  // a private breakdown for one person (PRD 8.2), not group deliverables to track here.
  const tasks = await prisma.task.findMany({
    // Completed projects are hidden from a Lead's day-to-day view.
    where: {
      groupId: { in: groupIds },
      parentTaskId: null,
      status: { not: "COMPLETED" },
      project: { status: { not: "COMPLETED" } },
    },
    include: { assignedTo: { select: { id: true, name: true, location: true } }, project: { select: { name: true } } },
    orderBy: { dueDate: "asc" },
  });

  const toDashTask = (t: (typeof tasks)[number]): DashTask => ({
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
  const bottlenecks: DashTask[] = [];
  const revisionTasks: DashTask[] = [];
  let reviewCount = 0;
  let unassignedCount = 0;
  let flaggedCount = 0;
  const bottleneckCutoff = new Date(now.getTime() - BOTTLENECK_DAYS * 24 * 60 * 60 * 1000);

  // Per-assignee tallies for the Team Workload widget — the piece that's genuinely
  // Lead-specific: who's carrying how much, and who's free to take the next handoff.
  const loadByUser = new Map<string, TeamMemberLoad>();
  const bumpLoad = (id: string, name: string, over: boolean, inProg: boolean) => {
    const row = loadByUser.get(id) ?? { id, name, open: 0, inProgress: 0, overdue: 0 };
    row.open += 1;
    if (inProg) row.inProgress += 1;
    if (over) row.overdue += 1;
    loadByUser.set(id, row);
  };

  for (const t of tasks) {
    const d = toDashTask(t);
    const isLate = d.daysLate !== null && d.daysLate > 0;

    if (t.status === "REVIEW") reviewCount += 1;
    if (t.assignedToId === null) unassignedCount += 1;
    if (t.revisionCount >= 2) flaggedCount += 1;
    if (t.status !== "ON_HOLD" && isLate) overdueTasks.push(d);
    if ((t.status === "IN_PROGRESS" || t.status === "REVIEW") && t.updatedAt < bottleneckCutoff) bottlenecks.push(d);
    if (t.revisionCount >= 1) revisionTasks.push(d);
    if (t.assignedTo) bumpLoad(t.assignedTo.id, t.assignedTo.name, isLate, t.status === "IN_PROGRESS");
  }
  revisionTasks.sort((a, b) => b.revisionCount - a.revisionCount);

  // Team roster = the pod members behind these groups, so people with zero open work still
  // show (capacity at a glance), not only those who currently hold a task.
  if (podIds.length > 0) {
    const members = await prisma.userRole.findMany({
      where: { podId: { in: podIds }, role: { in: ["CONTRIBUTOR", "LEAD"] }, user: { isActive: true } },
      include: { user: { select: { id: true, name: true } } },
      distinct: ["userId"],
    });
    for (const m of members) {
      if (!loadByUser.has(m.user.id)) {
        loadByUser.set(m.user.id, { id: m.user.id, name: m.user.name, open: 0, inProgress: 0, overdue: 0 });
      }
    }
  }

  const team = Array.from(loadByUser.values()).sort(
    (a, b) => b.open - a.open || a.name.localeCompare(b.name),
  );

  return { hasGroups: true, reviewCount, unassignedCount, flaggedCount, overdueTasks, bottlenecks, revisionTasks, team };
}
