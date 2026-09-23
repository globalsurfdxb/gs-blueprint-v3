"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { canSetTeamCapacity } from "@/lib/permissions";

// Team Capacity (hrs/wk) — a static planned-capacity number at the Task Group level, for
// Development/QA teams only (PRD Agile Sprint enhancement). Admin/Cluster Head only. Blank
// clears it. Purely a stored figure for the (still-held) Utilization report — no calculation
// is performed against it here.

const schema = z.object({
  // Empty string clears the capacity; otherwise a non-negative number (hours per week).
  capacity: z
    .string()
    .trim()
    .refine((v) => v === "" || (!Number.isNaN(Number(v)) && Number(v) >= 0), {
      message: "Capacity must be a non-negative number, or blank to clear it.",
    }),
});

export async function setTeamCapacity(groupId: string, formData: FormData) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not signed in.");

  const group = await prisma.taskGroup.findUnique({
    where: { id: groupId },
    include: { project: true, pod: { select: { sprintWorkflowEnabled: true } } },
  });
  if (!group) throw new Error("Task Group not found.");

  // Development/QA only — the same discipline gate the Sprint Workflow uses.
  if (!group.pod?.sprintWorkflowEnabled) {
    throw new Error("Capacity is only available for Development/QA teams.");
  }
  if (!canSetTeamCapacity(user, group.project, group)) {
    throw new Error("Only an Admin or the team's Cluster Head can set Team Capacity.");
  }

  const parsed = schema.safeParse({ capacity: formData.get("capacity") ?? "" });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid input.");

  await prisma.taskGroup.update({
    where: { id: groupId },
    data: { capacityHoursPerWeek: parsed.data.capacity === "" ? null : Number(parsed.data.capacity) },
  });

  revalidatePath(`/projects/${group.projectId}`);
}
