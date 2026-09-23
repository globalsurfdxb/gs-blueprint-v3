"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { canLogTime, canEditTimeLog } from "@/lib/permissions";
import { localInputToUtc } from "@/lib/timezone";

export async function startTimer(projectId: string, taskId: string, _formData: FormData) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not signed in.");

  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) throw new Error("Task not found.");
  if (!canLogTime(user, task)) throw new Error("Only the assignee can log time on this task.");
  // A Completed task is closed work — no new time can be logged against it (the UI already
  // hides Start once a task leaves In Progress; this enforces it server-side too).
  if (task.status === "COMPLETED") throw new Error("This task is completed — time can no longer be logged on it.");

  const now = new Date();

  // One active timer per user at a time — auto-stop whatever else is running (PRD v1.1 decision #6).
  const openLog = await prisma.timeLog.findFirst({
    where: { userId: user.id, endTime: null },
  });
  if (openLog) {
    const durationSeconds = Math.max(0, Math.round((now.getTime() - openLog.startTime.getTime()) / 1000));
    await prisma.timeLog.update({
      where: { id: openLog.id },
      data: { endTime: now, durationSeconds },
    });
  }

  await prisma.timeLog.create({
    data: { taskId, userId: user.id, startTime: now },
  });

  revalidatePath(`/projects/${projectId}/tasks/${taskId}`);
  if (openLog) revalidatePath(`/projects/${projectId}/tasks/${openLog.taskId}`);
}

export async function stopTimer(projectId: string, taskId: string, _formData: FormData) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not signed in.");

  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) throw new Error("Task not found.");
  if (!canLogTime(user, task)) throw new Error("Only the assignee can log time on this task.");

  const openLog = await prisma.timeLog.findFirst({
    where: { taskId, userId: user.id, endTime: null },
  });
  if (!openLog) throw new Error("No timer is running on this task.");

  const now = new Date();
  const durationSeconds = Math.max(0, Math.round((now.getTime() - openLog.startTime.getTime()) / 1000));
  await prisma.timeLog.update({
    where: { id: openLog.id },
    data: { endTime: now, durationSeconds },
  });

  revalidatePath(`/projects/${projectId}/tasks/${taskId}`);
}

const editTimeLogSchema = z.object({
  startTime: z.string().min(1, "Start time is required."),
  endTime: z.string().min(1, "End time is required."),
  reason: z.string().trim().min(1, "A reason for the edit is required."),
});

/**
 * Cluster-Head-only correction of a logged time entry (PRD 8.4). Deliberately tighter than
 * any other authority: not the Contributor who logged it, not the group Lead. Requires a
 * mandatory reason and snapshots the original values so the edit is visibly flagged, never a
 * silent overwrite. Only closed entries (a stopped timer) are editable.
 */
export async function editTimeLog(projectId: string, taskId: string, timeLogId: string, formData: FormData) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not signed in.");

  const log = await prisma.timeLog.findUnique({
    where: { id: timeLogId },
    include: { task: { include: { project: true } } },
  });
  if (!log || log.taskId !== taskId) throw new Error("Time entry not found.");
  if (log.endTime === null) throw new Error("Stop the running timer before editing this entry.");

  const group = log.task.groupId
    ? await prisma.taskGroup.findUnique({ where: { id: log.task.groupId }, select: { leadUserId: true, podId: true } })
    : null;
  if (!canEditTimeLog(user, log.task.project, group)) {
    throw new Error("Only this cluster's Cluster Head can edit a logged time entry.");
  }

  const parsed = editTimeLogSchema.safeParse({
    startTime: formData.get("startTime"),
    endTime: formData.get("endTime"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid input.");

  // datetime-local values are read as the editing Cluster Head's own wall-clock, converted
  // back to the true UTC instant for storage (PRD 9.5 — everything is stored UTC).
  const newStart = localInputToUtc(parsed.data.startTime, user.location);
  const newEnd = localInputToUtc(parsed.data.endTime, user.location);
  if (newEnd.getTime() <= newStart.getTime()) throw new Error("End time must be after start time.");
  const newDuration = Math.round((newEnd.getTime() - newStart.getTime()) / 1000);

  await prisma.timeLog.update({
    where: { id: log.id },
    data: {
      startTime: newStart,
      endTime: newEnd,
      durationSeconds: newDuration,
      editedAt: new Date(),
      editedById: user.id,
      editReason: parsed.data.reason,
      // Snapshot the originals only on the FIRST edit, so repeated edits keep the true original.
      ...(log.editedAt
        ? {}
        : {
            originalStartTime: log.startTime,
            originalEndTime: log.endTime,
            originalDurationSeconds: log.durationSeconds,
          }),
    },
  });

  revalidatePath(`/projects/${projectId}/tasks/${taskId}`);
}
