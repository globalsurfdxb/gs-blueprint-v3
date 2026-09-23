import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canCreateProject, canViewProject, hidesCompletedProjects, isAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { unarchiveProject } from "@/lib/actions/projects";
import { UnarchiveProjectButton } from "./unarchive-project-button";

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const admin = isAdmin(user);
  const showArchived = admin && (await searchParams).archived === "1";

  const allProjects = await prisma.project.findMany({
    where: {
      AND: [
        // Leads and Contributors don't see finished projects (oversight roles still do).
        hidesCompletedProjects(user) ? { status: { not: "COMPLETED" } } : {},
        // Archived projects are hidden everywhere; Admin can open the archived-only view.
        showArchived ? { archivedAt: { not: null } } : { archivedAt: null },
      ],
    },
    include: {
      client: true,
      serviceType: true,
      cluster: true,
      taskGroups: { include: { lead: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const visible = await Promise.all(
    allProjects.map(async (p) => ((await canViewProject(user, p)) ? p : null)),
  );
  const projects = visible.filter((p): p is NonNullable<typeof p> => p !== null);

  const canCreateAnywhere = canCreateProject(user);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{showArchived ? "Archived Projects" : "Projects"}</h1>
        {canCreateAnywhere && !showArchived && (
          <Link
            href="/projects/new"
            className="flex min-h-11 items-center rounded-md bg-gs-red px-4 text-sm font-medium text-white hover:opacity-90"
          >
            New Project
          </Link>
        )}
      </div>

      {admin && (
        <p className="mt-2 text-sm">
          {showArchived ? (
            <Link href="/projects" className="text-gs-red hover:underline">
              ← Back to active projects
            </Link>
          ) : (
            <Link href="/projects?archived=1" className="text-gs-gray hover:underline">
              View archived projects
            </Link>
          )}
        </p>
      )}

      <div className="mt-6 overflow-hidden rounded-lg border border-gs-gray/15 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead className="bg-gs-light text-left text-xs uppercase text-gs-gray">
              <tr>
                <th className="whitespace-nowrap px-4 py-3">Name</th>
                <th className="whitespace-nowrap px-4 py-3">Client</th>
                <th className="whitespace-nowrap px-4 py-3">Service Type</th>
                <th className="whitespace-nowrap px-4 py-3">Status</th>
                {showArchived && <th className="whitespace-nowrap px-4 py-3"></th>}
              </tr>
            </thead>
            <tbody>
              {projects.length === 0 && (
                <tr>
                  <td colSpan={showArchived ? 5 : 4} className="px-4 py-6 text-center text-gs-gray">
                    {showArchived ? "No archived projects." : "No projects yet."}
                  </td>
                </tr>
              )}
              {projects.map((p) => (
                <tr key={p.id} className="border-t border-gs-gray/10">
                  <td className="whitespace-nowrap px-4 py-3">
                    <Link href={`/projects/${p.id}`} className="font-medium hover:underline">
                      {p.name}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-gs-gray">{p.client.name}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-gs-gray">{p.serviceType.name}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-gs-gray">{p.status}</td>
                  {showArchived && (
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <UnarchiveProjectButton action={unarchiveProject.bind(null, p.id)} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
