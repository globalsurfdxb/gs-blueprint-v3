import { ActionForm, SubmitButton } from "@/components/action-form";

export function AddSubtaskForm({ action }: { action: (formData: FormData) => void }) {
  return (
    <ActionForm
      action={action}
      successMessage="Subtask added."
      className="flex flex-wrap items-end gap-3 rounded-lg border border-gs-gray/15 bg-white p-4"
    >
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-gs-gray">Subtask Name</label>
        <input
          name="name"
          required
          className="rounded-md border border-gs-gray/30 px-3 py-2 text-sm"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-gs-gray">Priority</label>
        <select name="priority" defaultValue="MEDIUM" className="rounded-md border border-gs-gray/30 px-3 py-2 text-sm">
          <option value="LOW">Low</option>
          <option value="MEDIUM">Medium</option>
          <option value="HIGH">High</option>
          <option value="URGENT">Urgent</option>
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-gs-gray">Due Date</label>
        <input name="dueDate" type="date" required className="rounded-md border border-gs-gray/30 px-3 py-2 text-sm" />
      </div>
      <SubmitButton
        pendingLabel="Adding…"
        className="flex min-h-11 items-center rounded-md border border-gs-gray/30 px-4 text-sm font-medium hover:bg-gs-light"
      >
        Add Subtask
      </SubmitButton>
    </ActionForm>
  );
}
