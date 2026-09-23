import { Fragment } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/format";
import { daysOverdue, getLocalDateString, addDays } from "@/lib/timezone";
import { hidesCompletedProjects } from "@/lib/permissions";
import { statusLabel } from "@/lib/bug";
import { TaskViews, type ViewTask } from "@/components/task-views";
import { TaskDrawerProvider, TaskOpener } from "@/components/task-drawer";

export default async function MyTasksPage({
  searchParams,
}: {
  searchParams: Promise<{ sprint?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { sprint: sprintParam = "" } = await searchParams;

  const now = new Date();
  const allTasks = await prisma.task.findMany({
    where: {
      assignedToId: user.id,
      status: { not: "COMPLETED" },
      project: {
        // Archived projects drop out for everyone.
        archivedAt: null,
        // Leads/Contributors don't see work under a Completed project.
        ...(hidesCompletedProjects(user) ? { status: { not: "COMPLETED" } } : {}),
      },
    },
    include: {
      project: { include: { client: true } },
      parentTask: true,
      group: { select: { pod: { select: { sprintWorkflowEnabled: true } } } },
      sprint: { select: { id: true, name: true, status: true } },
    },
    orderBy: { dueDate: "asc" },
  });

  // Sprint filter (PRD 8.14) — cross-project, shown only when the user has any Sprint-enabled
  // work. Options: Active Sprint, Backlog (Sprint-enabled but unsprinted), or a specific past
  // (Completed) Sprint the user has tasks in. Invisible for anyone with no Sprint-enabled tasks.
  const sprintWorkflowRelevant = allTasks.some((t) => t.group?.pod?.sprintWorkflowEnabled);
  const pastSprints = Array.from(
    new Map(
      allTasks
        .filter((t) => t.sprint?.status === "COMPLETED")
        .map((t) => [t.sprint!.id, { id: t.sprint!.id, name: t.sprint!.name }]),
    ).values(),
  ).sort((a, b) => a.name.localeCompare(b.name));

  const validSprintFilter =
    sprintParam === "active" || sprintParam === "backlog" || pastSprints.some((s) => s.id === sprintParam)
      ? sprintParam
      : "";

  const tasks = !validSprintFilter
    ? allTasks
    : allTasks.filter((t) => {
        if (validSprintFilter === "active") return t.sprint?.status === "ACTIVE";
        if (validSprintFilter === "backlog") return !!t.group?.pod?.sprintWorkflowEnabled && !t.sprintId;
        return t.sprintId === validSprintFilter;
      });

  // Tasks with a live timer, surfaced in the list (PRD 8.2.3). Only the assignee logs time,
  // so for this per-user view a task is "running" iff this user has an open timer on it.
  const runningLogs = await prisma.timeLog.findMany({
    where: { endTime: null, userId: user.id },
    select: { taskId: true },
  });
  const runningTaskIds = new Set(runningLogs.map((l) => l.taskId));

  // Flat task set for the Kanban/Calendar renderings — the exact same tasks the list shows
  // (already scoped to this user's own assignments; switching view never widens that). dueKey
  // uses the UTC calendar components, matching what formatDate displays.
  const viewTasks: ViewTask[] = tasks.map((t) => ({
    id: t.id,
    projectId: t.projectId,
    name: t.name,
    status: t.status,
    onHoldFromStatus: t.onHoldFromStatus ?? null,
    taskType: t.taskType,
    priority: t.priority,
    revisionCount: t.revisionCount,
    assigneeName: null,
    isTimerRunning: runningTaskIds.has(t.id),
    inActiveSprint: t.sprint?.status === "ACTIVE",
    dueKey: `${t.dueDate.getUTCFullYear()}-${String(t.dueDate.getUTCMonth() + 1).padStart(2, "0")}-${String(t.dueDate.getUTCDate()).padStart(2, "0")}`,
    dueLabel: formatDate(t.dueDate),
    // My Tasks is cross-project — show which project each card belongs to (final build).
    projectName: t.project.name,
  }));
  const todayKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;

  type Row = (typeof tasks)[number];

  // Subtasks nest under their parent, never a flattened standalone row (PRD 8.2.3). Within
  // this per-user view the parent may not itself be assigned to the user — it's then shown
  // as a dimmed context row so the subtask still reads as a child, not a top-level item.
  const byProject = new Map<
    string,
    { project: Row["project"]; parents: { parent: Row; isOwn: boolean; children: Row[]; contextNote?: string }[] }
  >();

  for (const t of tasks) {
    const bucket = byProject.get(t.projectId) ?? { project: t.project, parents: [] };
    byProject.set(t.projectId, bucket);
  }

  for (const [projectId, bucket] of byProject) {
    const projectTasks = tasks.filter((t) => t.projectId === projectId);
    const ownTopLevel = projectTasks.filter((t) => t.parentTaskId === null);
    const ownSubs = projectTasks.filter((t) => t.parentTaskId !== null);
    const ownTopLevelIds = new Set(ownTopLevel.map((t) => t.id));

    // Own top-level tasks, each with any of the user's own subtasks nested beneath.
    for (const parent of ownTopLevel) {
      bucket.parents.push({
        parent,
        isOwn: true,
        children: ownSubs.filter((s) => s.parentTaskId === parent.id),
      });
    }
    // Subtasks whose parent isn't the user's own → group under a dimmed context parent.
    const orphanSubs = ownSubs.filter((s) => s.parentTaskId && !ownTopLevelIds.has(s.parentTaskId));
    const contextGroups = new Map<string, Row[]>();
    for (const s of orphanSubs) {
      const arr = contextGroups.get(s.parentTaskId!) ?? [];
      arr.push(s);
      contextGroups.set(s.parentTaskId!, arr);
    }
    for (const [, children] of contextGroups) {
      // Accurate context label: the parent may be hidden here because it's the user's own
      // COMPLETED task (My Tasks excludes Completed), NOT because it belongs to someone else.
      const p = children[0].parentTask;
      const contextNote =
        p && p.assignedToId === user.id
          ? p.status === "COMPLETED"
            ? "completed"
            : "not in your active tasks"
          : "not assigned to you";
      bucket.parents.push({ parent: children[0], isOwn: false, children, contextNote });
    }
  }

  // --- Bucketed view: Overdue / Today / Tomorrow / This Week / Later / No Due Date ---
  // A personal daily-planning regroup of the SAME already-visible tasks by Due Date. "Today" is
  // the user's local calendar day (same rule as overdue/due-tomorrow, PRD 9.5); "This Week" is
  // the remaining days through the Sunday that ends the current Mon–Sun week; "Later" is beyond
  // it. Due Date is a required field, so "No Due Date" only ever appears defensively.
  const todayStr = getLocalDateString(user.location, now);
  const tomorrowStr = addDays(todayStr, 1);
  const dowSun0 = new Date(`${todayStr}T00:00:00Z`).getUTCDay(); // 0=Sun … 6=Sat
  const sundayStr = addDays(todayStr, (7 - dowSun0) % 7); // Sunday ending this week (today if Sun)

  type BucketKey = "overdue" | "today" | "tomorrow" | "week" | "later" | "none";
  const BUCKETS: { key: BucketKey; label: string }[] = [
    { key: "overdue", label: "Overdue" },
    { key: "today", label: "Today" },
    { key: "tomorrow", label: "Tomorrow" },
    { key: "week", label: "This Week" },
    { key: "later", label: "Later" },
    { key: "none", label: "No Due Date" },
  ];
  function bucketOf(t: Row): BucketKey {
    if (!t.dueDate) return "none";
    const d = t.dueDate.toISOString().slice(0, 10);
    if (d < todayStr) return "overdue";
    if (d === todayStr) return "today";
    if (d === tomorrowStr) return "tomorrow";
    if (d <= sundayStr) return "week";
    return "later";
  }
  const bucketed = new Map<BucketKey, Row[]>(BUCKETS.map((b) => [b.key, []]));
  for (const t of tasks) bucketed.get(bucketOf(t))!.push(t); // tasks already sorted by dueDate asc

  function OverdueBadge({ dueDate, status }: { dueDate: Date; status: string }) {
    if (status === "COMPLETED") return null;
    const late = daysOverdue(dueDate, user!.location, now);
    if (late === null) return null;
    return (
      <span className={late > 0 ? "ml-1 text-gs-red" : "ml-1 text-gs-gray"}>
        ({late} day{late === 1 ? "" : "s"})
      </span>
    );
  }

  function TaskCells({ t, indent }: { t: Row; indent: boolean }) {
    return (
      <>
        <td className="px-4 py-2" style={indent ? { paddingLeft: "2rem" } : undefined}>
          <span className="inline-flex items-center">
            {indent && <span className="mr-1 text-gs-gray/50">└</span>}
            <TaskOpener taskId={t.id} projectId={t.projectId} className="font-medium hover:underline">
              {t.name}
            </TaskOpener>
            {t.taskType === "BUG" && (
              <span className="ml-2 rounded-full bg-gs-red/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-gs-red">
                Bug
              </span>
            )}
            {runningTaskIds.has(t.id) && (
              <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-gs-red/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-gs-red">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-gs-red" aria-hidden />
                Running
              </span>
            )}
          </span>
        </td>
        <td className="whitespace-nowrap px-4 py-2 text-gs-gray">
          {formatDate(t.dueDate)}
          <OverdueBadge dueDate={t.dueDate} status={t.status} />
        </td>
        <td className="whitespace-nowrap px-4 py-2 text-gs-gray">{t.priority}</td>
        <td className="whitespace-nowrap px-4 py-2 text-gs-gray">{statusLabel(t.status, t.taskType)}</td>
        <td className="px-4 py-2">
          <span
            className={
              t.revisionCount >= 2 ? "text-gs-red" : t.revisionCount === 1 ? "text-amber-600" : "text-gs-gray"
            }
          >
            {t.revisionCount}
          </span>
        </td>
      </>
    );
  }

  function BucketRow({ t }: { t: Row }) {
    return (
      <tr className="border-t border-gs-gray/10">
        <td className="px-4 py-2">
          <span className="inline-flex items-center">
            <TaskOpener taskId={t.id} projectId={t.projectId} className="font-medium hover:underline">{t.name}</TaskOpener>
            {t.taskType === "BUG" && (
              <span className="ml-2 rounded-full bg-gs-red/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-gs-red">Bug</span>
            )}
            {runningTaskIds.has(t.id) && (
              <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-gs-red/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-gs-red">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-gs-red" aria-hidden />
                Running
              </span>
            )}
          </span>
        </td>
        <td className="whitespace-nowrap px-4 py-2 text-gs-gray">{t.project.name}</td>
        <td className="whitespace-nowrap px-4 py-2 text-gs-gray">
          {formatDate(t.dueDate)}
          <OverdueBadge dueDate={t.dueDate} status={t.status} />
        </td>
        <td className="whitespace-nowrap px-4 py-2 text-gs-gray">{t.priority}</td>
        <td className="whitespace-nowrap px-4 py-2 text-gs-gray">{statusLabel(t.status, t.taskType)}</td>
      </tr>
    );
  }

  const bucketedContent = (
    <div className="flex flex-col gap-6">
      {/* Count strip — the full bucket set at a glance (No Due Date shown only if any exist). */}
      <div className="flex flex-wrap gap-2">
        {BUCKETS.filter((b) => b.key !== "none" || bucketed.get("none")!.length > 0).map((b) => {
          const n = bucketed.get(b.key)!.length;
          return (
            <span
              key={b.key}
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                b.key === "overdue" && n > 0 ? "bg-gs-red/10 text-gs-red" : "bg-gs-black/5 text-gs-gray"
              }`}
            >
              {b.label}: {n}
            </span>
          );
        })}
      </div>

      {tasks.length === 0 ? (
        <p className="text-sm text-gs-gray">
          {validSprintFilter ? "No tasks match this Sprint filter." : "Nothing assigned to you yet."}
        </p>
      ) : (
        BUCKETS.map((b) => {
          const rows = bucketed.get(b.key)!;
          if (rows.length === 0) return null;
          return (
            <div key={b.key}>
              <h2 className={`text-sm font-semibold ${b.key === "overdue" ? "text-gs-red" : ""}`}>
                {b.label} <span className="font-normal text-gs-gray">· {rows.length}</span>
              </h2>
              <div className="mt-2 overflow-hidden rounded-lg border border-gs-gray/15 bg-white">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-sm">
                    <thead className="bg-gs-light text-left text-xs uppercase text-gs-gray">
                      <tr>
                        <th className="whitespace-nowrap px-4 py-2">Task</th>
                        <th className="whitespace-nowrap px-4 py-2">Project</th>
                        <th className="whitespace-nowrap px-4 py-2">Due Date</th>
                        <th className="whitespace-nowrap px-4 py-2">Priority</th>
                        <th className="whitespace-nowrap px-4 py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((t) => (
                        <BucketRow key={t.id} t={t} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">My Tasks</h1>
        {sprintWorkflowRelevant && (
          <form method="get" className="flex items-center gap-2">
            <label htmlFor="sprint" className="text-xs font-medium text-gs-gray">Sprint</label>
            <select
              id="sprint"
              name="sprint"
              defaultValue={validSprintFilter}
              className="min-h-9 rounded-md border border-gs-gray/30 px-2 text-sm"
            >
              <option value="">All tasks</option>
              <option value="active">Active Sprint</option>
              <option value="backlog">Backlog</option>
              {pastSprints.length > 0 && (
                <optgroup label="Past Sprints">
                  {pastSprints.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </optgroup>
              )}
            </select>
            <button type="submit" className="flex min-h-9 items-center rounded-md border border-gs-gray/30 px-3 text-xs font-medium hover:bg-gs-light">Apply</button>
          </form>
        )}
      </div>

      <div className="mt-6">
        <TaskDrawerProvider>
        <TaskViews
          surfacePath="/my-tasks"
          tasks={viewTasks}
          todayKey={todayKey}
          sprintFilterEnabled={sprintWorkflowRelevant}
          extraView={{ mode: "buckets", label: "By Due Date", content: bucketedContent }}
        >
          {byProject.size === 0 && (
            <p className="text-sm text-gs-gray">
              {validSprintFilter ? "No tasks match this Sprint filter." : "Nothing assigned to you yet."}
            </p>
          )}

          <div className="flex flex-col gap-6">
            {Array.from(byProject.values()).map(({ project, parents }) => (
          <div key={project.id}>
            <h2 className="text-sm font-semibold">
              {project.name} <span className="text-gs-gray">· {project.client.name}</span>
            </h2>
            <div className="mt-2 overflow-hidden rounded-lg border border-gs-gray/15 bg-white">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead className="bg-gs-light text-left text-xs uppercase text-gs-gray">
                    <tr>
                      <th className="whitespace-nowrap px-4 py-2">Task</th>
                      <th className="whitespace-nowrap px-4 py-2">Due Date</th>
                      <th className="whitespace-nowrap px-4 py-2">Priority</th>
                      <th className="whitespace-nowrap px-4 py-2">Status</th>
                      <th className="whitespace-nowrap px-4 py-2">Revisions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parents.map(({ parent, isOwn, children, contextNote }) => (
                      <Fragment key={isOwn ? parent.id : `ctx-${parent.parentTaskId}`}>
                        {isOwn ? (
                          <tr className="border-t border-gs-gray/10">
                            <TaskCells t={parent} indent={false} />
                          </tr>
                        ) : (
                          <tr className="border-t border-gs-gray/10">
                            <td className="px-4 py-2 text-gs-gray" colSpan={5}>
                              <Link
                                href={`/projects/${parent.projectId}/tasks/${parent.parentTaskId}`}
                                className="italic hover:underline"
                              >
                                {parent.parentTask?.name ?? "Parent task"}
                              </Link>
                              <span className="ml-1 text-xs">({contextNote})</span>
                            </td>
                          </tr>
                        )}
                        {children.map((c) => (
                          <tr key={c.id} className="border-t border-gs-gray/10">
                            <TaskCells t={c} indent />
                          </tr>
                        ))}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ))}
          </div>
        </TaskViews>
        </TaskDrawerProvider>
      </div>
    </div>
  );
}
