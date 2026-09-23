"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { canEditTaskAttributes } from "@/lib/permissions";

// Post-creation edits to a task's planning attributes — Priority and (for Bugs) Severity —
// introduced with the Dev/QA quick-edit drawer (PRD Agile Sprint enhancement). Gated by
// canEditTaskAttributes (group Lead / oversight / Admin). No other field, workflow, or
// permission is affected.

const PRIORITY_VALUES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
const SEVERITY_VALUES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;

async function loadTaskForAttrEdit(taskId: string) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { project: true, group: { select: { leadUserId: true, podId: true } } },
  });
  if (!task) throw new Error("Task not found.");
  return task;
}

const prioritySchema = z.object({ priority: z.enum(PRIORITY_VALUES) });

export async function setTaskPriority(taskId: string, formData: FormData) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not signed in.");

  const task = await loadTaskForAttrEdit(taskId);
  if (!canEditTaskAttributes(user, task.project, task.group)) {
    throw new Error("You don't have permission to change this task's priority.");
  }

  const parsed = prioritySchema.safeParse({ priority: formData.get("priority") });
  if (!parsed.success) throw new Error("Invalid priority.");

  await prisma.task.update({ where: { id: taskId }, data: { priority: parsed.data.priority } });

  revalidatePath(`/projects/${task.projectId}/tasks/${taskId}`);
  revalidatePath(`/projects/${task.projectId}`);
}

const severitySchema = z.object({ severity: z.enum(SEVERITY_VALUES) });

export async function setTaskSeverity(taskId: string, formData: FormData) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not signed in.");

  const task = await loadTaskForAttrEdit(taskId);
  if (task.taskType !== "BUG") {
    throw new Error("Severity only applies to Bugs.");
  }
  if (!canEditTaskAttributes(user, task.project, task.group)) {
    throw new Error("You don't have permission to change this bug's severity.");
  }

  const parsed = severitySchema.safeParse({ severity: formData.get("severity") });
  if (!parsed.success) throw new Error("Invalid severity.");

  await prisma.task.update({ where: { id: taskId }, data: { severity: parsed.data.severity } });

  revalidatePath(`/projects/${task.projectId}/tasks/${taskId}`);
  revalidatePath(`/projects/${task.projectId}`);
}
