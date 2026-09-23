import { SaveButton } from "@/components/save-button";

type Defaults = { name: string; contentLeadTimeDays: number; designLeadTimeDays: number };

export function EditContentTypeForm({
  defaults,
  action,
}: {
  defaults: Defaults;
  action: (formData: FormData) => void;
}) {
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-gs-gray">Name</label>
        <input
          name="name"
          required
          defaultValue={defaults.name}
          className="min-h-11 rounded-md border border-gs-gray/30 px-3 text-sm"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-gs-gray">Content Lead Time (days)</label>
        <input
          name="contentLeadTimeDays"
          type="number"
          min="0"
          required
          defaultValue={defaults.contentLeadTimeDays}
          className="min-h-11 w-28 rounded-md border border-gs-gray/30 px-3 text-sm"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-gs-gray">Design Lead Time (days)</label>
        <input
          name="designLeadTimeDays"
          type="number"
          min="0"
          required
          defaultValue={defaults.designLeadTimeDays}
          className="min-h-11 w-28 rounded-md border border-gs-gray/30 px-3 text-sm"
        />
      </div>
      <SaveButton className="flex min-h-11 items-center rounded-md border border-gs-gray/30 px-4 text-sm font-medium hover:bg-gs-light disabled:opacity-60">
        Save
      </SaveButton>
    </form>
  );
}
