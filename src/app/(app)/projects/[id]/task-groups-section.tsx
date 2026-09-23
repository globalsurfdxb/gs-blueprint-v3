"use client";

import { useMemo, useState } from "react";
import { statusLabel } from "@/lib/bug";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { TaskOpener, useTaskDrawer } from "@/components/task-drawer";

type GroupTask = {
  id: string;
  name: string;
  status: string;
  priority: string;
  dueDate: string;
  revisionCount: number;
  assigneeId: string | null;
  assigneeName: string | null;
  daysOverdue: number | null;
  isTimerRunning: boolean;
  taskType: string;
  subtasks: GroupTask[];
};
type GroupCard = {
  id: string;
  name: string;
  leadName: string;
  tasks: GroupTask[];
  hasHiddenTasks: boolean;
  canCreateTask: boolean;
  canRemove: boolean;
  totalSeconds: number | null;
  // Team Capacity (hrs/wk) — only shown on Development/QA teams (isDevQa).
  isDevQa: boolean;
  capacity: string | null;
  canEditCapacity: boolean;
};

const STATUS_LABELS: Record<string, string> = {
  NEW: "New",
  IN_PROGRESS: "In Progress",
  REVIEW: "Review",
  REVISION: "Revision",
  COMPLETED: "Completed",
  ON_HOLD: "On Hold",
};

function formatSeconds(seconds: number) {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hrs === 0 && mins === 0) return "0m";
  return [hrs > 0 ? `${hrs}h` : null, mins > 0 ? `${mins}m` : null].filter(Boolean).join(" ");
}

function matchesFilter(t: GroupTask, owner: string, status: string) {
  return (owner === "all" || t.assigneeId === owner) && (status === "all" || t.status === status);
}

/** Team Capacity (hrs/wk) — a static planned-capacity figure shown on Development/QA teams
 * only. Admin/Cluster Head edits inline; everyone else sees it read-only. Blank by default. */
function TeamCapacity({
  groupId,
  capacity,
  canEdit,
  action,
}: {
  groupId: string;
  capacity: string | null;
  canEdit: boolean;
  action: (groupId: string, formData: FormData) => void;
}) {
  const [editing, setEditing] = useState(false);
  const withId = action.bind(null, groupId);
  const shown = capacity ? `${Number(capacity)} hrs/wk` : "—";

  if (!canEdit) {
    return <p className="mt-1 text-xs text-gs-gray">Capacity: {shown}</p>;
  }
  if (!editing) {
    return (
      <p className="mt-1 text-xs text-gs-gray">
        Capacity: {shown}{" "}
        <button type="button" onClick={() => setEditing(true)} className="ml-1 text-gs-red hover:underline">
          {capacity ? "Edit" : "Set"}
        </button>
      </p>
    );
  }
  return (
    <ActionForm
      action={withId}
      successMessage="Team capacity updated."
      onSuccess={() => setEditing(false)}
      className="mt-1 flex items-center gap-2"
    >
      <label className="text-xs text-gs-gray">Capacity (hrs/wk)</label>
      <input
        name="capacity"
        type="number"
        min="0"
        step="0.5"
        defaultValue={capacity ? String(Number(capacity)) : ""}
        placeholder="blank = none"
        className="min-h-8 w-28 rounded-md border border-gs-gray/30 px-2 text-xs"
      />
      <SubmitButton
        pendingLabel="Saving…"
        className="flex min-h-8 items-center rounded-md border border-gs-gray/30 px-2.5 text-xs font-medium hover:bg-gs-light"
      >
        Save
      </SubmitButton>
      <button type="button" onClick={() => setEditing(false)} className="text-xs text-gs-gray hover:underline">
        Cancel
      </button>
    </ActionForm>
  );
}

function RunningBadge() {
  return (
    <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-gs-red/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-gs-red align-middle">
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-gs-red" aria-hidden />
      Running
    </span>
  );
}

function TaskRow({ projectId, task, depth }: { projectId: string; task: GroupTask; depth: number }) {
  const hasSubs = task.subtasks.length > 0;
  const [open, setOpen] = useState(true);
  return (
    <>
      <tr className="border-t border-gs-gray/10 hover:bg-gs-light">
        <td className="px-3 py-1.5" style={{ paddingLeft: `${0.75 + depth * 1.25}rem` }}>
          <span className="inline-flex items-center">
            {hasSubs ? (
              <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                aria-label={open ? "Collapse subtasks" : "Expand subtasks"}
                className="mr-1 w-4 shrink-0 text-gs-gray hover:text-gs-black"
              >
                {open ? "▾" : "▸"}
              </button>
            ) : (
              depth > 0 && <span className="mr-1 w-4 shrink-0 text-gs-gray/50">└</span>
            )}
            {task.taskType === "BUG" && (
              <span className="mr-1.5 rounded-full bg-gs-red/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-gs-red align-middle">
                Bug
              </span>
            )}
            <TaskOpener taskId={task.id} projectId={projectId} className="text-left font-medium hover:underline">
              {task.name}
            </TaskOpener>
            {task.isTimerRunning && <RunningBadge />}
          </span>
        </td>
        <td className="px-3 py-1.5 text-gs-gray">{task.assigneeName ?? "Unassigned"}</td>
        <td className="px-3 py-1.5 text-gs-gray">
          {task.dueDate}
          {task.daysOverdue !== null && (
            <span className={task.daysOverdue > 0 ? "ml-1 text-gs-red" : "ml-1 text-gs-gray"}>
              ({task.daysOverdue} day{task.daysOverdue === 1 ? "" : "s"})
            </span>
          )}
        </td>
        <td className="px-3 py-1.5 text-gs-gray">{task.priority}</td>
        <td className="px-3 py-1.5 text-gs-gray">{statusLabel(task.status, task.taskType)}</td>
        <td className="px-3 py-1.5">
          <span
            className={
              task.revisionCount >= 2 ? "text-gs-red" : task.revisionCount === 1 ? "text-amber-600" : "text-gs-gray"
            }
          >
            {task.revisionCount}
          </span>
        </td>
      </tr>
      {hasSubs &&
        open &&
        task.subtasks.map((s) => <TaskRow key={s.id} projectId={projectId} task={s} depth={depth + 1} />)}
    </>
  );
}

function TaskTable({ projectId, tasks }: { projectId: string; tasks: GroupTask[] }) {
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs uppercase text-gs-gray">
        <tr>
          <th className="px-3 py-1.5">Task</th>
          <th className="px-3 py-1.5">Assignee</th>
          <th className="px-3 py-1.5">Due Date</th>
          <th className="px-3 py-1.5">Priority</th>
          <th className="px-3 py-1.5">Status</th>
          <th className="px-3 py-1.5">Revisions</th>
        </tr>
      </thead>
      <tbody>
        {tasks.map((t) => (
          <TaskRow key={t.id} projectId={projectId} task={t} depth={0} />
        ))}
      </tbody>
    </table>
  );
}

export function TaskGroupsSection({
  projectId,
  groupCards,
  ungroupedTasks,
  canAttachGroups,
  availableLeadRoles,
  attachAction,
  removeAction,
  setCapacityAction,
}: {
  projectId: string;
  groupCards: GroupCard[];
  ungroupedTasks: GroupTask[];
  canAttachGroups: boolean;
  availableLeadRoles: { id: string; label: string }[];
  attachAction: (formData: FormData) => void;
  removeAction: (groupId: string, formData: FormData) => void;
  setCapacityAction: (groupId: string, formData: FormData) => void;
}) {
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const drawer = useTaskDrawer();
  const canCreateAny = groupCards.some((g) => g.canCreateTask);

  const owners = useMemo(() => {
    const byId = new Map<string, string>();
    for (const t of [...groupCards.flatMap((g) => g.tasks), ...ungroupedTasks]) {
      if (t.assigneeId) byId.set(t.assigneeId, t.assigneeName ?? t.assigneeId);
    }
    return Array.from(byId.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [groupCards, ungroupedTasks]);

  const hasAnyTasks = groupCards.some((g) => g.tasks.length > 0) || ungroupedTasks.length > 0;

  return (
    <div className="mt-8">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold uppercase text-gs-gray">Task Groups</h2>
          {canCreateAny && drawer && (
            <button
              type="button"
              onClick={() => drawer.openCreate(projectId)}
              className="text-xs font-medium text-gs-red hover:underline"
            >
              + Add Task
            </button>
          )}
        </div>
        {hasAnyTasks && (
          <div className="flex items-center gap-2">
            <select
              value={ownerFilter}
              onChange={(e) => setOwnerFilter(e.target.value)}
              className="min-h-11 rounded-md border border-gs-gray/30 px-2 text-xs"
            >
              <option value="all">All Owners</option>
              {owners.map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="min-h-11 rounded-md border border-gs-gray/30 px-2 text-xs"
            >
              <option value="all">All Statuses</option>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-col gap-4">
        {groupCards.length === 0 && (
          <p className="text-sm text-gs-gray">No discipline Leads attached yet.</p>
        )}
        {groupCards.map((g) => {
          const removeWithId = removeAction.bind(null, g.id);
          const shown = g.tasks.filter((t) => matchesFilter(t, ownerFilter, statusFilter));
          return (
            <div key={g.id} className="rounded-lg border border-gs-gray/15 bg-white p-4">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-semibold">{g.name}</span>
                  <span className="ml-2 text-xs text-gs-gray">Lead: {g.leadName}</span>
                  {g.totalSeconds !== null && (
                    <span className="ml-2 text-xs text-gs-gray">· {formatSeconds(g.totalSeconds)} logged</span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  {g.canCreateTask && drawer && (
                    <button
                      type="button"
                      onClick={() => drawer.openCreate(projectId, g.id)}
                      className="text-xs text-gs-red hover:underline"
                    >
                      New Task
                    </button>
                  )}
                  {g.canRemove && (
                    <form action={removeWithId}>
                      <button type="submit" className="text-xs text-gs-gray hover:underline">
                        Remove Group
                      </button>
                    </form>
                  )}
                </div>
              </div>
              {g.isDevQa && (
                <TeamCapacity groupId={g.id} capacity={g.capacity} canEdit={g.canEditCapacity} action={setCapacityAction} />
              )}
              <div className="mt-2">
                {g.tasks.length === 0 && (
                  <p className="text-xs text-gs-gray">
                    {g.hasHiddenTasks ? "This group has tasks, but only your own show here." : "No tasks yet."}
                  </p>
                )}
                {g.tasks.length > 0 && shown.length === 0 && (
                  <p className="text-xs text-gs-gray">No tasks match the current filter.</p>
                )}
                {shown.length > 0 && (
                  <div className="overflow-x-auto">
                    <TaskTable projectId={projectId} tasks={shown} />
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {ungroupedTasks.length > 0 && (() => {
          const shown = ungroupedTasks.filter((t) => matchesFilter(t, ownerFilter, statusFilter));
          return (
            <div className="rounded-lg border border-gs-gray/15 bg-white p-4">
              <span className="text-sm font-semibold">Ungrouped Tasks</span>
              <p className="text-xs text-gs-gray">Created before Task Groups existed on this project.</p>
              <div className="mt-2">
                {shown.length === 0 ? (
                  <p className="text-xs text-gs-gray">No tasks match the current filter.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <TaskTable projectId={projectId} tasks={shown} />
                  </div>
                )}
              </div>
            </div>
          );
        })()}
      </div>

      {canAttachGroups && (
        <form action={attachAction} className="mt-3 flex flex-wrap items-end gap-3">
          <div className="flex w-full flex-col gap-1.5 sm:w-auto">
            <label className="text-xs font-medium text-gs-gray">Attach Discipline Lead</label>
            <select name="leadRoleId" required className="w-full min-w-0 rounded-md border border-gs-gray/30 px-3 py-2 text-sm sm:w-72">
              <option value="" disabled>
                {availableLeadRoles.length === 0 ? "No more Leads available" : "Select a Lead"}
              </option>
              {availableLeadRoles.map((r) => (
                <option key={r.id} value={r.id}>{r.label}</option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={availableLeadRoles.length === 0}
            className="flex min-h-11 items-center rounded-md border border-gs-gray/30 px-4 text-sm font-medium hover:bg-gs-light disabled:opacity-50"
          >
            Attach
          </button>
        </form>
      )}
      {groupCards.some((g) => g.canCreateTask) && (
        <p className="mt-2 text-xs text-gs-gray">
          Any Lead attached to this project can create a task in any group here and hand it directly to a
          different team&apos;s Lead. Reviewing, holding, and viewing the full task list stays with that
          group&apos;s own Lead once the task exists.
        </p>
      )}
    </div>
  );
}
