import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canManageClients, canViewProject, isAdmin, getEligibleAccountManagers } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { updateClient, deleteClient } from "@/lib/actions/clients";
import { ClientForm } from "../client-form";
import { DeleteClientForm } from "./delete-client-form";

export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canManageClients(user)) redirect("/");

  const { id } = await params;
  const [client, owners] = await Promise.all([
    prisma.client.findUnique({
      where: { id },
      include: {
        projects: {
          include: { serviceType: true, taskGroups: { select: { id: true, leadUserId: true, podId: true } } },
          orderBy: { createdAt: "desc" },
        },
      },
    }),
    getEligibleAccountManagers(),
  ]);

  if (!client) notFound();

  const projectVisibility = await Promise.all(
    client.projects.map((p) => (isAdmin(user) ? true : canViewProject(user, p))),
  );
  const visibleProjects = client.projects.filter((_, i) => projectVisibility[i]);

  // A client is only reachable at all if at least one of its projects is visible to this user
  // (mirrors the scoping already applied on the Clients list).
  if (!isAdmin(user) && visibleProjects.length === 0) {
    redirect("/clients");
  }

  const updateClientWithId = updateClient.bind(null, client.id);

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-semibold">{client.name}</h1>

      <div className="mt-6">
        <ClientForm
          action={updateClientWithId}
          owners={owners}
          defaults={client}
          submitLabel="Save Changes"
        />
      </div>

      {isAdmin(user) && (
        <div className="mt-4">
          <DeleteClientForm clientName={client.name} action={deleteClient.bind(null, client.id)} />
        </div>
      )}

      <div className="mt-8">
        <h2 className="text-sm font-semibold uppercase text-gs-gray">Projects</h2>
        <div className="mt-3 flex flex-col gap-2">
          {visibleProjects.length === 0 && (
            <p className="text-sm text-gs-gray">No projects yet for this client.</p>
          )}
          {visibleProjects.map((p) => (
            <Link
              key={p.id}
              href={`/projects/${p.id}`}
              className="flex min-h-11 items-center justify-between gap-3 rounded-md border border-gs-gray/15 bg-white px-4 text-sm hover:bg-gs-light"
            >
              <span>{p.name}</span>
              <span className="text-gs-gray">{p.serviceType.name} · {p.status}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
