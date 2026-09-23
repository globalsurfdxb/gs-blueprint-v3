import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import {
  canViewProject,
  canViewAllProjectGroups,
  clusterHeadReachesProject,
  getClusterHeadPodRestriction,
} from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { formatDuration, secondsSince } from "@/lib/format";

const STATUS_LABELS: Record<string, string> = {
  NEW: "New",
  IN_PROGRESS: "In Progress",
  REVIEW: "Review",
  REVISION: "Revision",
  COMPLETED: "Completed",
  ON_HOLD: "On Hold",
};

export default async function ProjectReportPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { id } = await params;
  const project = await prisma.project.findUnique({
    where: { id },
    include: { taskGroups: { select: { id: true, leadUserId: true, podId: true } } },
  });
  if (!project) notFound();

  if (!(await canViewProject(user, project))) redirect("/projects");
  // The Core Project/Task Report necessarily shows every group's stages side by side in a
  // chain — restricted to the oversight roles that already see all groups (rule 2), plus a
  // pod-restricted Cluster Head whose reach covers this project (their report narrows to
  // only their own pod's chains below, rather than being blocked outright).
  const seesEveryGroup = canViewAllProjectGroups(user, project);
  if (!seesEveryGroup && !clusterHeadReachesProject(user, project)) redirect(`/projects/${id}`);
  const podRestriction = seesEveryGroup ? null : getClusterHeadPodRestriction(user, project.clusterId);

  const tasks = await prisma.task.findMany({
    where: {
      projectId: id,
      parentTaskId: null,
      ...(podRestriction ? { group: { podId: { in: podRestriction } } } : {}),
    },
    include: {
      group: { select: { name: true } },
      assignedTo: { select: { name: true } },
      timeLogs: { select: { durationSeconds: true, startTime: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const secondsFor = (t: (typeof tasks)[number]) =>
    t.timeLogs.reduce((sum, log) => sum + (log.durationSeconds ?? secondsSince(log.startTime)), 0);

  const successorOf = new Map<string, (typeof tasks)[number]>();
  for (const t of tasks) {
    if (t.predecessorTaskId) successorOf.set(t.predecessorTaskId, t);
  }

  // Chains start at any task with no predecessor; walk forward via the successor link.
  const chains: (typeof tasks)[number][][] = [];
  for (const t of tasks) {
    if (t.predecessorTaskId) continue; // not a chain start — reached by walking forward from one
    const chain = [t];
    let next = successorOf.get(t.id);
    while (next) {
      chain.push(next);
      next = successorOf.get(next.id);
    }
    chains.push(chain);
  }

  return (
    <div className="max-w-3xl">
      <p className="text-sm text-gs-gray">
        <Link href={`/projects/${project.id}`} className="hover:underline">
          {project.name}
        </Link>
      </p>
      <h1 className="mt-1 text-xl font-semibold">Core Project/Task Report</h1>
      <p className="mt-1 text-sm text-gs-gray">
        Cross-group handoff chains, in sequence — revision count and time logged per stage.
      </p>

      <div className="mt-6 flex flex-col gap-4">
        {chains.length === 0 && <p className="text-sm text-gs-gray">No tasks yet.</p>}
        {chains.map((chain) => (
          <div key={chain[0].id} className="rounded-lg border border-gs-gray/15 bg-white p-4">
            <div className="flex flex-wrap items-stretch gap-2">
              {chain.map((t, i) => (
                <div key={t.id} className="flex items-center gap-2">
                  <Link
                    href={`/projects/${project.id}/tasks/${t.id}`}
                    className="flex min-w-[180px] flex-col gap-1 rounded-md border border-gs-gray/15 px-3 py-2 text-sm hover:bg-gs-light"
                  >
                    <span className="text-xs uppercase text-gs-gray">{t.group?.name ?? "Ungrouped"}</span>
                    <span className="font-medium">{t.name}</span>
                    <span className="text-xs text-gs-gray">{t.assignedTo?.name ?? "Unassigned"} · {STATUS_LABELS[t.status]}</span>
                    <span className="text-xs text-gs-gray">Revisions: {t.revisionCount} · Logged: {formatDuration(secondsFor(t))}</span>
                  </Link>
                  {i < chain.length - 1 && <span className="text-gs-gray">→</span>}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
