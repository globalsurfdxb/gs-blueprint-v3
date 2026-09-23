"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { canManageMilestones } from "@/lib/permissions";

// Project Milestones (PRD — agency-wide). A flat, manually-managed, ordered checklist per
// project. All writes gate on canManageMilestones (attached Lead / Cluster Head / Admin / PAM);
// milestones never touch task status and no task touches a milestone.

/** Load the project in the shape canManageMilestones needs, then authorize. */
async function authorizeProject(projectId: string) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not signed in.");
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { taskGroups: { select: { id: true, leadUserId: true, podId: true, pod: { select: { name: true } } } } },
  });
  if (!project) throw new Error("Project not found.");
  if (!canManageMilestones(user, project)) {
    throw new Error("You don't have permission to manage milestones on this project.");
  }
  return project;
}

async function authorizeMilestone(milestoneId: string) {
  const milestone = await prisma.milestone.findUnique({ where: { id: milestoneId } });
  if (!milestone) throw new Error("Milestone not found.");
  await authorizeProject(milestone.projectId);
  return milestone;
}

const upsertSchema = z.object({
  title: z.string().trim().min(1, "Milestone title is required.").max(200),
  dueDate: z.string().min(1, "Due date is required."),
});

export async function createMilestone(projectId: string, formData: FormData) {
  await authorizeProject(projectId);

  const parsed = upsertSchema.safeParse({ title: formData.get("title"), dueDate: formData.get("dueDate") });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid input.");

  // Append to the end of the list.
  const last = await prisma.milestone.findFirst({
    where: { projectId },
    orderBy: { order: "desc" },
    select: { order: true },
  });

  await prisma.milestone.create({
    data: {
      projectId,
      title: parsed.data.title,
      dueDate: new Date(parsed.data.dueDate),
      order: (last?.order ?? 0) + 1,
    },
  });

  revalidatePath(`/projects/${projectId}`);
}

export async function updateMilestone(milestoneId: string, formData: FormData) {
  const milestone = await authorizeMilestone(milestoneId);

  const parsed = upsertSchema.safeParse({ title: formData.get("title"), dueDate: formData.get("dueDate") });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid input.");

  await prisma.milestone.update({
    where: { id: milestoneId },
    data: { title: parsed.data.title, dueDate: new Date(parsed.data.dueDate) },
  });

  revalidatePath(`/projects/${milestone.projectId}`);
}

/** Manual check/uncheck — never computed from task status (PRD guardrail). */
export async function toggleMilestone(milestoneId: string) {
  const milestone = await authorizeMilestone(milestoneId);
  await prisma.milestone.update({
    where: { id: milestoneId },
    data: { completed: !milestone.completed },
  });
  revalidatePath(`/projects/${milestone.projectId}`);
}

export async function deleteMilestone(milestoneId: string) {
  const milestone = await authorizeMilestone(milestoneId);
  await prisma.milestone.delete({ where: { id: milestoneId } });
  revalidatePath(`/projects/${milestone.projectId}`);
}

const reorderSchema = z.object({ direction: z.enum(["up", "down"]) });

/** Move a milestone one position up or down by swapping its order with the adjacent one. */
export async function reorderMilestone(milestoneId: string, formData: FormData) {
  const milestone = await authorizeMilestone(milestoneId);
  const parsed = reorderSchema.safeParse({ direction: formData.get("direction") });
  if (!parsed.success) throw new Error("Invalid input.");

  const neighbor = await prisma.milestone.findFirst({
    where: {
      projectId: milestone.projectId,
      order: parsed.data.direction === "up" ? { lt: milestone.order } : { gt: milestone.order },
    },
    orderBy: { order: parsed.data.direction === "up" ? "desc" : "asc" },
  });
  if (!neighbor) return; // already at the end/start — nothing to swap

  await prisma.$transaction([
    prisma.milestone.update({ where: { id: milestone.id }, data: { order: neighbor.order } }),
    prisma.milestone.update({ where: { id: neighbor.id }, data: { order: milestone.order } }),
  ]);

  revalidatePath(`/projects/${milestone.projectId}`);
}
