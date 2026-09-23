"use server";

import { put, del } from "@vercel/blob";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { canManageBugImages } from "@/lib/permissions";

// Screenshot Attachments on Bugs (PRD 8.2.4) — deliberately narrow limits. Do NOT raise
// these without a product decision.
const MAX_IMAGES = 3;
const MAX_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

/** Defence-in-depth: verify the actual file signature, not just the declared MIME type, so a
 * 40MB video renamed/relabelled as image/png can't slip past the picker's accept filter. */
function sniffImageType(bytes: Uint8Array): "image/png" | "image/jpeg" | "image/webp" | null {
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && // "RIFF"
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50 // "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

async function loadBugForImages(taskId: string) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      projectId: true,
      taskType: true,
      assignedToId: true,
      createdById: true,
      groupId: true,
      _count: { select: { bugImages: true } },
    },
  });
  if (!task) throw new Error("Task not found.");
  const group = task.groupId
    ? await prisma.taskGroup.findUnique({ where: { id: task.groupId }, select: { leadUserId: true, podId: true } })
    : null;
  return { task, group };
}

/**
 * Attach one screenshot to a Bug. Images only (PNG/JPG/WebP), ≤5MB, max 3 per bug — all
 * enforced HERE, server-side, before anything is uploaded, so a request that bypasses the
 * file picker can't get through. The binary goes to Vercel Blob; only a reference is stored.
 */
export async function uploadBugImage(projectId: string, taskId: string, formData: FormData) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not signed in.");

  const { task, group } = await loadBugForImages(taskId);
  if (task.taskType !== "BUG") throw new Error("Screenshots can only be attached to a Bug.");
  if (!canManageBugImages(user, group, task)) {
    throw new Error("You don't have permission to attach images to this bug.");
  }
  if (task._count.bugImages >= MAX_IMAGES) {
    throw new Error(`A bug can have at most ${MAX_IMAGES} images — remove one first.`);
  }

  const file = formData.get("image");
  if (!(file instanceof File) || file.size === 0) throw new Error("Choose an image to upload.");
  if (file.size > MAX_BYTES) throw new Error("Image must be 5MB or smaller.");
  if (!ALLOWED_TYPES.has(file.type)) throw new Error("Only PNG, JPG or WebP images are allowed.");

  const bytes = new Uint8Array(await file.arrayBuffer());
  const sniffed = sniffImageType(bytes);
  if (!sniffed) throw new Error("That file isn't a valid PNG, JPG or WebP image.");

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "image";
  const blob = await put(`bug-images/${taskId}/${safeName}`, file, {
    access: "public",
    addRandomSuffix: true,
    contentType: sniffed,
  });

  await prisma.bugImage.create({
    data: {
      taskId,
      url: blob.url,
      pathname: blob.pathname,
      filename: file.name.slice(0, 200),
      contentType: sniffed,
      addedById: user.id,
    },
  });

  revalidatePath(`/projects/${projectId}/tasks/${taskId}`);
}

/** Remove a screenshot — deletes both the DB reference and the blob. No versioning/history. */
export async function removeBugImage(projectId: string, taskId: string, imageId: string, _formData: FormData) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not signed in.");

  const { task, group } = await loadBugForImages(taskId);
  if (!canManageBugImages(user, group, task)) {
    throw new Error("You don't have permission to remove images from this bug.");
  }

  const image = await prisma.bugImage.findUnique({ where: { id: imageId } });
  if (!image || image.taskId !== taskId) throw new Error("Image not found.");

  await prisma.bugImage.delete({ where: { id: imageId } });

  // Handoff copies share the same blob URL across successor tasks — only delete the actual
  // blob once nothing else references it, so removing here can't break a sibling's thumbnail.
  const stillReferenced = await prisma.bugImage.count({ where: { url: image.url } });
  if (stillReferenced === 0) {
    try {
      await del(image.url);
    } catch {
      // best-effort: the DB row (already gone) is the source of truth for what's shown
    }
  }

  revalidatePath(`/projects/${projectId}/tasks/${taskId}`);
}
