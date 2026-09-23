import { ActionForm, SubmitButton } from "@/components/action-form";

function ReassignIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
      <path d="M17 2l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7 22l-4-4 4-4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ReassignTaskForm({
  assignees,
  currentAssignedToId,
  action,
  bugMode = false,
}: {
  assignees: { id: string; name: string }[];
  currentAssignedToId: string | null;
  action: (formData: FormData) => void;
  // Bug same-group reassignment by a Contributor (PRD v1.18) — reword so it reads as
  // "hand this bug to a teammate to work next", not a Lead's delegate-or-keep decision.
  bugMode?: boolean;
}) {
  // A task that lands on a Lead directly (self-created, or received cross-team) is theirs
  // to keep or delegate — collapsed by default so working it themselves stays the default
  // path, not something that looks like it needs a decision every time.
  return (
    <details className="mt-4">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 text-sm font-medium text-gs-red hover:underline [&::-webkit-details-marker]:hidden">
        <ReassignIcon className="h-4 w-4" />
        {bugMode ? "Reassign bug" : "Reassign"}
      </summary>
      <ActionForm action={action} successMessage="Task reassigned." className="mt-3 flex flex-wrap items-end gap-3 rounded-lg border border-gs-gray/15 bg-white p-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-gs-gray">Assign To</label>
          <select
            name="assignedToId"
            required
            defaultValue={currentAssignedToId ?? ""}
            className="rounded-md border border-gs-gray/30 px-3 py-2 text-sm"
          >
            <option value="" disabled>Select one person</option>
            {assignees.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
        <SubmitButton
          pendingLabel="Reassigning…"
          className="flex min-h-11 items-center rounded-md border border-gs-gray/30 px-4 text-sm font-medium hover:bg-gs-light"
        >
          Reassign
        </SubmitButton>
        <p className="w-full text-xs text-gs-gray">
          {bugMode
            ? "Hand this bug to another member of your team to work next — or pick yourself to keep it."
            : "Delegate this task to a member of your group, or keep it and pick yourself."}
        </p>
      </ActionForm>
    </details>
  );
}
