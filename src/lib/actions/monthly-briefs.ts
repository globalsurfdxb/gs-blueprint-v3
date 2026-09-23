"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { canManageContentCalendar, SOCIAL_MEDIA_POD_NAME } from "@/lib/permissions";

const monthlyBriefSchema = z.object({
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(2000).max(2100),
  text: z.string().min(1, "Monthly Brief can't be empty."),
});

/** One brief per Project + Month + Year, owned by that project's own Social Media Task
 * Group Lead (or Admin) — created on first save, edited in place on every save after. */
export async function upsertMonthlyBrief(projectId: string, formData: FormData) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not signed in.");

  const socialMediaGroup = await prisma.taskGroup.findFirst({
    where: { projectId, pod: { name: SOCIAL_MEDIA_POD_NAME } },
  });
  if (!canManageContentCalendar(user, socialMediaGroup)) {
    throw new Error("Only this project's Social Media Lead (or Admin) can set the Monthly Brief.");
  }

  const parsed = monthlyBriefSchema.safeParse({
    month: formData.get("month"),
    year: formData.get("year"),
    text: formData.get("text"),
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input.");
  }

  await prisma.monthlyBrief.upsert({
    where: { projectId_month_year: { projectId, month: parsed.data.month, year: parsed.data.year } },
    update: { text: parsed.data.text },
    create: {
      projectId,
      month: parsed.data.month,
      year: parsed.data.year,
      text: parsed.data.text,
      createdById: user.id,
    },
  });

  revalidatePath(`/content-calendar/${projectId}`);
}
