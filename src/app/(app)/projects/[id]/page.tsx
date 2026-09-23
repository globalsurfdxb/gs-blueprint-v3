import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import type { CurrentUser } from "@/lib/auth";
import {
  canViewProject,
  canManageTaskGroups,
  canAttachLeadRole,
  canManageThisGroup,
  canEditProjectInCluster,
  canViewMaxAllocatedHours,
  canViewAllProjectGroups,
  canOverseeGroup,
  canCreateTaskInGroup,
  canViewGroupTimeRollup,
  canViewProjectTimeRollup,
  canAssignAccountManager,
  canAssignDependencyTracker,
  canManageSprints,
  canSetTeamCapacity,
  canManageMilestones,
  getEligibleAccountManagers,
  getEligibleDependencyTrackers,
  isAdmin,
  isProjectSocialMediaLead,
  isCalendarPipelinePod,
  canSelfCreateInGroup,
} from "@/lib/permissions";
import { isCompletionTrackedPod, computeGroupCompletion } from "@/lib/completion";
import { CompletionSection } from "./completion-section";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/format";
import {
  updateProject,
  attachTaskGroup,
  removeTaskGroup,
  archiveProject,
  unarchiveProject,
} from "@/lib/actions/projects";
import { ArchiveProjectButton } from "./archive-project-button";
import { UnarchiveProjectButton } from "../unarchive-project-button";
import {
  addProjectAttachment,
  editProjectAttachment,
  deleteProjectAttachment,
} from "@/lib/actions/project-attachments";
import { formatDuration, secondsSince } from "@/lib/format";
import { daysOverdue } from "@/lib/timezone";
import { createSprint, updateSprint, setSprintStatus } from "@/lib/actions/sprints";
import { setTeamCapacity } from "@/lib/actions/team-capacity";
import { createMilestone, updateMilestone, toggleMilestone, reorderMilestone, deleteMilestone } from "@/lib/actions/milestones";
import { MilestonesSection } from "./milestones-section";
import { ProjectEditForm } from "./project-edit-form";
import { TaskGroupsSection } from "./task-groups-section";
import { SprintsSection } from "./sprints-section";
import { TaskViews, type ViewTask } from "@/components/task-views";
import { TaskDrawerProvider } from "@/components/task-drawer";
import { ProjectAttachmentsSection } from "./attachments-section";

/**
 * Sorts a project's visible Task Groups so the ones most relevant to the logged-in user
 * surface first: their own Lead-owned group, then a group matching their pod or cluster
 * scope (covers Contributors and pod-restricted Cluster Heads too), then everything else
 * in its original (attach) order. Applies uniformly regardless of role — cluster, pod, or
 * Lead login all get their own group(s) surfaced first.
 */
/** Shared row shape for both grouped and ungrouped task tables — Due Date, Priority,
 * Status, Revisions, and how many days late the assignee's own local calendar day is
 * past the due date (PRD 9.5: computed per-assignee timezone, not server/viewer time). */
type RowInput = {
  id: string;
  name: string;
  status: string;
  priority: string;
  dueDate: Date;
  revisionCount: number;
  taskType: string;
  assignedToId: string | null;
  assignedTo: { name: string; location: string } | null;
  subtasks?: RowInput[];
};

type GroupTaskRow = {
  id: string;
  name: string;
  status: string;
  priority: string;
  dueDate: string;
  revisionCount: number;
  taskType: string;
  assigneeId: string | null;
  assigneeName: string | null;
  daysOverdue: number | null;
  isTimerRunning: boolean;
  subtasks: GroupTaskRow[];
};

function toGroupTaskRow(t: RowInput, now: Date, runningTaskIds: Set<string>): GroupTaskRow {
  return {
    id: t.id,
    name: t.name,
    status: t.status,
    priority: t.priority,
    dueDate: formatDate(t.dueDate),
    revisionCount: t.revisionCount,
    taskType: t.taskType,
    assigneeId: t.assignedToId,
    assigneeName: t.assignedTo?.name ?? null,
    // A Completed task is historical record — "days late" no longer means anything once
    // it's done, so the badge is scoped to still-open work only (My Tasks doesn't need
    // this guard since it excludes Completed entirely, but Task Group view shows every status).
    daysOverdue: t.status === "COMPLETED" ? null : daysOverdue(t.dueDate, t.assignedTo?.location, now),
    isTimerRunning: runningTaskIds.has(t.id),
    subtasks: (t.subtasks ?? []).map((s) => toGroupTaskRow(s, now, runningTaskIds)),
  };
}

// A task as the Kanban/Calendar renderers need it. Built from the SAME visible task set the
// list uses (subtasks flattened), so all three views are scoped identically. dueKey uses the
// UTC calendar components — the same basis formatDate displays — so a card lands on the
// calendar day matching its shown Due Date.
function toViewTask(
  t: {
    id: string;
    name: string;
    status: string;
    onHoldFromStatus: string | null;
    taskType: string;
    priority: string;
    revisionCount: number;
    dueDate: Date;
    assignedTo: { name: string } | null;
    sprint?: { status: string } | null;
    sprintId?: string | null;
    groupId?: string | null;
  },
  projectId: string,
  runningTaskIds: Set<string>,
): ViewTask {
  return {
    id: t.id,
    projectId,
    sprintId: t.sprintId ?? null,
    name: t.name,
    status: t.status,
    onHoldFromStatus: t.onHoldFromStatus ?? null,
    taskType: t.taskType,
    priority: t.priority,
    revisionCount: t.revisionCount,
    assigneeName: t.assignedTo?.name ?? null,
    isTimerRunning: runningTaskIds.has(t.id),
    inActiveSprint: t.sprint?.status === "ACTIVE",
    dueKey: `${t.dueDate.getUTCFullYear()}-${String(t.dueDate.getUTCMonth() + 1).padStart(2, "0")}-${String(t.dueDate.getUTCDate()).padStart(2, "0")}`,
    dueLabel: formatDate(t.dueDate),
  };
}

function groupRelevance(
  user: CurrentUser,
  group: { leadUserId: string; podId: string | null; clusterId: string | null },
) {
  if (group.leadUserId === user.id) return 0;
  const ownRole = user.roles[0];
  if (ownRole?.podId && ownRole.podId === group.podId) return 1;
  if (ownRole && !ownRole.podId && ownRole.clusterId === group.clusterId) return 2;
  return 3;
}

export default async function ProjectDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ sprint?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const now = new Date();
  const { id } = await params;
  const { sprint: sprintParam } = await searchParams;
  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      client: true,
      serviceType: true,
      cluster: true,
      accountManager: true,
      dependencyTracker: true,
      taskGroups: { include: { lead: true, pod: true }, orderBy: { createdAt: "asc" } },
      attachments: { include: { addedBy: true }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!project) notFound();

  if (!(await canViewProject(user, project))) {
    redirect("/projects");
  }

  const isOversight = canViewAllProjectGroups(user, project);
  const canAttachGroups = canManageTaskGroups(user, project);
  // The project's own Social Media Lead planned the Content Calendar, so they also get
  // read oversight into the Content/Design tasks it generates on this same project.
  const socialMediaOversight = await isProjectSocialMediaLead(user, project.id);

  const [serviceTypes, accountManagers, dependencyTrackers, allLeadRoles, topLevelTasks, timeLogs, runningLogs] = await Promise.all([
    prisma.serviceType.findMany({ orderBy: { name: "asc" } }),
    getEligibleAccountManagers(),
    getEligibleDependencyTrackers(),
    canAttachGroups
      ? prisma.userRole.findMany({
          where: { role: "LEAD" },
          include: { user: true, cluster: true, pod: true },
          orderBy: { user: { name: "asc" } },
        })
      : Promise.resolve([]),
    prisma.task.findMany({
      where: { projectId: project.id, parentTaskId: null },
      // Subtasks nest under their parent (PRD 8.2.3) — never a flattened top-level row.
      include: {
        assignedTo: true,
        sprint: { select: { status: true } },
        subtasks: { include: { assignedTo: true, sprint: { select: { status: true } } }, orderBy: { createdAt: "asc" } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.timeLog.findMany({
      where: { task: { projectId: project.id } },
      select: { durationSeconds: true, startTime: true, task: { select: { groupId: true } } },
    }),
    // Tasks (or subtasks) with a currently-running timer — surfaced in the list view (PRD 8.2.3).
    prisma.timeLog.findMany({
      where: { endTime: null, task: { projectId: project.id } },
      select: { taskId: true },
    }),
  ]);

  const runningTaskIds = new Set(runningLogs.map((l) => l.taskId));

  // Sprint Workflow (PRD 8.14) — surfaced only when a Sprint-enabled discipline (pod) is on
  // this project. The Sprints section, Task Sprint field and board filters all key off this.
  const sprintEnabledGroups = project.taskGroups.filter((g) => g.pod?.sprintWorkflowEnabled);
  const hasSprintWorkflow = sprintEnabledGroups.length > 0;
  const canManageSprintsHere = canManageSprints(user, project, sprintEnabledGroups);
  const sprints = hasSprintWorkflow
    ? await prisma.sprint.findMany({
        where: { projectId: project.id },
        include: { _count: { select: { tasks: true } } },
        orderBy: [{ startDate: "asc" }, { createdAt: "asc" }],
      })
    : [];

  // Sprint-wise board (final build): clicking any Sprint (Planned/Active/Completed) scopes the
  // existing Kanban to just that sprint's tasks — a navigation filter, not a new screen. Only a
  // real sprint on this project counts; anything else falls back to the full board.
  const focusSprint = sprintParam ? sprints.find((s) => s.id === sprintParam) ?? null : null;

  // Project Milestones (PRD — agency-wide): an ordered checklist for every project, managed by
  // the project-management tier and read-only for everyone else who can see the project.
  const canManageMilestonesHere = canManageMilestones(user, project);
  const milestones = await prisma.milestone.findMany({
    where: { projectId: project.id },
    orderBy: { order: "asc" },
  });

  // Every LEAD-role instance not already representing a discipline on this project —
  // one option per (user, cluster, pod) tuple, since attaching picks a specific one. A
  // pod-restricted Cluster Head only sees Leads from their own pod(s) in this dropdown.
  const attachedLeadUserIds = new Set(project.taskGroups.map((g) => g.leadUserId));
  const availableLeadRoles = allLeadRoles.filter(
    (r) => r.user.isActive && !attachedLeadUserIds.has(r.userId) && canAttachLeadRole(user, project, r),
  );

  const secondsByGroup = new Map<string, number>();
  let projectTotalSeconds = 0;
  for (const log of timeLogs) {
    const seconds = log.durationSeconds ?? secondsSince(log.startTime);
    projectTotalSeconds += seconds;
    if (log.task.groupId) {
      secondsByGroup.set(log.task.groupId, (secondsByGroup.get(log.task.groupId) ?? 0) + seconds);
    }
  }

  const tasksByGroupId = new Map<string, typeof topLevelTasks>();
  const ungroupedTasks: typeof topLevelTasks = [];
  for (const t of topLevelTasks) {
    if (!t.groupId) {
      ungroupedTasks.push(t);
      continue;
    }
    const arr = tasksByGroupId.get(t.groupId) ?? [];
    arr.push(t);
    tasksByGroupId.set(t.groupId, arr);
  }

  // Task Group *existing-task* visibility is strict (Task Grouping & Cross-Group Handoff,
  // rule 2): a Lead sees the full task list only for their own group; oversight roles
  // (Admin/Cluster Head/Account-Client-Services) see every group's tasks. Task *creation*
  // is project-wide for any Lead attached to this project — so every group's card is
  // surfaced to them (to create/hand off into it) even when its existing tasks stay
  // hidden beyond their own.
  const canCreateAnywhere = canCreateTaskInGroup(user, project);
  const groupCards = project.taskGroups
    .map((group) => {
      const tasks = tasksByGroupId.get(group.id) ?? [];
      const isThisGroupsLead = group.leadUserId === user.id;
      const isCalendarPipelineOversight = socialMediaOversight && isCalendarPipelinePod(group.pod?.name);
      const canSeeAllTasks = canOverseeGroup(user, project, group) || isThisGroupsLead || isCalendarPipelineOversight;
      const isOwnTask = (t: (typeof tasks)[number]) => t.assignedToId === user.id || t.createdById === user.id;
      const hasOwnTask = tasks.some(isOwnTask);
      // A Contributor may self-create in a group that belongs to their own pod (PRD 8.2).
      const canSelfCreateHere = canSelfCreateInGroup(user, group);
      const visible = canSeeAllTasks || hasOwnTask || canCreateAnywhere || canSelfCreateHere;
      const shownTasks = canSeeAllTasks ? tasks : tasks.filter(isOwnTask);
      return {
        group,
        visible,
        shownTasks,
        hasHiddenTasks: !canSeeAllTasks && tasks.length > shownTasks.length,
        canCreateTask: canCreateAnywhere || canSelfCreateHere,
        canRemove: canManageThisGroup(user, project, group) && tasks.length === 0,
        totalSeconds:
          canViewGroupTimeRollup(user, project, group) || isCalendarPipelineOversight
            ? secondsByGroup.get(group.id) ?? 0
            : null,
      };
    })
    .filter((c) => c.visible)
    .sort((a, b) => groupRelevance(user, a.group) - groupRelevance(user, b.group));

  const shownUngroupedTasks = isOversight
    ? ungroupedTasks
    : ungroupedTasks.filter((t) => t.assignedToId === user.id || t.createdById === user.id);

  // Project Completion % (final build) — one card per attached Development/Design Task Group the
  // viewer may see: oversight roles see every qualifying discipline; a Lead sees only their own
  // group. Empty (section hidden) on projects with no Dev/Design group, e.g. SEO/Social retainers.
  const allTasksFlat = topLevelTasks.flatMap((t) => [t, ...(t.subtasks ?? [])]);
  const completionGroups = project.taskGroups
    .filter(
      (g) =>
        isCompletionTrackedPod(g.pod?.name) &&
        (canOverseeGroup(user, project, g) || g.leadUserId === user.id),
    )
    .map((g) => {
      const groupTasks = allTasksFlat.filter((t) => t.groupId === g.id);
      return { id: g.id, name: g.name, ...computeGroupCompletion(groupTasks, user.location, now) };
    });

  // Flat, identically-scoped task set for the Kanban/Calendar renderings — the exact same
  // tasks the list shows (subtasks flattened into their own cards, since those views don't
  // nest). Switching view never widens what's visible (PRD 8.11 §1).
  const flatViewTasks: ViewTask[] = [
    ...groupCards.flatMap((c) => c.shownTasks),
    ...shownUngroupedTasks,
  ].flatMap((t) => [
    toViewTask(t, project.id, runningTaskIds),
    ...(t.subtasks ?? []).map((s) => toViewTask(s, project.id, runningTaskIds)),
  ]);
  const todayKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;

  const canEdit = canEditProjectInCluster(user, project);
  const canSeeMaxHours = canViewMaxAllocatedHours(user, project);
  const canSeeProjectTotal = canViewProjectTimeRollup(user, project);

  const updateProjectWithId = updateProject.bind(null, project.id);
  const attachTaskGroupWithId = attachTaskGroup.bind(null, project.id);
  const removeTaskGroupWithId = removeTaskGroup.bind(null, project.id);
  const createSprintWithId = createSprint.bind(null, project.id);
  const createMilestoneWithId = createMilestone.bind(null, project.id);
  const addProjectAttachmentWithId = addProjectAttachment.bind(null, project.id);
  const editProjectAttachmentWithId = editProjectAttachment.bind(null, project.id);
  const deleteProjectAttachmentWithId = deleteProjectAttachment.bind(null, project.id);

  return (
    // Wider than a single reading column — the Task Group tables below have 6 columns
    // (Task/Assignee/Due Date/Priority/Status/Revisions) that were cramped to ~78px for
    // Due Date at max-w-2xl, tight enough for an overdue badge to wrap awkwardly.
    <div className="max-w-4xl">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">{project.name}</h1>
        <span className="text-sm text-gs-gray">
          {project.client.name} · {project.cluster.name}
        </span>
      </div>

      {isAdmin(user) && (
        <div className="mt-3">
          {project.archivedAt ? (
            <div className="flex flex-wrap items-center gap-3 rounded-md border border-gs-gray/20 bg-gs-light px-3 py-2 text-sm">
              <span className="text-gs-gray">This project is archived — hidden from listings and reports.</span>
              <UnarchiveProjectButton action={unarchiveProject.bind(null, project.id)} />
            </div>
          ) : (
            <ArchiveProjectButton projectName={project.name} action={archiveProject.bind(null, project.id)} />
          )}
        </div>
      )}

      {canSeeProjectTotal && (
        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="inline-flex items-baseline gap-2 rounded-lg border border-gs-gray/15 bg-white px-4 py-3">
            <span className="text-xs uppercase text-gs-gray">Total Time Logged</span>
            <span className="text-lg font-semibold">{formatDuration(projectTotalSeconds)}</span>
          </div>
          <Link href={`/projects/${project.id}/report`} className="text-sm text-gs-red hover:underline">
            Core Project/Task Report
          </Link>
        </div>
      )}

      <CompletionSection groups={completionGroups} />

      {/* Constrained narrower than the page itself — short form fields/labels stretching
          to the full table width below would read as ungrounded, not "denser". */}
      <div className="mt-6 max-w-2xl">
        {canEdit ? (
          <ProjectEditForm
            action={updateProjectWithId}
            serviceTypes={serviceTypes}
            accountManagers={accountManagers}
            dependencyTrackers={dependencyTrackers}
            defaults={{ ...project, accountManagerName: project.accountManager?.name ?? null, dependencyTrackerName: project.dependencyTracker?.name ?? null }}
            canSeeMaxAllocatedHours={canSeeMaxHours}
            canAssignAccountManager={canAssignAccountManager(user, project)}
            canAssignDependencyTracker={canAssignDependencyTracker(user, project)}
          />
        ) : (
          <div className="flex flex-col gap-2 rounded-lg border border-gs-gray/15 bg-white p-6 text-sm">
            <p><span className="text-gs-gray">Service Type:</span> {project.serviceType.name}</p>
            <p><span className="text-gs-gray">Reference Number:</span> {project.referenceNumber ?? "—"}</p>
            <p><span className="text-gs-gray">Status:</span> {project.status}</p>
            {project.summary && (
              <p><span className="text-gs-gray">Summary:</span> {project.summary}</p>
            )}
            <p><span className="text-gs-gray">Account Manager:</span> {project.accountManager?.name ?? "Unassigned"}</p>
            <p><span className="text-gs-gray">Dependency Tracker:</span> {project.dependencyTracker?.name ?? "Unassigned"}</p>
            {canSeeMaxHours && (
              <p>
                <span className="text-gs-gray">Max Allocated Hours:</span>{" "}
                {project.maxAllocatedHours
                  ? `${project.maxAllocatedHours.toString()} ${project.hoursAllocationType === "MONTHLY" ? "hrs/month" : "hrs total"}`
                  : "—"}
              </p>
            )}
          </div>
        )}
      </div>

      <ProjectAttachmentsSection
        attachments={project.attachments}
        currentUserId={user.id}
        canDelete={isAdmin(user)}
        addAction={addProjectAttachmentWithId}
        editAction={editProjectAttachmentWithId}
        deleteAction={deleteProjectAttachmentWithId}
      />

      <MilestonesSection
        canManage={canManageMilestonesHere}
        createAction={createMilestoneWithId}
        toggleAction={toggleMilestone}
        updateAction={updateMilestone}
        reorderAction={reorderMilestone}
        deleteAction={deleteMilestone}
        milestones={milestones.map((m) => ({
          id: m.id,
          title: m.title,
          dueLabel: formatDate(m.dueDate),
          dueInput: m.dueDate.toISOString().slice(0, 10),
          completed: m.completed,
        }))}
      />

      {hasSprintWorkflow && (
        <SprintsSection
          projectId={project.id}
          canManage={canManageSprintsHere}
          createAction={createSprintWithId}
          updateAction={updateSprint}
          setStatusAction={setSprintStatus}
          sprints={sprints.map((s) => ({
            id: s.id,
            name: s.name,
            status: s.status,
            startLabel: formatDate(s.startDate),
            endLabel: formatDate(s.endDate),
            startInput: s.startDate.toISOString().slice(0, 10),
            endInput: s.endDate.toISOString().slice(0, 10),
            taskCount: s._count.tasks,
            datesLocked: s.status !== "PLANNED",
          }))}
        />
      )}

      <TaskDrawerProvider>
      <TaskViews
        surfacePath={`/projects/${project.id}`}
        tasks={flatViewTasks}
        todayKey={todayKey}
        sprintFilterEnabled={hasSprintWorkflow}
        focusSprint={focusSprint ? { id: focusSprint.id, name: focusSprint.name } : undefined}
      >
        <TaskGroupsSection
        projectId={project.id}
        groupCards={groupCards.map((c) => ({
          id: c.group.id,
          name: c.group.name,
          leadName: c.group.lead.name,
          tasks: c.shownTasks.map((t) => toGroupTaskRow(t, now, runningTaskIds)),
          hasHiddenTasks: c.hasHiddenTasks,
          canCreateTask: c.canCreateTask,
          canRemove: c.canRemove,
          totalSeconds: c.totalSeconds,
          // Team Capacity (hrs/wk) — Development/QA teams only; editable by Admin/Cluster Head.
          isDevQa: !!c.group.pod?.sprintWorkflowEnabled,
          capacity: c.group.capacityHoursPerWeek?.toString() ?? null,
          canEditCapacity: canSetTeamCapacity(user, project, c.group),
        }))}
        ungroupedTasks={shownUngroupedTasks.map((t) => toGroupTaskRow(t, now, runningTaskIds))}
        setCapacityAction={setTeamCapacity}
        canAttachGroups={canAttachGroups}
        availableLeadRoles={availableLeadRoles.map((r) => ({
          id: r.id,
          label: [r.user.name, [r.cluster?.name, r.pod?.name].filter(Boolean).join(" · ")].filter(Boolean).join(" · "),
        }))}
        attachAction={attachTaskGroupWithId}
        removeAction={removeTaskGroupWithId}
        />
      </TaskViews>
      </TaskDrawerProvider>
    </div>
  );
}
