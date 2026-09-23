import "server-only";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/format";
import type { CurrentUser } from "@/lib/auth";
import { isAdmin, isContributor, isAnyAccountClientServices } from "@/lib/permissions";
import { daysOverdue } from "@/lib/timezone";
import { secondsSince } from "@/lib/format";
import type { Prisma } from "@/generated/prisma/client";

// Reports (PRD 8.9). Rows are scoped to the viewer just like the dashboard: Admin sees the
// whole agency; a Cluster Head their own cluster (a pod-restricted one, their pods); an
// Account/Client Services user their cluster's projects. Export to Excel/PDF is Sprint 4 —
// these are on-screen views only. One role per user keeps the scope resolution unambiguous.

const FALLBACK_LOCATION = "DUBAI";

export type ReportScope = {
  label: string;
  taskWhere: Prisma.TaskWhereInput;
  projectWhere: Prisma.ProjectWhereInput;
};

/**
 * Archived projects (Project.archivedAt set) are hidden from every report, search and
 * dashboard that keys off the report scope. Applied once here, on top of whatever
 * role-scoped where-clause the branches below produce, so no branch has to remember it.
 */
export function getReportScope(user: CurrentUser): ReportScope {
  const raw = getReportScopeRaw(user);
  return {
    label: raw.label,
    taskWhere: { AND: [raw.taskWhere, { project: { archivedAt: null } }] },
    projectWhere: { AND: [raw.projectWhere, { archivedAt: null }] },
  };
}

function getReportScopeRaw(user: CurrentUser): ReportScope {
  if (isAdmin(user)) return { label: "Agency-wide", taskWhere: {}, projectWhere: {} };

  const ch = user.roles.find((r) => r.role === "CLUSTER_HEAD");
  if (ch) {
    const cid = ch.clusterId ?? "";
    const restriction = ch.restrictedPodIds.length > 0 ? ch.restrictedPodIds : null;
    if (restriction) {
      // Pod-restricted Cluster Head: only the work in their own pod(s), wherever it runs.
      return {
        label: ch.cluster?.name ?? "Your cluster",
        taskWhere: { group: { clusterId: cid, podId: { in: restriction } } },
        projectWhere: { taskGroups: { some: { podId: { in: restriction } } } },
      };
    }
    // Unrestricted Cluster Head: the whole of any project their cluster OWNS (home cluster) —
    // including task groups run by other clusters/disciplines on it, so a cross-cluster team
    // (e.g. Design under a PD&CS-owned project) still shows — PLUS their own cluster's groups
    // wherever those contribute to other clusters' projects.
    return {
      label: ch.cluster?.name ?? "Your cluster",
      taskWhere: { OR: [{ project: { clusterId: cid } }, { group: { clusterId: cid } }] },
      projectWhere: { OR: [{ clusterId: cid }, { taskGroups: { some: { clusterId: cid } } }] },
    };
  }

  const acs = user.roles.find((r) => r.role === "ACCOUNT_CLIENT_SERVICES");
  if (acs) {
    const cid = acs.clusterId ?? "";
    return {
      label: acs.cluster?.name ?? "Your cluster",
      taskWhere: { project: { clusterId: cid } },
      projectWhere: { clusterId: cid },
    };
  }

  // A Lead's report scope is the Task Groups they own (across any project), so the Time Logs
  // report shows only their own team's logged time — never another discipline's.
  const lead = user.roles.find((r) => r.role === "LEAD");
  if (lead) {
    return {
      label: "Your team",
      taskWhere: { group: { leadUserId: user.id } },
      projectWhere: { taskGroups: { some: { leadUserId: user.id } } },
    };
  }

  // Not reachable behind the report gates, but fail closed rather than leaking everything.
  return { label: "", taskWhere: { id: "__none__" }, projectWhere: { id: "__none__" } };
}

export type OverdueRow = {
  id: string;
  name: string;
  projectId: string;
  projectName: string;
  assigneeName: string | null;
  dueDate: string;
  daysLate: number;
};

export type OverdueCluster = { clusterName: string; tasks: OverdueRow[] };

export async function getOverdueReport(user: CurrentUser): Promise<OverdueCluster[]> {
  const { taskWhere } = getReportScope(user);
  const now = new Date();

  const tasks = await prisma.task.findMany({
    where: { ...taskWhere, parentTaskId: null, status: { notIn: ["COMPLETED", "ON_HOLD"] } },
    include: {
      assignedTo: { select: { name: true, location: true } },
      project: { select: { id: true, name: true, cluster: { select: { name: true } } } },
    },
    orderBy: { dueDate: "asc" },
  });

  const byCluster = new Map<string, OverdueRow[]>();
  for (const t of tasks) {
    const late = daysOverdue(t.dueDate, t.assignedTo?.location ?? FALLBACK_LOCATION, now);
    if (late === null || late <= 0) continue;
    const row: OverdueRow = {
      id: t.id,
      name: t.name,
      projectId: t.projectId,
      projectName: t.project.name,
      assigneeName: t.assignedTo?.name ?? null,
      dueDate: formatDate(t.dueDate),
      daysLate: late,
    };
    const key = t.project.cluster.name;
    const arr = byCluster.get(key) ?? [];
    arr.push(row);
    byCluster.set(key, arr);
  }

  return Array.from(byCluster.entries())
    .map(([clusterName, rows]) => ({
      clusterName,
      tasks: rows.sort((a, b) => b.daysLate - a.daysLate),
    }))
    .sort((a, b) => a.clusterName.localeCompare(b.clusterName));
}

export type ClientHoursRow = {
  clientId: string;
  clientName: string;
  projectCount: number;
  totalSeconds: number;
};

export async function getTimeByClientReport(user: CurrentUser): Promise<ClientHoursRow[]> {
  const { projectWhere } = getReportScope(user);

  // In-scope projects, keyed to their client — projects with zero logged time still count
  // toward a client's project total so the roster reads completely.
  const projects = await prisma.project.findMany({
    where: projectWhere,
    select: { id: true, clientId: true, client: { select: { name: true } } },
  });
  if (projects.length === 0) return [];

  const clients = new Map<string, ClientHoursRow>();
  const projectToClient = new Map<string, string>();
  for (const p of projects) {
    projectToClient.set(p.id, p.clientId);
    const row = clients.get(p.clientId) ?? {
      clientId: p.clientId,
      clientName: p.client.name,
      projectCount: 0,
      totalSeconds: 0,
    };
    row.projectCount += 1;
    clients.set(p.clientId, row);
  }

  const logs = await prisma.timeLog.findMany({
    where: { task: { projectId: { in: projects.map((p) => p.id) } } },
    select: { durationSeconds: true, startTime: true, task: { select: { projectId: true } } },
  });
  for (const l of logs) {
    const clientId = projectToClient.get(l.task.projectId);
    if (!clientId) continue;
    const row = clients.get(clientId);
    if (!row) continue;
    row.totalSeconds += l.durationSeconds ?? secondsSince(l.startTime);
  }

  return Array.from(clients.values()).sort(
    (a, b) => b.totalSeconds - a.totalSeconds || a.clientName.localeCompare(b.clientName),
  );
}

// ---- Time Logs report (Team Leads + oversight roles) --------------------------------------
// Total logged hours per assignee → per task, filterable by project, assignee, and time
// period. Available to Leads for their own team (getReportScope), and to Admin/CH/ACS at
// their usual scope. A running timer (endTime null) counts its elapsed time so far.

export type TimeLogPeriod = "day" | "week" | "month" | "custom";

export type TimeLogParams = {
  projectId: string;
  assigneeId: string;
  period: TimeLogPeriod;
  from: string; // yyyy-mm-dd (used when period = custom)
  to: string; // yyyy-mm-dd (used when period = custom)
};

export type TimeLogTaskRow = {
  taskId: string;
  taskName: string;
  projectId: string;
  projectName: string;
  clientName: string;
  totalSeconds: number;
};

export type TimeLogAssigneeGroup = {
  userId: string;
  userName: string;
  totalSeconds: number;
  tasks: TimeLogTaskRow[];
};

export type TimeLogReport = {
  fromLabel: string;
  toLabel: string;
  groups: TimeLogAssigneeGroup[];
  grandTotalSeconds: number;
};

/** Filter dropdowns for the Time Logs report, each already narrowed to the viewer's scope. */
export async function getTimeLogFilterOptions(user: CurrentUser) {
  // A Contributor's hours report is self-only: their project options are the projects they've
  // actually logged time on, and the only "assignee" is themselves.
  if (isContributor(user)) {
    const logs = await prisma.timeLog.findMany({
      where: { userId: user.id, task: { project: { archivedAt: null } } },
      select: { task: { select: { project: { select: { id: true, name: true } } } } },
    });
    const projById = new Map<string, string>();
    for (const l of logs) projById.set(l.task.project.id, l.task.project.name);
    const projects = Array.from(projById, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
    return { projects, assignees: [{ id: user.id, name: user.name }] };
  }

  const { taskWhere, projectWhere } = getReportScope(user);

  // Assignees = everyone currently assigned to an in-scope task, UNIONed with anyone who has
  // already logged time in scope (covers reassignments). Deriving only from time logs would
  // hide contributors who are assigned but haven't logged time yet.
  const [projects, taskAssignees, logUsers] = await Promise.all([
    prisma.project.findMany({ where: projectWhere, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.task.findMany({
      where: { ...taskWhere, assignedToId: { not: null } },
      select: { assignedToId: true, assignedTo: { select: { name: true } } },
      distinct: ["assignedToId"],
    }),
    prisma.timeLog.findMany({
      where: { task: taskWhere },
      select: { userId: true, user: { select: { name: true } } },
      distinct: ["userId"],
    }),
  ]);

  const byId = new Map<string, string>();
  for (const t of taskAssignees) if (t.assignedToId) byId.set(t.assignedToId, t.assignedTo!.name);
  for (const l of logUsers) byId.set(l.userId, l.user.name);

  const assignees = Array.from(byId.entries())
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { projects, assignees };
}

/** Resolve a period preset (or a custom from/to) to an inclusive UTC day range. */
function resolveRange(params: TimeLogParams): { start: Date; endExclusive: Date; fromLabel: string; toLabel: string } {
  const now = new Date();
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  let start: Date;
  let endInclusive: Date;

  if (params.period === "custom" && params.from && params.to) {
    start = new Date(`${params.from}T00:00:00Z`);
    endInclusive = new Date(`${params.to}T00:00:00Z`);
    if (endInclusive < start) endInclusive = start;
  } else if (params.period === "day") {
    start = todayUtc;
    endInclusive = todayUtc;
  } else if (params.period === "week") {
    // Monday of the current week through today.
    const dow = (todayUtc.getUTCDay() + 6) % 7; // Mon = 0
    start = new Date(todayUtc);
    start.setUTCDate(start.getUTCDate() - dow);
    endInclusive = todayUtc;
  } else {
    // month (default): 1st of the current month through today.
    start = new Date(Date.UTC(todayUtc.getUTCFullYear(), todayUtc.getUTCMonth(), 1));
    endInclusive = todayUtc;
  }

  const endExclusive = new Date(endInclusive);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  return { start, endExclusive, fromLabel: formatDate(start), toLabel: formatDate(endInclusive) };
}

export async function getTimeLogReport(user: CurrentUser, params: TimeLogParams): Promise<TimeLogReport> {
  const { start, endExclusive, fromLabel, toLabel } = resolveRange(params);

  // Hours report scoping (PRD Timesheet/Hours): ACS is excluded entirely (defensive — the gate
  // already blocks them); a Contributor sees only their OWN logged hours; Lead/Cluster-Head/
  // Admin use their existing task-visibility scope. Only getReportScope's oversight taskWhere is
  // reused — the contributor case is self-only and never touches another person's hours.
  if (isAnyAccountClientServices(user)) {
    return { fromLabel, toLabel, groups: [], grandTotalSeconds: 0 };
  }
  const contributor = isContributor(user);
  const taskFilter: Prisma.TaskWhereInput = contributor
    ? { project: { archivedAt: null } }
    : getReportScope(user).taskWhere;
  const userFilter = contributor
    ? { userId: user.id }
    : params.assigneeId
      ? { userId: params.assigneeId }
      : {};

  const logs = await prisma.timeLog.findMany({
    where: {
      task: { ...taskFilter, ...(params.projectId ? { projectId: params.projectId } : {}) },
      ...userFilter,
      startTime: { gte: start, lt: endExclusive },
    },
    select: {
      durationSeconds: true,
      startTime: true,
      userId: true,
      user: { select: { name: true } },
      task: {
        select: {
          id: true,
          name: true,
          projectId: true,
          project: { select: { name: true, client: { select: { name: true } } } },
        },
      },
    },
  });

  const groups = new Map<string, TimeLogAssigneeGroup>();
  let grandTotalSeconds = 0;

  for (const l of logs) {
    const seconds = l.durationSeconds ?? secondsSince(l.startTime);
    grandTotalSeconds += seconds;

    let group = groups.get(l.userId);
    if (!group) {
      group = { userId: l.userId, userName: l.user.name, totalSeconds: 0, tasks: [] };
      groups.set(l.userId, group);
    }
    group.totalSeconds += seconds;

    let taskRow = group.tasks.find((t) => t.taskId === l.task.id);
    if (!taskRow) {
      taskRow = {
        taskId: l.task.id,
        taskName: l.task.name,
        projectId: l.task.projectId,
        projectName: l.task.project.name,
        clientName: l.task.project.client.name,
        totalSeconds: 0,
      };
      group.tasks.push(taskRow);
    }
    taskRow.totalSeconds += seconds;
  }

  const sortedGroups = Array.from(groups.values())
    .map((g) => ({ ...g, tasks: g.tasks.sort((a, b) => b.totalSeconds - a.totalSeconds) }))
    .sort((a, b) => b.totalSeconds - a.totalSeconds || a.userName.localeCompare(b.userName));

  return { fromLabel, toLabel, groups: sortedGroups, grandTotalSeconds };
}
