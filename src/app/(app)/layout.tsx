import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getNavItems } from "@/lib/nav";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const [unreadCount, openLog, dependencyTrackerCount] = await Promise.all([
    prisma.notification.count({
      where: { userId: user.id, isRead: false },
    }),
    // The one running timer for this user, if any (endTime = null) — surfaced as a
    // live pill in the header so a forgotten running timer is visible from any page.
    prisma.timeLog.findFirst({
      where: { userId: user.id, endTime: null },
      select: {
        startTime: true,
        task: { select: { id: true, name: true, projectId: true } },
      },
    }),
    // Does this user hold any Dependency Tracker designation? Drives the nav item (PRD 8.13).
    prisma.project.count({ where: { dependencyTrackerId: user.id, archivedAt: null } }),
  ]);

  const navItems = getNavItems(user, { isDependencyTracker: dependencyTrackerCount > 0 });

  const runningTimer = openLog
    ? {
        taskId: openLog.task.id,
        projectId: openLog.task.projectId,
        taskName: openLog.task.name,
        startedAtMs: openLog.startTime.getTime(),
      }
    : null;

  return (
    <AppShell
      navItems={navItems}
      userName={user.name}
      unreadCount={unreadCount}
      runningTimer={runningTimer}
    >
      {children}
    </AppShell>
  );
}
