import "server-only";
import { prisma } from "@/lib/prisma";
import type { NotificationType } from "@/generated/prisma/enums";

export async function notifyUsers(
  userIds: (string | null | undefined)[],
  data: {
    type: NotificationType;
    message: string;
    relatedTaskId?: string;
    relatedProjectId?: string;
  },
) {
  const uniqueIds = Array.from(new Set(userIds.filter((id): id is string => !!id)));
  if (uniqueIds.length === 0) return;

  await prisma.notification.createMany({
    data: uniqueIds.map((userId) => ({
      userId,
      type: data.type,
      message: data.message,
      relatedTaskId: data.relatedTaskId,
      relatedProjectId: data.relatedProjectId,
    })),
  });
}
