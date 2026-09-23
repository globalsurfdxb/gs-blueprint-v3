import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canManageBugTracking } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { setPodBugTracking } from "@/lib/actions/bug-tracking";
import { ActionForm, SubmitButton } from "@/components/action-form";

export default async function BugTrackingSettingsPage() {
  const user = await getCurrentUser();
  if (!user || !canManageBugTracking(user)) {
    redirect("/");
  }

  const pods = await prisma.pod.findMany({
    include: { cluster: { select: { name: true } } },
    orderBy: [{ cluster: { name: "asc" } }, { name: "asc" }],
  });

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-semibold">Bug Tracking</h1>
      <p className="mt-1 text-sm text-gs-gray">
        When enabled for a discipline, its Task Groups get a Task Type field (Standard / Bug) on the
        create-task screen. Every other discipline is unaffected. Typically only Development (QA is a
        Contributor role inside the Development team, not a separate discipline).
      </p>

      <div className="mt-6 overflow-hidden rounded-lg border border-gs-gray/15 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gs-light text-left text-xs uppercase text-gs-gray">
            <tr>
              <th className="px-4 py-2">Discipline</th>
              <th className="px-4 py-2">Cluster</th>
              <th className="px-4 py-2">Bug Tracking</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {pods.map((pod) => (
              <tr key={pod.id} className="border-t border-gs-gray/10">
                <td className="px-4 py-2 font-medium">{pod.name}</td>
                <td className="px-4 py-2 text-gs-gray">{pod.cluster.name}</td>
                <td className="px-4 py-2">
                  <span className={pod.bugTrackingEnabled ? "font-medium text-green-600" : "text-gs-gray"}>
                    {pod.bugTrackingEnabled ? "Enabled" : "Disabled"}
                  </span>
                </td>
                <td className="px-4 py-2 text-right">
                  <ActionForm
                    action={setPodBugTracking}
                    successMessage={`Bug Tracking ${pod.bugTrackingEnabled ? "disabled" : "enabled"} for ${pod.name}.`}
                  >
                    <input type="hidden" name="podId" value={pod.id} />
                    <input type="hidden" name="enabled" value={pod.bugTrackingEnabled ? "false" : "true"} />
                    <SubmitButton
                      pendingLabel="Saving…"
                      className="flex min-h-9 items-center rounded-md border border-gs-gray/30 px-3 text-sm font-medium hover:bg-gs-light"
                    >
                      {pod.bugTrackingEnabled ? "Disable" : "Enable"}
                    </SubmitButton>
                  </ActionForm>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
