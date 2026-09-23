"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { canAdvanceTask, canRecordBugVerdict, canToggleHoldTask } from "@/lib/permissions";
import { notifyUsers } from "@/lib/notifications";
import type { TaskStatus } from "@/generated/prisma/client";

/** Bug-scoped status-change log (PRD 8.2.4 §4): record one row per transition, but ONLY
 * for Bug-type tasks. Standard tasks write nothing — this is deliberately not a general
 * audit log. Records the status the task moved INTO and who did it. */
async function logBugStatusEvent(task: { id: string; taskType: string }, status: TaskStatus, userId: string) {
  if (task.taskType !== "BUG") return;
  await prisma.taskStatusEvent.create({ data: { taskId: task.id, status, changedById: userId } });
}

async function loadTaskWithGroup(taskId: string) {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) throw new Error("Task not found.");
  const project = await prisma.project.findUnique({ where: { id: task.projectId } });
  if (!project) throw new Error("Project not found.");
  const group = task.groupId
    ? await prisma.taskGroup.findUnique({
        where: { id: task.groupId },
        include: { pod: { select: { bugTrackingEnabled: true } } },
      })
    : null;
  return { task, project, group };
}

/** Close any timer still running on a task, stamping the given instant as its end so the
 * logged duration is accurate. Used whenever a task leaves an actively-worked state —
 * Completed (approval) or On Hold (a deliberate pause) — since neither should keep
 * accruing time. */
async function stopOpenTimers(taskId: string, at: Date) {
  const openLogs = await prisma.timeLog.findMany({ where: { taskId, endTime: null } });
  for (const log of openLogs) {
    await prisma.timeLog.update({
      where: { id: log.id },
      data: {
        endTime: at,
        durationSeconds: Math.max(0, Math.round((at.getTime() - log.startTime.getTime()) / 1000)),
      },
    });
  }
}

export async function startTask(taskId: string, _formData: FormData) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not signed in.");
  const { task, project } = await loadTaskWithGroup(taskId);

  if (!canAdvanceTask(user, task)) throw new Error("Only the assignee can start this task.");
  if (task.status !== "NEW") throw new Error("Task is not in New status.");

  await prisma.task.update({ where: { id: taskId }, data: { status: "IN_PROGRESS" } });
  await logBugStatusEvent(task, "IN_PROGRESS", user.id);
  revalidatePath(`/projects/${project.id}/tasks/${taskId}`);
}

export async function submitForReview(taskId: string, _formData: FormData) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not signed in.");
  const { task, project, group } = await loadTaskWithGroup(taskId);

  if (!canAdvanceTask(user, task)) throw new Error("Only the assignee can submit this task for review.");
  if (task.status !== "IN_PROGRESS") throw new Error("Task is not In Progress.");

  await prisma.task.update({ where: { id: taskId }, data: { status: "REVIEW" } });
  await logBugStatusEvent(task, "REVIEW", user.id);

  if (group) {
    await notifyUsers([group.leadUserId], {
      type: "SUBMITTED_FOR_REVIEW",
      message: `"${task.name}" was submitted for review by ${user.name}.`,
      relatedTaskId: task.id,
      relatedProjectId: project.id,
    });
  }

  revalidatePath(`/projects/${project.id}/tasks/${taskId}`);
}

export async function approveTask(taskId: string, _formData: FormData) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not signed in.");
  const { task, project, group } = await loadTaskWithGroup(taskId);

  // Bugs (PRD v1.18): a Contributor member of a Bug-Tracking group can close the bug after
  // retesting; the Lead/Admin always can. Standard tasks stay strictly Lead-only.
  const verdictGroup = group ? { ...group, bugTrackingEnabled: group.pod?.bugTrackingEnabled } : null;
  if (!canRecordBugVerdict(user, verdictGroup, task)) {
    throw new Error("Only this task's group Lead can approve it.");
  }
  if (task.status !== "REVIEW") throw new Error("Task is not in Review.");

  const completedAt = new Date();
  await prisma.task.update({
    where: { id: taskId },
    data: { status: "COMPLETED", completedAt },
  });

  await logBugStatusEvent(task, "COMPLETED", user.id);

  // A Completed task can't keep accruing time — auto-stop any timer still running on it
  // (the assignee may have left it running when the Lead approved the work).
  await stopOpenTimers(taskId, completedAt);

  await notifyUsers([task.createdById, group?.leadUserId], {
    type: "COMPLETED",
    message: `"${task.name}" was marked Completed.`,
    relatedTaskId: task.id,
    relatedProjectId: project.id,
  });

  // Content Calendar tasks do NOT auto-forward to Design on this approval — that's the
  // Content group's own Lead signing off on their team's work, not final clearance. The
  // project's Social Media Lead (or Admin) still has to explicitly approve the handoff
  // to Design (see approveCalendarHandoffToDesign) before it moves on.
  revalidatePath(`/projects/${project.id}/tasks/${taskId}`);
}

export async function sendToRevision(taskId: string, _formData: FormData) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not signed in.");
  const { task, project, group } = await loadTaskWithGroup(taskId);

  // Bugs (PRD v1.18): a Contributor member of a Bug-Tracking group can reopen the bug after a
  // failed retest; the Lead/Admin always can. Standard tasks stay strictly Lead-only.
  const verdictGroup = group ? { ...group, bugTrackingEnabled: group.pod?.bugTrackingEnabled } : null;
  if (!canRecordBugVerdict(user, verdictGroup, task)) {
    throw new Error("Only this task's group Lead can send it to revision.");
  }
  if (task.status !== "REVIEW") throw new Error("Task is not in Review.");

  // Revision is momentary by design (PRD 8.3): increment the count and land back
  // in In Progress in the same operation, rather than resting in a REVISION status.
  await prisma.task.update({
    where: { id: taskId },
    data: { status: "IN_PROGRESS", revisionCount: { increment: 1 } },
  });
  // For a Bug this is the "Reopened" moment — logged as REVISION even though the task then
  // rests in In Progress (revision is momentary; the Reopen Count captures the tally).
  await logBugStatusEvent(task, "REVISION", user.id);

  if (group) {
    await notifyUsers([group.leadUserId], {
      type: "MOVED_TO_REVISION",
      message: `"${task.name}" was sent to revision.`,
      relatedTaskId: task.id,
      relatedProjectId: project.id,
    });
  }

  revalidatePath(`/projects/${project.id}/tasks/${taskId}`);
}

const HOLDABLE_STATUSES = ["NEW", "IN_PROGRESS", "REVIEW"] as const;

export async function putTaskOnHold(taskId: string, _formData: FormData) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not signed in.");
  const { task, project, group } = await loadTaskWithGroup(taskId);

  if (!canToggleHoldTask(user, group)) throw new Error("Only this task's group Lead can put it on hold.");
  if (!HOLDABLE_STATUSES.includes(task.status as typeof HOLDABLE_STATUSES[number])) {
    throw new Error("Task can't be put on hold from its current status.");
  }

  await prisma.task.update({
    where: { id: taskId },
    data: { status: "ON_HOLD", onHoldFromStatus: task.status },
  });
  await logBugStatusEvent(task, "ON_HOLD", user.id);

  // On Hold is a deliberate pause — a paused task shouldn't keep the clock running.
  // Any running timer stops now; the assignee starts a fresh one when work resumes.
  await stopOpenTimers(taskId, new Date());

  revalidatePath(`/projects/${project.id}/tasks/${taskId}`);
}

export async function resumeTaskFromHold(taskId: string, _formData: FormData) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not signed in.");
  const { task, project, group } = await loadTaskWithGroup(taskId);

  if (!canToggleHoldTask(user, group)) throw new Error("Only this task's group Lead can resume it.");
  if (task.status !== "ON_HOLD" || !task.onHoldFromStatus) {
    throw new Error("Task is not on hold.");
  }

  await prisma.task.update({
    where: { id: taskId },
    data: { status: task.onHoldFromStatus, onHoldFromStatus: null },
  });
  await logBugStatusEvent(task, task.onHoldFromStatus, user.id);
  revalidatePath(`/projects/${project.id}/tasks/${taskId}`);
}

/**
 * Kanban drag-and-drop (PRD 8.11) is NOT a new status path — it's a thin adapter that maps a
 * card moving between columns onto the SAME transition actions the list/detail view already
 * uses, so every permission and status guard is enforced in exactly one place. Only the four
 * moves that correspond to a real transition are accepted; any other drag (backward, skipping
 * a step, out of On Hold, an unknown column) is rejected here and the card snaps back. The
 * called action re-checks authority (assignee to advance; Lead/Admin — or a bug Contributor —
 * to approve/reopen), so a drag can never do something the same user couldn't do from the list.
 *
 * `surfacePath` is the board's own route (e.g. /projects/<id> or /my-tasks) so it re-renders
 * after the move — the underlying action already revalidates the task's detail page.
 */
export async function changeTaskStatusByDrag(taskId: string, targetStatus: string, surfacePath: string) {
  const { task } = await loadTaskWithGroup(taskId);
  const move = `${task.status}->${targetStatus}`;
  const formData = new FormData();

  switch (move) {
    case "NEW->IN_PROGRESS":
      await startTask(taskId, formData);
      break;
    case "IN_PROGRESS->REVIEW":
      await submitForReview(taskId, formData);
      break;
    case "REVIEW->COMPLETED":
      await approveTask(taskId, formData);
      break;
    // Dragging a card in Review back to In Progress is a reject/reopen — the same
    // momentary Revision transition (Reopen for a Bug), which lands back in In Progress.
    case "REVIEW->IN_PROGRESS":
      await sendToRevision(taskId, formData);
      break;
    default:
      throw new Error("That isn't a valid status move — drop it on the next step in the workflow.");
  }

  revalidatePath(surfacePath);
}
