import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getLocalDateString } from "@/lib/timezone";
import { formatDate } from "@/lib/format";
import { loadDependencyGroups, dueRange, ALL_STATUSES, STATUS_LABELS } from "@/lib/dependency-data";
import { DependencyProjectGroups } from "@/components/dependency-project-groups";

/**
 * Projects tab for a Dependency Tracker coordinator. With no project selected it lists the
 * coordinator's projects; selecting one shows ALL of that project's cross-department tasks —
 * every status, INCLUDING Completed (unlike the active tracker) — so a coordinator can review
 * the full history of an ongoing retainer. Read-only, with due-date and status filters.
 */
export default async function DependencyProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; due?: string; from?: string; to?: string; status?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { project: projectParam = "", due = "", from, to, status = "" } = await searchParams;

  // --- Project list (no project selected) ---
  if (!projectParam) {
    const projects = await prisma.project.findMany({
      where: { dependencyTrackerId: user.id, archivedAt: null },
      orderBy: { name: "asc" },
      include: { client: { select: { name: true } } },
    });
    return (
      <div className="max-w-3xl">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-xl font-semibold">Projects</h1>
          <Link href="/dependencies/tracker" className="text-sm text-gs-red hover:underline">← Active tracker</Link>
        </div>
        <p className="mt-1 text-sm text-gs-gray">Open a project to see all its cross-department tasks, including completed.</p>

        {projects.length === 0 ? (
          <p className="mt-6 text-sm text-gs-gray">You have no assigned projects yet.</p>
        ) : (
          <div className="mt-6 overflow-hidden rounded-lg border border-gs-gray/15 bg-white">
            {projects.map((p) => (
              <Link
                key={p.id}
                href={`/dependencies/projects?project=${p.id}`}
                className="flex items-center justify-between border-b border-gs-gray/10 px-4 py-3 text-sm last:border-b-0 hover:bg-gs-light"
              >
                <span className="font-medium">{p.name}</span>
                <span className="text-gs-gray">{p.client.name}</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    );
  }

  // --- Single project (all cross-department tasks, incl. Completed) ---
  const project = await prisma.project.findFirst({
    where: { id: projectParam, dependencyTrackerId: user.id, archivedAt: null },
    include: { client: { select: { name: true } } },
  });
  if (!project) notFound();

  // Milestones (PRD — agency-wide): a Dependency Tracker gets strictly read-only visibility, a
  // coarse cross-department progress signal consistent with their read-only rule elsewhere.
  const milestones = await prisma.milestone.findMany({
    where: { projectId: project.id },
    orderBy: { order: "asc" },
  });

  const now = new Date();
  const todayStr = getLocalDateString(user.location, now);
  const range = dueRange(due, from, to, todayStr);
  const validStatus = (ALL_STATUSES as readonly string[]).includes(status) ? status : null;
  const anyFilter = due !== "" || validStatus !== null;

  const groups = await loadDependencyGroups(user.id, {
    projectId: projectParam,
    excludeCompleted: false,
    status: validStatus,
    range,
  });

  return (
    <div className="max-w-5xl">
      <p className="text-sm text-gs-gray">
        <Link href="/dependencies/projects" className="hover:underline">Projects</Link>
        {" › "}
        <Link href="/dependencies/tracker" className="hover:underline">Active tracker</Link>
      </p>
      <h1 className="mt-1 text-xl font-semibold">
        {project.name} <span className="text-sm font-normal text-gs-gray">· {project.client.name}</span>
      </h1>
      <p className="mt-1 text-sm text-gs-gray">All cross-department tasks, including completed — view only.</p>

      {milestones.length > 0 && (
        <div className="mt-4">
          <h2 className="text-sm font-semibold uppercase text-gs-gray">Milestones</h2>
          <ul className="mt-2 overflow-hidden rounded-lg border border-gs-gray/15 bg-white">
            {milestones.map((m) => (
              <li key={m.id} className="flex items-center gap-3 border-b border-gs-gray/10 px-4 py-2.5 last:border-b-0">
                <span
                  aria-label={m.completed ? "Completed" : "Not completed"}
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border text-xs ${
                    m.completed ? "border-green-600 bg-green-600 text-white" : "border-gs-gray/30 text-transparent"
                  }`}
                >
                  ✓
                </span>
                <span className={`text-sm font-medium ${m.completed ? "text-gs-gray line-through" : ""}`}>{m.title}</span>
                <span className="ml-auto whitespace-nowrap text-xs text-gs-gray">Due {formatDate(m.dueDate)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <form method="get" className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-gs-gray/15 bg-white p-3">
        <input type="hidden" name="project" value={projectParam} />
        <div className="flex flex-col gap-1">
          <label htmlFor="status" className="text-xs font-medium text-gs-gray">Status</label>
          <select id="status" name="status" defaultValue={validStatus ?? ""} className="min-h-9 rounded-md border border-gs-gray/30 px-2 text-sm">
            <option value="">Any status</option>
            {ALL_STATUSES.map((s) => (
              <option key={s} value={s}>{STATUS_LABELS[s]}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="due" className="text-xs font-medium text-gs-gray">Due</label>
          <select id="due" name="due" defaultValue={due} className="min-h-9 rounded-md border border-gs-gray/30 px-2 text-sm">
            <option value="">Any time</option>
            <option value="week">This week</option>
            <option value="month">This month</option>
            <option value="custom">Custom range</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="from" className="text-xs font-medium text-gs-gray">From</label>
          <input id="from" type="date" name="from" defaultValue={from ?? ""} className="min-h-9 rounded-md border border-gs-gray/30 px-2 text-sm" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="to" className="text-xs font-medium text-gs-gray">To</label>
          <input id="to" type="date" name="to" defaultValue={to ?? ""} className="min-h-9 rounded-md border border-gs-gray/30 px-2 text-sm" />
        </div>
        <button type="submit" className="flex min-h-9 items-center rounded-md bg-gs-black px-4 text-sm font-medium text-white hover:opacity-90">Apply</button>
        {anyFilter && (
          <Link href={`/dependencies/projects?project=${projectParam}`} className="flex min-h-9 items-center px-2 text-sm text-gs-gray hover:underline">Clear</Link>
        )}
        <p className="w-full text-xs text-gs-gray">From / To apply when Due is set to “Custom range”.</p>
      </form>

      {groups.length === 0 ? (
        <p className="mt-6 text-sm text-gs-gray">
          {anyFilter ? "No cross-department tasks match your filters." : "No cross-department tasks on this project."}
        </p>
      ) : (
        <DependencyProjectGroups groups={groups} viewerLocation={user.location} showProjectHeading={false} />
      )}
    </div>
  );
}
