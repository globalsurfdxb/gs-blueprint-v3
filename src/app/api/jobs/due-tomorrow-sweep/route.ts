import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getLocalDateString, addDays } from "@/lib/timezone";

// Scheduled via vercel.json crons. Vercel Cron invokes the path with a GET request and, when the
// CRON_SECRET env var is set, adds `Authorization: Bearer ${CRON_SECRET}`. PRD 8.7: notifies the
// assignee.
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
      dueDate: { gte: todayUtcStart },
      assignedToId: { not: null },
    },
    include: { assignedTo: true },
  });

  let notified = 0;
  for (const task of tasks) {
    if (!task.assignedTo) continue;
    const today = getLocalDateString(task.assignedTo.location, now);
    const tomorrow = addDays(today, 1);
    const dueDateStr = task.dueDate.toISOString().slice(0, 10);
    if (dueDateStr !== tomorrow) continue;

    const alreadySent = await prisma.notification.findFirst({
      where: {
        userId: task.assignedTo.id,
        relatedTaskId: task.id,
        type: "DUE_TOMORROW",
        createdAt: { gte: todayUtcStart },
      },
    });
    if (alreadySent) continue;

    await prisma.notification.create({
      data: {
        userId: task.assignedTo.id,
        type: "DUE_TOMORROW",
        message: `"${task.name}" is due tomorrow.`,
        relatedTaskId: task.id,
        relatedProjectId: task.projectId,
      },
    });
    notified++;
  }

  return NextResponse.json({ ok: true, notified });
}
