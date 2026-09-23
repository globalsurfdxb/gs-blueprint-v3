import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { ChangePasswordForm } from "./change-password-form";

const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Admin",
  CLUSTER_HEAD: "Cluster Head",
  LEAD: "Lead",
  ACCOUNT_CLIENT_SERVICES: "Account/Client Services",
  CONTRIBUTOR: "Contributor",
  ACCOUNTANT: "Accountant",
};

const LOCATION_LABELS: Record<string, string> = {
  DUBAI: "Dubai",
  INDIA: "India",
};

export default async function ProfilePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const roleLines = user.roles.map((r) =>
    [ROLE_LABELS[r.role] ?? r.role, r.cluster?.name, r.pod?.name].filter(Boolean).join(" · "),
  );

  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-semibold">Profile</h1>
      <p className="mt-1 text-sm text-gs-gray">Your account details. Only your password can be changed here.</p>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <div className="flex flex-col gap-4 rounded-lg border border-gs-gray/15 bg-white p-6">
          <div>
            <p className="text-xs uppercase text-gs-gray">Name</p>
            <p className="text-sm font-medium">{user.name}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-gs-gray">Email</p>
            <p className="text-sm font-medium">{user.email}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-gs-gray">Role</p>
            {roleLines.length > 0 ? (
              roleLines.map((line, i) => <p key={i} className="text-sm font-medium">{line}</p>)
            ) : (
              <p className="text-sm text-gs-gray">No role assigned</p>
            )}
          </div>
          <div>
            <p className="text-xs uppercase text-gs-gray">Location</p>
            <p className="text-sm font-medium">{LOCATION_LABELS[user.location] ?? user.location}</p>
          </div>
          <p className="text-xs text-gs-gray">
            To change your name, email, role or location, contact an Admin.
          </p>
        </div>

        <ChangePasswordForm />
      </div>
    </div>
  );
}
