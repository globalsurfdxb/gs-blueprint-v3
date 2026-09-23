"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { canManageContentTypes } from "@/lib/permissions";

const contentTypeSchema = z
  .object({
    name: z.string().min(1, "Name is required."),
    contentLeadTimeDays: z.coerce.number().int().min(0, "Content Lead Time must be 0 or more days."),
    designLeadTimeDays: z.coerce.number().int().min(0, "Design Lead Time must be 0 or more days."),
  })
  .refine((data) => data.contentLeadTimeDays > data.designLeadTimeDays, {
    message: "Content Lead Time must be greater than Design Lead Time — Content is always due earlier.",
    path: ["contentLeadTimeDays"],
  });

async function requireContentTypeManager() {
  const user = await getCurrentUser();
  if (!user || !canManageContentTypes(user)) {
    throw new Error("Only an Admin can manage Content Types.");
  }
}

export async function createContentType(formData: FormData) {
  await requireContentTypeManager();

  const parsed = contentTypeSchema.safeParse({
    name: formData.get("name"),
    contentLeadTimeDays: formData.get("contentLeadTimeDays"),
    designLeadTimeDays: formData.get("designLeadTimeDays"),
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input.");
  }

  const existing = await prisma.contentType.findUnique({ where: { name: parsed.data.name } });
  if (existing) {
    throw new Error("A Content Type with this name already exists.");
  }

  await prisma.contentType.create({ data: parsed.data });

  revalidatePath("/admin/content-types");
}

export async function updateContentType(contentTypeId: string, formData: FormData) {
  await requireContentTypeManager();

  const parsed = contentTypeSchema.safeParse({
    name: formData.get("name"),
    contentLeadTimeDays: formData.get("contentLeadTimeDays"),
    designLeadTimeDays: formData.get("designLeadTimeDays"),
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input.");
  }

  const existing = await prisma.contentType.findFirst({
    where: { name: parsed.data.name, id: { not: contentTypeId } },
  });
  if (existing) {
    throw new Error("A Content Type with this name already exists.");
  }

  await prisma.contentType.update({ where: { id: contentTypeId }, data: parsed.data });

  revalidatePath("/admin/content-types");
}

export async function deleteContentType(contentTypeId: string, _formData: FormData) {
  await requireContentTypeManager();

  const taskCount = await prisma.task.count({ where: { contentTypeId } });
  if (taskCount > 0) {
    throw new Error(
      "This Content Type is used by existing Content Calendar tasks — it can't be removed while those still reference it.",
    );
  }

  await prisma.contentType.delete({ where: { id: contentTypeId } });

  revalidatePath("/admin/content-types");
}
