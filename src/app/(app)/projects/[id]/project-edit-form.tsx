import { ActionForm } from "@/components/action-form";
import { SaveButton } from "@/components/save-button";

type ServiceType = { id: string; name: string };
type AccountManager = { id: string; name: string };
type ProjectDefaults = {
  name: string;
  serviceTypeId: string;
  referenceNumber: string | null;
  summary: string | null;
  startDate: Date | null;
  deadline: Date | null;
  status: string;
  maxAllocatedHours: unknown;
  hoursAllocationType: string | null;
  accountManagerId: string | null;
  accountManagerName: string | null;
  dependencyTrackerId: string | null;
  dependencyTrackerName: string | null;
  // Bumped on every save (Prisma @updatedAt). Used as the form's React key so the whole
  // form remounts after a successful save and its uncontrolled <select>/<input> defaults
  // re-sync to the freshly-saved server values — otherwise a just-changed Status / Account
  // Manager / Dependency Tracker could read stale in the control until a manual refresh.
  updatedAt: Date;
};

const STATUS_OPTIONS = ["PLANNING", "ACTIVE", "PAUSED", "COMPLETED", "CANCELLED"];

function toDateInputValue(date: Date | null) {
  if (!date) return "";
  return date.toISOString().slice(0, 10);
}

export function ProjectEditForm({
  action,
  serviceTypes,
  accountManagers,
  dependencyTrackers,
  defaults,
  canSeeMaxAllocatedHours,
  canAssignAccountManager,
  canAssignDependencyTracker,
}: {
  action: (formData: FormData) => void;
  serviceTypes: ServiceType[];
  accountManagers: AccountManager[];
  dependencyTrackers: AccountManager[];
  defaults: ProjectDefaults;
  canSeeMaxAllocatedHours: boolean;
  canAssignAccountManager: boolean;
  canAssignDependencyTracker: boolean;
}) {
  return (
    <ActionForm key={defaults.updatedAt.getTime()} action={action} successMessage="Project updated." className="flex flex-col gap-4 rounded-lg border border-gs-gray/15 bg-white p-6">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="name" className="text-sm font-medium">Project Name</label>
        <input
          id="name"
          name="name"
          required
          defaultValue={defaults.name}
          className="rounded-md border border-gs-gray/30 px-3 py-2 text-sm outline-none focus:border-gs-red focus:ring-1 focus:ring-gs-red"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="serviceTypeId" className="text-sm font-medium">Service Type</label>
        <select
          id="serviceTypeId"
          name="serviceTypeId"
          defaultValue={defaults.serviceTypeId}
          className="rounded-md border border-gs-gray/30 px-3 py-2 text-sm outline-none focus:border-gs-red focus:ring-1 focus:ring-gs-red"
        >
          {serviceTypes.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="referenceNumber" className="text-sm font-medium">Reference Number</label>
        <input
          id="referenceNumber"
          name="referenceNumber"
          defaultValue={defaults.referenceNumber ?? ""}
          className="rounded-md border border-gs-gray/30 px-3 py-2 text-sm outline-none focus:border-gs-red focus:ring-1 focus:ring-gs-red"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="summary" className="text-sm font-medium">Summary</label>
        <textarea
          id="summary"
          name="summary"
          rows={3}
          defaultValue={defaults.summary ?? ""}
          className="rounded-md border border-gs-gray/30 px-3 py-2 text-sm outline-none focus:border-gs-red focus:ring-1 focus:ring-gs-red"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="startDate" className="text-sm font-medium">Start Date</label>
          <input
            id="startDate"
            name="startDate"
            type="date"
            defaultValue={toDateInputValue(defaults.startDate)}
            className="rounded-md border border-gs-gray/30 px-3 py-2 text-sm outline-none focus:border-gs-red focus:ring-1 focus:ring-gs-red"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="deadline" className="text-sm font-medium">Deadline</label>
          <input
            id="deadline"
            name="deadline"
            type="date"
            defaultValue={toDateInputValue(defaults.deadline)}
            className="rounded-md border border-gs-gray/30 px-3 py-2 text-sm outline-none focus:border-gs-red focus:ring-1 focus:ring-gs-red"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="status" className="text-sm font-medium">Status</label>
        <select
          id="status"
          name="status"
          defaultValue={defaults.status}
          className="rounded-md border border-gs-gray/30 px-3 py-2 text-sm outline-none focus:border-gs-red focus:ring-1 focus:ring-gs-red"
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      {canSeeMaxAllocatedHours && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="maxAllocatedHours" className="text-sm font-medium">
            Max Allocated Hours <span className="text-gs-gray">(optional)</span>
          </label>
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                name="hoursAllocationType"
                value="ONE_TIME"
                defaultChecked={defaults.hoursAllocationType !== "MONTHLY"}
              />
              One-Time (total for project)
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                name="hoursAllocationType"
                value="MONTHLY"
                defaultChecked={defaults.hoursAllocationType === "MONTHLY"}
              />
              Monthly (retainer, e.g. SEO / Social)
            </label>
          </div>
          <input
            id="maxAllocatedHours"
            name="maxAllocatedHours"
            type="number"
            min="0"
            step="0.5"
            defaultValue={defaults.maxAllocatedHours ? String(defaults.maxAllocatedHours) : ""}
            className="rounded-md border border-gs-gray/30 px-3 py-2 text-sm outline-none focus:border-gs-red focus:ring-1 focus:ring-gs-red"
          />
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium">Account Manager</label>
        {canAssignAccountManager ? (
          <>
            <select
              id="accountManagerId"
              name="accountManagerId"
              defaultValue={defaults.accountManagerId ?? ""}
              className="rounded-md border border-gs-gray/30 px-3 py-2 text-sm outline-none focus:border-gs-red focus:ring-1 focus:ring-gs-red"
            >
              <option value="">Unassigned</option>
              {accountManagers.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
            <p className="text-xs text-gs-gray">
              Restricted to Account/Client Services users in the Project Delivery &amp; Client Services cluster.
            </p>
          </>
        ) : (
          <p className="rounded-md border border-gs-gray/30 bg-gs-light px-3 py-2 text-sm text-gs-black">
            {defaults.accountManagerName ?? "Unassigned"}
            <span className="ml-2 text-xs text-gs-gray">— set by Admin or the project&apos;s Cluster Head</span>
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium">Dependency Tracker</label>
        {canAssignDependencyTracker ? (
          <>
            <select
              id="dependencyTrackerId"
              name="dependencyTrackerId"
              defaultValue={defaults.dependencyTrackerId ?? ""}
              className="rounded-md border border-gs-gray/30 px-3 py-2 text-sm outline-none focus:border-gs-red focus:ring-1 focus:ring-gs-red"
            >
              <option value="">Unassigned</option>
              {dependencyTrackers.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
            <p className="text-xs text-gs-gray">
              View-only coordinator — sees only this project&apos;s cross-group-linked tasks (predecessor/successor).
            </p>
          </>
        ) : (
          <p className="rounded-md border border-gs-gray/30 bg-gs-light px-3 py-2 text-sm text-gs-black">
            {defaults.dependencyTrackerName ?? "Unassigned"}
            <span className="ml-2 text-xs text-gs-gray">— set by Admin or the project&apos;s Cluster Head</span>
          </p>
        )}
      </div>

      <SaveButton />
    </ActionForm>
  );
}
