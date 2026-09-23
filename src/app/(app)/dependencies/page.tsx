import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getLocalDateString } from "@/lib/timezone";
import { dueRange, loadActiveTrackerRows, deriveTrackerStats } from "@/lib/dependency-data";

/**
 * Dependency Tracker Dashboard (PRD 8.13, v1.28) — the coordinator's landing screen on login.
 * Deliberately clean: just the at-a-glance figures, no filter form and no task list. Every tile
 * deep-links into the Dependency Tracker list (or the Projects tab) with the matching filter
 * pre-applied. All figures are computed from the coordinator's full visible universe — every
 * non-completed cross-department task on their tracked projects (department-membership rule).
 */
export default async function DependencyDashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const now = new Date();
  const todayStr = getLocalDateString(user.location, now);
  const weekRange = dueRange("week", undefined, undefined, todayStr);

  const [projectCount, rows] = await Promise.all([
    prisma.project.count({ where: { dependencyTrackerId: user.id, archivedAt: null } }),
    loadActiveTrackerRows(user.id, user.location, now),
  ]);

  const stats = deriveTrackerStats(rows, weekRange);

  const tile = "flex flex-col rounded-xl border border-gs-gray/15 bg-white px-5 py-4 text-left transition hover:border-gs-red/40 hover:shadow-sm";

  return (
    <div className="max-w-5xl">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <Link href="/dependencies/tracker" className="text-sm text-gs-red hover:underline">Open Dependency Tracker →</Link>
      </div>
      <p className="mt-1 text-sm text-gs-gray">
        At-a-glance status of the cross-department work you coordinate. Select any figure to drill in.
      </p>

      <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <Link href="/dependencies/projects" className={tile}>
          <span className="text-3xl font-semibold">{projectCount}</span>
          <span className="mt-1 text-xs uppercase tracking-wide text-gs-gray">Projects Tracked</span>
        </Link>

        <Link href="/dependencies/tracker?due=week" className={tile}>
          <span className="text-3xl font-semibold">{stats.dueThisWeek}</span>
          <span className="mt-1 text-xs uppercase tracking-wide text-gs-gray">Due This Week</span>
        </Link>

        <Link href="/dependencies/tracker?overdue=1" className={tile}>
          <span className={`text-3xl font-semibold ${stats.overdue > 0 ? "text-gs-red" : ""}`}>{stats.overdue}</span>
          <span className="mt-1 text-xs uppercase tracking-wide text-gs-gray">Overdue</span>
        </Link>

        <Link href="/dependencies/tracker?stuck=1" className={tile}>
          <span className={`text-3xl font-semibold ${stats.stuck > 0 ? "text-amber-600" : ""}`}>{stats.stuck}</span>
          <span className="mt-1 text-xs uppercase tracking-wide text-gs-gray">Stuck</span>
        </Link>

        <div className={`${tile} hover:border-gs-gray/15 hover:shadow-none`}>
          <span className="text-xs uppercase tracking-wide text-gs-gray">By Discipline</span>
          {stats.byDiscipline.length === 0 ? (
            <span className="mt-2 text-sm text-gs-gray">—</span>
          ) : (
            <div className="mt-2 flex flex-col gap-1">
              {stats.byDiscipline.map((d) => (
                <Link
                  key={d.discipline}
                  href={`/dependencies/tracker?discipline=${encodeURIComponent(d.discipline)}`}
                  className="flex items-center justify-between text-sm hover:text-gs-red"
                >
                  <span className="truncate">{d.discipline}</span>
                  <span className="ml-2 font-semibold">{d.count}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
