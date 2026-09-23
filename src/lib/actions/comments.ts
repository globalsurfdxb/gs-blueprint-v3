"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { canViewTask, isAdmin } from "@/lib/permissions";
import { notifyUsers } from "@/lib/notifications";

const commentSchema = z.object({ text: z.string().min(1, "Comment can't be empty.") });

export async function addComment(projectId: string, taskId: string, formData: FormData) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not signed in.");

  const [project, task] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      // pod.name is needed so canViewTask can evaluate the Social Media cross-group grant
      // (PRD 8.2.2) for calendar-originated Content/Design tasks — Sneha and her Contributors
      // read + comment on that copy. Without it the calendar-pipeline branch can't fire.
      include: { taskGroups: { select: { id: true, leadUserId: true, podId: true, pod: { select: { name: true } } } } },
    }),
    prisma.task.findUnique({ where: { id: taskId } }),
  ]);
  if (!project || !task) throw new Error("Task not found.");

  if (!(await canViewTask(user, project, task))) {
    throw new Error("You don't have access to this task.");
  }

  const parsed = commentSchema.safeParse({ text: formData.get("text") });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid input.");

  const comment = await prisma.comment.create({
    data: { taskId, authorId: user.id, text: parsed.data.text },
  });

  await notifyUsers(
    [task.assignedToId, task.createdById].filter((id) => id !== user.id),
    {
      type: "COMMENT_ADDED",
      message: `New comment on "${task.name}".`,
      relatedTaskId: task.id,
      relatedProjectId: project.id,
    },
  );

  revalidatePath(`/projects/${projectId}/tasks/${taskId}`);
  return comment;
}

export async function editComment(projectId: string, taskId: string, commentId: string, formData: FormData) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not signed in.");

  const comment = await prisma.comment.findUnique({ where: { id: commentId } });
  if (!comment) throw new Error("Comment not found.");
  if (comment.authorId !== user.id) throw new Error("Only the author can edit this comment.");

  const parsed = commentSchema.safeParse({ text: formData.get("text") });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid input.");

  await prisma.comment.update({
    where: { id: commentId },
    data: { text: parsed.data.text, isEdited: true, editedAt: new Date() },
  });

  revalidatePath(`/projects/${projectId}/tasks/${taskId}`);
}

export async function deleteComment(projectId: string, taskId: string, commentId: string, _formData: FormData) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not signed in.");
  if (!isAdmin(user)) throw new Error("Only an Admin can delete comments.");

  await prisma.comment.delete({ where: { id: commentId } });
  revalidatePath(`/projects/${projectId}/tasks/${taskId}`);
}
