import "server-only";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/format";
import type { CurrentUser } from "@/lib/auth";
import { getReportScope } from "@/lib/reports";
import type { Prisma, TaskStatus } from "@/generated/prisma/client";

// Search & Filters (PRD 8.10): free-text across project and task names, plus filters by
// Client, Project, Status, Assigned To, and Due Date range. Results are scoped to the
// viewer via the same rules as Reports (getReportScope) — a cross-project search surface
// is an oversight capability, so it's gated to Admin / Cluster Head / Account-Client-Services
// (canSearch). Leads and Contributors work from My Tasks / My Reviews instead.

export type SearchParams = {
  q?: string;
  clientId?: string;
  projectId?: string;
  status?: string;
  assignedToId?: string;
  dueFrom?: string;
  dueTo?: string;
  timer?: string; // "running" | "notrunning" | undefined
  sort?: string; // "newest" | "oldest" | "due" | "updated"
  taskType?: string; // "STANDARD" | "BUG" | undefined
  severity?: string; // "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" — only meaningful with taskType=BUG
  sprint?: string; // "active" | "backlog" | a specific sprintId — PRD 8.14, Sprint-enabled scope only
};

export const SORT_OPTIONS = [
  { value: "due", label: "Due Date" },
  { value: "newest", label: "Newest First" },
  { value: "oldest", label: "Oldest First" },
  { value: "updated", label: "Recently Updated" },
] as const;

const SORT_ORDER_BY: Record<string, Prisma.TaskOrderByWithRelationInput[]> = {
  due: [{ dueDate: "asc" }],
  newest: [{ createdAt: "desc" }],
  oldest: [{ createdAt: "asc" }],
  updated: [{ updatedAt: "desc" }],
};

export type SearchResult = {
  id: string;
  name: string;
  parentName: string | null;
  projectId: string;
  projectName: string;
  clientName: string;
  status: string;
  assigneeName: string | null;
  dueDate: string;
  taskType: string;
  severity: string | null;
};

export type SearchFilterOptions = {
  clients: { id: string; name: string }[];
  projects: { id: string; name: string }[];
  assignees: { id: string; name: string }[];
  // Agile Sprint Workflow (PRD 8.14): the Sprint filter appears only when Sprint-enabled work
  // is in the viewer's scope. `sprints` lists specific sprints they can filter to.
  sprints: { id: string; label: string }[];
  sprintWorkflowInScope: boolean;
};

const STATUS_VALUES: TaskStatus[] = ["NEW", "IN_PROGRESS", "REVIEW", "REVISION", "COMPLETED", "ON_HOLD"];

/** Dropdown option lists, each already narrowed to the viewer's scope so a filter can never
 * surface a client/project/person outside what their results could contain. */
export async function getSearchFilterOptions(user: CurrentUser): Promise<SearchFilterOptions> {
  const { projectWhere, taskWhere } = getReportScope(user);

  const projects = await prisma.project.findMany({
    where: projectWhere,
    select: { id: true, name: true, client: { select: { id: true, name: true } } },
    orderBy: { name: "asc" },
  });

  const clientsById = new Map<string, { id: string; name: string }>();
  for (const p of projects) clientsById.set(p.client.id, { id: p.client.id, name: p.client.name });

  // Assignees are the distinct people actually holding a task in scope — not the whole
  // directory, so the filter only offers names that can return a row.
  const assigneeRows = await prisma.task.findMany({
    where: { ...taskWhere, assignedToId: { not: null } },
    select: { assignedTo: { select: { id: true, name: true } } },
    distinct: ["assignedToId"],
  });
  const assignees = assigneeRows
    .map((r) => r.assignedTo)
    .filter((a): a is { id: string; name: string } => a !== null)
    .sort((a, b) => a.name.localeCompare(b.name));

  // Sprint options (PRD 8.14) — scoped to the viewer's projects; labelled with their project
  // to disambiguate a cross-project list. The filter only surfaces where Sprint Workflow is on.
  const [sprintRows, sprintEnabledGroupCount] = await Promise.all([
    prisma.sprint.findMany({
      where: { project: projectWhere },
      select: { id: true, name: true, project: { select: { name: true } } },
      orderBy: [{ project: { name: "asc" } }, { startDate: "asc" }],
    }),
    prisma.taskGroup.count({ where: { project: projectWhere, pod: { sprintWorkflowEnabled: true } } }),
  ]);

  return {
    clients: Array.from(clientsById.values()).sort((a, b) => a.name.localeCompare(b.name)),
    projects: projects.map((p) => ({ id: p.id, name: p.name })),
    assignees,
    sprints: sprintRows.map((s) => ({ id: s.id, label: `${s.name} · ${s.project.name}` })),
    sprintWorkflowInScope: sprintEnabledGroupCount > 0,
  };
}

export async function runSearch(user: CurrentUser, params: SearchParams): Promise<SearchResult[]> {
  const { taskWhere } = getReportScope(user);
  const and: Prisma.TaskWhereInput[] = [taskWhere];

  const q = params.q?.trim();
  if (q) {
    and.push({
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { project: { name: { contains: q, mode: "insensitive" } } },
      ],
    });
  }
  if (params.clientId) and.push({ project: { clientId: params.clientId } });
  if (params.projectId) and.push({ projectId: params.projectId });
  if (params.status && STATUS_VALUES.includes(params.status as TaskStatus)) {
    and.push({ status: params.status as TaskStatus });
  }
  if (params.assignedToId) and.push({ assignedToId: params.assignedToId });

  // Timer Status filter (PRD 8.10): "running" = has an open time log; "notrunning" = none.
  if (params.timer === "running") and.push({ timeLogs: { some: { endTime: null } } });
  else if (params.timer === "notrunning") and.push({ timeLogs: { none: { endTime: null } } });

  // QA / Bug Tracking filters (PRD 8.2.4 §6): Task Type, and Severity when filtering to Bug.
  if (params.taskType === "BUG" || params.taskType === "STANDARD") {
    and.push({ taskType: params.taskType });
  }
  if (params.taskType === "BUG" && params.severity && ["CRITICAL", "HIGH", "MEDIUM", "LOW"].includes(params.severity)) {
    and.push({ severity: params.severity as "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" });
  }

  // Sprint filter (PRD 8.14): Active Sprint, Backlog (Sprint-enabled but unsprinted), or a
  // specific sprint. A planning filter only — never affects a task's own workflow.
  if (params.sprint === "active") {
    and.push({ sprint: { status: "ACTIVE" } });
  } else if (params.sprint === "backlog") {
    and.push({ sprintId: null, group: { pod: { sprintWorkflowEnabled: true } } });
  } else if (params.sprint) {
    and.push({ sprintId: params.sprint });
  }

  // Date range is inclusive on both ends; a bare "to" of 2026-07-20 should include tasks
  // due that whole day, so compare against the day boundary.
  const dueDate: Prisma.DateTimeFilter = {};
  if (params.dueFrom) dueDate.gte = new Date(`${params.dueFrom}T00:00:00.000Z`);
  if (params.dueTo) dueDate.lte = new Date(`${params.dueTo}T23:59:59.999Z`);
  if (dueDate.gte || dueDate.lte) and.push({ dueDate });

  const orderBy = SORT_ORDER_BY[params.sort ?? "due"] ?? SORT_ORDER_BY.due;

  const tasks = await prisma.task.findMany({
    where: { AND: and },
    include: {
      parentTask: { select: { name: true } },
      assignedTo: { select: { name: true } },
      project: { select: { id: true, name: true, client: { select: { name: true } } } },
    },
    orderBy,
    take: 200,
  });

  return tasks.map((t) => ({
    id: t.id,
    name: t.name,
    parentName: t.parentTask?.name ?? null,
    projectId: t.projectId,
    projectName: t.project.name,
    clientName: t.project.client.name,
    status: t.status,
    assigneeName: t.assignedTo?.name ?? null,
    dueDate: formatDate(t.dueDate),
    taskType: t.taskType,
    severity: t.severity,
  }));
}
