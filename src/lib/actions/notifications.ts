"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export async function markNotificationRead(notificationId: string, _formData: FormData) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not signed in.");

  const notification = await prisma.notification.findUnique({ where: { id: notificationId } });
  if (!notification || notification.userId !== user.id) {
    throw new Error("Notification not found.");
  }

  await prisma.notification.update({ where: { id: notificationId }, data: { isRead: true } });
  revalidatePath("/notifications");
}

export async function markAllNotificationsRead(_formData: FormData) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not signed in.");

  await prisma.notification.updateMany({
    where: { userId: user.id, isRead: false },
    data: { isRead: true },
  });
  revalidatePath("/notifications");
}
