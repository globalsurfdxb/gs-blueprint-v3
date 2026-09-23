"use server";

import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export type ChangePasswordState = { ok: boolean; message: string };

const schema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password."),
    newPassword: z.string().min(8, "New password must be at least 8 characters."),
    confirmPassword: z.string().min(1, "Re-enter your new password."),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: "New passwords do not match.",
    path: ["confirmPassword"],
  })
  .refine((d) => d.newPassword !== d.currentPassword, {
    message: "New password must be different from the current one.",
    path: ["newPassword"],
  });

/**
 * Self-service password change (team feedback #14). Verifies the current password before
 * setting the new bcrypt hash — a user can only ever change their OWN password, never
 * anyone else's, and no role can reach this on another account.
 */
export async function changePassword(
  _prev: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: "You are not signed in." };

  const parsed = schema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const record = await prisma.user.findUnique({ where: { id: user.id }, select: { passwordHash: true } });
  if (!record) return { ok: false, message: "Account not found." };

  const valid = await bcrypt.compare(parsed.data.currentPassword, record.passwordHash);
  if (!valid) return { ok: false, message: "Your current password is incorrect." };

  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 12);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });

  return { ok: true, message: "Password updated." };
}
