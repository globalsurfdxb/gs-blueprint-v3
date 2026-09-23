"use server";

import { z } from "zod";
import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";

async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user)) {
    throw new Error("Admin access required.");
  }
  return user;
}

const ROLE_VALUES = [
  "ADMIN",
  "CLUSTER_HEAD",
  "LEAD",
  "ACCOUNT_CLIENT_SERVICES",
  "CONTRIBUTOR",
  "ACCOUNTANT",
] as const;

// Cross-cutting roles, like Admin — not tied to any cluster or pod.
const UNSCOPED_ROLES = ["ADMIN", "ACCOUNTANT"] as const;
function isUnscopedRole(role: string) {
  return (UNSCOPED_ROLES as readonly string[]).includes(role);
}

// Account/Client Services may be CLUSTER-LESS (PRD v1.26): a "ceiling only" coordinator such
// as a Dependency Tracker (Vidhukrishna) — the ACS permission ceiling with NO cluster oversight.
// The cluster stays REQUIRED for Cluster Head, Lead and Contributor. Unlike the unscoped roles,
// ACS may ALSO carry a cluster (the normal case, e.g. Harsha), so it's optional, not forbidden.
function clusterIsOptional(role: string) {
  return isUnscopedRole(role) || role === "ACCOUNT_CLIENT_SERVICES";
}

const createUserSchema = z.object({
  name: z.string().min(1, "Name is required."),
  email: z.string().email("Enter a valid email."),
  password: z.string().min(8, "Password must be at least 8 characters."),
  location: z.enum(["DUBAI", "INDIA"]),
  role: z.enum(ROLE_VALUES, { message: "A role is required." }),
  clusterId: z.string().optional(),
  podId: z.string().optional(),
});

export async function createUser(formData: FormData) {
  await requireAdmin();

  const parsed = createUserSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    location: formData.get("location"),
    role: formData.get("role"),
    clusterId: formData.get("clusterId") || undefined,
    podId: formData.get("podId") || undefined,
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input.");
  }
  if (!clusterIsOptional(parsed.data.role) && !parsed.data.clusterId) {
    throw new Error("A cluster is required for this role.");
  }

  const existing = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (existing) {
    throw new Error("A user with this email already exists.");
  }

  // Pod restriction (multi-select) only applies to Cluster Head — the checklist is only
  // ever rendered for that role, but guard here too in case of a stale/tampered submit.
  const restrictedPodIds =
    parsed.data.role === "CLUSTER_HEAD" ? formData.getAll("restrictedPodIds").map(String).filter(Boolean) : [];

  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  const user = await prisma.user.create({
    data: {
      name: parsed.data.name,
      email: parsed.data.email,
      passwordHash,
      location: parsed.data.location,
      roles: {
        create: {
          role: parsed.data.role,
          clusterId: isUnscopedRole(parsed.data.role) ? null : parsed.data.clusterId ?? null,
          podId: parsed.data.podId ?? null,
          ...(restrictedPodIds.length > 0
            ? { restrictedPods: { create: restrictedPodIds.map((podId) => ({ podId })) } }
            : {}),
        },
      },
    },
  });

  revalidatePath("/admin/users");
  redirect(`/admin/users/${user.id}`);
}

const updateUserSchema = z.object({
  name: z.string().min(1, "Name is required."),
  email: z.string().email("Enter a valid email."),
  location: z.enum(["DUBAI", "INDIA"]),
  isActive: z.boolean(),
});

export async function updateUser(userId: string, formData: FormData) {
  await requireAdmin();

  const parsed = updateUserSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    location: formData.get("location"),
    isActive: formData.get("isActive") === "on",
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input.");
  }

  const existing = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (existing && existing.id !== userId) {
    throw new Error("A user with this email already exists.");
  }

  await prisma.user.update({
    where: { id: userId },
    data: parsed.data,
  });

  revalidatePath(`/admin/users/${userId}`);
  revalidatePath("/admin/users");
}

const roleSchema = z
  .object({
    role: z.enum(ROLE_VALUES),
    clusterId: z.string().nullable(),
    podId: z.string().nullable(),
  })
  .refine(
    (data) => {
      if (isUnscopedRole(data.role)) return data.clusterId === null; // Admin/Accountant: never scoped
      if (data.role === "ACCOUNT_CLIENT_SERVICES") return true; // ACS: cluster optional (coordinator)
      return data.clusterId !== null; // Cluster Head, Lead, Contributor: cluster required
    },
    {
      message:
        "Admin and Accountant can't be scoped to a cluster; Cluster Head, Lead and Contributor each require one.",
      path: ["clusterId"],
    },
  );

/**
 * Every user holds exactly one role (enforced by a unique constraint on
 * UserRole.userId) — there's no separate add/remove; a user's role is only ever edited
 * in place, here, to keep that invariant from the UI.
 */
export async function changeUserRole(userId: string, userRoleId: string, formData: FormData) {
  await requireAdmin();

  const rawClusterId = formData.get("clusterId");
  const rawPodId = formData.get("podId");

  const parsed = roleSchema.safeParse({
    role: formData.get("role"),
    clusterId: rawClusterId ? String(rawClusterId) : null,
    podId: rawPodId ? String(rawPodId) : null,
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid role assignment.");
  }

  const clusterId = isUnscopedRole(parsed.data.role) ? null : parsed.data.clusterId;
  const podId = parsed.data.podId;

  // Pod restriction (multi-select) only applies to Cluster Head — clear any existing rows
  // first (role edited in place, never a fresh row) and only re-create them if the role
  // being saved is still Cluster Head, so switching away from it drops the restriction too.
  const restrictedPodIds =
    parsed.data.role === "CLUSTER_HEAD" ? formData.getAll("restrictedPodIds").map(String).filter(Boolean) : [];

  await prisma.$transaction([
    prisma.userRolePod.deleteMany({ where: { userRoleId } }),
    prisma.userRole.update({
      where: { id: userRoleId },
      data: {
        role: parsed.data.role,
        clusterId,
        podId,
        ...(restrictedPodIds.length > 0
          ? { restrictedPods: { create: restrictedPodIds.map((podId) => ({ podId })) } }
          : {}),
      },
    }),
  ]);

  revalidatePath(`/admin/users/${userId}`);
}

/**
 * Hard-deletes a user. Only allowed when the account has no content tied to it
 * (projects/tasks created, tasks assigned, time logged, comments, attachments, etc.) —
 * deleting a user who has a real footprint would silently destroy other people's
 * project history. Deactivate (the Active checkbox) instead for anyone with history.
 */
export async function deleteUser(userId: string, _formData: FormData) {
  const admin = await requireAdmin();
  if (userId === admin.id) {
    throw new Error("You can't delete your own account.");
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      _count: {
        select: {
          projectsCreated: true,
          tasksAssigned: true,
          tasksCreated: true,
          timeLogs: true,
          comments: true,
          taskAttachments: true,
          projectAttachments: true,
          studioTicketsRaised: true,
          studioTicketsHandled: true,
          clustersHeaded: true,
          clientsOwned: true,
          taskGroupsLed: true,
        },
      },
    },
  });
  if (!user) throw new Error("User not found.");

  const hasHistory = Object.values(user._count).some((n) => n > 0);
  if (hasHistory) {
    throw new Error(
      "This user has projects, tasks, Task Groups, or other activity tied to their account — deactivate them instead of deleting, to keep that history intact.",
    );
  }

  await prisma.$transaction([
    prisma.userRole.deleteMany({ where: { userId } }),
    prisma.taskGroup.updateMany({ where: { addedById: userId }, data: { addedById: null } }),
    prisma.notification.deleteMany({ where: { userId } }),
    prisma.user.delete({ where: { id: userId } }),
  ]);

  revalidatePath("/admin/users");
  redirect("/admin/users");
}
