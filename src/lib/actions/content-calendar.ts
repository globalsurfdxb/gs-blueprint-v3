"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { canManageContentCalendar, canViewContentCalendar, SOCIAL_MEDIA_POD_NAME, CONTENT_POD_NAME } from "@/lib/permissions";
import { subtractWorkingDays, formatDate } from "@/lib/format";
import { notifyUsers } from "@/lib/notifications";
import { getLocalDateString } from "@/lib/timezone";

const calendarEntrySchema = z.object({
  publishDate: z.string().min(1, "Publish Date is required."),
  title: z.string().min(1, "Topic/Title is required."),
  contentTypeId: z.string().min(1, "Content Type is required."),
});

/**
 * Adding a calendar entry auto-creates its Content task: Due Date = Publish Date −
 * Content Lead Time for the chosen Content Type. The Social Media Lead plans the
 * calendar and owns the Monthly Brief, but the task itself is created in the project's
 * Content Task Group (a distinct production stage, e.g. Hamna's discipline) — unassigned,
 * so that group's own Lead delegates it to one of their Contributors via the existing
 * Assign flow, the same as receiving any other cross-team hand-off.
 */
export async function createCalendarEntry(projectId: string, formData: FormData) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not signed in.");

  const socialMediaGroup = await prisma.taskGroup.findFirst({
    where: { projectId, pod: { name: SOCIAL_MEDIA_POD_NAME } },
  });
  if (!canManageContentCalendar(user, socialMediaGroup)) {
    throw new Error("Only this project's Social Media Lead (or Admin) can add to the Content Calendar.");
  }
  if (!socialMediaGroup) {
    throw new Error("No Social Media Task Group is attached to this project yet.");
  }

  const contentGroup = await prisma.taskGroup.findFirst({
    where: { projectId, pod: { name: CONTENT_POD_NAME } },
  });
  if (!contentGroup) {
    throw new Error("No Content Task Group is attached to this project yet — attach one before adding calendar entries.");
  }

  const parsed = calendarEntrySchema.safeParse({
    publishDate: formData.get("publishDate"),
    title: formData.get("title"),
    contentTypeId: formData.get("contentTypeId"),
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input.");
  }

  const contentType = await prisma.contentType.findUnique({ where: { id: parsed.data.contentTypeId } });
  if (!contentType) throw new Error("Content Type not found.");

  const publishDate = new Date(parsed.data.publishDate);
  const dueDate = subtractWorkingDays(publishDate, contentType.contentLeadTimeDays);

  // The chosen Publish Date must leave enough runway for this Content Type's own lead
  // time — if the Content team's Due Date would already be in the past, there's no real
  // window left to produce the work. Checked in the Social Media Lead's own local day, same
  // as every other date comparison in the app (see daysOverdue).
  const todayStr = getLocalDateString(user.location, new Date());
  if (dueDate.toISOString().slice(0, 10) < todayStr) {
    throw new Error(
      `That Publish Date doesn't leave enough lead time for "${contentType.name}" (needs ${contentType.contentLeadTimeDays} days before publish) — choose a later Publish Date or a faster Content Type.`,
    );
  }

  const monthlyBrief = await prisma.monthlyBrief.findUnique({
    where: {
      projectId_month_year: { projectId, month: publishDate.getMonth() + 1, year: publishDate.getFullYear() },
    },
  });

  const task = await prisma.task.create({
    data: {
      projectId,
      groupId: contentGroup.id,
      name: parsed.data.title,
      dueDate,
      publishDate,
      contentTypeId: contentType.id,
      monthlyBriefId: monthlyBrief?.id,
      createdById: user.id,
      // Unassigned — the Content group's own Lead delegates via the existing assign flow.
      assignedToId: null,
    },
  });

  await notifyUsers([contentGroup.leadUserId].filter((id) => id !== user.id), {
    type: "TASK_ASSIGNED",
    message: `A new Content Calendar entry "${task.name}" was added to your Content group.`,
    relatedTaskId: task.id,
    relatedProjectId: projectId,
  });

  revalidatePath(`/content-calendar/${projectId}`);
  revalidatePath(`/projects/${projectId}`);
  return task;
}

const updateDateSchema = z.object({
  publishDate: z.string().min(1, "Publish Date is required."),
});

/**
 * Reschedule an existing calendar entry's Publish Date. Same authority (the project's Social
 * Media Lead, or Admin) and the same working-day lead-time rule as creating one — the Content
 * Due Date is recomputed from the new date, and the entry is re-linked to the destination
 * month's Monthly Brief. Locked once the entry is Completed (by then it's been approved and
 * handed to Design, so its date is fixed).
 */
export async function updateCalendarEntryDate(projectId: string, taskId: string, formData: FormData) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not signed in.");

  const socialMediaGroup = await prisma.taskGroup.findFirst({
    where: { projectId, pod: { name: SOCIAL_MEDIA_POD_NAME } },
  });
  if (!canManageContentCalendar(user, socialMediaGroup)) {
    throw new Error("Only this project's Social Media Lead (or Admin) can change a calendar entry's date.");
  }

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { contentType: true, group: { select: { leadUserId: true } } },
  });
  if (!task || task.projectId !== projectId || !task.contentTypeId || !task.publishDate || !task.contentType) {
    throw new Error("Calendar entry not found.");
  }
  // Editable while the post is still New or In Progress; locked once Completed (produced and
  // handed off to Design). The lead-time rule below then governs the new date.
  if (task.status === "COMPLETED") {
    throw new Error("This post has been produced and handed off — its Publish Date can no longer be changed.");
  }
  const todayStr = getLocalDateString(user.location, new Date());

  const parsed = updateDateSchema.safeParse({ publishDate: formData.get("publishDate") });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input.");
  }

  const publishDate = new Date(parsed.data.publishDate);
  const dueDate = subtractWorkingDays(publishDate, task.contentType.contentLeadTimeDays);

  if (dueDate.toISOString().slice(0, 10) < todayStr) {
    throw new Error(
      `That Publish Date doesn't leave enough lead time for "${task.contentType.name}" (needs ${task.contentType.contentLeadTimeDays} working days before publish) — choose a later Publish Date.`,
    );
  }

  // Re-link to the destination month's brief (or clear it if that month has none yet).
  const monthlyBrief = await prisma.monthlyBrief.findUnique({
    where: {
      projectId_month_year: { projectId, month: publishDate.getMonth() + 1, year: publishDate.getFullYear() },
    },
  });

  await prisma.task.update({
    where: { id: task.id },
    data: { publishDate, dueDate, monthlyBriefId: monthlyBrief?.id ?? null },
  });

  // Let the Content team know the deadline moved.
  await notifyUsers([task.group?.leadUserId, task.assignedToId].filter((id): id is string => !!id && id !== user.id), {
    type: "TASK_ASSIGNED",
    message: `Publish Date for "${task.name}" changed — new Due Date is ${formatDate(dueDate)}.`,
    relatedTaskId: task.id,
    relatedProjectId: projectId,
  });

  revalidatePath(`/content-calendar/${projectId}`);
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/tasks/${task.id}`);
}

const updateTitleSchema = z.object({
  title: z.string().min(1, "Topic/Title is required."),
});

/**
 * Edit a calendar entry's Topic/Title. Open to anyone who can view the calendar — the Social
 * Media Lead, Admin, and the overseeing Cluster Head (Ashna) — while the entry is still in
 * production. Locked once Completed (its content has been produced and handed off, so the
 * topic no longer has enough runway to change).
 */
export async function updateCalendarEntryTitle(projectId: string, taskId: string, formData: FormData) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not signed in.");

  const socialMediaGroup = await prisma.taskGroup.findFirst({
    where: { projectId, pod: { name: SOCIAL_MEDIA_POD_NAME } },
  });
  if (!canViewContentCalendar(user, socialMediaGroup)) {
    throw new Error("You don't have access to this Content Calendar.");
  }

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { projectId: true, contentTypeId: true, publishDate: true, status: true },
  });
  if (!task || task.projectId !== projectId || !task.contentTypeId || !task.publishDate) {
    throw new Error("Calendar entry not found.");
  }
  // Editable while New or In Progress; locked once Completed (produced and handed off).
  if (task.status === "COMPLETED") {
    throw new Error("This post has been produced and handed off — its topic can no longer be changed.");
  }

  const parsed = updateTitleSchema.safeParse({ title: formData.get("title") });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input.");
  }

  await prisma.task.update({ where: { id: taskId }, data: { name: parsed.data.title } });

  revalidatePath(`/content-calendar/${projectId}`);
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/tasks/${taskId}`);
}
