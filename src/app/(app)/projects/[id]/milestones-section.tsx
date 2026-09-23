"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/action-form";

export type MilestoneRow = {
  id: string;
  title: string;
  dueLabel: string;
  dueInput: string; // YYYY-MM-DD
  completed: boolean;
};

/**
 * Project Milestones (PRD — agency-wide): a short, ordered checklist above the Task Groups.
 * Managers (attached Lead / Cluster Head / Admin / PAM) can add, edit, reorder, check off and
 * remove; everyone else who can see the project (Contributors, Dependency Trackers) sees it
 * strictly read-only. Purely a checklist — no link to any task.
 */
export function MilestonesSection({
  milestones,
  canManage,
  createAction,
  toggleAction,
  updateAction,
  reorderAction,
  deleteAction,
}: {
  milestones: MilestoneRow[];
  canManage: boolean;
  createAction: (formData: FormData) => void;
  toggleAction: (id: string, formData: FormData) => void;
  updateAction: (id: string, formData: FormData) => void;
  reorderAction: (id: string, formData: FormData) => void;
  deleteAction: (id: string, formData: FormData) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div className="mt-8">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase text-gs-gray">Milestones</h2>
        {canManage && (
          <button type="button" onClick={() => setCreating((c) => !c)} className="text-xs text-gs-red hover:underline">
            {creating ? "Cancel" : "Add Milestone"}
          </button>
        )}
      </div>

      {canManage && creating && (
        <ActionForm
          action={createAction}
          successMessage="Milestone added."
          onSuccess={() => setCreating(false)}
          className="mt-3 flex flex-wrap items-end gap-3 rounded-lg border border-gs-gray/15 bg-white p-4"
        >
          <div className="flex flex-1 flex-col gap-1">
            <label className="text-xs font-medium text-gs-gray">Title</label>
            <input name="title" required placeholder="e.g. Design Sign-off" className="min-h-9 rounded-md border border-gs-gray/30 px-2 text-sm" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gs-gray">Due Date</label>
            <input type="date" name="dueDate" required className="min-h-9 rounded-md border border-gs-gray/30 px-2 text-sm" />
          </div>
          <SubmitButton pendingLabel="Adding…" className="flex min-h-9 items-center rounded-md bg-gs-black px-4 text-sm font-medium text-white hover:opacity-90">
            Add
          </SubmitButton>
        </ActionForm>
      )}

      <div className="mt-3 overflow-hidden rounded-lg border border-gs-gray/15 bg-white">
        {milestones.length === 0 ? (
          <p className="px-4 py-4 text-sm text-gs-gray">
            {canManage ? "No milestones yet — add the project's key checkpoints above." : "No milestones set for this project yet."}
          </p>
        ) : (
          <ul>
            {milestones.map((m, i) => {
              const isEditing = editingId === m.id;
              return (
                <li key={m.id} className="border-b border-gs-gray/10 last:border-b-0">
                  {isEditing && canManage ? (
                    <ActionForm
                      action={updateAction.bind(null, m.id)}
                      successMessage="Milestone updated."
                      onSuccess={() => setEditingId(null)}
                      className="flex flex-wrap items-end gap-3 px-4 py-3"
                    >
                      <div className="flex flex-1 flex-col gap-1">
                        <label className="text-xs font-medium text-gs-gray">Title</label>
                        <input name="title" required defaultValue={m.title} className="min-h-9 rounded-md border border-gs-gray/30 px-2 text-sm" />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-gs-gray">Due Date</label>
                        <input type="date" name="dueDate" required defaultValue={m.dueInput} className="min-h-9 rounded-md border border-gs-gray/30 px-2 text-sm" />
                      </div>
                      <SubmitButton pendingLabel="Saving…" className="flex min-h-9 items-center rounded-md bg-gs-black px-3 text-sm font-medium text-white hover:opacity-90">
                        Save
                      </SubmitButton>
                      <button type="button" onClick={() => setEditingId(null)} className="text-xs text-gs-gray hover:underline">
                        Cancel
                      </button>
                    </ActionForm>
                  ) : (
                    <div className="flex items-center gap-3 px-4 py-2.5">
                      {/* Check / uncheck — manual only (never computed from task status). */}
                      {canManage ? (
                        <form action={toggleAction.bind(null, m.id)}>
                          <button
                            type="submit"
                            aria-label={m.completed ? "Mark incomplete" : "Mark complete"}
                            className={`flex h-5 w-5 items-center justify-center rounded border text-xs ${
                              m.completed ? "border-green-600 bg-green-600 text-white" : "border-gs-gray/40 text-transparent hover:border-gs-gray"
                            }`}
                          >
                            ✓
                          </button>
                        </form>
                      ) : (
                        <span
                          aria-label={m.completed ? "Completed" : "Not completed"}
                          className={`flex h-5 w-5 items-center justify-center rounded border text-xs ${
                            m.completed ? "border-green-600 bg-green-600 text-white" : "border-gs-gray/30 text-transparent"
                          }`}
                        >
                          ✓
                        </span>
                      )}

                      <div className="flex-1">
                        <span className={`text-sm font-medium ${m.completed ? "text-gs-gray line-through" : ""}`}>{m.title}</span>
                        <span className="ml-2 text-xs text-gs-gray">Due {m.dueLabel}</span>
                      </div>

                      {canManage && (
                        <div className="flex items-center gap-1.5 text-gs-gray">
                          <form action={reorderAction.bind(null, m.id)}>
                            <input type="hidden" name="direction" value="up" />
                            <button type="submit" disabled={i === 0} aria-label="Move up" className="px-1 hover:text-gs-black disabled:opacity-30">↑</button>
                          </form>
                          <form action={reorderAction.bind(null, m.id)}>
                            <input type="hidden" name="direction" value="down" />
                            <button type="submit" disabled={i === milestones.length - 1} aria-label="Move down" className="px-1 hover:text-gs-black disabled:opacity-30">↓</button>
                          </form>
                          <button type="button" onClick={() => setEditingId(m.id)} className="px-1 text-xs hover:underline">Edit</button>
                          <form action={deleteAction.bind(null, m.id)}>
                            <button type="submit" aria-label="Delete milestone" className="px-1 text-xs hover:text-gs-red">✕</button>
                          </form>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
