"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { canViewProject, isAdmin } from "@/lib/permissions";

const attachmentSchema = z.object({
  url: z.string().url("Enter a valid URL."),
  label: z.string().optional(),
});

export async function addProjectAttachment(projectId: string, formData: FormData) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not signed in.");

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { taskGroups: { select: { id: true, leadUserId: true, podId: true } } },
  });
  if (!project) throw new Error("Project not found.");
  if (!(await canViewProject(user, project))) {
    throw new Error("You don't have access to this project.");
  }

  const parsed = attachmentSchema.safeParse({
    url: formData.get("url"),
    label: formData.get("label") || undefined,
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid input.");

  await prisma.projectAttachment.create({
    data: { projectId, url: parsed.data.url, label: parsed.data.label, addedById: user.id },
  });

  revalidatePath(`/projects/${projectId}`);
}

export async function editProjectAttachment(
  projectId: string,
  attachmentId: string,
  formData: FormData,
) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not signed in.");

  const attachment = await prisma.projectAttachment.findUnique({ where: { id: attachmentId } });
  if (!attachment) throw new Error("Attachment not found.");
  if (attachment.addedById !== user.id) throw new Error("Only the person who added this link can edit it.");

  const parsed = attachmentSchema.safeParse({
    url: formData.get("url"),
    label: formData.get("label") || undefined,
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid input.");

  await prisma.projectAttachment.update({
    where: { id: attachmentId },
    data: { url: parsed.data.url, label: parsed.data.label, isEdited: true, editedAt: new Date() },
  });

  revalidatePath(`/projects/${projectId}`);
}

export async function deleteProjectAttachment(
  projectId: string,
  attachmentId: string,
  _formData: FormData,
) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not signed in.");
  if (!isAdmin(user)) throw new Error("Only an Admin can delete attachments.");

  await prisma.projectAttachment.delete({ where: { id: attachmentId } });
  revalidatePath(`/projects/${projectId}`);
}
