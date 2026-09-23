import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { statusLabel } from "@/lib/bug";
import { getTaskRound } from "@/lib/task-chain";
import { isCrossDepartmentTask } from "@/lib/dependency-tracker";
import { formatDate, formatDateTime } from "@/lib/format";
import { daysOverdue } from "@/lib/timezone";

/**
 * Read-only task view for a Dependency Tracker (PRD 8.13, v1.26). Deliberately a dedicated
 * screen, NOT the normal task detail page — so none of that page's controls (comment box, edit,
 * status, reassign, create) can ever render for this viewer. Shows exactly what the spec allows:
 * task name, status, due date, Round indicator, and the Comments thread — with NO reply box.
 * Stricter than the Social Media cross-group grant (8.2.2), which does allow commenting.
 *
 * Access is gated to the project's Dependency Tracker AND to CROSS-department tasks (discipline
 * differs from the project's home discipline, its Service Type). A subtask or a home-discipline
 * task 404s — a Dependency Tracker must never reach one.
 */
export default async function DependencyTaskPage({ params }: { params: Promise<{ taskId: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { taskId } = await params;
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      project: { select: { id: true, name: true, dependencyTrackerId: true, archivedAt: true, serviceType: { select: { name: true } }, client: { select: { name: true } } } },
      group: { select: { name: true, pod: { select: { name: true } } } },
      assignedTo: { select: { name: true } },
      predecessorTask: { select: { id: true, name: true, group: { select: { name: true } } } },
      successorTask: { select: { id: true, name: true, group: { select: { name: true } } } },
      comments: { include: { author: { select: { name: true } } }, orderBy: { createdAt: "asc" } },
    },
  });

  // Not found, not this user's tracked project, archived, a subtask, or a home-discipline task
  // → 404. A Dependency Tracker only ever reaches this project's cross-department tasks.
  if (!task) notFound();
  if (task.project.dependencyTrackerId !== user.id || task.project.archivedAt) notFound();
  if (task.parentTaskId !== null) notFound();
  if (!isCrossDepartmentTask(task.project.serviceType.name, task.group?.pod?.name)) notFound();

  const round = await getTaskRound(task);
  // Days overdue: for a completed task, how late it was actually finished (completedAt vs due);
  // for a still-open one, days past due to today.
  const lateDays = daysOverdue(task.dueDate, user.location, task.completedAt ?? new Date());
  const overdue = lateDays !== null && lateDays > 0;

  return (
    <div className="max-w-3xl">
      <p className="text-sm text-gs-gray">
        <Link href="/dependencies/tracker" className="hover:underline">Dependency Tracker</Link>
        {" › "}
        {task.project.name} <span className="text-gs-gray">· {task.project.client.name}</span>
      </p>

      <div className="mt-1 flex items-center gap-2">
        <h1 className="text-xl font-semibold">{task.name}</h1>
        {task.taskType === "BUG" && (
          <span className="rounded-full bg-gs-red/10 px-2 py-0.5 text-xs font-semibold uppercase text-gs-red">Bug</span>
        )}
      </div>

      <div className="mt-2 flex items-center gap-2">
        {(task.predecessorTask || task.successorTask) && (
          <span className="rounded-full bg-gs-black/5 px-2.5 py-0.5 text-xs font-semibold uppercase text-gs-black">Round {round}</span>
        )}
        <span className="text-xs text-gs-gray">
          {task.group?.pod?.name ? `${task.group.pod.name} · ` : ""}view only
        </span>
      </div>

      {(task.predecessorTask || task.successorTask) && (
        <div className="mt-4 flex flex-col gap-2 text-sm sm:flex-row">
          {task.predecessorTask && (
            <div className="flex-1 rounded-lg border border-gs-gray/15 bg-gs-light px-4 py-3">
              <p className="text-xs uppercase text-gs-gray">
                Predecessor{task.predecessorTask.group ? ` · ${task.predecessorTask.group.name}` : ""}
              </p>
              <p className="font-medium">{task.predecessorTask.name}</p>
            </div>
          )}
          {task.successorTask && (
            <div className="flex-1 rounded-lg border border-gs-gray/15 bg-gs-light px-4 py-3">
              <p className="text-xs uppercase text-gs-gray">
                Successor{task.successorTask.group ? ` · ${task.successorTask.group.name}` : ""}
              </p>
              <p className="font-medium">{task.successorTask.name}</p>
            </div>
          )}
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-4 rounded-lg border border-gs-gray/15 bg-white p-6 text-sm sm:grid-cols-3">
        <div>
          <p className="text-xs uppercase text-gs-gray">Task Group</p>
          <p className="font-medium">{task.group?.name ?? "—"}</p>
        </div>
        <div>
          <p className="text-xs uppercase text-gs-gray">Owner</p>
          <p className="font-medium">{task.assignedTo?.name ?? "Unassigned"}</p>
        </div>
        <div>
          <p className="text-xs uppercase text-gs-gray">Status</p>
          <p className="font-medium">{statusLabel(task.status, task.taskType)}</p>
        </div>
        <div>
          <p className="text-xs uppercase text-gs-gray">Assigned</p>
          <p className="font-medium">{formatDate(task.createdAt)}</p>
        </div>
        <div>
          <p className="text-xs uppercase text-gs-gray">Due Date</p>
          <p className="font-medium">
            {formatDate(task.dueDate)}
            {overdue && (
              <span className="ml-1 text-gs-red">· {lateDays} day{lateDays === 1 ? "" : "s"} overdue</span>
            )}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase text-gs-gray">Reopens</p>
          <p className="font-medium">{task.revisionCount}</p>
        </div>
      </div>

      <div className="mt-6">
        <h2 className="text-sm font-semibold uppercase text-gs-gray">Comments</h2>
        {task.comments.length === 0 ? (
          <p className="mt-2 text-sm text-gs-gray">No comments yet.</p>
        ) : (
          <div className="mt-2 flex flex-col gap-3">
            {task.comments.map((c) => (
              <div key={c.id} className="rounded-lg border border-gs-gray/15 bg-white px-4 py-3 text-sm">
                <p className="text-xs text-gs-gray">
                  {c.author.name} · {formatDateTime(c.createdAt)}{c.isEdited ? " · edited" : ""}
                </p>
                <p className="mt-1 whitespace-pre-wrap">{c.text}</p>
              </div>
            ))}
          </div>
        )}
        <p className="mt-3 text-xs text-gs-gray">
          View only — follow up with the task&apos;s Lead directly to request changes.
        </p>
      </div>
    </div>
  );
}
