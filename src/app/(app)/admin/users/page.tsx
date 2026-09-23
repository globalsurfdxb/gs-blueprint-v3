import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Admin",
  CLUSTER_HEAD: "Cluster Head",
  LEAD: "Lead",
  ACCOUNT_CLIENT_SERVICES: "Account/Client Services",
  CONTRIBUTOR: "Contributor",
  ACCOUNTANT: "Accountant",
};

export default async function UsersPage() {
  const currentUser = await getCurrentUser();
  if (!currentUser || !isAdmin(currentUser)) {
    redirect("/");
  }

  const users = await prisma.user.findMany({
    include: { roles: { include: { cluster: true, pod: true } } },
    orderBy: { name: "asc" },
  });

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Users & Roles</h1>
        <Link
          href="/admin/users/new"
          className="flex min-h-11 items-center rounded-md bg-gs-red px-4 text-sm font-medium text-white hover:opacity-90"
        >
          New User
        </Link>
      </div>

      <div className="mt-6 overflow-hidden rounded-lg border border-gs-gray/15 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-gs-light text-left text-xs uppercase text-gs-gray">
              <tr>
                <th className="whitespace-nowrap px-4 py-3">Name</th>
                <th className="whitespace-nowrap px-4 py-3">Email</th>
                <th className="whitespace-nowrap px-4 py-3">Location</th>
                <th className="whitespace-nowrap px-4 py-3">Roles</th>
                <th className="whitespace-nowrap px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t border-gs-gray/10">
                  <td className="whitespace-nowrap px-4 py-3">
                    <Link href={`/admin/users/${u.id}`} className="font-medium hover:underline">
                      {u.name}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-gs-gray">{u.email}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-gs-gray">{u.location}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {u.roles.length === 0 && <span className="text-gs-gray">No roles</span>}
                      {u.roles.map((r) => (
                        <span
                          key={r.id}
                          className="rounded-full bg-gs-light px-2 py-0.5 text-xs text-gs-black"
                        >
                          {ROLE_LABELS[r.role]}
                          {r.cluster ? ` · ${r.cluster.name}` : ""}
                          {r.pod ? ` · ${r.pod.name}` : ""}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    {u.isActive ? (
                      <span className="text-gs-black">Active</span>
                    ) : (
                      <span className="text-gs-gray">Inactive</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
