import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canManageClients, canCreateClient, canViewProject, isAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export default async function ClientsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  // Accountant can't manage existing clients, but still reaches this page to find the
  // New Client button — the list itself naturally renders empty for them below, since
  // they fail every per-client visibility check.
  if (!canManageClients(user) && !canCreateClient(user)) redirect("/");

  const allClients = await prisma.client.findMany({
    include: {
      accountOwner: true,
      _count: { select: { projects: true } },
      projects: { include: { taskGroups: { select: { id: true, leadUserId: true, podId: true } } } },
    },
    orderBy: { name: "asc" },
  });

  // Non-Admins only see clients that have at least one project they have access to —
  // a Cluster Head shouldn't see every client in the agency, just the ones touching their scope.
  const visible = await Promise.all(
    allClients.map(async (c) => {
      if (isAdmin(user)) return c;
      const visibility = await Promise.all(c.projects.map((p) => canViewProject(user, p)));
      return visibility.some(Boolean) ? c : null;
    }),
  );
  const clients = visible.filter((c): c is NonNullable<typeof c> => c !== null);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Clients</h1>
        {canCreateClient(user) && (
          <Link
            href="/clients/new"
            className="flex min-h-11 items-center rounded-md bg-gs-red px-4 text-sm font-medium text-white hover:opacity-90"
          >
            New Client
          </Link>
        )}
      </div>

      <div className="mt-6 overflow-hidden rounded-lg border border-gs-gray/15 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-gs-light text-left text-xs uppercase text-gs-gray">
              <tr>
                <th className="whitespace-nowrap px-4 py-3">Name</th>
                <th className="whitespace-nowrap px-4 py-3">Industry</th>
                <th className="whitespace-nowrap px-4 py-3">Contact</th>
                <th className="whitespace-nowrap px-4 py-3">Account Owner</th>
                <th className="whitespace-nowrap px-4 py-3">Projects</th>
              </tr>
            </thead>
            <tbody>
              {clients.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-gs-gray">
                    No clients yet.
                  </td>
                </tr>
              )}
              {clients.map((c) => (
                <tr key={c.id} className="border-t border-gs-gray/10">
                  <td className="whitespace-nowrap px-4 py-3">
                    <Link href={`/clients/${c.id}`} className="font-medium hover:underline">
                      {c.name}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-gs-gray">{c.industry ?? "—"}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-gs-gray">
                    {c.contactPerson ?? "—"}
                    {c.contactEmail ? ` · ${c.contactEmail}` : ""}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-gs-gray">{c.accountOwner?.name ?? "—"}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-gs-gray">{c._count.projects}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
