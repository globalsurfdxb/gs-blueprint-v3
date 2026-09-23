import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { isLead, SOCIAL_MEDIA_POD_NAME, CONTENT_POD_NAME, DESIGN_POD_NAME } from "@/lib/permissions";
import { formatDate } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { daysOverdue } from "@/lib/timezone";

export default async function MyReviewsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!isLead(user)) redirect("/");

  const now = new Date();

  // Cross-project queue for a Lead's own groups — the "beside My Tasks" counterpart to
  // their personal backlog, not scoped to one project the way the project detail page's
  // group card is. Two things land here: work submitted for review, and a cross-group
  // handoff that arrived unassigned — the receiving Lead has to route it (to themselves or
  // a Contributor) before anyone can act on it, and today that's only ever surfaced by a
  // one-time notification. A missed notification left it invisible until someone happened
  // to open the project's Task Groups view, so it belongs in this queue too.
  const tasks = await prisma.task.findMany({
    where: {
      group: { leadUserId: user.id },
      project: { status: { not: "COMPLETED" }, archivedAt: null },
      OR: [{ status: "REVIEW" }, { assignedToId: null, status: { not: "COMPLETED" } }],
    },
    include: { project: { include: { client: true } }, assignedTo: true, parentTask: true },
    orderBy: { dueDate: "asc" },
  });

  const groups = new Map<string, { project: (typeof tasks)[number]["project"]; tasks: typeof tasks }>();
  for (const t of tasks) {
    const existing = groups.get(t.projectId);
    if (existing) {
      existing.tasks.push(t);
    } else {
      groups.set(t.projectId, { project: t.project, tasks: [t] });
    }
  }

  // Content Calendar approval checkpoints (see approveCalendarHandoffToDesign /
  // approveCalendarFinalDelivery): these sit in Completed, not Review, and in a group this
  // user doesn't lead (Content or Design), so the query above never surfaces them — but
  // they're still an action waiting on this project's own Social Media Lead, so they
  // belong in the same "waiting on you" queue.
  const socialMediaGroups = await prisma.taskGroup.findMany({
    where: {
      leadUserId: user.id,
      pod: { name: SOCIAL_MEDIA_POD_NAME },
      project: { status: { not: "COMPLETED" }, archivedAt: null },
    },
    select: { projectId: true },
  });
  const calendarProjectIds = socialMediaGroups.map((g) => g.projectId);

  let calendarPending: ((typeof tasks)[number] & { calendarStage: "content" | "design" })[] = [];
  if (calendarProjectIds.length > 0) {
    const contentCandidates = await prisma.task.findMany({
      where: {
        projectId: { in: calendarProjectIds },
        status: "COMPLETED",
        publishDate: { not: null },
        contentTypeId: { not: null },
        group: { pod: { name: CONTENT_POD_NAME } },
      },
      include: { project: { include: { client: true } }, assignedTo: true, parentTask: true },
      orderBy: { dueDate: "asc" },
    });
    const contentIds = contentCandidates.map((t) => t.id);
    const successors =
      contentIds.length > 0
        ? await prisma.task.findMany({ where: { predecessorTaskId: { in: contentIds } }, select: { predecessorTaskId: true } })
        : [];
    const hasSuccessor = new Set(successors.map((s) => s.predecessorTaskId));
    const contentPending = contentCandidates
      .filter((t) => !hasSuccessor.has(t.id))
      .map((t) => ({ ...t, calendarStage: "content" as const }));

    const designPending = (
      await prisma.task.findMany({
        where: {
          projectId: { in: calendarProjectIds },
          status: "COMPLETED",
          publishDate: { not: null },
          contentTypeId: { not: null },
          calendarApprovedAt: null,
          group: { pod: { name: DESIGN_POD_NAME } },
        },
        include: { project: { include: { client: true } }, assignedTo: true, parentTask: true },
        orderBy: { dueDate: "asc" },
      })
    ).map((t) => ({ ...t, calendarStage: "design" as const }));

    calendarPending = [...contentPending, ...designPending];
  }

  const calendarGroups = new Map<string, { project: (typeof tasks)[number]["project"]; tasks: typeof calendarPending }>();
  for (const t of calendarPending) {
    const existing = calendarGroups.get(t.projectId);
    if (existing) {
      existing.tasks.push(t);
    } else {
      calendarGroups.set(t.projectId, { project: t.project, tasks: [t] });
    }
  }

  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-semibold">My Reviews</h1>
      <p className="mt-1 text-sm text-gs-gray">
        Work submitted for your review, or still unassigned, across every project you lead a Task Group on.
      </p>

      {groups.size === 0 && calendarGroups.size === 0 && (
        <p className="mt-6 text-sm text-gs-gray">Nothing waiting on your review.</p>
      )}

      {calendarGroups.size > 0 && (
        <div className="mt-6 flex flex-col gap-6">
          <h2 className="text-sm font-semibold uppercase text-gs-gray">Content Calendar Approvals</h2>
          {Array.from(calendarGroups.values()).map(({ project, tasks: projectTasks }) => (
            <div key={project.id}>
              <h3 className="text-sm font-semibold">
                {project.name} <span className="text-gs-gray">· {project.client.name}</span>
              </h3>
              <div className="mt-2 overflow-hidden rounded-lg border border-gs-gray/15 bg-white">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] text-sm">
                    <thead className="bg-gs-light text-left text-xs uppercase text-gs-gray">
                      <tr>
                        <th className="whitespace-nowrap px-4 py-3">Task</th>
                        <th className="whitespace-nowrap px-4 py-3">Assignee</th>
                        <th className="whitespace-nowrap px-4 py-3">Due Date</th>
                        <th className="whitespace-nowrap px-4 py-3">Needs</th>
                      </tr>
                    </thead>
                    <tbody>
                      {projectTasks.map((t) => (
                        <tr key={t.id} className="border-t border-gs-gray/10">
                          <td className="px-4 py-3">
                            <Link href={`/projects/${t.projectId}/tasks/${t.id}`} className="font-medium hover:underline">
                              {t.name}
                            </Link>
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-gs-gray">{t.assignedTo?.name ?? "Unassigned"}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-gs-gray">{formatDate(t.dueDate)}</td>
                          <td className="whitespace-nowrap px-4 py-3">
                            <span className="font-medium text-gs-red">
                              {t.calendarStage === "content" ? "Approve → Design" : "Approve Final Delivery"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-6 flex flex-col gap-6">
        {Array.from(groups.values()).map(({ project, tasks: projectTasks }) => (
          <div key={project.id}>
            <h2 className="text-sm font-semibold">
              {project.name} <span className="text-gs-gray">· {project.client.name}</span>
            </h2>
            <div className="mt-2 overflow-hidden rounded-lg border border-gs-gray/15 bg-white">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead className="bg-gs-light text-left text-xs uppercase text-gs-gray">
                    <tr>
                      <th className="whitespace-nowrap px-4 py-3">Task</th>
                      <th className="whitespace-nowrap px-4 py-3">Assignee</th>
                      <th className="whitespace-nowrap px-4 py-3">Due Date</th>
                      <th className="whitespace-nowrap px-4 py-3">Priority</th>
                      <th className="whitespace-nowrap px-4 py-3">Revisions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {projectTasks.map((t) => {
                      const late = daysOverdue(t.dueDate, t.assignedTo?.location, now);
                      return (
                        <tr key={t.id} className="border-t border-gs-gray/10">
                          <td className="px-4 py-3">
                            <Link href={`/projects/${t.projectId}/tasks/${t.id}`} className="font-medium hover:underline">
                              {t.parentTask ? `${t.parentTask.name} › ${t.name}` : t.name}
                            </Link>
                          </td>
                          <td className="whitespace-nowrap px-4 py-3">
                            {t.assignedTo ? (
                              <span className="text-gs-gray">{t.assignedTo.name}</span>
                            ) : (
                              <span className="font-medium text-gs-red">Not Assigned</span>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-gs-gray">
                            {formatDate(t.dueDate)}
                            {late !== null && (
                              <span className={late > 0 ? "ml-1 text-gs-red" : "ml-1 text-gs-gray"}>
                                ({late} day{late === 1 ? "" : "s"})
                              </span>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-gs-gray">{t.priority}</td>
                          <td className="px-4 py-3">
                            <span
                              className={
                                t.revisionCount >= 2
                                  ? "text-gs-red"
                                  : t.revisionCount === 1
                                    ? "text-amber-600"
                                    : "text-gs-gray"
                              }
                            >
                              {t.revisionCount}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
