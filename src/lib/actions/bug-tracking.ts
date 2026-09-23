"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { canManageBugTracking } from "@/lib/permissions";

const schema = z.object({
  podId: z.string().min(1),
  enabled: z.enum(["true", "false"]),
});

/** Toggle Bug Tracking for one discipline (pod) — Admin only (PRD 8.2.4). */
export async function setPodBugTracking(formData: FormData) {
  const user = await getCurrentUser();
  if (!user || !canManageBugTracking(user)) {
    throw new Error("Only an Admin can manage Bug Tracking settings.");
  }

  const parsed = schema.safeParse({
    podId: formData.get("podId"),
    enabled: formData.get("enabled"),
  });
  if (!parsed.success) throw new Error("Invalid input.");

  await prisma.pod.update({
    where: { id: parsed.data.podId },
    data: { bugTrackingEnabled: parsed.data.enabled === "true" },
  });

  revalidatePath("/admin/bug-tracking");
}
