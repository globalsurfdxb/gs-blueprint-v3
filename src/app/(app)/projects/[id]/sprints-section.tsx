"use client";

import { useState } from "react";
import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/action-form";

export type SprintRow = {
  id: string;
  name: string;
  status: "PLANNED" | "ACTIVE" | "COMPLETED";
  startLabel: string;
  endLabel: string;
  startInput: string;
  endInput: string;
  taskCount: number;
  datesLocked: boolean; // dates locked once Active (PRD 8.14)
};

const STATUS_STYLE: Record<SprintRow["status"], string> = {
  PLANNED: "bg-gs-black/5 text-gs-black",
  ACTIVE: "bg-green-100 text-green-700",
  COMPLETED: "bg-gs-gray/15 text-gs-gray",
};
const STATUS_LABEL: Record<SprintRow["status"], string> = {
  PLANNED: "Planned",
  ACTIVE: "Active",
  COMPLETED: "Completed",
};
const STATUSES: SprintRow["status"][] = ["PLANNED", "ACTIVE", "COMPLETED"];

function SprintCard({
  sprint,
  projectId,
  canManage,
  updateAction,
  setStatusAction,
}: {
  sprint: SprintRow;
  projectId: string;
  canManage: boolean;
  updateAction: (id: string, formData: FormData) => void;
  setStatusAction: (id: string, formData: FormData) => void;
}) {
  const [editing, setEditing] = useState(false);
  const updateWithId = updateAction.bind(null, sprint.id);
  const setStatusWithId = setStatusAction.bind(null, sprint.id);

  return (
    <div className="rounded-lg border border-gs-gray/15 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">{sprint.name}</span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${STATUS_STYLE[sprint.status]}`}>
            {STATUS_LABEL[sprint.status]}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gs-gray">
            {sprint.startLabel} – {sprint.endLabel} · {sprint.taskCount} task{sprint.taskCount === 1 ? "" : "s"}
          </span>
          {/* Sprint-wise board (final build): open the Kanban scoped to just this sprint. */}
          <Link
            href={`/projects/${projectId}?sprint=${sprint.id}`}
            className="whitespace-nowrap text-xs font-medium text-gs-red hover:underline"
          >
            View board →
          </Link>
        </div>
      </div>

      {canManage && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <ActionForm action={setStatusWithId} successMessage="Sprint status updated." className="flex items-center gap-2">
            <select
              name="status"
              defaultValue={sprint.status}
              className="min-h-9 rounded-md border border-gs-gray/30 px-2 text-xs"
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>{STATUS_LABEL[s]}</option>
              ))}
            </select>
            <SubmitButton
              pendingLabel="Saving…"
              className="flex min-h-9 items-center rounded-md border border-gs-gray/30 px-3 text-xs font-medium hover:bg-gs-light"
            >
              Set status
            </SubmitButton>
          </ActionForm>
          <button
            type="button"
            onClick={() => setEditing((e) => !e)}
            className="text-xs text-gs-gray hover:underline"
          >
            {editing ? "Cancel" : "Edit"}
          </button>
        </div>
      )}

      {canManage && editing && (
        <ActionForm
          action={updateWithId}
          successMessage="Sprint updated."
          onSuccess={() => setEditing(false)}
          className="mt-3 flex flex-wrap items-end gap-3 border-t border-gs-gray/10 pt-3"
        >
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gs-gray">Name</label>
            <input name="name" defaultValue={sprint.name} required className="min-h-9 rounded-md border border-gs-gray/30 px-2 text-sm" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gs-gray">Start</label>
            <input
              type="date"
              name="startDate"
              defaultValue={sprint.startInput}
              required
              disabled={sprint.datesLocked}
              className="min-h-9 rounded-md border border-gs-gray/30 px-2 text-sm disabled:bg-gs-light disabled:text-gs-gray"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gs-gray">End</label>
            <input
              type="date"
              name="endDate"
              defaultValue={sprint.endInput}
              required
              disabled={sprint.datesLocked}
              className="min-h-9 rounded-md border border-gs-gray/30 px-2 text-sm disabled:bg-gs-light disabled:text-gs-gray"
            />
          </div>
          <SubmitButton
            pendingLabel="Saving…"
            className="flex min-h-9 items-center rounded-md bg-gs-black px-4 text-sm font-medium text-white hover:opacity-90"
          >
            Save
          </SubmitButton>
          {sprint.datesLocked && (
            <p className="w-full text-xs text-gs-gray">Dates are locked once a Sprint is Active — you can still rename it.</p>
          )}
        </ActionForm>
      )}
    </div>
  );
}

export function SprintsSection({
  sprints,
  projectId,
  canManage,
  createAction,
  updateAction,
  setStatusAction,
}: {
  sprints: SprintRow[];
  projectId: string;
  canManage: boolean;
  createAction: (formData: FormData) => void;
  updateAction: (id: string, formData: FormData) => void;
  setStatusAction: (id: string, formData: FormData) => void;
}) {
  const [creating, setCreating] = useState(false);

  return (
    <div className="mt-8">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase text-gs-gray">Sprints</h2>
        {canManage && (
          <button
            type="button"
            onClick={() => setCreating((c) => !c)}
            className="text-xs text-gs-red hover:underline"
          >
            {creating ? "Cancel" : "New Sprint"}
          </button>
        )}
      </div>

      {canManage && creating && (
        <ActionForm
          action={createAction}
          successMessage="Sprint created."
          onSuccess={() => setCreating(false)}
          className="mt-3 flex flex-wrap items-end gap-3 rounded-lg border border-gs-gray/15 bg-white p-4"
        >
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gs-gray">Name</label>
            <input name="name" placeholder="Sprint 1" required className="min-h-9 rounded-md border border-gs-gray/30 px-2 text-sm" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gs-gray">Start</label>
            <input type="date" name="startDate" required className="min-h-9 rounded-md border border-gs-gray/30 px-2 text-sm" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gs-gray">End</label>
            <input type="date" name="endDate" required className="min-h-9 rounded-md border border-gs-gray/30 px-2 text-sm" />
          </div>
          <SubmitButton
            pendingLabel="Creating…"
            className="flex min-h-9 items-center rounded-md bg-gs-black px-4 text-sm font-medium text-white hover:opacity-90"
          >
            Create Sprint
          </SubmitButton>
        </ActionForm>
      )}

      <div className="mt-3 flex flex-col gap-3">
        {sprints.length === 0 ? (
          <p className="text-sm text-gs-gray">
            No Sprints yet. {canManage ? "Create one to start planning — tasks left unassigned stay in the Backlog." : "Tasks are in the Backlog until a Sprint is planned."}
          </p>
        ) : (
          sprints.map((s) => (
            <SprintCard
              key={s.id}
              sprint={s}
              projectId={projectId}
              canManage={canManage}
              updateAction={updateAction}
              setStatusAction={setStatusAction}
            />
          ))
        )}
      </div>
    </div>
  );
}
