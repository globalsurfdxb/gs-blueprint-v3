"use client";

import { createContext, useContext, useState, useTransition, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toast";
import { getTaskDrawerData, type TaskDrawerData } from "@/lib/actions/task-drawer";
import { changeTaskStatusByDrag } from "@/lib/actions/task-status";
import { reassignTask } from "@/lib/actions/tasks";
import { setTaskSprint } from "@/lib/actions/sprints";
import { setTaskPriority, setTaskSeverity } from "@/lib/actions/task-attributes";
import { addComment } from "@/lib/actions/comments";
import { getCreatableProjects, getTaskCreateOptions, type TaskCreateOptions } from "@/lib/actions/task-create";
import { CreateTaskPanel } from "@/components/create-task-panel";
import { formatLocalDate, formatLocalTime } from "@/lib/timezone";

// Quick-edit task drawer. A right-side slide-over rendered over the current view — opening it
// does NOT navigate, so the underlying view's scroll position and filters are preserved. Inline
// edit of Status, Assignee, Severity, Sprint, Priority and Comments; everything heavier stays one
// click away via "Open full view". Works for tasks AND bugs across every discipline: fields that
// only apply to some work self-hide (Severity on bugs only, Sprint where Sprint Workflow is on),
// and the drawer is cross-project — each opened task carries its own project context — so the same
// provider serves both the single-project board and the cross-project My Tasks surface.

type DrawerApi = {
  /** Open the edit drawer for an existing task. */
  openTask: (taskId: string) => void;
  /** Open the create drawer. Pass a project (and optionally a group) to pre-select it; with no
   * project the picker defaults to the user's first creatable project. */
  openCreate: (projectId?: string, groupId?: string) => void;
};
const TaskDrawerContext = createContext<DrawerApi | null>(null);
/** Returns the drawer API, or null when no drawer provider is mounted — callers fall back to
 * normal full-page navigation in that case. */
export function useTaskDrawer(): DrawerApi | null {
  return useContext(TaskDrawerContext);
}

const STATUS_TARGETS = ["NEW", "IN_PROGRESS", "REVIEW", "COMPLETED"] as const;
const STATUS_LABELS: Record<string, string> = {
  NEW: "New",
  IN_PROGRESS: "In Progress",
  REVIEW: "Review",
  REVISION: "Revision",
  ON_HOLD: "On Hold",
  COMPLETED: "Completed",
};
const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"];
const SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
const PRIORITY_LABELS: Record<string, string> = { LOW: "Low", MEDIUM: "Medium", HIGH: "High", URGENT: "Urgent" };
const SEVERITY_LABELS: Record<string, string> = { CRITICAL: "Critical", HIGH: "High", MEDIUM: "Medium", LOW: "Low" };

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

const selectClass = "min-h-9 w-full rounded-md border border-gs-gray/30 px-2 text-sm disabled:opacity-60";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium uppercase tracking-wide text-gs-gray">{label}</span>
      {children}
    </label>
  );
}

export function TaskDrawerProvider({ children }: { children: React.ReactNode }) {
  const [taskId, setTaskId] = useState<string | null>(null);
  const [data, setData] = useState<TaskDrawerData | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, startTransition] = useTransition();
  const [commentText, setCommentText] = useState("");
  // Create mode (final build): the same slide-over, in create rather than edit form.
  const [creating, setCreating] = useState(false);
  const [createOptions, setCreateOptions] = useState<TaskCreateOptions | null>(null);
  const [createProjects, setCreateProjects] = useState<{ id: string; name: string; clientName: string }[] | null>(null);
  const [createInitialGroupId, setCreateInitialGroupId] = useState<string | null>(null);
  const [createLoading, setCreateLoading] = useState(false);
  const { addToast } = useToast();
  const router = useRouter();

  const load = useCallback(
    async (id: string) => {
      setLoading(true);
      try {
        setData(await getTaskDrawerData(id));
      } catch (e) {
        addToast(e instanceof Error ? e.message : "Couldn't load that task.", "error");
        setTaskId(null);
      } finally {
        setLoading(false);
      }
    },
    [addToast],
  );

  const openTask = useCallback(
    (id: string) => {
      setCreating(false); // edit and create are mutually exclusive
      setTaskId(id);
      setData(null);
      setCommentText("");
      void load(id);
    },
    [load],
  );

  const close = useCallback(() => {
    setTaskId(null);
    setData(null);
  }, []);

  const closeCreate = useCallback(() => {
    setCreating(false);
    setCreateOptions(null);
    setCreateInitialGroupId(null);
  }, []);

  const openCreate = useCallback(
    (projectId?: string, groupId?: string) => {
      setTaskId(null);
      setData(null);
      setCreating(true);
      setCreateInitialGroupId(groupId ?? null);
      setCreateOptions(null);
      setCreateLoading(true);
      void (async () => {
        try {
          const projectsPromise = createProjects ? Promise.resolve(createProjects) : getCreatableProjects();
          let pid = projectId;
          if (!pid) {
            const projs = await projectsPromise;
            setCreateProjects(projs);
            pid = projs[0]?.id;
            if (!pid) return; // nothing this user can create in
          } else {
            void projectsPromise.then(setCreateProjects).catch(() => {});
          }
          setCreateOptions(await getTaskCreateOptions(pid));
        } catch (e) {
          addToast(e instanceof Error ? e.message : "Couldn't open the create form.", "error");
          setCreating(false);
        } finally {
          setCreateLoading(false);
        }
      })();
    },
    [createProjects, addToast],
  );

  const changeCreateProject = useCallback(
    (projectId: string) => {
      setCreateOptions(null);
      setCreateInitialGroupId(null);
      setCreateLoading(true);
      getTaskCreateOptions(projectId)
        .then(setCreateOptions)
        .catch((e) => addToast(e instanceof Error ? e.message : "Couldn't load that project.", "error"))
        .finally(() => setCreateLoading(false));
    },
    [addToast],
  );

  const onCreated = useCallback(() => {
    closeCreate();
    router.refresh();
  }, [closeCreate, router]);

  // Every inline edit runs through here: perform the mutation, re-fetch the drawer's own data,
  // and refresh the underlying view (RSC) so the board/list reflects the change too.
  function runEdit(fn: () => Promise<void>) {
    startTransition(async () => {
      try {
        await fn();
        if (taskId) await load(taskId);
        router.refresh();
      } catch (e) {
        addToast(e instanceof Error ? e.message : "Something went wrong.", "error");
      }
    });
  }

  function submitComment() {
    const text = commentText.trim();
    if (!text || !taskId || !data) return;
    const projectId = data.projectId;
    runEdit(async () => {
      await addComment(projectId, taskId, fd({ text }));
      setCommentText("");
    });
  }

  return (
    <TaskDrawerContext.Provider value={{ openTask, openCreate }}>
      {children}
      {creating && (
        <CreateTaskPanel
          projects={createProjects}
          options={createOptions}
          loading={createLoading}
          initialGroupId={createInitialGroupId}
          onProjectChange={changeCreateProject}
          onClose={closeCreate}
          onCreated={onCreated}
        />
      )}
      {taskId && (
        <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/30" onClick={close} aria-hidden />
          <div className="relative z-10 flex h-full w-full max-w-md flex-col overflow-y-auto bg-white shadow-xl">
            {!data || loading ? (
              <div className="p-6 text-sm text-gs-gray">Loading…</div>
            ) : (
              <>
                <div className="sticky top-0 flex items-start justify-between gap-3 border-b border-gs-gray/15 bg-white px-5 py-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-semibold leading-snug">{data.name}</h2>
                      {data.taskType === "BUG" && (
                        <span className="rounded-full bg-gs-red/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-gs-red">Bug</span>
                      )}
                      {data.hasChain && (
                        <span className="rounded-full bg-gs-black/5 px-2 py-0.5 text-[10px] font-semibold uppercase">Round {data.round}</span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-gs-gray">
                      {data.projectName} · {data.clientName}
                      {data.discipline ? ` · ${data.discipline}` : ""}
                    </p>
                  </div>
                  <button type="button" onClick={close} aria-label="Close" className="shrink-0 text-lg leading-none text-gs-gray hover:text-gs-black">✕</button>
                </div>

                <div className={`flex flex-col gap-4 px-5 py-4 ${pending ? "opacity-60" : ""}`}>
                  <div className="flex items-center justify-between text-xs text-gs-gray">
                    <span>Due {data.dueDateLabel}</span>
                    <span>{data.taskType === "BUG" ? "Reopens" : "Revisions"}: {data.revisionCount}</span>
                  </div>

                  <Field label="Status">
                    <select
                      className={selectClass}
                      disabled={pending}
                      value={(STATUS_TARGETS as readonly string[]).includes(data.status) ? data.status : ""}
                      onChange={(e) => {
                        const target = e.target.value;
                        if (target) runEdit(() => changeTaskStatusByDrag(data.id, target, `/projects/${data.projectId}`));
                      }}
                    >
                      {!(STATUS_TARGETS as readonly string[]).includes(data.status) && (
                        <option value="">{STATUS_LABELS[data.status] ?? data.status} (current)</option>
                      )}
                      {STATUS_TARGETS.map((s) => (
                        <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                      ))}
                    </select>
                  </Field>

                  {data.canReassign && (
                    <Field label={data.reassignBugMode ? "Assignee (hand bug to)" : "Assignee"}>
                      <select
                        className={selectClass}
                        disabled={pending}
                        value={data.assignedToId ?? ""}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v && v !== data.assignedToId) runEdit(() => reassignTask(data.id, fd({ assignedToId: v })));
                        }}
                      >
                        {data.assignees.map((a) => (
                          <option key={a.id} value={a.id}>{a.name}</option>
                        ))}
                      </select>
                    </Field>
                  )}
                  {!data.canReassign && (
                    <Field label="Assignee">
                      <p className="text-sm">{data.assignedToName ?? "Unassigned"}</p>
                    </Field>
                  )}

                  <Field label="Priority">
                    {data.canEditAttributes ? (
                      <select
                        className={selectClass}
                        disabled={pending}
                        value={data.priority}
                        onChange={(e) => runEdit(() => setTaskPriority(data.id, fd({ priority: e.target.value })))}
                      >
                        {PRIORITIES.map((p) => (
                          <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
                        ))}
                      </select>
                    ) : (
                      <p className="text-sm">{PRIORITY_LABELS[data.priority] ?? data.priority}</p>
                    )}
                  </Field>

                  {data.taskType === "BUG" && (
                    <Field label="Severity">
                      {data.canEditAttributes ? (
                        <select
                          className={selectClass}
                          disabled={pending}
                          value={data.severity ?? ""}
                          onChange={(e) => runEdit(() => setTaskSeverity(data.id, fd({ severity: e.target.value })))}
                        >
                          {data.severity === null && <option value="">—</option>}
                          {SEVERITIES.map((s) => (
                            <option key={s} value={s}>{SEVERITY_LABELS[s]}</option>
                          ))}
                        </select>
                      ) : (
                        <p className="text-sm">{data.severity ? SEVERITY_LABELS[data.severity] : "—"}</p>
                      )}
                    </Field>
                  )}

                  {data.canManageSprint && (
                    <Field label="Sprint">
                      <select
                        className={selectClass}
                        disabled={pending}
                        value={data.sprintId ?? ""}
                        onChange={(e) => runEdit(() => setTaskSprint(data.id, fd({ sprintId: e.target.value })))}
                      >
                        <option value="">Backlog (no sprint)</option>
                        {data.sprints.map((s) => (
                          <option key={s.id} value={s.id}>{s.name}{s.status === "ACTIVE" ? " · Active" : s.status === "COMPLETED" ? " · Completed" : ""}</option>
                        ))}
                      </select>
                    </Field>
                  )}

                  {/* Comments — add + view inline; edit/delete stay in the full view. */}
                  <div className="mt-1 border-t border-gs-gray/10 pt-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-gs-gray">Comments</p>
                    <div className="mt-2 flex flex-col gap-2">
                      {data.comments.length === 0 ? (
                        <p className="text-sm text-gs-gray">No comments yet.</p>
                      ) : (
                        data.comments.map((c) => (
                          <div key={c.id} className="rounded-md border border-gs-gray/15 px-3 py-2 text-sm">
                            <p className="text-[11px] text-gs-gray">
                              {c.author.name} · {formatLocalDate(new Date(c.createdAt), data.viewerLocation)} {formatLocalTime(new Date(c.createdAt), data.viewerLocation)}{c.isEdited ? " · edited" : ""}
                            </p>
                            <p className="mt-0.5 whitespace-pre-wrap">{c.text}</p>
                          </div>
                        ))
                      )}
                    </div>
                    <textarea
                      value={commentText}
                      onChange={(e) => setCommentText(e.target.value)}
                      rows={2}
                      placeholder="Add a comment…"
                      className="mt-2 w-full rounded-md border border-gs-gray/30 px-2 py-1.5 text-sm"
                    />
                    <button
                      type="button"
                      onClick={submitComment}
                      disabled={pending || !commentText.trim()}
                      className="mt-1 flex min-h-9 items-center rounded-md bg-gs-black px-3 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                    >
                      Comment
                    </button>
                  </div>

                  <Link
                    href={data.fullViewHref}
                    className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-gs-red hover:underline"
                  >
                    Open full view ↗
                  </Link>
                  <p className="text-[11px] text-gs-gray">
                    Subtasks, timer, cross-group handoff, bug images and content live in the full view.
                  </p>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </TaskDrawerContext.Provider>
  );
}

/** Renders a task title as either a drawer trigger (whenever a drawer provider is mounted) or a
 * normal link to the full page (when it isn't). Shared by the List/Kanban/Calendar surfaces and
 * My Tasks. */
export function TaskOpener({
  taskId,
  projectId,
  className,
  children,
}: {
  taskId: string;
  projectId: string;
  className?: string;
  children: React.ReactNode;
}) {
  const api = useTaskDrawer();
  if (api) {
    return (
      <button type="button" onClick={() => api.openTask(taskId)} className={className}>
        {children}
      </button>
    );
  }
  return (
    <Link href={`/projects/${projectId}/tasks/${taskId}`} className={className}>
      {children}
    </Link>
  );
}
