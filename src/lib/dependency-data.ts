import "server-only";
import { prisma } from "@/lib/prisma";
import { getTaskRound } from "@/lib/task-chain";
import { isCrossDepartmentTask } from "@/lib/dependency-tracker";
import { isBottleneck } from "@/lib/dashboard";
import { daysOverdue } from "@/lib/timezone";
import type { DependencyGroup, DependencyRow } from "@/components/dependency-project-groups";
import type { TaskStatus } from "@/generated/prisma/client";

// Status sets used by the two Dependency Tracker surfaces: the tracker is an ACTIVE queue
// (completed work is excluded — an ongoing monthly retainer would otherwise pile up), while the
// per-project view shows every status including Completed.
export const ACTIVE_STATUSES = ["NEW", "IN_PROGRESS", "REVIEW", "REVISION", "ON_HOLD"] as const;
export const ALL_STATUSES = [...ACTIVE_STATUSES, "COMPLETED"] as const;

// Generic status labels for the filter dropdowns (row cells use the bug-aware statusLabel).
export const STATUS_LABELS: Record<string, string> = {
  NEW: "New",
  IN_PROGRESS: "In Progress",
  REVIEW: "Review",
  REVISION: "Revision",
  ON_HOLD: "On Hold",
  COMPLETED: "Completed",
};

// --- due-date range helpers (pure YYYY-MM-DD math) shared by both surfaces ---
export const isYmd = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
function ymdToUtc(s: string) { return new Date(`${s}T00:00:00Z`); }
function addDaysStr(s: string, n: number) { const d = ymdToUtc(s); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function startOfWeekStr(s: string) { const mon0 = (ymdToUtc(s).getUTCDay() + 6) % 7; return addDaysStr(s, -mon0); }

/** Resolve the [from,to] due-date window (YYYY-MM-DD, inclusive) for a filter selection. */
export function dueRange(due: string, from: string | undefined, to: string | undefined, todayStr: string): { from: string | null; to: string | null } {
  if (due === "week") {
    const start = startOfWeekStr(todayStr);
    return { from: start, to: addDaysStr(start, 6) };
  }
  if (due === "month") {
    const d = ymdToUtc(todayStr);
    const first = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
    const nextMonthFirst = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
    return { from: first, to: addDaysStr(nextMonthFirst, -1) };
  }
  if (due === "custom") {
    return { from: isYmd(from) ? from : null, to: isYmd(to) ? to : null };
  }
  return { from: null, to: null };
}

/**
 * Load a coordinator's cross-department tasks, grouped by project, applying the shared filters.
 * Cross-department = the task's discipline differs from the project's home discipline (Service
 * Type). Projects with no matching rows are dropped.
 */
export async function loadDependencyGroups(
  userId: string,
  opts: {
    projectId?: string;
    excludeCompleted?: boolean;
    status?: string | null;
    range?: { from: string | null; to: string | null };
  },
): Promise<DependencyGroup[]> {
  const statusWhere = opts.status
    ? { status: opts.status as TaskStatus }
    : opts.excludeCompleted
      ? { status: { not: "COMPLETED" as TaskStatus } }
      : {};

  const projects = await prisma.project.findMany({
    where: {
      dependencyTrackerId: userId,
      archivedAt: null,
      ...(opts.projectId ? { id: opts.projectId } : {}),
    },
    orderBy: { name: "asc" },
    include: {
      client: { select: { name: true } },
      serviceType: { select: { name: true } },
      tasks: {
        where: { parentTaskId: null, ...statusWhere },
        orderBy: { dueDate: "asc" },
        include: {
          group: { select: { name: true, pod: { select: { name: true } } } },
          assignedTo: { select: { name: true } },
        },
      },
    },
  });

  const inRange = (d: Date) => {
    const r = opts.range;
    if (!r || (!r.from && !r.to)) return true;
    const k = d.toISOString().slice(0, 10);
    if (r.from && k < r.from) return false;
    if (r.to && k > r.to) return false;
    return true;
  };

  const groups: DependencyGroup[] = [];
  for (const p of projects) {
    const filtered = p.tasks.filter(
      (t) => isCrossDepartmentTask(p.serviceType.name, t.group?.pod?.name) && inRange(t.dueDate),
    );
    if (filtered.length === 0) continue;
    const rows = await Promise.all(filtered.map(async (t) => ({ task: t, round: await getTaskRound(t) })));
    groups.push({ project: { id: p.id, name: p.name, client: p.client }, rows });
  }
  return groups;
}

// ─────────────────────────────────────────────────────────────────────────────
// KPI band + in-place filtering for the active Dependency Tracker (PRD 8.13, v1.28)
//
// The active tracker home screen loads its full visible universe once — every non-completed
// cross-department task on the coordinator's tracked projects — then derives both the summary
// KPI figures and the filtered list from that same set. This keeps every tile figure and the
// list it filters into strictly consistent (no second query, no divergent visibility logic),
// and guarantees the "Stuck" figure reuses the Section 8.8 bottleneck rule verbatim.
// ─────────────────────────────────────────────────────────────────────────────

export type TrackerRow = {
  project: { id: string; name: string; client: { name: string } };
  task: DependencyRow["task"];
  round: number;
  discipline: string;
  daysLate: number | null; // >0 = overdue; 0 = due today; null = not yet due
  stuck: boolean;
};

/** Flatten the active universe into enriched rows, deriving discipline, days-late (in the
 * viewer's calendar day, matching the list column) and the shared 8.8 "stuck" flag. */
export async function loadActiveTrackerRows(userId: string, viewerLocation: string, now: Date): Promise<TrackerRow[]> {
  const groups = await loadDependencyGroups(userId, { excludeCompleted: true });
  const rows: TrackerRow[] = [];
  for (const g of groups) {
    for (const r of g.rows) {
      rows.push({
        project: g.project,
        task: r.task,
        round: r.round,
        discipline: r.task.group?.pod?.name ?? "Ungrouped",
        daysLate: daysOverdue(r.task.dueDate, viewerLocation, now),
        stuck: isBottleneck(r.task.status, r.task.updatedAt, now),
      });
    }
  }
  return rows;
}

export type TrackerStats = {
  dueThisWeek: number;
  overdue: number;
  stuck: number;
  byDiscipline: { discipline: string; count: number }[];
};

/** Summary figures for the KPI band, computed from the full visible set (independent of the
 * filters currently applied to the list below). Projects Tracked is counted separately by the
 * page — a tracked project with no cross-department tasks still counts. */
export function deriveTrackerStats(rows: TrackerRow[], weekRange: { from: string | null; to: string | null }): TrackerStats {
  const inWeek = (d: Date) => {
    const k = d.toISOString().slice(0, 10);
    return (!weekRange.from || k >= weekRange.from) && (!weekRange.to || k <= weekRange.to);
  };
  const byDiscipline = new Map<string, number>();
  let dueThisWeek = 0;
  let overdue = 0;
  let stuck = 0;
  for (const r of rows) {
    if (inWeek(r.task.dueDate)) dueThisWeek++;
    if (r.daysLate !== null && r.daysLate > 0) overdue++;
    if (r.stuck) stuck++;
    byDiscipline.set(r.discipline, (byDiscipline.get(r.discipline) ?? 0) + 1);
  }
  return {
    dueThisWeek,
    overdue,
    stuck,
    byDiscipline: Array.from(byDiscipline, ([discipline, count]) => ({ discipline, count })).sort(
      (a, b) => b.count - a.count || a.discipline.localeCompare(b.discipline),
    ),
  };
}

export type TrackerFilters = {
  projectId?: string;
  status?: string | null;
  range?: { from: string | null; to: string | null };
  overdue?: boolean;
  discipline?: string;
  stuck?: boolean;
};

/** Apply the active-tracker filters to the pre-loaded rows, then regroup into DependencyGroups
 * for rendering. When the Overdue filter is on, rows sort worst-days-overdue first. */
export function filterTrackerRows(rows: TrackerRow[], f: TrackerFilters): DependencyGroup[] {
  const inRange = (d: Date) => {
    const r = f.range;
    if (!r || (!r.from && !r.to)) return true;
    const k = d.toISOString().slice(0, 10);
    return (!r.from || k >= r.from) && (!r.to || k <= r.to);
  };
  let matched = rows.filter((r) => {
    if (f.projectId && r.project.id !== f.projectId) return false;
    if (f.status && r.task.status !== f.status) return false;
    if (f.overdue && !(r.daysLate !== null && r.daysLate > 0)) return false;
    if (f.discipline && r.discipline !== f.discipline) return false;
    if (f.stuck && !r.stuck) return false;
    if (!inRange(r.task.dueDate)) return false;
    return true;
  });

  if (f.overdue) {
    matched = [...matched].sort((a, b) => (b.daysLate ?? 0) - (a.daysLate ?? 0));
  }

  const byProject = new Map<string, DependencyGroup>();
  for (const r of matched) {
    let g = byProject.get(r.project.id);
    if (!g) {
      g = { project: r.project, rows: [] };
      byProject.set(r.project.id, g);
    }
    g.rows.push({ task: r.task, round: r.round });
  }
  return Array.from(byProject.values());
}
