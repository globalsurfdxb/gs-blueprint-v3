import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getDashboardData, type DashTask } from "@/lib/dashboard";
import { getLeadDashboardData, type LeadDashboardData } from "@/lib/lead-dashboard";
import { getSprintProgressData, type SprintProgressData } from "@/lib/sprint-dashboard";
import { canViewDashboard, isLead } from "@/lib/permissions";
import { formatDuration } from "@/lib/format";

const STATUS_LABELS: Record<string, string> = {
  NEW: "New",
  IN_PROGRESS: "In Progress",
  REVIEW: "Review",
  REVISION: "Revision",
  COMPLETED: "Completed",
  ON_HOLD: "On Hold",
};

function StatCard({
  label,
  value,
  tone = "default",
  href,
}: {
  label: string;
  value: number;
  tone?: "default" | "warn" | "danger";
  href?: string;
}) {
  const valueColor = tone === "danger" ? "text-gs-red" : tone === "warn" ? "text-amber-600" : "text-gs-black";
  const body = (
    <>
      <p className="text-xs uppercase tracking-wide text-gs-gray">{label}</p>
      <p className={`mt-1 font-heading text-3xl font-bold ${valueColor}`}>{value}</p>
    </>
  );
  const cls = "block rounded-lg border border-gs-gray/15 bg-white p-4";
  return href ? (
    <Link href={href} className={`${cls} hover:bg-gs-light`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function TaskRows({ tasks, emptyText }: { tasks: DashTask[]; emptyText: string }) {
  if (tasks.length === 0) return <p className="px-4 py-4 text-sm text-gs-gray">{emptyText}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-sm">
        <thead className="bg-gs-light text-left text-xs uppercase text-gs-gray">
          <tr>
            <th className="whitespace-nowrap px-4 py-2">Task</th>
            <th className="whitespace-nowrap px-4 py-2">Project</th>
            <th className="whitespace-nowrap px-4 py-2">Assignee</th>
            <th className="whitespace-nowrap px-4 py-2">Due Date</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => (
            <tr key={t.id} className="border-t border-gs-gray/10">
              <td className="px-4 py-2">
                <Link href={`/projects/${t.projectId}/tasks/${t.id}`} className="font-medium hover:underline">
                  {t.name}
                </Link>
              </td>
              <td className="whitespace-nowrap px-4 py-2 text-gs-gray">{t.projectName}</td>
              <td className="whitespace-nowrap px-4 py-2">
                {t.assigneeName ? (
                  <span className="text-gs-gray">{t.assigneeName}</span>
                ) : (
                  <span className="font-medium text-gs-red">Not Assigned</span>
                )}
              </td>
              <td className="whitespace-nowrap px-4 py-2 text-gs-gray">
                {t.dueDate}
                {t.daysLate !== null && t.daysLate > 0 && (
                  <span className="ml-1 text-gs-red">({t.daysLate} day{t.daysLate === 1 ? "" : "s"})</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-sm font-semibold uppercase text-gs-gray">{title}</h2>
      <div className="mt-2 overflow-hidden rounded-lg border border-gs-gray/15 bg-white">{children}</div>
    </section>
  );
}

/**
 * Sprint Progress (PRD 8.14) — completion %, per-person workload (open tasks + hours logged),
 * and the reused 8.8 overdue/bottleneck flags, scoped to Sprint-enabled Task Groups. Rendered
 * only when the viewer has Sprint-enabled work in scope, so non-Dev dashboards are unchanged.
 */
function SprintProgressSection({ data }: { data: SprintProgressData }) {
  if (!data.inScope) return null;
  return (
    <div className="flex flex-col gap-8">
      <SectionCard title="Sprint Progress">
        {data.sprints.length === 0 ? (
          <p className="px-4 py-4 text-sm text-gs-gray">No active or planned sprints in scope.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-gs-light text-left text-xs uppercase text-gs-gray">
                <tr>
                  <th className="whitespace-nowrap px-4 py-2">Sprint</th>
                  <th className="whitespace-nowrap px-4 py-2">Project</th>
                  <th className="whitespace-nowrap px-4 py-2">Status</th>
                  <th className="whitespace-nowrap px-4 py-2">Completion</th>
                  <th className="whitespace-nowrap px-4 py-2">Overdue</th>
                  <th className="whitespace-nowrap px-4 py-2">Stuck</th>
                </tr>
              </thead>
              <tbody>
                {data.sprints.map((s) => (
                  <tr key={s.id} className="border-t border-gs-gray/10">
                    <td className="px-4 py-2">
                      <Link href={`/projects/${s.projectId}`} className="font-medium hover:underline">{s.name}</Link>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-gs-gray">{s.projectName}</td>
                    <td className="whitespace-nowrap px-4 py-2">
                      <span className={s.status === "ACTIVE" ? "font-medium text-green-600" : "text-gs-gray"}>
                        {s.status === "ACTIVE" ? "Active" : "Planned"}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2">
                      <span className="inline-flex items-center gap-2">
                        <span className="inline-block h-1.5 w-16 overflow-hidden rounded-full bg-gs-gray/15" aria-hidden>
                          <span className="block h-full rounded-full bg-gs-black" style={{ width: `${s.completionPct}%` }} />
                        </span>
                        <span className="text-gs-gray">{s.completionPct}% ({s.completedTasks}/{s.totalTasks})</span>
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      <span className={s.overdue > 0 ? "font-medium text-gs-red" : "text-gs-gray"}>{s.overdue}</span>
                    </td>
                    <td className="px-4 py-2">
                      <span className={s.stuck > 0 ? "font-medium text-amber-600" : "text-gs-gray"}>{s.stuck}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Sprint Workload — Active Sprints">
        {data.workload.length === 0 ? (
          <p className="px-4 py-4 text-sm text-gs-gray">No one has active-sprint work in scope.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
              <thead className="bg-gs-light text-left text-xs uppercase text-gs-gray">
                <tr>
                  <th className="whitespace-nowrap px-4 py-2">Member</th>
                  <th className="whitespace-nowrap px-4 py-2">Open Tasks</th>
                  <th className="whitespace-nowrap px-4 py-2">Hours Logged</th>
                </tr>
              </thead>
              <tbody>
                {data.workload.map((m) => (
                  <tr key={m.userId} className="border-t border-gs-gray/10">
                    <td className="whitespace-nowrap px-4 py-2 font-medium">{m.name}</td>
                    <td className="px-4 py-2 text-gs-gray">{m.openTasks}</td>
                    <td className="px-4 py-2 text-gs-gray">{formatDuration(m.loggedSeconds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}

function LeadDashboard({ data, sprintProgress }: { data: LeadDashboardData; sprintProgress: SprintProgressData }) {
  if (!data.hasGroups) {
    return (
      <div className="max-w-5xl">
        <h1 className="text-xl font-semibold">My Team</h1>
        <p className="mt-6 text-sm text-gs-gray">
          You don&apos;t lead a Task Group on any project yet — once you&apos;re attached as a discipline Lead,
          your team&apos;s work rolls up here.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">My Team</h1>
        <span className="text-sm text-gs-gray">Across every group you lead</span>
      </div>

      {/* KPI row — the "what needs me" glance. Review/unassigned link into My Reviews, the
          Lead's action queue, rather than duplicating that list here. */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Awaiting My Review" value={data.reviewCount} tone={data.reviewCount > 0 ? "warn" : "default"} href="/my-reviews" />
        <StatCard label="Unassigned" value={data.unassignedCount} tone={data.unassignedCount > 0 ? "danger" : "default"} href="/my-reviews" />
        <StatCard label="Overdue" value={data.overdueTasks.length} tone={data.overdueTasks.length > 0 ? "danger" : "default"} />
        <StatCard label="Revision-Flagged" value={data.flaggedCount} tone={data.flaggedCount > 0 ? "danger" : "default"} />
      </div>

      <div className="mt-8 flex flex-col gap-8">
        <SectionCard title="Team Workload">
          {data.team.length === 0 ? (
            <p className="px-4 py-4 text-sm text-gs-gray">No team members found for your pod.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm">
                <thead className="bg-gs-light text-left text-xs uppercase text-gs-gray">
                  <tr>
                    <th className="whitespace-nowrap px-4 py-2">Member</th>
                    <th className="whitespace-nowrap px-4 py-2">Open</th>
                    <th className="whitespace-nowrap px-4 py-2">In Progress</th>
                    <th className="whitespace-nowrap px-4 py-2">Overdue</th>
                  </tr>
                </thead>
                <tbody>
                  {data.team.map((m) => (
                    <tr key={m.id} className="border-t border-gs-gray/10">
                      <td className="whitespace-nowrap px-4 py-2 font-medium">{m.name}</td>
                      <td className="px-4 py-2 text-gs-gray">{m.open}</td>
                      <td className="px-4 py-2 text-gs-gray">{m.inProgress}</td>
                      <td className="px-4 py-2">
                        <span className={m.overdue > 0 ? "font-medium text-gs-red" : "text-gs-gray"}>{m.overdue}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>

        <SectionCard title="Overdue Tasks">
          <TaskRows tasks={data.overdueTasks} emptyText="Nothing overdue in your groups." />
        </SectionCard>

        <SectionCard title="Tasks With Revisions">
          {data.revisionTasks.length === 0 ? (
            <p className="px-4 py-4 text-sm text-gs-gray">No tasks in revision.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="bg-gs-light text-left text-xs uppercase text-gs-gray">
                  <tr>
                    <th className="whitespace-nowrap px-4 py-2">Task</th>
                    <th className="whitespace-nowrap px-4 py-2">Project</th>
                    <th className="whitespace-nowrap px-4 py-2">Assignee</th>
                    <th className="whitespace-nowrap px-4 py-2">Status</th>
                    <th className="whitespace-nowrap px-4 py-2">Revisions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.revisionTasks.map((t) => (
                    <tr key={t.id} className="border-t border-gs-gray/10">
                      <td className="px-4 py-2">
                        <Link href={`/projects/${t.projectId}/tasks/${t.id}`} className="font-medium hover:underline">
                          {t.name}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-gs-gray">{t.projectName}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-gs-gray">{t.assigneeName ?? "Unassigned"}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-gs-gray">{STATUS_LABELS[t.status] ?? t.status}</td>
                      <td className="px-4 py-2">
                        <span
                          className={`inline-flex min-w-6 justify-center rounded px-1.5 py-0.5 text-xs font-semibold ${
                            t.revisionCount >= 2 ? "bg-gs-red/10 text-gs-red" : "bg-amber-100 text-amber-700"
                          }`}
                        >
                          {t.revisionCount}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>

        <SectionCard title="Bottlenecks — Stuck 3+ Days">
          <TaskRows tasks={data.bottlenecks} emptyText="Nothing stuck in progress or review." />
        </SectionCard>

        <SprintProgressSection data={sprintProgress} />
      </div>
    </div>
  );
}

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // Admin + Cluster Head get the oversight dashboard (PRD 8.8); a Lead gets their own
  // "My Team" roll-up; everyone else lands on their own task list, their real home.
  if (!canViewDashboard(user)) {
    if (isLead(user)) {
      const [leadData, sprintProgress] = await Promise.all([
        getLeadDashboardData(user),
        getSprintProgressData(user),
      ]);
      return <LeadDashboard data={leadData} sprintProgress={sprintProgress} />;
    }
    // A view-only Dependency Tracker (PRD 8.13) has no task list of their own — their home is
    // the dependency queue. Only redirect there if they actually hold a designation.
    const trackerCount = await prisma.project.count({ where: { dependencyTrackerId: user.id, archivedAt: null } });
    redirect(trackerCount > 0 ? "/dependencies" : "/my-tasks");
  }

  const [data, sprintProgress] = await Promise.all([getDashboardData(user), getSprintProgressData(user)]);

  return (
    <div className="max-w-5xl">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <span className="text-sm text-gs-gray">{data.scopeLabel}</span>
      </div>

      {/* Glanceable KPI row — big Space Grotesk numbers, the "what needs attention" summary
          a Cluster Head or Admin pulls up between meetings (PRD 8.8, 9.4). */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Overdue Tasks" value={data.overdueTasks.length} tone={data.overdueTasks.length > 0 ? "danger" : "default"} />
        <StatCard label="With Revisions" value={data.revisionTasks.length} tone={data.revisionTasks.length > 0 ? "warn" : "default"} />
        <StatCard label="Hours at Risk" value={data.hoursRisk.length} tone={data.hoursRisk.length > 0 ? "warn" : "default"} />
        <StatCard label="Bottlenecked" value={data.bottlenecks.length} tone={data.bottlenecks.length > 0 ? "warn" : "default"} />
        <StatCard label="Not On Track" value={data.projectsNotOnTrack} tone={data.projectsNotOnTrack > 0 ? "danger" : "default"} />
      </div>

      {/* Activity summary widgets (PRD 8.8) — scoped identically to the KPIs above. */}
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Active Tasks" value={data.activeCount} />
        <StatCard label="Completed Tasks" value={data.completedCount} />
        <StatCard label="Due Today" value={data.dueTodayTasks.length} tone={data.dueTodayTasks.length > 0 ? "warn" : "default"} />
        <StatCard label="Running Timers" value={data.runningTimers.length} tone={data.runningTimers.length > 0 ? "warn" : "default"} />
      </div>

      <div className="mt-8 flex flex-col gap-8">
        {data.dueTodayTasks.length > 0 && (
          <SectionCard title="Due Today">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[360px] text-sm">
                <thead className="bg-gs-light text-left text-xs uppercase text-gs-gray">
                  <tr>
                    <th className="whitespace-nowrap px-4 py-2">Task</th>
                    <th className="whitespace-nowrap px-4 py-2">Project</th>
                    <th className="whitespace-nowrap px-4 py-2">Assignee</th>
                    <th className="whitespace-nowrap px-4 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.dueTodayTasks.map((t) => (
                    <tr key={t.id} className="border-t border-gs-gray/10">
                      <td className="px-4 py-2">
                        <Link href={`/projects/${t.projectId}/tasks/${t.id}`} className="font-medium hover:underline">
                          {t.name}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-gs-gray">{t.projectName}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-gs-gray">{t.assigneeName ?? "Unassigned"}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-gs-gray">{t.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>
        )}

        {data.runningTimers.length > 0 && (
          <SectionCard title="Running Timers">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[320px] text-sm">
                <thead className="bg-gs-light text-left text-xs uppercase text-gs-gray">
                  <tr>
                    <th className="whitespace-nowrap px-4 py-2">Task</th>
                    <th className="whitespace-nowrap px-4 py-2">Running for</th>
                  </tr>
                </thead>
                <tbody>
                  {data.runningTimers.map((r) => (
                    <tr key={r.taskId} className="border-t border-gs-gray/10">
                      <td className="px-4 py-2">
                        <Link href={`/projects/${r.projectId}/tasks/${r.taskId}`} className="font-medium hover:underline">
                          {r.taskName}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-gs-gray">{r.userName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>
        )}

        {/* On-track rollup — cluster-by-cluster for Admin, pod-by-pod for a Cluster Head. */}
        <SectionCard title={`On Track vs. Not — by ${data.onTrackGrouping}`}>
          {data.onTrack.length === 0 ? (
            <p className="px-4 py-4 text-sm text-gs-gray">No active projects in scope.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[360px] text-sm">
                <thead className="bg-gs-light text-left text-xs uppercase text-gs-gray">
                  <tr>
                    <th className="whitespace-nowrap px-4 py-2 capitalize">{data.onTrackGrouping}</th>
                    <th className="whitespace-nowrap px-4 py-2">On Track</th>
                    <th className="whitespace-nowrap px-4 py-2">Not On Track</th>
                  </tr>
                </thead>
                <tbody>
                  {data.onTrack.map((r) => (
                    <tr key={r.label} className="border-t border-gs-gray/10">
                      <td className="whitespace-nowrap px-4 py-2 font-medium">{r.label}</td>
                      <td className="px-4 py-2 text-gs-gray">{r.onTrack}</td>
                      <td className="px-4 py-2">
                        <span className={r.notOnTrack > 0 ? "font-medium text-gs-red" : "text-gs-gray"}>{r.notOnTrack}</span>
                      </td>
                    </tr>
                  ))}
                  {/* Distinct-project total only for the cluster view — pod rows overlap
                      (a multi-pod project counts under each pod), so summing them would
                      over-count. The KPI card above carries the honest distinct figure. */}
                  {data.onTrackGrouping === "cluster" ? (
                    <tr className="border-t border-gs-gray/15 bg-gs-light/50">
                      <td className="px-4 py-2 text-xs font-semibold uppercase text-gs-gray">Total</td>
                      <td className="px-4 py-2 font-medium">{data.projectsOnTrack}</td>
                      <td className="px-4 py-2 font-medium text-gs-red">{data.projectsNotOnTrack}</td>
                    </tr>
                  ) : (
                    <tr className="border-t border-gs-gray/15 bg-gs-light/50">
                      <td colSpan={3} className="px-4 py-2 text-xs text-gs-gray">
                        {data.projectsNotOnTrack} of {data.projectsOnTrack + data.projectsNotOnTrack}{" "}
                        {data.projectsOnTrack + data.projectsNotOnTrack === 1 ? "project" : "projects"} not on track. A
                        project spanning two pods appears in both rows above.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>

        <SectionCard title="Overdue Tasks">
          <TaskRows tasks={data.overdueTasks} emptyText="Nothing overdue in scope." />
        </SectionCard>

        {/* Revision-count highlighting: 1 = amber (normal), 2+ = red (flagged) per PRD 8.8. */}
        <SectionCard title="Tasks With Revisions">
          {data.revisionTasks.length === 0 ? (
            <p className="px-4 py-4 text-sm text-gs-gray">No tasks in revision.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="bg-gs-light text-left text-xs uppercase text-gs-gray">
                  <tr>
                    <th className="whitespace-nowrap px-4 py-2">Task</th>
                    <th className="whitespace-nowrap px-4 py-2">Project</th>
                    <th className="whitespace-nowrap px-4 py-2">Assignee</th>
                    <th className="whitespace-nowrap px-4 py-2">Status</th>
                    <th className="whitespace-nowrap px-4 py-2">Revisions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.revisionTasks.map((t) => (
                    <tr key={t.id} className="border-t border-gs-gray/10">
                      <td className="px-4 py-2">
                        <Link href={`/projects/${t.projectId}/tasks/${t.id}`} className="font-medium hover:underline">
                          {t.name}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-gs-gray">{t.projectName}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-gs-gray">{t.assigneeName ?? "Unassigned"}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-gs-gray">{STATUS_LABELS[t.status] ?? t.status}</td>
                      <td className="px-4 py-2">
                        <span
                          className={`inline-flex min-w-6 justify-center rounded px-1.5 py-0.5 text-xs font-semibold ${
                            t.revisionCount >= 2 ? "bg-gs-red/10 text-gs-red" : "bg-amber-100 text-amber-700"
                          }`}
                        >
                          {t.revisionCount}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>

        <SectionCard title="Projects Approaching / Over Max Hours">
          {data.hoursRisk.length === 0 ? (
            <p className="px-4 py-4 text-sm text-gs-gray">No projects near their hours cap.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead className="bg-gs-light text-left text-xs uppercase text-gs-gray">
                  <tr>
                    <th className="whitespace-nowrap px-4 py-2">Project</th>
                    <th className="whitespace-nowrap px-4 py-2">Client</th>
                    <th className="whitespace-nowrap px-4 py-2">Logged / Max</th>
                    <th className="whitespace-nowrap px-4 py-2">Used</th>
                  </tr>
                </thead>
                <tbody>
                  {data.hoursRisk.map((p) => (
                    <tr key={p.projectId} className="border-t border-gs-gray/10">
                      <td className="px-4 py-2">
                        <Link href={`/projects/${p.projectId}`} className="font-medium hover:underline">
                          {p.name}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-gs-gray">{p.clientName}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-gs-gray">
                        {formatDuration(Math.round(p.loggedHours * 3600))} / {p.maxHours}h
                        {p.allocationType === "MONTHLY" ? "/mo" : ""}
                      </td>
                      <td className="px-4 py-2">
                        <span className={`font-medium ${p.pct > 1 ? "text-gs-red" : "text-amber-600"}`}>
                          {Math.round(p.pct * 100)}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>

        <SectionCard title="Bottlenecks — Stuck 3+ Days">
          <TaskRows tasks={data.bottlenecks} emptyText="Nothing stuck in progress or review." />
        </SectionCard>

        <SprintProgressSection data={sprintProgress} />
      </div>
    </div>
  );
}
