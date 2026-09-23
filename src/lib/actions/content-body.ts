"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { canEditContentBody, canManageContentBody } from "@/lib/permissions";
import { sanitizeContentBody, isEmptyContentBody, MAX_CONTENT_BODY_CHARS } from "@/lib/content-body";

// Generous raw-input ceiling before sanitizing — real copy is well under this; the cap just
// stops a pathological payload from reaching the sanitizer.
const MAX_RAW_CHARS = MAX_CONTENT_BODY_CHARS * 4;

/**
 * Save a task's Content Body (PRD 8.12). Enforced server-side, not just hidden in the UI:
 *  1. the task's discipline must have Content Body enabled (per-pod toggle), and
 *  2. only the task's current assignee may edit it (same authorship rule as OneDrive links).
 * The submitted HTML is sanitized to the basic-formatting allowlist before storage. Editing
 * overwrites — there is no version history (Revision Count conveys the feedback rounds).
 */
export async function updateContentBody(projectId: string, taskId: string, formData: FormData) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not signed in.");

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { id: true, assignedToId: true, groupId: true },
  });
  if (!task) throw new Error("Task not found.");

  const group = task.groupId
    ? await prisma.taskGroup.findUnique({
        where: { id: task.groupId },
        select: { pod: { select: { contentBodyEnabled: true } } },
      })
    : null;
  if (!group?.pod?.contentBodyEnabled) {
    throw new Error("Content Body isn't enabled for this task's discipline.");
  }

  if (!canEditContentBody(user, task)) {
    throw new Error("Only the task's current assignee can edit the Content Body.");
  }

  const raw = formData.get("contentBody");
  if (typeof raw !== "string") throw new Error("Invalid input.");
  if (raw.length > MAX_RAW_CHARS) throw new Error("Content Body is too long.");

  const clean = sanitizeContentBody(raw);
  const value = isEmptyContentBody(clean) ? null : clean.slice(0, MAX_CONTENT_BODY_CHARS);

  await prisma.task.update({ where: { id: taskId }, data: { contentBody: value } });
  revalidatePath(`/projects/${projectId}/tasks/${taskId}`);
}

const podToggleSchema = z.object({
  podId: z.string().min(1),
  enabled: z.enum(["true", "false"]),
});

/** Toggle the Content Body field for one discipline (pod) — Admin only (PRD 8.12). */
export async function setPodContentBody(formData: FormData) {
  const user = await getCurrentUser();
  if (!user || !canManageContentBody(user)) {
    throw new Error("Only an Admin can manage Content Body settings.");
  }

  const parsed = podToggleSchema.safeParse({
    podId: formData.get("podId"),
    enabled: formData.get("enabled"),
  });
  if (!parsed.success) throw new Error("Invalid input.");

  await prisma.pod.update({
    where: { id: parsed.data.podId },
    data: { contentBodyEnabled: parsed.data.enabled === "true" },
  });

  revalidatePath("/admin/content-body");
}
