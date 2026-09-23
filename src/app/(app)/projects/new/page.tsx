import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canCreateProject, getEligibleAccountManagers, isAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { createProject } from "@/lib/actions/projects";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { OneDriveLinksField } from "./onedrive-links-field";

export default async function NewProjectPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canCreateProject(user)) redirect("/projects");

  // Accountant is intake-only (PRD correction #7): Task Group attachment and Account
  // Manager designation are the owning Cluster Head's job afterward, so those sections
  // (and the queries behind them) only apply for Admin.
  const canSetExtras = isAdmin(user);

  const [clients, serviceTypes, allClusters, leadRoles, accountManagers] = await Promise.all([
    prisma.client.findMany({ orderBy: { name: "asc" } }),
    prisma.serviceType.findMany({ orderBy: { name: "asc" } }),
    prisma.cluster.findMany({ orderBy: { name: "asc" } }),
    canSetExtras
      ? prisma.userRole.findMany({
          where: { role: "LEAD" },
          include: { user: true, cluster: true, pod: true },
          orderBy: { user: { name: "asc" } },
        })
      : Promise.resolve([]),
    canSetExtras ? getEligibleAccountManagers() : Promise.resolve([]),
  ]);

  const clusters = allClusters;

  // One checkbox per LEAD-role instance (not deduped by user) — attaching a Lead picks
  // exactly one discipline (cluster/pod tag) to represent, and each option here is one
  // such instance. Cross-cluster by design: every Lead in the agency is selectable here,
  // not just ones in the cluster being chosen above.
  const leadOptions = leadRoles
    .filter((r) => r.user.isActive)
    .map((r) => ({
      id: r.id,
      label: [r.user.name, [r.cluster?.name, r.pod?.name].filter(Boolean).join(" · ")].filter(Boolean).join(" · "),
    }));

  return (
    <div className="max-w-md">
      <h1 className="text-xl font-semibold">New Project</h1>

      <ActionForm
        action={createProject}
        successMessage="Project created."
        className="mt-6 flex flex-col gap-4 rounded-lg border border-gs-gray/15 bg-white p-6"
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor="name" className="text-sm font-medium">Project Name</label>
          <input
            id="name"
            name="name"
            required
            placeholder="e.g. Inno SEO"
            className="rounded-md border border-gs-gray/30 px-3 py-2 text-sm outline-none focus:border-gs-red focus:ring-1 focus:ring-gs-red"
          />
          <p className="text-xs text-gs-gray">
            Convention: Client + Service Type (each service line is its own project).
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="clientId" className="text-sm font-medium">Client</label>
          <select
            id="clientId"
            name="clientId"
            required
            className="rounded-md border border-gs-gray/30 px-3 py-2 text-sm outline-none focus:border-gs-red focus:ring-1 focus:ring-gs-red"
          >
            <option value="" disabled>Select a client</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="serviceTypeId" className="text-sm font-medium">Service Type</label>
          <select
            id="serviceTypeId"
            name="serviceTypeId"
            required
            className="rounded-md border border-gs-gray/30 px-3 py-2 text-sm outline-none focus:border-gs-red focus:ring-1 focus:ring-gs-red"
          >
            <option value="" disabled>Select a service type</option>
            {serviceTypes.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="clusterId" className="text-sm font-medium">Cluster</label>
          <select
            id="clusterId"
            name="clusterId"
            required
            defaultValue={clusters.length === 1 ? clusters[0].id : undefined}
            className="rounded-md border border-gs-gray/30 px-3 py-2 text-sm outline-none focus:border-gs-red focus:ring-1 focus:ring-gs-red"
          >
            {clusters.length !== 1 && <option value="" disabled>Select a cluster</option>}
            {clusters.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="status" className="text-sm font-medium">Status</label>
          <select
            id="status"
            name="status"
            defaultValue="PLANNING"
            className="rounded-md border border-gs-gray/30 px-3 py-2 text-sm outline-none focus:border-gs-red focus:ring-1 focus:ring-gs-red"
          >
            <option value="PLANNING">Planning</option>
            <option value="ACTIVE">Active</option>
            <option value="PAUSED">Paused</option>
            <option value="COMPLETED">Completed</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="referenceNumber" className="text-sm font-medium">
            Reference Number <span className="text-gs-gray">(invoice / PO / proposal — free text)</span>
          </label>
          <input
            id="referenceNumber"
            name="referenceNumber"
            className="rounded-md border border-gs-gray/30 px-3 py-2 text-sm outline-none focus:border-gs-red focus:ring-1 focus:ring-gs-red"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="summary" className="text-sm font-medium">
            Summary <span className="text-gs-gray">(optional)</span>
          </label>
          <textarea
            id="summary"
            name="summary"
            rows={3}
            placeholder="What is this project for, at a glance..."
            className="rounded-md border border-gs-gray/30 px-3 py-2 text-sm outline-none focus:border-gs-red focus:ring-1 focus:ring-gs-red"
          />
        </div>

        <OneDriveLinksField />

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="startDate" className="text-sm font-medium">Start Date</label>
            <input
              id="startDate"
              name="startDate"
              type="date"
              className="rounded-md border border-gs-gray/30 px-3 py-2 text-sm outline-none focus:border-gs-red focus:ring-1 focus:ring-gs-red"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="deadline" className="text-sm font-medium">Deadline</label>
            <input
              id="deadline"
              name="deadline"
              type="date"
              className="rounded-md border border-gs-gray/30 px-3 py-2 text-sm outline-none focus:border-gs-red focus:ring-1 focus:ring-gs-red"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="maxAllocatedHours" className="text-sm font-medium">
            Max Allocated Hours <span className="text-gs-gray">(optional)</span>
          </label>
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-1.5">
              <input type="radio" name="hoursAllocationType" value="ONE_TIME" defaultChecked />
              One-Time (total for project)
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" name="hoursAllocationType" value="MONTHLY" />
              Monthly (retainer, e.g. SEO / Social)
            </label>
          </div>
          <input
            id="maxAllocatedHours"
            name="maxAllocatedHours"
            type="number"
            min="0"
            step="0.5"
            className="rounded-md border border-gs-gray/30 px-3 py-2 text-sm outline-none focus:border-gs-red focus:ring-1 focus:ring-gs-red"
          />
          <p className="text-xs text-gs-gray">Visible to the assigned Lead — flags retainer over-servicing risk.</p>
        </div>

        {canSetExtras && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="accountManagerId" className="text-sm font-medium">
              Account Manager <span className="text-gs-gray">(optional)</span>
            </label>
            <select
              id="accountManagerId"
              name="accountManagerId"
              defaultValue=""
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
          </div>
        )}

        {canSetExtras && (
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Discipline Task Groups</span>
            <div className="flex flex-col gap-1 rounded-md border border-gs-gray/30 p-3">
              {leadOptions.length === 0 && (
                <p className="text-sm text-gs-gray">No one holds a Lead role yet.</p>
              )}
              {leadOptions.map((l) => (
                <label key={l.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="leadRoleIds" value={l.id} />
                  {l.label}
                </label>
              ))}
            </div>
            <p className="text-xs text-gs-gray">
              Optional at creation — attaching a Lead creates their discipline&apos;s Task Group (e.g. an SEO
              Lead plus a separate Design Lead). More can be attached later from the project page.
            </p>
          </div>
        )}

        {!canSetExtras && (
          <p className="text-xs text-gs-gray">
            The owning Cluster Head attaches discipline Leads and assigns an Account Manager after intake.
          </p>
        )}

        <SubmitButton
          pendingLabel="Creating…"
          className="mt-2 flex min-h-11 items-center self-start rounded-md bg-gs-red px-4 text-sm font-medium text-white hover:opacity-90"
        >
          Create Project
        </SubmitButton>
      </ActionForm>
    </div>
  );
}
