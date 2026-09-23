"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import {
  canCreateTaskInGroup,
  canSelfCreateInGroup,
  canCreateSubtaskInGroup,
  canAssignHandoffTask,
  canAssignAnyoneInGroup,
  canReassignTask,
  canReassignBugWithinGroup,
  isRoleContributorInGroup,
  canDeleteTask,
  canManageSprints,
} from "@/lib/permissions";
import { notifyUsers } from "@/lib/notifications";

const PRIORITY_VALUES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
const SEVERITY_VALUES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;
const ENVIRONMENT_VALUES = ["FRONTEND", "BACKEND", "BOTH"] as const;

const createTaskSchema = z.object({
  groupId: z.string().min(1, "Select a Task Group."),
  name: z.string().min(1, "Task name is required."),
  description: z.string().optional(),
  assignedToId: z.string().min(1, "Assignee is required."),
  priority: z.enum(PRIORITY_VALUES),
  dueDate: z.string().min(1, "Due date is required."),
  // QA / Bug Tracking (PRD 8.2.4). Bug-only fields are validated below against taskType.
  taskType: z.enum(["STANDARD", "BUG"]).optional(),
  severity: z.enum(SEVERITY_VALUES).optional(),
  stepsToReproduce: z.string().optional(),
  environment: z.enum(ENVIRONMENT_VALUES).optional(),
  // Agile Sprint Workflow (PRD 8.14) — optional; blank = Backlog.
  sprintId: z.string().optional(),
});

// Single source of truth for task-creation rules (permissions, bug routing, sprint gating,
// notifications). Both the unified drawer and any future caller go through this; it returns the
// new task id and never redirects, so the caller decides what to do next.
async function createTaskCore(projectId: string, formData: FormData): Promise<string> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not signed in.");

  const parsed = createTaskSchema.safeParse({
    groupId: formData.get("groupId"),
    name: formData.get("name"),
    description: formData.get("description") || undefined,
    assignedToId: formData.get("assignedToId"),
    priority: formData.get("priority"),
    dueDate: formData.get("dueDate"),
    taskType: formData.get("taskType") || undefined,
    severity: formData.get("severity") || undefined,
    stepsToReproduce: formData.get("stepsToReproduce") || undefined,
    environment: formData.get("environment") || undefined,
    sprintId: formData.get("sprintId") || undefined,
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input.");
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      taskGroups: {
        select: {
          id: true,
          leadUserId: true,
          podId: true,
          clusterId: true,
          pod: { select: { name: true, bugTrackingEnabled: true, sprintWorkflowEnabled: true } },
        },
      },
    },
  });
  if (!project) throw new Error("Project not found.");
  const group = project.taskGroups.find((g) => g.id === parsed.data.groupId);
  if (!group) throw new Error("Task Group not found.");

  // Sprint (PRD 8.14): optional; blank = Backlog. If set, the group's discipline must have
  // Sprint Workflow on, the sprint must belong to this project, and the creator must be able
  // to manage sprints here (Lead/CH/Admin) — never a workflow gate, just a planning field.
  const sprintId = parsed.data.sprintId || null;
  if (sprintId) {
    if (!group.pod?.sprintWorkflowEnabled) {
      throw new Error("Sprint Workflow isn't enabled for this discipline.");
    }
    const sprintEnabledGroups = project.taskGroups.filter((g) => g.pod?.sprintWorkflowEnabled);
    if (!canManageSprints(user, project, sprintEnabledGroups)) {
      throw new Error("You don't have permission to assign Sprints on this project.");
    }
    const sprint = await prisma.sprint.findUnique({ where: { id: sprintId }, select: { projectId: true } });
    if (!sprint || sprint.projectId !== projectId) {
      throw new Error("That Sprint doesn't belong to this project.");
    }
  }

  const privileged = canCreateTaskInGroup(user, project);
  const selfCreate = !privileged && canSelfCreateInGroup(user, group);
  if (!privileged && !selfCreate) {
    throw new Error(
      "Only a Lead attached to this project, its Cluster Head or Account Manager, or an Admin can create tasks on it.",
    );
  }

  const isBug = parsed.data.taskType === "BUG";

  // A Contributor self-creating in their own group is normally auto-assigned to themselves —
  // the submitted assignee is ignored, so they can never assign to a different Contributor
  // (that stays Lead-only). Privileged creators keep the cross-team handoff boundary.
  //
  // Bug override (PRD 8.2.4, v1.24): a Bug ALWAYS routes to the group's Lead for triage on
  // creation — overriding both the self-assignment rule and any submitted assignee, for every
  // creator (a QA Contributor reporting a bug, a Dev Contributor self-reporting one on their
  // own work, the Lead, or Admin). No exception for self-reported bugs. The Lead then reassigns
  // it to a developer with the existing Lead reassignment control. Standard tasks are unchanged.
  let assignedToId = selfCreate ? user.id : parsed.data.assignedToId;
  if (isBug) {
    assignedToId = group.leadUserId;
  }
  if (privileged && !canAssignAnyoneInGroup(user, group) && assignedToId !== group.leadUserId) {
    throw new Error("You can only assign a task in another team's group to that group's own Lead.");
  }

  // QA / Bug Tracking (PRD 8.2.4), enforced server-side:
  // - a Bug can only be created in a discipline (pod) with Bug Tracking enabled;
  // - Severity + Environment are required for a Bug and forbidden on a Standard task.
  if (isBug && !group.pod?.bugTrackingEnabled) {
    throw new Error("Bug Tracking isn't enabled for this discipline.");
  }
  if (isBug && (!parsed.data.severity || !parsed.data.environment)) {
    throw new Error("A Bug needs a Severity and an Environment.");
  }

  const task = await prisma.task.create({
    data: {
      projectId,
      groupId: group.id,
      name: parsed.data.name,
      description: parsed.data.description,
      assignedToId,
      priority: parsed.data.priority,
      dueDate: new Date(parsed.data.dueDate),
      createdById: user.id,
      // Bug-only fields are stored only for a Bug; a Standard task never carries them.
      taskType: isBug ? "BUG" : "STANDARD",
      severity: isBug ? parsed.data.severity : null,
      stepsToReproduce: isBug ? parsed.data.stepsToReproduce ?? null : null,
      environment: isBug ? parsed.data.environment : null,
      sprintId,
    },
  });

  if (isBug) {
    // The bug was routed to the Lead for triage (v1.24) — notify them it needs assigning to a
    // developer, unless the Lead created it themselves.
    if (group.leadUserId !== user.id) {
      await notifyUsers([group.leadUserId], {
        type: "TASK_ASSIGNED",
        message: `${user.name} reported a bug "${task.name}" in your group — assign it for triage.`,
        relatedTaskId: task.id,
        relatedProjectId: projectId,
      });
    }
  } else if (selfCreate) {
    // Notify the group's Lead that work landed in their group that they didn't assign
    // ("Task Self-Created", PRD 8.7) — skip if the creator somehow is the Lead.
    if (group.leadUserId !== user.id) {
      await notifyUsers([group.leadUserId], {
        type: "TASK_ASSIGNED",
        message: `${user.name} self-created and took "${task.name}" in your group.`,
        relatedTaskId: task.id,
        relatedProjectId: projectId,
      });
    }
  } else {
    await notifyUsers([task.assignedToId], {
      type: "TASK_ASSIGNED",
      message: `You were assigned "${task.name}".`,
      relatedTaskId: task.id,
      relatedProjectId: projectId,
    });
  }

  revalidatePath(`/projects/${projectId}`);
  return task.id;
}

/** Create a task from the unified task drawer (final build) — identical rules to the old
 * full-page create (via createTaskCore), but it returns instead of redirecting so the drawer
 * can close in place and the underlying view refreshes. */
export async function createTaskInDrawer(projectId: string, formData: FormData) {
  await createTaskCore(projectId, formData);
}

const createSubtaskSchema = z.object({
  name: z.string().min(1, "Subtask name is required."),
  priority: z.enum(PRIORITY_VALUES),
  dueDate: z.string().min(1, "Due date is required."),
});

export async function createSubtask(projectId: string, parentTaskId: string, formData: FormData) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not signed in.");

  const parentTask = await prisma.task.findUnique({ where: { id: parentTaskId } });
  if (!parentTask) throw new Error("Task not found.");
  const group = parentTask.groupId
    ? await prisma.taskGroup.findUnique({ where: { id: parentTask.groupId } })
    : null;
  if (!canCreateSubtaskInGroup(user, group, parentTask)) {
    throw new Error("You don't have permission to add a subtask here.");
  }

  const parsed = createSubtaskSchema.safeParse({
    name: formData.get("name"),
    priority: formData.get("priority"),
    dueDate: formData.get("dueDate"),
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input.");
  }

  // Subtasks are locked to their creator (PRD v1.1 decision #11) and inherit the
  // parent's Task Group — they're the same discipline's work, just broken down.
  await prisma.task.create({
    data: {
      projectId,
      parentTaskId,
      groupId: parentTask.groupId,
      name: parsed.data.name,
      assignedToId: user.id,
      priority: parsed.data.priority,
      dueDate: new Date(parsed.data.dueDate),
      createdById: user.id,
    },
  });

  revalidatePath(`/projects/${projectId}/tasks/${parentTaskId}`);
}

const assignTaskSchema = z.object({
  assignedToId: z.string().min(1, "Select someone to assign this task to."),
});

/** Assigns a currently-unassigned task — the path a cross-group handoff's receiving
 * Lead uses to hand the new task to a member of their own group. */
export async function assignHandoffTask(taskId: string, formData: FormData) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not signed in.");

  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) throw new Error("Task not found.");
  if (task.assignedToId) throw new Error("This task is already assigned.");

  const group = task.groupId ? await prisma.taskGroup.findUnique({ where: { id: task.groupId } }) : null;
  if (!canAssignHandoffTask(user, group)) {
    throw new Error("Only this group's Lead (or Admin) can assign this task.");
  }

  const parsed = assignTaskSchema.safeParse({ assignedToId: formData.get("assignedToId") });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input.");
  }

  await prisma.task.update({ where: { id: taskId }, data: { assignedToId: parsed.data.assignedToId } });

  await notifyUsers([parsed.data.assignedToId], {
    type: "TASK_ASSIGNED",
    message: `You were assigned "${task.name}".`,
    relatedTaskId: task.id,
    relatedProjectId: task.projectId,
  });

  revalidatePath(`/projects/${task.projectId}/tasks/${taskId}`);
}

/** Reassigns an already-assigned task. Two authority paths:
 *  - Standard (and the default for everything): a group's own Lead (or Admin) delegates a task
 *    that landed on them to one of their own Contributors — canReassignTask.
 *  - Bug-only (PRD v1.18): on a BUG in a Bug-Tracking group, any Contributor member of that
 *    group can hand it to another Contributor in the same group with no Lead step, so a
 *    QA↔fixer retest loop doesn't route through the Lead. The target is validated server-side. */
export async function reassignTask(taskId: string, formData: FormData) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not signed in.");

  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) throw new Error("Task not found.");

  const group = task.groupId
    ? await prisma.taskGroup.findUnique({
        where: { id: task.groupId },
        select: {
          leadUserId: true,
          podId: true,
          clusterId: true,
          pod: { select: { bugTrackingEnabled: true } },
        },
      })
    : null;

  const groupRef = group ? { leadUserId: group.leadUserId, podId: group.podId } : null;
  const leadPath = canReassignTask(user, groupRef, task);
  const bugPath =
    !leadPath &&
    canReassignBugWithinGroup(
      user,
      group ? { ...groupRef!, clusterId: group.clusterId, bugTrackingEnabled: group.pod?.bugTrackingEnabled } : null,
      task,
    );

  if (!leadPath && !bugPath) {
    throw new Error(
      "Only this task's group Lead or Admin can reassign it — or, for a bug, a Contributor on its team. It must not be Completed.",
    );
  }

  const parsed = assignTaskSchema.safeParse({ assignedToId: formData.get("assignedToId") });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input.");
  }

  // The Bug same-group exception is narrow: when a Contributor (not a Lead/Admin) performs the
  // reassignment, the target must be a Contributor already in this same group — never the Lead,
  // never someone outside the team. The Lead/Admin path keeps its existing full-team pool.
  if (bugPath) {
    const targetRole = await prisma.userRole.findUnique({
      where: { userId: parsed.data.assignedToId },
      select: { role: true, clusterId: true, podId: true },
    });
    if (!isRoleContributorInGroup(targetRole, { clusterId: group!.clusterId, podId: group!.podId })) {
      throw new Error("A bug can only be reassigned to a Contributor on the same team.");
    }
  }

  await prisma.task.update({ where: { id: taskId }, data: { assignedToId: parsed.data.assignedToId } });

  if (parsed.data.assignedToId !== task.assignedToId) {
    await notifyUsers([parsed.data.assignedToId], {
      type: "TASK_ASSIGNED",
      message: `You were assigned "${task.name}".`,
      relatedTaskId: task.id,
      relatedProjectId: task.projectId,
    });
  }

  revalidatePath(`/projects/${task.projectId}/tasks/${taskId}`);
}

/**
 * Hard-delete a task and everything that hangs off it — Admin only (team feedback #10).
 * There are no ON DELETE CASCADE rules in the schema, so each dependent is removed
 * explicitly in one transaction, and the task's own subtasks are folded into the same
 * sweep (a subtask is a private breakdown, never orphaned into a project on its own).
 *
 * Handoff chain: if a downstream task points back to any of these via predecessorTaskId,
 * that link is nulled first so the successor survives as a standalone task rather than
 * being force-deleted along with its predecessor.
 */
export async function deleteTask(taskId: string, _formData: FormData) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not signed in.");

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      projectId: true,
      groupId: true,
      createdById: true,
      status: true,
      subtasks: { select: { id: true, status: true } },
      _count: { select: { comments: true, timeLogs: true } },
    },
  });
  if (!task) throw new Error("Task not found.");

  const group = task.groupId
    ? await prisma.taskGroup.findUnique({ where: { id: task.groupId }, select: { leadUserId: true, podId: true } })
    : null;

  // WHO: creator, group Lead, or Admin (PRD 8.2).
  if (!canDeleteTask(user, group, task)) {
    throw new Error("Only this task's creator, its group Lead, or an Admin can delete it.");
  }

  const subtaskIds = task.subtasks.map((s) => s.id);
  const ids = [task.id, ...subtaskIds];

  // ACTIVITY GUARD (mirrors user hard-delete, PRD 5.7): block entirely — not just warn —
  // the moment the task (or any of its subtasks) has real activity. "Real activity" =
  // any time logged, any comment, or a status that ever moved beyond New.
  const [logCount, commentCount] = await Promise.all([
    prisma.timeLog.count({ where: { taskId: { in: ids } } }),
    prisma.comment.count({ where: { taskId: { in: ids } } }),
  ]);
  const anyStatusAdvanced = task.status !== "NEW" || task.subtasks.some((s) => s.status !== "NEW");
  if (logCount > 0 || commentCount > 0 || anyStatusAdvanced) {
    throw new Error(
      "This task has activity (time logged, comments, or work started) and can no longer be deleted — close it out via Completed or Handoff instead.",
    );
  }

  await prisma.$transaction([
    // Break any handoff-chain link pointing INTO these tasks (keeps the successor).
    prisma.task.updateMany({
      where: { predecessorTaskId: { in: ids } },
      data: { predecessorTaskId: null },
    }),
    prisma.taskAttachment.deleteMany({ where: { taskId: { in: ids } } }),
    prisma.notification.deleteMany({ where: { relatedTaskId: { in: ids } } }),
    // Subtasks (children) before the parent to satisfy the self-referential FK.
    prisma.task.deleteMany({ where: { id: { in: subtaskIds } } }),
    prisma.task.delete({ where: { id: task.id } }),
  ]);

  revalidatePath(`/projects/${task.projectId}`);
  redirect(`/projects/${task.projectId}`);
}
