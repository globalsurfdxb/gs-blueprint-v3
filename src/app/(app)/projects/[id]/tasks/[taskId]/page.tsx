import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import {
  canViewTask,
  canCreateSubtaskInGroup,
  canAdvanceTask,
  canReviewGroupTask,
  canRejectAndReturn,
  canRecordBugVerdict,
  canToggleHoldTask,
  canLogTime,
  canEditTimeLog,
  canViewGroupTimeRollup,
  canDeleteTask,
  canManageBugImages,
  canEditContentBody,
  isAdmin,
  DESIGN_POD_NAME,
  isProjectSocialMediaLead,
  isCalendarPipelinePod,
  canApproveCalendarHandoff,
  canApproveCalendarFinalDelivery,
  canManageSprints,
} from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { createSubtask, assignHandoffTask, reassignTask, deleteTask } from "@/lib/actions/tasks";
import { setTaskSprint } from "@/lib/actions/sprints";
import { resolveTaskAssigneeContext } from "@/lib/task-assignment";
import { ActionForm, SubmitButton } from "@/components/action-form";
import {
  sendTaskToNextGroup,
  rejectAndReturnTask,
  approveCalendarHandoffToDesign,
  approveCalendarFinalDelivery,
} from "@/lib/actions/task-handoff";
import { getTaskRound } from "@/lib/task-chain";
import {
  startTask,
  submitForReview,
  approveTask,
  sendToRevision,
  putTaskOnHold,
  resumeTaskFromHold,
} from "@/lib/actions/task-status";
import { startTimer, stopTimer, editTimeLog } from "@/lib/actions/time-tracking";
import { addComment, editComment, deleteComment } from "@/lib/actions/comments";
import { addAttachment, editAttachment, deleteAttachment } from "@/lib/actions/attachments";
import { formatDuration, secondsSince, subtractWorkingDays, MONTH_NAMES, formatDate } from "@/lib/format";
import { AddSubtaskForm } from "./add-subtask-form";
import { TaskStatusActions } from "./task-status-actions";
import { TaskTimer } from "./task-timer";
import { CommentsSection } from "./comments-section";
import { AttachmentsSection } from "./attachments-section";
import { ContentBodySection } from "./content-body-section";
import { updateContentBody } from "@/lib/actions/content-body";
import { TimeLogEntries } from "./time-log-entries";
import { AssignTaskForm } from "./assign-task-form";
import { ReassignTaskForm } from "./reassign-task-form";
import { SendToNextGroupForm } from "./send-to-next-group-form";
import { RejectReturnForm } from "./reject-return-form";
import { DeleteTaskButton } from "./delete-task-button";
import { statusLabel, revisionCountLabel, SEVERITY_LABELS, ENVIRONMENT_LABELS } from "@/lib/bug";
import { BugImagesSection } from "./bug-images-section";
import { uploadBugImage, removeBugImage } from "@/lib/actions/bug-images";
import { formatLocalDate, formatLocalTime } from "@/lib/timezone";

const PRIORITY_LABELS: Record<string, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  URGENT: "Urgent",
};

const STATUS_LABELS: Record<string, string> = {
  NEW: "New",
  IN_PROGRESS: "In Progress",
  REVIEW: "Review",
  REVISION: "Revision",
  COMPLETED: "Completed",
  ON_HOLD: "On Hold",
};

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ id: string; taskId: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { id: projectId, taskId } = await params;

  const [project, task] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      include: {
        client: true,
        taskGroups: {
          select: { id: true, name: true, leadUserId: true, clusterId: true, podId: true, pod: { select: { name: true, bugTrackingEnabled: true, contentBodyEnabled: true, sprintWorkflowEnabled: true } } },
        },
      },
    }),
    prisma.task.findUnique({
      where: { id: taskId },
      include: {
        assignedTo: true,
        createdBy: true,
        parentTask: true,
        subtasks: { include: { assignedTo: true }, orderBy: { createdAt: "asc" } },
        timeLogs: { include: { user: { select: { name: true } }, editedBy: { select: { name: true } } } },
        comments: { include: { author: true }, orderBy: { createdAt: "asc" } },
        attachments: { include: { addedBy: true }, orderBy: { createdAt: "asc" } },
        contentType: true,
        monthlyBrief: true,
        calendarApprovedBy: true,
        // Bug-scoped status-change log (PRD 8.2.4) — empty for Standard tasks.
        statusEvents: { include: { changedBy: { select: { name: true } } }, orderBy: { createdAt: "asc" } },
        bugImages: { orderBy: { createdAt: "asc" } },
        sprint: { select: { id: true, name: true, status: true } },
      },
    }),
  ]);

  if (!project || !task || task.projectId !== project.id) notFound();

  if (!(await canViewTask(user, project, task))) {
    redirect(`/projects/${projectId}`);
  }

  const group = task.groupId ? project.taskGroups.find((g) => g.id === task.groupId) ?? null : null;

  // Sprint (PRD 8.14) — surfaced only when the task's discipline has Sprint Workflow on. A
  // manager (Lead/CH/Admin) can move it between sprints and the Backlog; everyone else sees it
  // read-only. This is a planning field, never a gate on the task's own workflow.
  const sprintEnabled = !!group?.pod?.sprintWorkflowEnabled;
  const sprintEnabledGroups = project.taskGroups.filter((g) => g.pod?.sprintWorkflowEnabled);
  const canManageSprintHere = sprintEnabled && canManageSprints(user, project, sprintEnabledGroups);
  const projectSprints = canManageSprintHere
    ? await prisma.sprint.findMany({
        where: { projectId: project.id, OR: [{ status: { not: "COMPLETED" } }, { id: task.sprintId ?? "" }] },
        orderBy: [{ status: "asc" }, { startDate: "asc" }],
        select: { id: true, name: true, status: true },
      })
    : [];
  const setTaskSprintWithId = setTaskSprint.bind(null, task.id);

  const [predecessorTask, successorTask] = await Promise.all([
    task.predecessorTaskId
      ? prisma.task.findUnique({
          where: { id: task.predecessorTaskId },
          select: { id: true, name: true, description: true, completedAt: true, group: { select: { name: true } } },
        })
      : Promise.resolve(null),
    prisma.task.findFirst({
      where: { predecessorTaskId: task.id },
      select: { id: true, name: true, description: true, status: true, group: { select: { name: true } } },
    }),
  ]);

  const canAddSubtask = canCreateSubtaskInGroup(user, group, task);
  const createSubtaskWithIds = createSubtask.bind(null, project.id, task.id);

  const statusActionProps = {
    startTask: startTask.bind(null, task.id),
    submitForReview: submitForReview.bind(null, task.id),
    approveTask: approveTask.bind(null, task.id),
    sendToRevision: sendToRevision.bind(null, task.id),
    putTaskOnHold: putTaskOnHold.bind(null, task.id),
    resumeTaskFromHold: resumeTaskFromHold.bind(null, task.id),
  };

  // Delete is available only to the creator / group Lead / Admin AND only while the task
  // has zero real activity — no time logged, no comments, and nothing (task or subtask)
  // advanced beyond New (PRD 8.2, mirroring the user hard-delete guard 5.7).
  const taskHasActivity =
    task.status !== "NEW" ||
    task.subtasks.some((s) => s.status !== "NEW") ||
    task.comments.length > 0 ||
    task.timeLogs.length > 0;
  const canDelete = canDeleteTask(user, group, task) && !taskHasActivity;
  const isBug = task.taskType === "BUG";

  const openTimeLog = task.timeLogs.find((t) => t.userId === user.id && t.endTime === null);
  const closedSeconds = task.timeLogs.reduce((sum, t) => sum + (t.durationSeconds ?? 0), 0);
  const runningSeconds = openTimeLog ? secondsSince(openTimeLog.startTime) : 0;
  const totalSeconds = closedSeconds + runningSeconds;
  // The project's own Social Media Lead planned the Content Calendar, so they also get
  // read oversight (including time-log detail) into the Content/Design tasks it generates.
  const isCalendarPipelineOversight =
    !!group && isCalendarPipelinePod(group.pod?.name) && (await isProjectSocialMediaLead(user, project.id));
  const canSeeTimeLogDetail =
    canLogTime(user, task) || (group && canViewGroupTimeRollup(user, project, group)) || isCalendarPipelineOversight;

  // A Content Calendar task's path forward is the dedicated Sneha/Admin approval below,
  // not the generic Share action — the Content group's own Lead has no way to send it on.
  const isCalendarTask = task.publishDate !== null && task.contentTypeId !== null;
  const isDesignStageTask = group?.pod?.name === DESIGN_POD_NAME;
  const canSendToNextGroup =
    task.status === "COMPLETED" && !successorTask && canReviewGroupTask(user, group) && !isCalendarTask;
  // Reject & Return (PRD 8.2.1 v1.22): a handoff-received task can be sent back to the group
  // it came from at ANY status — but only while it hasn't itself been sent onward (straight
  // chain). Round is this task's position in the chain, shown only when chain context exists.
  const round = await getTaskRound(task);
  const canReject = !successorTask && canRejectAndReturn(user, group, task);
  // Only the Content-stage task hands off to Design — the Design-stage task itself is the
  // terminal link (see canGiveFinalCalendarApproval below), not another source to re-send.
  const canApproveDesignHandoff =
    isCalendarTask &&
    !isDesignStageTask &&
    task.status === "COMPLETED" &&
    !successorTask &&
    (await canApproveCalendarHandoff(user, project.id));
  // The chain's last link: once the Design-stage task itself is Completed, the same
  // Social Media Lead gives final sign-off — closing the loop she opened above.
  const canGiveFinalCalendarApproval =
    isCalendarTask &&
    isDesignStageTask &&
    task.status === "COMPLETED" &&
    !task.calendarApprovedAt &&
    (await canApproveCalendarFinalDelivery(user, project.id));
  const destinationGroups = project.taskGroups
    .filter((g) => g.id !== task.groupId)
    .map((g) => ({ id: g.id, name: g.name, isDesign: g.pod?.name === DESIGN_POD_NAME }));
  const autoDesignDueDate =
    task.publishDate && task.contentType
      ? subtractWorkingDays(task.publishDate, task.contentType.designLeadTimeDays).toISOString().slice(0, 10)
      : null;

  // Assignee pool + reassign/bug-handoff rules — shared with the Dev/QA quick-edit drawer
  // (resolveTaskAssigneeContext) so the two surfaces never diverge.
  const { canAssign, canReassign, canReassignBug, assignees } = await resolveTaskAssigneeContext(
    user,
    project,
    group,
    task,
  );

  return (
    // Wider than a single reading column on desktop/laptop — this is the screen opened
    // most often in the app, so the metadata grid below packs more fields per row instead
    // of forcing extra scrolling to see the same information a narrower column would.
    <div className="max-w-3xl">
      <p className="text-sm text-gs-gray">
        <Link href={`/projects/${project.id}`} className="hover:underline">
          {project.name}
        </Link>
        {task.parentTask && (
          <>
            {" › "}
            <Link href={`/projects/${project.id}/tasks/${task.parentTask.id}`} className="hover:underline">
              {task.parentTask.name}
            </Link>
          </>
        )}
      </p>
      <div className="mt-1 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {isBug && (
              <span className="rounded-full bg-gs-red/10 px-2 py-0.5 text-xs font-semibold uppercase text-gs-red">
                Bug
              </span>
            )}
            <h1 className="text-xl font-semibold">{task.name}</h1>
          </div>
          {group && <p className="text-sm text-gs-gray">{group.name}</p>}
        </div>
        {canDelete && (
          <DeleteTaskButton taskName={task.name} action={deleteTask.bind(null, task.id)} />
        )}
      </div>

      {/* Round Indicator (PRD 8.2.1 v1.22): this task's position in the handoff chain, shown
          only when there IS a chain. Kept separate from the Revision Count in the grid below —
          they measure different things (hops across groups vs. rework within one task). */}
      {(predecessorTask || successorTask) && (
        <div className="mt-4 flex items-center gap-2">
          <span className="rounded-full bg-gs-black/5 px-2.5 py-0.5 text-xs font-semibold uppercase text-gs-black">
            Round {round}
          </span>
          <span className="text-xs text-gs-gray">handoff chain</span>
        </div>
      )}

      {predecessorTask && (
        <div className="mt-4 rounded-lg border border-gs-gray/15 bg-gs-light px-4 py-3 text-sm">
          <p className="text-xs uppercase text-gs-gray">
            Predecessor{predecessorTask.group ? ` · ${predecessorTask.group.name}` : ""}
          </p>
          <p className="font-medium">{predecessorTask.name}</p>
          {predecessorTask.description && <p className="mt-1 text-gs-gray">{predecessorTask.description}</p>}
          {predecessorTask.completedAt && (
            <p className="mt-1 text-xs text-gs-gray">
              Completed {formatDate(predecessorTask.completedAt)}
            </p>
          )}
        </div>
      )}

      {task.description && (
        <p className="mt-4 text-sm text-gs-gray">{task.description}</p>
      )}

      <div className="mt-6 grid grid-cols-2 gap-4 rounded-lg border border-gs-gray/15 bg-white p-6 text-sm sm:grid-cols-3 lg:grid-cols-4">
        <div>
          <p className="text-gs-gray">Assigned To</p>
          <p className="font-medium">{task.assignedTo?.name ?? "Unassigned"}</p>
        </div>
        <div>
          <p className="text-gs-gray">Priority</p>
          <p className="font-medium">{PRIORITY_LABELS[task.priority]}</p>
        </div>
        <div>
          <p className="text-gs-gray">Due Date</p>
          <p className="font-medium">{formatDate(task.dueDate)}</p>
        </div>
        <div>
          <p className="text-gs-gray">Status</p>
          <p className="font-medium">{statusLabel(task.status, task.taskType)}</p>
        </div>
        {isBug && (
          <>
            <div>
              <p className="text-gs-gray">Severity</p>
              <p className="font-medium">{task.severity ? SEVERITY_LABELS[task.severity] : "—"}</p>
            </div>
            <div>
              <p className="text-gs-gray">Environment</p>
              <p className="font-medium">{task.environment ? ENVIRONMENT_LABELS[task.environment] : "—"}</p>
            </div>
          </>
        )}
        <div>
          <p className="text-gs-gray">{revisionCountLabel(task.taskType)}</p>
          <p
            className={`font-medium ${
              task.revisionCount >= 2 ? "text-gs-red" : task.revisionCount === 1 ? "text-amber-600" : ""
            }`}
          >
            {task.revisionCount}
          </p>
        </div>
        <div>
          <p className="text-gs-gray">Created By</p>
          <p className="font-medium">{task.createdBy.name}</p>
        </div>
        {sprintEnabled && (
          <div>
            <p className="text-gs-gray">Sprint</p>
            <p className="font-medium">
              {task.sprint ? (
                <>
                  {task.sprint.name}
                  {task.sprint.status === "ACTIVE" && <span className="ml-1 text-green-600">· Active</span>}
                </>
              ) : (
                <span className="text-gs-gray">Backlog</span>
              )}
            </p>
          </div>
        )}
        {task.publishDate && (
          <div>
            <p className="text-gs-gray">Publish Date</p>
            <p className="font-medium">{formatDate(task.publishDate)}</p>
          </div>
        )}
        {task.contentType && (
          <div>
            <p className="text-gs-gray">Content Type</p>
            <p className="font-medium">{task.contentType.name}</p>
          </div>
        )}
      </div>

      {canManageSprintHere && (
        <ActionForm
          action={setTaskSprintWithId}
          successMessage="Sprint updated."
          className="mt-3 flex flex-wrap items-end gap-3 rounded-lg border border-gs-gray/15 bg-white px-4 py-3"
        >
          <div className="flex flex-col gap-1">
            <label htmlFor="sprintId" className="text-xs font-medium text-gs-gray">Sprint</label>
            <select
              id="sprintId"
              name="sprintId"
              defaultValue={task.sprintId ?? ""}
              className="min-h-9 rounded-md border border-gs-gray/30 px-2 text-sm"
            >
              <option value="">Backlog (no sprint)</option>
              {projectSprints.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}{s.status === "ACTIVE" ? " · Active" : s.status === "COMPLETED" ? " · Completed" : ""}
                </option>
              ))}
            </select>
          </div>
          <SubmitButton
            pendingLabel="Saving…"
            className="flex min-h-9 items-center rounded-md border border-gs-gray/30 px-3 text-sm font-medium hover:bg-gs-light"
          >
            Update Sprint
          </SubmitButton>
        </ActionForm>
      )}

      {isBug && task.stepsToReproduce && (
        <div className="mt-4 rounded-lg border border-gs-gray/15 bg-white px-4 py-3 text-sm">
          <p className="text-xs uppercase text-gs-gray">Steps to Reproduce</p>
          <p className="mt-1 whitespace-pre-wrap">{task.stepsToReproduce}</p>
        </div>
      )}

      {isBug && (
        <BugImagesSection
          images={task.bugImages}
          canManage={canManageBugImages(user, group, task)}
          uploadAction={uploadBugImage.bind(null, project.id, task.id)}
          removeAction={removeBugImage.bind(null, project.id, task.id)}
        />
      )}

      {isBug && task.statusEvents.length > 0 && (
        <div className="mt-4 rounded-lg border border-gs-gray/15 bg-white px-4 py-3 text-sm">
          <p className="text-xs uppercase text-gs-gray">Status History</p>
          <ol className="mt-2 flex flex-col gap-1.5">
            {task.statusEvents.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium">{statusLabel(e.status, "BUG")}</span>
                <span className="text-gs-gray">
                  {formatLocalDate(e.createdAt, user.location)} {formatLocalTime(e.createdAt, user.location)}
                  {" · "}
                  {e.changedBy.name}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {task.monthlyBrief && (
        <div className="mt-4 rounded-lg border border-gs-gray/15 bg-gs-light px-4 py-3 text-sm">
          <p className="text-xs uppercase text-gs-gray">
            Monthly Brief — {MONTH_NAMES[task.monthlyBrief.month - 1]} {task.monthlyBrief.year}
          </p>
          <p className="mt-1 whitespace-pre-wrap text-gs-gray">{task.monthlyBrief.text}</p>
        </div>
      )}

      {/* ── Manage the task: status workflow, then assignment ── */}
      <TaskStatusActions
        status={task.status}
        taskType={task.taskType}
        canAdvance={canAdvanceTask(user, task)}
        canReview={canRecordBugVerdict(
          user,
          group ? { leadUserId: group.leadUserId, podId: group.podId, clusterId: group.clusterId, bugTrackingEnabled: group.pod?.bugTrackingEnabled } : null,
          task,
        )}
        canHold={canToggleHoldTask(user, group)}
        actions={statusActionProps}
      />

      {canAssign && (
        <AssignTaskForm assignees={assignees} action={assignHandoffTask.bind(null, task.id)} />
      )}

      {(canReassign || canReassignBug) && (
        <ReassignTaskForm
          assignees={assignees}
          currentAssignedToId={task.assignedToId}
          action={reassignTask.bind(null, task.id)}
          bugMode={canReassignBug && !canReassign}
        />
      )}

      {/* ── Track time ── */}
      {canLogTime(user, task) && (task.status === "IN_PROGRESS" || openTimeLog) ? (
        <TaskTimer
          isRunning={!!openTimeLog}
          closedSeconds={closedSeconds}
          runningSinceIso={openTimeLog ? openTimeLog.startTime.toISOString() : null}
          startAction={startTimer.bind(null, project.id, task.id)}
          stopAction={stopTimer.bind(null, project.id, task.id)}
        />
      ) : (
        totalSeconds > 0 && (
          <p className="mt-8 text-sm text-gs-gray">
            Time logged: <span className="font-medium text-gs-black">{formatDuration(totalSeconds)}</span>
          </p>
        )
      )}

      {canSeeTimeLogDetail && task.timeLogs.length > 0 && (
        <TimeLogEntries
          logs={task.timeLogs}
          location={task.assignedTo?.location ?? "DUBAI"}
          canEdit={canEditTimeLog(user, project, group)}
          editAction={editTimeLog.bind(null, project.id, task.id)}
        />
      )}

      {/* ── The work: references (OneDrive), then the copy (Content Body), then the
             discussion (Comments) — deliverable sits directly above the thread about it. ── */}
      <AttachmentsSection
        attachments={task.attachments}
        currentUserId={user.id}
        canDelete={isAdmin(user)}
        addAction={addAttachment.bind(null, project.id, task.id)}
        editAction={editAttachment.bind(null, project.id, task.id)}
        deleteAction={deleteAttachment.bind(null, project.id, task.id)}
      />

      {/* Content Body (PRD 8.12) — only on Content-discipline tasks; the assignee edits, others
          read. Additive: the OneDrive links above stay for briefs/references, not the copy. */}
      {group?.pod?.contentBodyEnabled && (
        <ContentBodySection
          html={task.contentBody}
          canManage={canEditContentBody(user, task)}
          action={updateContentBody.bind(null, project.id, task.id)}
        />
      )}

      <CommentsSection
        comments={task.comments}
        currentUserId={user.id}
        viewerLocation={user.location}
        canDelete={isAdmin(user)}
        addAction={addComment.bind(null, project.id, task.id)}
        editAction={editComment.bind(null, project.id, task.id)}
        deleteAction={deleteComment.bind(null, project.id, task.id)}
      />

      <div className="mt-8">
        <h2 className="text-sm font-semibold uppercase text-gs-gray">Subtasks</h2>
        <div className="mt-3 flex flex-col gap-2">
          {task.subtasks.length === 0 && (
            <p className="text-sm text-gs-gray">No subtasks yet.</p>
          )}
          {task.subtasks.map((s) => (
            <Link
              key={s.id}
              href={`/projects/${project.id}/tasks/${s.id}`}
              className="flex items-center justify-between rounded-md border border-gs-gray/15 bg-white px-4 py-2 text-sm hover:bg-gs-light"
            >
              <span>{s.name}</span>
              <span className="text-gs-gray">{s.assignedTo?.name ?? "Unassigned"} · {STATUS_LABELS[s.status]}</span>
            </Link>
          ))}
        </div>

        {canAddSubtask && !task.parentTaskId && (
          <div className="mt-4">
            <AddSubtaskForm action={createSubtaskWithIds} />
            <p className="mt-2 text-xs text-gs-gray">
              Subtasks are for your own use and stay assigned to you — they can&apos;t be reassigned.
            </p>
          </div>
        )}
      </div>

      {/* ── Route onward: hand off / reject & return / calendar sign-off, then the Successor
             summary. Kept at the bottom so the chain reads top-to-bottom (Predecessor above,
             Successor here) and the primary work above isn't split by routing controls. ── */}
      {canSendToNextGroup && (
        <SendToNextGroupForm
          destinationGroups={destinationGroups}
          defaultDescription={task.description ?? ""}
          autoDesignDueDate={autoDesignDueDate}
          action={sendTaskToNextGroup.bind(null, task.id)}
        />
      )}

      {canReject && (
        <RejectReturnForm
          destinationGroupName={predecessorTask?.group?.name ?? "the previous group"}
          action={rejectAndReturnTask.bind(null, task.id)}
        />
      )}

      {canApproveDesignHandoff && (
        <form action={approveCalendarHandoffToDesign.bind(null, task.id)} className="mt-4 rounded-lg border border-gs-gray/15 bg-white p-4">
          <button
            type="submit"
            className="flex min-h-11 items-center rounded-md bg-gs-red px-4 text-sm font-medium text-white hover:bg-gs-red/90"
          >
            Approve &amp; Send to Design
          </button>
          {autoDesignDueDate && (
            <p className="mt-2 text-xs text-gs-gray">
              Creates a linked task in the Design group with Due Date{" "}
              <span className="font-medium text-gs-black">{formatDate(autoDesignDueDate)}</span> — auto-calculated from this
              entry&apos;s Publish Date and Content Type.
            </p>
          )}
        </form>
      )}

      {canGiveFinalCalendarApproval && (
        <form action={approveCalendarFinalDelivery.bind(null, task.id)} className="mt-4 rounded-lg border border-gs-gray/15 bg-white p-4">
          <button
            type="submit"
            className="flex min-h-11 items-center rounded-md bg-gs-red px-4 text-sm font-medium text-white hover:bg-gs-red/90"
          >
            Approve Final Delivery
          </button>
          <p className="mt-2 text-xs text-gs-gray">
            Closes out this Content Calendar entry — the last step after Design has completed the work.
          </p>
        </form>
      )}

      {task.calendarApprovedAt && task.calendarApprovedBy && (
        <p className="mt-4 text-xs text-gs-gray">
          Final approval: <span className="font-medium text-gs-black">{task.calendarApprovedBy.name}</span> on{" "}
          {formatDate(task.calendarApprovedAt)}
        </p>
      )}

      {successorTask && (
        <div className="mt-4 rounded-lg border border-gs-gray/15 bg-gs-light px-4 py-3 text-sm">
          <p className="text-xs uppercase text-gs-gray">
            Successor{successorTask.group ? ` · ${successorTask.group.name}` : ""}
          </p>
          <p className="font-medium">{successorTask.name}</p>
          {successorTask.description && <p className="mt-1 text-gs-gray">{successorTask.description}</p>}
          <p className="mt-1 text-xs text-gs-gray">Status: {statusLabel(successorTask.status, task.taskType)}</p>
        </div>
      )}
    </div>
  );
}
