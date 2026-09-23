"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { canManageSprints } from "@/lib/permissions";
import type { SprintStatus } from "@/generated/prisma/client";

// Sprint management (PRD 8.14). All actions gate on canManageSprints — Lead of a Sprint-enabled
// group on the project, its Cluster Head, or Admin. A Sprint is project-scoped; its dates are set
// at creation and locked once it goes Active until it completes.

const SPRINT_STATUSES = ["PLANNED", "ACTIVE", "COMPLETED"] as const;

/** Load a project with the shape canManageSprints needs, plus its Sprint-enabled groups. */
async function loadProjectForSprintAuth(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { taskGroups: { include: { pod: { select: { name: true, sprintWorkflowEnabled: true } } } } },
  });
  if (!project) return null;
  const sprintEnabledGroups = project.taskGroups.filter((g) => g.pod?.sprintWorkflowEnabled);
  return { project, sprintEnabledGroups };
}

const createSchema = z
  .object({
    name: z.string().trim().min(1, "Sprint name is required.").max(120),
    startDate: z.string().min(1, "Start date is required."),
    endDate: z.string().min(1, "End date is required."),
  })
  .refine((d) => new Date(d.endDate) >= new Date(d.startDate), {
    message: "End date must be on or after the start date.",
    path: ["endDate"],
  });

export async function createSprint(projectId: string, formData: FormData) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not authenticated.");

  const loaded = await loadProjectForSprintAuth(projectId);
  if (!loaded) throw new Error("Project not found.");
  if (loaded.sprintEnabledGroups.length === 0) {
    throw new Error("Sprint Workflow is not enabled for any discipline on this project.");
  }
  if (!canManageSprints(user, loaded.project, loaded.sprintEnabledGroups)) {
    throw new Error("You don't have permission to manage Sprints on this project.");
  }

  const parsed = createSchema.safeParse({
    name: formData.get("name"),
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid input.");

  await prisma.sprint.create({
    data: {
      projectId,
      name: parsed.data.name,
      startDate: new Date(parsed.data.startDate),
      endDate: new Date(parsed.data.endDate),
      createdById: user.id,
    },
  });

  revalidatePath(`/projects/${projectId}`);
}

const updateSchema = z
  .object({
    name: z.string().trim().min(1, "Sprint name is required.").max(120),
    startDate: z.string().min(1, "Start date is required."),
    endDate: z.string().min(1, "End date is required."),
  })
  .refine((d) => new Date(d.endDate) >= new Date(d.startDate), {
    message: "End date must be on or after the start date.",
    path: ["endDate"],
  });

/** Edit a Sprint's name and dates. Dates can only change while the Sprint is still Planned —
 * once Active they're locked until it completes (PRD 8.14). */
export async function updateSprint(sprintId: string, formData: FormData) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not authenticated.");

  const sprint = await prisma.sprint.findUnique({ where: { id: sprintId } });
  if (!sprint) throw new Error("Sprint not found.");

  const loaded = await loadProjectForSprintAuth(sprint.projectId);
  if (!loaded || !canManageSprints(user, loaded.project, loaded.sprintEnabledGroups)) {
    throw new Error("You don't have permission to manage Sprints on this project.");
  }

  const parsed = updateSchema.safeParse({
    name: formData.get("name"),
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid input.");

  const datesLocked = sprint.status !== "PLANNED";
  await prisma.sprint.update({
    where: { id: sprintId },
    data: {
      name: parsed.data.name,
      ...(datesLocked
        ? {}
        : { startDate: new Date(parsed.data.startDate), endDate: new Date(parsed.data.endDate) }),
    },
  });

  revalidatePath(`/projects/${sprint.projectId}`);
}

const statusSchema = z.object({ status: z.enum(SPRINT_STATUSES) });

export async function setSprintStatus(sprintId: string, formData: FormData) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not authenticated.");

  const sprint = await prisma.sprint.findUnique({ where: { id: sprintId } });
  if (!sprint) throw new Error("Sprint not found.");

  const loaded = await loadProjectForSprintAuth(sprint.projectId);
  if (!loaded || !canManageSprints(user, loaded.project, loaded.sprintEnabledGroups)) {
    throw new Error("You don't have permission to manage Sprints on this project.");
  }

  const parsed = statusSchema.safeParse({ status: formData.get("status") });
  if (!parsed.success) throw new Error("Invalid status.");

  await prisma.sprint.update({
    where: { id: sprintId },
    data: { status: parsed.data.status as SprintStatus },
  });

  revalidatePath(`/projects/${sprint.projectId}`);
}

const taskSprintSchema = z.object({ sprintId: z.string() });

/**
 * Assign a task to a Sprint or move it back to Backlog (empty value). The task's group must
 * belong to a Sprint-enabled discipline, and the Sprint (if any) must belong to the same
 * project. Never a workflow gate — this only sets a planning field.
 */
export async function setTaskSprint(taskId: string, formData: FormData) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not authenticated.");

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { group: { include: { pod: { select: { sprintWorkflowEnabled: true } } } } },
  });
  if (!task) throw new Error("Task not found.");
  if (!task.group?.pod?.sprintWorkflowEnabled) {
    throw new Error("Sprint Workflow is not enabled for this task's discipline.");
  }

  const loaded = await loadProjectForSprintAuth(task.projectId);
  if (!loaded || !canManageSprints(user, loaded.project, loaded.sprintEnabledGroups)) {
    throw new Error("You don't have permission to assign Sprints on this project.");
  }

  const parsed = taskSprintSchema.safeParse({ sprintId: formData.get("sprintId") ?? "" });
  if (!parsed.success) throw new Error("Invalid input.");

  const newSprintId = parsed.data.sprintId || null;
  if (newSprintId) {
    const sprint = await prisma.sprint.findUnique({ where: { id: newSprintId }, select: { projectId: true } });
    if (!sprint || sprint.projectId !== task.projectId) {
      throw new Error("That Sprint doesn't belong to this project.");
    }
  }

  await prisma.task.update({ where: { id: taskId }, data: { sprintId: newSprintId } });

  revalidatePath(`/projects/${task.projectId}/tasks/${taskId}`);
  revalidatePath(`/projects/${task.projectId}`);
}
