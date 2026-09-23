import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canAccessContentCalendar, canViewContentCalendar, hidesCompletedProjects, SOCIAL_MEDIA_POD_NAME } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export default async function ContentCalendarIndexPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canAccessContentCalendar(user)) redirect("/");

  const socialMediaGroups = await prisma.taskGroup.findMany({
    where: { pod: { name: SOCIAL_MEDIA_POD_NAME } },
    include: { project: { include: { client: true } } },
    orderBy: { project: { name: "asc" } },
  });

  // Admin sees every project with a Social Media Task Group; a Social Media Lead sees ones
  // they lead; the overseeing Cluster Head (Ashna) sees ones in their pod scope — same
  // per-project authority the calendar page itself enforces (canViewContentCalendar).
  const eligibleProjects = socialMediaGroups
    .filter((g) => canViewContentCalendar(user, g))
    .map((g) => g.project)
    // Archived projects drop out for everyone.
    .filter((p) => p.archivedAt === null)
    // Leads/Contributors don't see Completed projects; Admin & Cluster Heads (oversight) do.
    .filter((p) => !hidesCompletedProjects(user) || p.status !== "COMPLETED");

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-semibold">Content Calendar</h1>
      <p className="mt-1 text-sm text-gs-gray">
        Select a project to open or create that month&apos;s Social Media Content Calendar.
      </p>

      <div className="mt-6 flex flex-col gap-2">
        {eligibleProjects.length === 0 && (
          <p className="text-sm text-gs-gray">
            No project has a Social Media Task Group you lead yet — attach one from the project page first.
          </p>
        )}
        {eligibleProjects.map((p) => (
          <Link
            key={p.id}
            href={`/content-calendar/${p.id}`}
            className="flex min-h-11 items-center justify-between rounded-md border border-gs-gray/15 bg-white px-4 text-sm hover:bg-gs-light"
          >
            <span className="font-medium">{p.name}</span>
            <span className="text-gs-gray">{p.client.name}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
