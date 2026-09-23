"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import {
  canCreateProject,
  canEditProjectInCluster,
  canManageTaskGroups,
  canAttachLeadRole,
  canManageThisGroup,
  canAssignAccountManager,
  canAssignDependencyTracker,
  isAdmin,
} from "@/lib/permissions";
import { notifyUsers } from "@/lib/notifications";

const PROJECT_STATUS_VALUES = ["PLANNING", "ACTIVE", "PAUSED", "COMPLETED", "CANCELLED"] as const;

/** Notifies a newly-attached group's Lead plus the project's home-cluster Cluster Head(s)
 * — excludes the acting user from their own notification. */
async function notifyGroupAttached(
  clusterId: string,
  projectId: string,
  projectName: string,
  leadUserId: string,
  actingUserId: string,
) {
  const clusterHeadRoles = await prisma.userRole.findMany({
    where: { role: "CLUSTER_HEAD", clusterId },
    select: { userId: true },
  });
  const recipients = [leadUserId, ...clusterHeadRoles.map((r) => r.userId)].filter(
    (id) => id !== actingUserId,
  );
  await notifyUsers(recipients, {
    type: "PROJECT_ASSIGNED",
    message: `You were assigned to project "${projectName}".`,
    relatedProjectId: projectId,
  });
}

/** Builds a TaskGroup's discipline name/cluster/pod from the LEAD-role instance chosen to
 * represent it (e.g. "Marketing & Strategy · SEO"). */
async function resolveLeadRole(leadRoleId: string) {
  const role = await prisma.userRole.findUnique({
    where: { id: leadRoleId },
    include: { user: true, cluster: true, pod: true },
  });
  if (!role || role.role !== "LEAD") {
    throw new Error("Select a valid Lead.");
  }
  const name = [role.cluster?.name, role.pod?.name].filter(Boolean).join(" · ") || role.user.name;
  return { userId: role.userId, clusterId: role.clusterId, podId: role.podId, name };
}

const HOURS_ALLOCATION_TYPE_VALUES = ["ONE_TIME", "MONTHLY"] as const;

const createProjectSchema = z.object({
  name: z.string().min(1, "Project name is required."),
  clientId: z.string().min(1, "Client is required."),
  serviceTypeId: z.string().min(1, "Service type is required."),
  clusterId: z.string().min(1, "Cluster is required."),
  referenceNumber: z.string().optional(),
  summary: z.string().optional(),
  startDate: z.string().optional(),
  deadline: z.string().optional(),
  maxAllocatedHours: z.string().optional(),
  hoursAllocationType: z.enum(HOURS_ALLOCATION_TYPE_VALUES).optional(),
  accountManagerId: z.string().optional(),
  status: z.enum(PROJECT_STATUS_VALUES).optional(),
});

export async function createProject(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not signed in.");

  const parsed = createProjectSchema.safeParse({
    name: formData.get("name"),
    clientId: formData.get("clientId"),
    serviceTypeId: formData.get("serviceTypeId"),
    clusterId: formData.get("clusterId"),
    referenceNumber: formData.get("referenceNumber") || undefined,
    summary: formData.get("summary") || undefined,
    startDate: formData.get("startDate") || undefined,
    deadline: formData.get("deadline") || undefined,
    maxAllocatedHours: formData.get("maxAllocatedHours") || undefined,
    hoursAllocationType: formData.get("hoursAllocationType") || undefined,
    accountManagerId: formData.get("accountManagerId") || undefined,
    status: formData.get("status") || undefined,
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input.");
  }

  if (!canCreateProject(user)) {
    throw new Error("Only an Admin or Accountant can create a new project.");
  }

  // Accountant is intake-only (PRD correction #7): they create the bare project record
  // and hand off — Task Group attachment and Account Manager designation are the owning
  // Cluster Head's job afterward, never set at Accountant-driven creation.
  const canSetExtras = isAdmin(user);
  const initialLeadRoleIds = canSetExtras ? formData.getAll("leadRoleIds").map(String).filter(Boolean) : [];
  const initialGroups = await Promise.all(initialLeadRoleIds.map(resolveLeadRole));

  // Multiple labeled OneDrive links, added as parallel arrays by the dynamic
  // add-row UI (each row contributes one url + one label, empty urls are dropped).
  const linkUrls = formData.getAll("linkUrls").map(String);
  const linkLabels = formData.getAll("linkLabels").map(String);
  const links = linkUrls
    .map((url, i) => ({ url: url.trim(), label: linkLabels[i]?.trim() || undefined }))
    .filter((l) => l.url.length > 0);
  for (const l of links) {
    if (!z.string().url().safeParse(l.url).success) {
      throw new Error(`"${l.url}" is not a valid URL.`);
    }
  }

  const project = await prisma.project.create({
    data: {
      name: parsed.data.name,
      clientId: parsed.data.clientId,
      serviceTypeId: parsed.data.serviceTypeId,
      clusterId: parsed.data.clusterId,
      referenceNumber: parsed.data.referenceNumber,
      summary: parsed.data.summary,
      startDate: parsed.data.startDate ? new Date(parsed.data.startDate) : undefined,
      deadline: parsed.data.deadline ? new Date(parsed.data.deadline) : undefined,
      maxAllocatedHours: parsed.data.maxAllocatedHours ? Number(parsed.data.maxAllocatedHours) : undefined,
      hoursAllocationType: parsed.data.maxAllocatedHours ? parsed.data.hoursAllocationType : undefined,
      accountManagerId: canSetExtras ? parsed.data.accountManagerId : undefined,
      status: parsed.data.status ?? undefined,
      createdById: user.id,
      taskGroups: {
        create: initialGroups.map((g) => ({
          name: g.name,
          leadUserId: g.userId,
          clusterId: g.clusterId,
          podId: g.podId,
          addedById: user.id,
        })),
      },
      attachments: {
        create: links.map((l) => ({ url: l.url, label: l.label, addedById: user.id })),
      },
    },
  });

  await Promise.all(
    initialGroups.map((g) =>
      notifyGroupAttached(parsed.data.clusterId, project.id, project.name, g.userId, user.id),
    ),
  );

  revalidatePath("/projects");
  // Accountant can't view the project detail page (intake-only, no cluster/lead
  // membership) — send them back to the Dashboard instead of a page that would bounce them.
  redirect(isAdmin(user) ? `/projects/${project.id}` : "/");
}

const updateProjectSchema = z.object({
  name: z.string().min(1, "Project name is required."),
  serviceTypeId: z.string().min(1, "Service type is required."),
  referenceNumber: z.string().optional(),
  summary: z.string().optional(),
  startDate: z.string().optional(),
  deadline: z.string().optional(),
  status: z.enum(PROJECT_STATUS_VALUES),
  maxAllocatedHours: z.string().optional(),
  hoursAllocationType: z.enum(HOURS_ALLOCATION_TYPE_VALUES).optional(),
  accountManagerId: z.string().optional(),
  dependencyTrackerId: z.string().optional(),
});

export async function updateProject(projectId: string, formData: FormData) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not signed in.");

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { taskGroups: { select: { id: true, leadUserId: true, podId: true } } },
  });
  if (!project) throw new Error("Project not found.");
  if (!canEditProjectInCluster(user, project)) {
    throw new Error("You don't have permission to edit this project.");
  }

  const parsed = updateProjectSchema.safeParse({
    name: formData.get("name"),
    serviceTypeId: formData.get("serviceTypeId"),
    referenceNumber: formData.get("referenceNumber") || undefined,
    summary: formData.get("summary") || undefined,
    startDate: formData.get("startDate") || undefined,
    deadline: formData.get("deadline") || undefined,
    status: formData.get("status"),
    maxAllocatedHours: formData.get("maxAllocatedHours") || undefined,
    hoursAllocationType: formData.get("hoursAllocationType") || undefined,
    accountManagerId: formData.get("accountManagerId") || undefined,
    dependencyTrackerId: formData.get("dependencyTrackerId") || undefined,
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input.");
  }

  await prisma.project.update({
    where: { id: projectId },
    data: {
      name: parsed.data.name,
      serviceTypeId: parsed.data.serviceTypeId,
      referenceNumber: parsed.data.referenceNumber,
      summary: parsed.data.summary || null,
      startDate: parsed.data.startDate ? new Date(parsed.data.startDate) : null,
      deadline: parsed.data.deadline ? new Date(parsed.data.deadline) : null,
      status: parsed.data.status,
      maxAllocatedHours: parsed.data.maxAllocatedHours ? Number(parsed.data.maxAllocatedHours) : null,
      hoursAllocationType: parsed.data.maxAllocatedHours ? parsed.data.hoursAllocationType ?? null : null,
      // Top-down only, never self-service (PRD correction #2): only Admin or the
      // project's own Cluster Head may change who's designated Account Manager here —
      // anyone else's form omits the field entirely, so leave the existing value alone
      // rather than defaulting it to null.
      ...(canAssignAccountManager(user, project)
        ? { accountManagerId: parsed.data.accountManagerId || null }
        : {}),
      // Dependency Tracker (PRD 8.13) — same top-down-only rule, assigned independently of
      // the Account Manager; anyone without the authority has no field, so leave it alone.
      ...(canAssignDependencyTracker(user, project)
        ? { dependencyTrackerId: parsed.data.dependencyTrackerId || null }
        : {}),
    },
  });

  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/projects");
}

const attachGroupSchema = z.object({
  leadRoleId: z.string().min(1, "Select a Lead."),
});

/** Attaches a new discipline Lead to the project, creating their Task Group. */
export async function attachTaskGroup(projectId: string, formData: FormData) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not signed in.");

  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw new Error("Project not found.");
  if (!canManageTaskGroups(user, project)) {
    throw new Error("Only Admin, the project's Cluster Head, or Account/Client Services can attach a discipline Lead.");
  }

  const parsed = attachGroupSchema.safeParse({ leadRoleId: formData.get("leadRoleId") });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input.");
  }

  const group = await resolveLeadRole(parsed.data.leadRoleId);

  if (!canAttachLeadRole(user, project, group)) {
    throw new Error("A pod-restricted Cluster Head can only attach a Lead from their own pod.");
  }

  const existing = await prisma.taskGroup.findUnique({
    where: { projectId_leadUserId: { projectId, leadUserId: group.userId } },
  });
  if (existing) {
    throw new Error("This Lead already has a Task Group on this project.");
  }

  await prisma.taskGroup.create({
    data: {
      projectId,
      name: group.name,
      leadUserId: group.userId,
      clusterId: group.clusterId,
      podId: group.podId,
      addedById: user.id,
    },
  });

  await notifyGroupAttached(project.clusterId, project.id, project.name, group.userId, user.id);

  revalidatePath(`/projects/${projectId}`);
}

export async function removeTaskGroup(projectId: string, groupId: string, _formData: FormData) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not signed in.");

  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw new Error("Project not found.");
  if (!canManageTaskGroups(user, project)) {
    throw new Error("Only Admin, the project's Cluster Head, or Account/Client Services can remove a Task Group.");
  }

  const group = await prisma.taskGroup.findUnique({ where: { id: groupId } });
  if (!group || group.projectId !== projectId) throw new Error("Task Group not found.");
  if (!canManageThisGroup(user, project, group)) {
    throw new Error("A pod-restricted Cluster Head can only remove a Task Group from their own pod.");
  }

  const taskCount = await prisma.task.count({ where: { groupId } });
  if (taskCount > 0) {
    throw new Error("This Task Group has tasks in it — reassign or complete them before removing the group.");
  }

  await prisma.taskGroup.delete({ where: { id: groupId } });

  revalidatePath(`/projects/${projectId}`);
}

/**
 * Archive a project — Admin only (team feedback #9). A soft-delete: the project and all
 * its history stay in the database but drop out of every listing, dashboard and report
 * (see getReportScope + the project list's archived filter). Fully reversible via
 * unarchiveProject.
 */
export async function archiveProject(projectId: string, _formData: FormData) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not signed in.");
  if (!isAdmin(user)) throw new Error("Only an Admin can archive a project.");

  await prisma.project.update({
    where: { id: projectId },
    data: { archivedAt: new Date() },
  });

  revalidatePath("/projects");
  revalidatePath(`/projects/${projectId}`);
  redirect("/projects");
}

/** Restore an archived project back into every listing/report — Admin only. */
export async function unarchiveProject(projectId: string, _formData: FormData) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not signed in.");
  if (!isAdmin(user)) throw new Error("Only an Admin can restore a project.");

  await prisma.project.update({
    where: { id: projectId },
    data: { archivedAt: null },
  });

  revalidatePath("/projects");
  revalidatePath(`/projects/${projectId}`);
}
