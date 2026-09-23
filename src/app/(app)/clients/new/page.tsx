import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canCreateClient, getEligibleAccountManagers, isAdmin } from "@/lib/permissions";
import { createClient } from "@/lib/actions/clients";
import { ClientForm } from "../client-form";

export default async function NewClientPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canCreateClient(user)) redirect("/clients");

  // Accountant is intake-only — Account Owner assignment is handled later, same
  // top-down principle as Project Account Manager (PRD correction #2/#7).
  const canSetOwner = isAdmin(user);
  const owners = canSetOwner ? await getEligibleAccountManagers() : [];

  return (
    <div className="max-w-md">
      <h1 className="text-xl font-semibold">New Client</h1>
      <div className="mt-6">
        <ClientForm
          action={createClient}
          owners={owners}
          submitLabel="Create Client"
          showAccountOwner={canSetOwner}
        />
      </div>
    </div>
  );
}
