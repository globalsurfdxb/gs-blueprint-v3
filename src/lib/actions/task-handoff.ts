"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import {
  canReviewGroupTask,
  canRejectAndReturn,
  canApproveCalendarHandoff,
  canApproveCalendarFinalDelivery,
  DESIGN_POD_NAME,
} from "@/lib/permissions";
import { notifyUsers } from "@/lib/notifications";
import { subtractWorkingDays } from "@/lib/format";
import type { Task, TaskGroup, Pod } from "@/generated/prisma/client";

const handoffSchema = z.object({
  destinationGroupId: z.string().min(1, "Select a destination Task Group."),
  description: z.string().optional(),
  // Required only for an ordinary handoff — a Content Calendar task's Design due date is
  // auto-calculated below and this field is ignored even if present. Nullish because a
  // field the form omits entirely comes through FormData.get() as null, not undefined.
  dueDate: z.string().nullish(),
});

/**
 * Shared by the manual "Share to Another Group" action and the automatic Content
 * Calendar → Design handoff on approve: creates the destination task, carrying the brief
 * and (if present) calendar metadata forward, with a Predecessor link back to the source
 * — the source task is never altered. Computes the Content Calendar Design due-date
 * override itself when the destination is the Design group; callers only need to supply
 * a manual due date for an ordinary handoff.
 */
async function createHandoffTask({
  sourceTask,
  destinationGroup,
  description,
  manualDueDate,
  actingUserId,
}: {
  sourceTask: Task;
  destinationGroup: TaskGroup & { pod: Pod | null };
  description?: string;
  manualDueDate?: string | null;
  actingUserId: string;
}) {
  const isCalendarTask = sourceTask.publishDate !== null && sourceTask.contentTypeId !== null;
  const autoCalculateDesignDueDate = isCalendarTask && destinationGroup.pod?.name === DESIGN_POD_NAME;

  let dueDate: Date;
  if (autoCalculateDesignDueDate) {
    const contentType = await prisma.contentType.findUnique({ where: { id: sourceTask.contentTypeId! } });
    if (!contentType) throw new Error("This task's Content Type no longer exists.");
    dueDate = subtractWorkingDays(sourceTask.publishDate!, contentType.designLeadTimeDays);
  } else {
    if (!manualDueDate) throw new Error("Due date is required.");
    dueDate = new Date(manualDueDate);
  }

  // Bugs are NOT handed off (PRD v1.18): a Bug lives in the single Development Task Group and
  // moves between QA and the fixer by same-group reassignment, so its type/fields and its
  // screenshots stay on the one record — there is no carry-forward. Cross-Group Handoff now
  // only ever moves Standard tasks (e.g. Content → Design), which is what this creates.
  const newTask = await prisma.task.create({
    data: {
      projectId: sourceTask.projectId,
      groupId: destinationGroup.id,
      name: sourceTask.name,
      description: description ?? sourceTask.description,
      priority: sourceTask.priority,
      dueDate,
      publishDate: sourceTask.publishDate,
      contentTypeId: sourceTask.contentTypeId,
      monthlyBriefId: sourceTask.monthlyBriefId,
      predecessorTaskId: sourceTask.id,
      createdById: actingUserId,
      // Unassigned — the receiving Lead assigns it to a member of their own group.
      assignedToId: null,
    },
  });

  return newTask;
}

/**
 * Cross-Group Handoff (continuation, not duplication): from a Completed task, its
 * group's Lead sends the work forward to any other Task Group already attached to the
 * project. v1 is a straight chain: the @unique on Task.predecessorTaskId means a given
 * task can only ever be sent once (enforced below with a friendly error rather than
 * relying on the DB constraint).
 */
export async function sendTaskToNextGroup(taskId: string, formData: FormData) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not signed in.");

  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) throw new Error("Task not found.");
  if (task.status !== "COMPLETED") {
    throw new Error("Only a Completed task can be sent to the next group.");
  }

  const sourceGroup = task.groupId ? await prisma.taskGroup.findUnique({ where: { id: task.groupId } }) : null;
  if (!canReviewGroupTask(user, sourceGroup)) {
    throw new Error("Only this task's group Lead (or Admin) can send it to the next group.");
  }

  const existingSuccessor = await prisma.task.findFirst({ where: { predecessorTaskId: taskId } });
  if (existingSuccessor) {
    throw new Error("This task has already been sent to a next group.");
  }

  const parsed = handoffSchema.safeParse({
    destinationGroupId: formData.get("destinationGroupId"),
    description: formData.get("description") || undefined,
    dueDate: formData.get("dueDate"),
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input.");
  }

  const destinationGroup = await prisma.taskGroup.findUnique({
    where: { id: parsed.data.destinationGroupId },
    include: { pod: true },
  });
  if (!destinationGroup || destinationGroup.projectId !== task.projectId) {
    throw new Error("Destination Task Group not found on this project.");
  }
  if (destinationGroup.id === task.groupId) {
    throw new Error("Choose a different Task Group to hand off to.");
  }

  const newTask = await createHandoffTask({
    sourceTask: task,
    destinationGroup,
    description: parsed.data.description,
    manualDueDate: parsed.data.dueDate,
    actingUserId: user.id,
  });

  await notifyUsers([destinationGroup.leadUserId], {
    type: "TASK_HANDOFF_RECEIVED",
    message: `"${task.name}" was handed off to your ${destinationGroup.name} group, continuing from a completed task${sourceGroup ? ` in ${sourceGroup.name}` : ""}.`,
    relatedTaskId: newTask.id,
    relatedProjectId: task.projectId,
  });

  revalidatePath(`/projects/${task.projectId}`);
  revalidatePath(`/projects/${task.projectId}/tasks/${task.id}`);
}

/**
 * Reject & Return (PRD 8.2.1 v1.22): send a handoff-received task BACK to the group it came
 * from for rework. This is NOT a new workflow — it's the same Cross-Group Handoff mechanism
 * (createHandoffTask: new linked task, brief copied, Predecessor link, "Task Handoff Received"
 * notification) with a different trigger. Two things differ from forward "Send to Next Group":
 * the destination is fixed to the Predecessor's group (not chosen), and it is NOT gated on
 * Completed — a Lead unhappy with received work returns it at any status. Straight-chain rule
 * is unchanged: a task can still only spawn one successor. Rejection context lives in Comments,
 * so there is no reason field. Universal — works for any attached pair, since the destination
 * is simply wherever the Predecessor lives.
 */
export async function rejectAndReturnTask(taskId: string, _formData: FormData) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not signed in.");

  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) throw new Error("Task not found.");
  if (!task.predecessorTaskId) {
    throw new Error("This task didn't arrive via a handoff, so there's nowhere to return it to.");
  }

  const group = task.groupId ? await prisma.taskGroup.findUnique({ where: { id: task.groupId } }) : null;
  if (!canRejectAndReturn(user, group, task)) {
    throw new Error("Only this task's group Lead (or Admin) can reject and return it.");
  }

  // Straight chain (unchanged): a task spawns at most one successor, forward or returned.
  const existingSuccessor = await prisma.task.findFirst({ where: { predecessorTaskId: taskId } });
  if (existingSuccessor) {
    throw new Error("This task has already been sent on to another group.");
  }

  const predecessor = await prisma.task.findUnique({ where: { id: task.predecessorTaskId } });
  if (!predecessor?.groupId) {
    throw new Error("The group this task came from no longer exists.");
  }
  const destinationGroup = await prisma.taskGroup.findUnique({
    where: { id: predecessor.groupId },
    include: { pod: true },
  });
  if (!destinationGroup || destinationGroup.projectId !== task.projectId) {
    throw new Error("The group this task came from is no longer attached to this project.");
  }

  // Reuse the forward-handoff creator verbatim — only the destination and trigger differ.
  // Carry this task's own due date over for the returned rework (createHandoffTask still
  // auto-computes the Design due date for the calendar case, exactly as a forward handoff would).
  const newTask = await createHandoffTask({
    sourceTask: task,
    destinationGroup,
    manualDueDate: task.dueDate.toISOString(),
    actingUserId: user.id,
  });

  await notifyUsers([destinationGroup.leadUserId].filter((id) => id !== user.id), {
    type: "TASK_HANDOFF_RECEIVED",
    message: `"${task.name}" was returned to your ${destinationGroup.name} group for rework.`,
    relatedTaskId: newTask.id,
    relatedProjectId: task.projectId,
  });

  revalidatePath(`/projects/${task.projectId}`);
  revalidatePath(`/projects/${task.projectId}/tasks/${task.id}`);
}

/**
 * Content Calendar → Design handoff: a checkpoint on top of the Content group's own
 * Lead having already approved the work (that's what got the task to Completed in the
 * first place). Only the project's own Social Media Lead — who planned the calendar and
 * owns the Monthly Brief — or Admin can trigger this final sign-off; the Content Lead has
 * no path to send it onward themselves. Destination is always Design for a calendar task,
 * so unlike the generic Share action this needs no destination picker — due date is
 * auto-calculated the same way.
 */
export async function approveCalendarHandoffToDesign(taskId: string, _formData: FormData) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not signed in.");

  const task = await prisma.task.findUnique({ where: { id: taskId }, include: { group: { include: { pod: true } } } });
  if (!task) throw new Error("Task not found.");
  if (task.status !== "COMPLETED") {
    throw new Error("Only a Completed task can be approved for Design.");
  }
  if (task.publishDate === null || task.contentTypeId === null) {
    throw new Error("This task didn't originate from the Content Calendar.");
  }
  if (task.group?.pod?.name === DESIGN_POD_NAME) {
    throw new Error("This task is already in Design — use Approve Final Delivery instead.");
  }
  if (!(await canApproveCalendarHandoff(user, task.projectId))) {
    throw new Error("Only this project's Social Media Lead (or Admin) can approve the handoff to Design.");
  }

  const existingSuccessor = await prisma.task.findFirst({ where: { predecessorTaskId: taskId } });
  if (existingSuccessor) {
    throw new Error("This task has already been sent to Design.");
  }

  const designGroup = await prisma.taskGroup.findFirst({
    where: { projectId: task.projectId, pod: { name: DESIGN_POD_NAME } },
    include: { pod: true },
  });
  if (!designGroup) {
    throw new Error("No Design Task Group is attached to this project yet — attach one before approving.");
  }

  const newTask = await createHandoffTask({ sourceTask: task, destinationGroup: designGroup, actingUserId: user.id });

  await notifyUsers(
    [designGroup.leadUserId].filter((id) => id !== user.id),
    {
      type: "TASK_HANDOFF_RECEIVED",
      message: `"${task.name}" was approved by ${user.name} and handed off to your ${designGroup.name} group.`,
      relatedTaskId: newTask.id,
      relatedProjectId: task.projectId,
    },
  );

  revalidatePath(`/projects/${task.projectId}`);
  revalidatePath(`/projects/${task.projectId}/tasks/${task.id}`);
}

/**
 * Closes the Content Calendar loop: once the Design group's own Lead completes the last
 * task in the chain, the project's Social Media Lead (or Admin) — the same person who
 * approved the earlier Content→Design handoff — gives final sign-off. Design is the
 * terminal stage, so unlike the earlier handoff this creates nothing new; it just stamps
 * the completed Design task as approved.
 */
export async function approveCalendarFinalDelivery(taskId: string, _formData: FormData) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not signed in.");

  const task = await prisma.task.findUnique({ where: { id: taskId }, include: { group: { include: { pod: true } } } });
  if (!task) throw new Error("Task not found.");
  if (task.status !== "COMPLETED") {
    throw new Error("Only a Completed task can be given final approval.");
  }
  if (task.publishDate === null || task.contentTypeId === null) {
    throw new Error("This task didn't originate from the Content Calendar.");
  }
  if (task.group?.pod?.name !== DESIGN_POD_NAME) {
    throw new Error("Final approval applies only to the Design-stage task in this chain.");
  }
  if (task.calendarApprovedAt) {
    throw new Error("This task has already been given final approval.");
  }
  if (!(await canApproveCalendarFinalDelivery(user, task.projectId))) {
    throw new Error("Only this project's Social Media Lead (or Admin) can give final approval.");
  }

  await prisma.task.update({
    where: { id: taskId },
    data: { calendarApprovedAt: new Date(), calendarApprovedById: user.id },
  });

  await notifyUsers(
    [task.group.leadUserId, task.createdById].filter((id) => id !== user.id),
    {
      type: "COMPLETED",
      message: `"${task.name}" received final approval from ${user.name} — the Content Calendar entry is closed out.`,
      relatedTaskId: task.id,
      relatedProjectId: task.projectId,
    },
  );

  revalidatePath(`/projects/${task.projectId}/tasks/${taskId}`);
}
