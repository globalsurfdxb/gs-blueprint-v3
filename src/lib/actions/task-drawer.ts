"use server";

import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { canViewTask, canManageSprints, canEditTaskAttributes, isAdmin } from "@/lib/permissions";
import { resolveTaskAssigneeContext } from "@/lib/task-assignment";
import { getTaskRound } from "@/lib/task-chain";
import { formatDate } from "@/lib/format";

// Data for the Dev/QA quick-edit drawer (PRD Agile Sprint enhancement). A read-only fetch
// (via a server action so it can authorize with getCurrentUser) returning everything the
// drawer renders. Gated by canViewTask — identical visibility to the full detail page.

export type DrawerComment = {
  id: string;
  text: string;
  isEdited: boolean;
  createdAt: Date;
  author: { id: string; name: string };
};

export type TaskDrawerData = {
  id: string;
  projectId: string;
  fullViewHref: string;
  name: string;
  taskType: string;
  status: string;
  priority: string;
  severity: string | null;
  dueDateLabel: string;
  revisionCount: number;
  round: number;
  hasChain: boolean;
  groupName: string | null;
  discipline: string | null;
  projectName: string;
  clientName: string;
  assignedToId: string | null;
  assignedToName: string | null;
  // Assignee editing
  canReassign: boolean;
  reassignBugMode: boolean;
  assignees: { id: string; name: string }[];
  // Sprint editing
  canManageSprint: boolean;
  sprintId: string | null;
  sprints: { id: string; name: string; status: string }[];
  // Priority / Severity editing
  canEditAttributes: boolean;
  // Comments
  comments: DrawerComment[];
  canDeleteComment: boolean;
  currentUserId: string;
  viewerLocation: string;
};

export async function getTaskDrawerData(taskId: string): Promise<TaskDrawerData> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not signed in.");

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      assignedTo: { select: { name: true } },
      group: {
        select: {
          id: true,
          name: true,
          leadUserId: true,
          podId: true,
          clusterId: true,
          pod: { select: { name: true, bugTrackingEnabled: true, sprintWorkflowEnabled: true } },
        },
      },
      sprint: { select: { id: true } },
      comments: { include: { author: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } },
      predecessorTask: { select: { id: true } },
      successorTask: { select: { id: true } },
    },
  });
  if (!task) throw new Error("Task not found.");

  const project = await prisma.project.findUnique({
    where: { id: task.projectId },
    include: {
      client: { select: { name: true } },
      taskGroups: { select: { id: true, leadUserId: true, podId: true, pod: { select: { name: true, sprintWorkflowEnabled: true } } } },
    },
  });
  if (!project) throw new Error("Project not found.");

  if (!(await canViewTask(user, project, task))) {
    throw new Error("You don't have access to this task.");
  }

  const group = task.group;
  const assigneeCtx = await resolveTaskAssigneeContext(user, project, group, task);

  const sprintEnabledGroups = project.taskGroups.filter((g) => g.pod?.sprintWorkflowEnabled);
  const canManageSprint = !!group?.pod?.sprintWorkflowEnabled && canManageSprints(user, project, sprintEnabledGroups);
  const sprints = canManageSprint
    ? await prisma.sprint.findMany({
        where: { projectId: project.id, OR: [{ status: { not: "COMPLETED" } }, { id: task.sprintId ?? "" }] },
        orderBy: [{ status: "asc" }, { startDate: "asc" }],
        select: { id: true, name: true, status: true },
      })
    : [];

  const round = await getTaskRound(task);

  return {
    id: task.id,
    projectId: task.projectId,
    fullViewHref: `/projects/${task.projectId}/tasks/${task.id}`,
    name: task.name,
    taskType: task.taskType,
    status: task.status,
    priority: task.priority,
    severity: task.severity,
    dueDateLabel: formatDate(task.dueDate),
    revisionCount: task.revisionCount,
    round,
    hasChain: !!(task.predecessorTask || task.successorTask),
    groupName: group?.name ?? null,
    discipline: group?.pod?.name ?? null,
    projectName: project.name,
    clientName: project.client.name,
    assignedToId: task.assignedToId,
    assignedToName: task.assignedTo?.name ?? null,
    canReassign: assigneeCtx.canReassign || assigneeCtx.canReassignBug,
    reassignBugMode: assigneeCtx.canReassignBug && !assigneeCtx.canReassign,
    assignees: assigneeCtx.assignees,
    canManageSprint,
    sprintId: task.sprintId,
    sprints,
    canEditAttributes: canEditTaskAttributes(user, project, group),
    comments: task.comments.map((c) => ({
      id: c.id,
      text: c.text,
      isEdited: c.isEdited,
      createdAt: c.createdAt,
      author: { id: c.author.id, name: c.author.name },
    })),
    canDeleteComment: isAdmin(user),
    currentUserId: user.id,
    viewerLocation: user.location,
  };
}
