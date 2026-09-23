import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getLocalDateString } from "@/lib/timezone";

// Scheduled via vercel.json crons. Vercel Cron invokes the path with a GET request and, when the
// CRON_SECRET env var is set, adds `Authorization: Bearer ${CRON_SECRET}`. PRD 8.7: notifies the
// assignee AND the task's Lead.
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const todayUtcStart = new Date(now.toISOString().slice(0, 10) + "T00:00:00Z");
  const tasks = await prisma.task.findMany({
    where: {
      status: { notIn: ["COMPLETED", "ON_HOLD"] },
      dueDate: { lt: todayUtcStart },
      assignedToId: { not: null },
    },
    include: { assignedTo: true, group: { select: { leadUserId: true } } },
  });

  let notified = 0;
  for (const task of tasks) {
    if (!task.assignedTo) continue;
    const today = getLocalDateString(task.assignedTo.location, now);
    const dueDateStr = task.dueDate.toISOString().slice(0, 10);
    if (dueDateStr >= today) continue;

    const alreadySent = await prisma.notification.findFirst({
      where: {
        relatedTaskId: task.id,
        type: "OVERDUE",
        createdAt: { gte: todayUtcStart },
      },
    });
    if (alreadySent) continue;

    // Overdue notifies the assignee and their task's own group Lead (PRD 8.7) — group
    // scoping means this is no longer every lead on the project, just the one accountable.
    await prisma.notification.createMany({
      data: Array.from(new Set([task.assignedToId, task.group?.leadUserId].filter((id): id is string => !!id)))
        .map((userId) => ({
          userId,
          type: "OVERDUE" as const,
          message: `"${task.name}" is overdue.`,
          relatedTaskId: task.id,
          relatedProjectId: task.projectId,
        })),
    });
    notified++;
  }

  return NextResponse.json({ ok: true, notified });
}
