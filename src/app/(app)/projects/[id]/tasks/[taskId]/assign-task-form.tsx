import { ActionForm, SubmitButton } from "@/components/action-form";

export function AssignTaskForm({
  assignees,
  action,
}: {
  assignees: { id: string; name: string }[];
  action: (formData: FormData) => void;
}) {
  return (
    <ActionForm
      action={action}
      successMessage="Task assigned."
      className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-gs-gray/15 bg-white p-4"
    >
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-gs-gray">Assign To</label>
        <select name="assignedToId" required defaultValue="" className="rounded-md border border-gs-gray/30 px-3 py-2 text-sm">
          <option value="" disabled>Select one person</option>
          {assignees.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      </div>
      <SubmitButton
        pendingLabel="Assigning…"
        className="flex min-h-11 items-center rounded-md bg-gs-red px-4 text-sm font-medium text-white hover:opacity-90"
      >
        Assign
      </SubmitButton>
      <p className="w-full text-xs text-gs-gray">
        This task was handed off unassigned — assign it to a member of your group to start work.
      </p>
    </ActionForm>
  );
}
