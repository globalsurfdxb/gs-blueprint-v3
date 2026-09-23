import { ActionForm } from "@/components/action-form";
import { SaveButton } from "@/components/save-button";

type Owner = { id: string; name: string };
type ClientDefaults = {
  name?: string;
  industry?: string | null;
  contactPerson?: string | null;
  contactEmail?: string | null;
  accountOwnerId?: string | null;
};

export function ClientForm({
  action,
  owners,
  defaults,
  submitLabel,
  successMessage = "Saved.",
  showAccountOwner = true,
}: {
  action: (formData: FormData) => void;
  owners: Owner[];
  defaults?: ClientDefaults;
  submitLabel: string;
  successMessage?: string;
  showAccountOwner?: boolean;
}) {
  return (
    <ActionForm action={action} successMessage={successMessage} className="flex flex-col gap-4 rounded-lg border border-gs-gray/15 bg-white p-6">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="name" className="text-sm font-medium">Client Name</label>
        <input
          id="name"
          name="name"
          required
          defaultValue={defaults?.name}
          className="rounded-md border border-gs-gray/30 px-3 py-2 text-sm outline-none focus:border-gs-red focus:ring-1 focus:ring-gs-red"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="industry" className="text-sm font-medium">Industry</label>
        <input
          id="industry"
          name="industry"
          defaultValue={defaults?.industry ?? ""}
          className="rounded-md border border-gs-gray/30 px-3 py-2 text-sm outline-none focus:border-gs-red focus:ring-1 focus:ring-gs-red"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="contactPerson" className="text-sm font-medium">Contact Person</label>
        <input
          id="contactPerson"
          name="contactPerson"
          defaultValue={defaults?.contactPerson ?? ""}
          className="rounded-md border border-gs-gray/30 px-3 py-2 text-sm outline-none focus:border-gs-red focus:ring-1 focus:ring-gs-red"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="contactEmail" className="text-sm font-medium">Contact Email</label>
        <input
          id="contactEmail"
          name="contactEmail"
          type="email"
          defaultValue={defaults?.contactEmail ?? ""}
          className="rounded-md border border-gs-gray/30 px-3 py-2 text-sm outline-none focus:border-gs-red focus:ring-1 focus:ring-gs-red"
        />
      </div>

      {showAccountOwner && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="accountOwnerId" className="text-sm font-medium">Account Owner</label>
          <select
            id="accountOwnerId"
            name="accountOwnerId"
            defaultValue={defaults?.accountOwnerId ?? ""}
            className="rounded-md border border-gs-gray/30 px-3 py-2 text-sm outline-none focus:border-gs-red focus:ring-1 focus:ring-gs-red"
          >
            <option value="">No owner assigned</option>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <SaveButton>{submitLabel}</SaveButton>
    </ActionForm>
  );
}
