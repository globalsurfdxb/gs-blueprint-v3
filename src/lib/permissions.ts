import "server-only";
import { prisma } from "@/lib/prisma";
import type { CurrentUser } from "@/lib/auth";
import type { Project, Task, RoleName } from "@/generated/prisma/client";

// All permission checks funnel through this module so the role/cluster-scoping
// rules in PRD Section 5, plus the Task Group discipline-scoping rules, are enforced
// consistently rather than re-derived per route.

// A project is divided into discipline Task Groups (see TaskGroup in schema.prisma) — one
// per attached Lead, cross-cluster by design. Any function that needs to know a project's
// groups takes this shape — callers must include `taskGroups: { select: { id: true,
// leadUserId: true, podId: true } }` (or similar) on their Prisma query.
export type ProjectWithGroups = Project & {
  taskGroups: { id: string; leadUserId: string; podId: string | null; pod?: { name: string } | null }[];
};
export type TaskGroupRef = { leadUserId: string; podId?: string | null };

function hasRole(user: CurrentUser, role: string, clusterId?: string, podId?: string) {
  return user.roles.some(
    (r) =>
      r.role === role &&
      (clusterId === undefined || r.clusterId === clusterId) &&
      (podId === undefined || r.podId === podId),
  );
}

export function isAdmin(user: CurrentUser) {
  return hasRole(user, "ADMIN");
}

/** Accountant is cross-cutting — not tied to any cluster or pod, like Admin. Their whole
 * role is client/project intake (PRD correction #7): create the record, hand off, done. */
export function isAccountant(user: CurrentUser) {
  return hasRole(user, "ACCOUNTANT");
}

/** Holds the Lead role at all (any pod) — gates access to the cross-project "My Reviews"
 * queue, since only a Lead ever reviews a group's submitted work. */
export function isLead(user: CurrentUser) {
  return hasRole(user, "LEAD");
}

export function isContributor(user: CurrentUser) {
  return hasRole(user, "CONTRIBUTOR");
}

/** Leads and Contributors work day-to-day and shouldn't see finished projects cluttering
 * their lists — Completed projects are hidden from their views (Projects list, My Tasks,
 * My Reviews, their dashboard, the calendar selector). Oversight roles (Admin, Cluster
 * Head, ACS, Accountant) still see everything for reporting and records. */
export function hidesCompletedProjects(user: CurrentUser) {
  return isLead(user) || isContributor(user);
}

/** Holds the Cluster Head role for any cluster (pod restriction is irrelevant to presence). */
export function isAnyClusterHead(user: CurrentUser) {
  return user.roles.some((r) => r.role === "CLUSTER_HEAD");
}

/** Holds a CLUSTER-SCOPED Account/Client Services role — i.e. an ACS user with real cluster
 * oversight (the surfaces below: search, reports). A cluster-less ACS (clusterId null) is the
 * "ceiling only" case (PRD v1.26 Dependency Tracker coordinator like Vidhukrishna): it grants
 * the ACS permission ceiling but NO automatic visibility, so it must NOT count as an oversight
 * ACS here — his visibility comes solely from per-project Dependency Tracker designations. */
export function isAnyAccountClientServices(user: CurrentUser) {
  return user.roles.some((r) => r.role === "ACCOUNT_CLIENT_SERVICES" && r.clusterId != null);
}

/** A "Dependency Tracker coordinator" (PRD v1.26): an ACS user with NO cluster scope — the
 * ceiling-only account (e.g. Vidhukrishna). No cluster oversight and no delivery involvement,
 * so their only surface is the Dependency Tracker; they have no Projects / My Tasks / Clients. */
export function isDependencyCoordinator(user: CurrentUser) {
  return user.roles.some((r) => r.role === "ACCOUNT_CLIENT_SERVICES" && r.clusterId == null);
}

/** Dashboards are an oversight surface (PRD 8.8): Admin sees agency-wide, each Cluster Head
 * sees the same widgets scoped to their own cluster. No other role gets a dashboard. */
export function canViewDashboard(user: CurrentUser) {
  return isAdmin(user) || isAnyClusterHead(user);
}

/** Reports (PRD 8.9) are for the roles that monitor delivery and margin across projects:
 * Admin (agency-wide), a Cluster Head (their cluster), and Account/Client Services (their
 * cluster's clients). Every report scopes its own rows to the viewer beyond this gate. */
export function canViewReports(user: CurrentUser) {
  return isAdmin(user) || isAnyClusterHead(user) || isAnyAccountClientServices(user);
}

/**
 * The Timesheet / Hours report (per-person logged hours). Deliberately NOT gated by
 * canViewReports: it is available to every delivery role — Contributor (own hours only), Lead
 * (their Task Group[s]), Cluster Head (their cluster, pod-restricted where it applies), Admin
 * (org-wide) — but EXCLUDES Account/Client Services (any designation, incl. PAM / Dependency
 * Tracker). Hours logged is cost-adjacent information, and ACS sits below the cost/margin
 * ceiling by design, so it stays outside their view — same as task authority and cost data.
 * Per-row scoping is applied in getTimeLogReport, not here.
 */
export function canViewHoursReport(user: CurrentUser) {
  if (isAnyAccountClientServices(user)) return false;
  return isAdmin(user) || isAnyClusterHead(user) || isLead(user) || isContributor(user);
}

/** Cross-project search & filters (PRD 8.10) is an oversight capability — the same roles
 * that span many projects. Leads and Contributors work from My Tasks / My Reviews, whose
 * lists are already scoped to them, so they don't get the global search surface in v1. */
export function canSearch(user: CurrentUser) {
  return isAdmin(user) || isAnyClusterHead(user) || isAnyAccountClientServices(user);
}

/** The user's CLUSTER_HEAD role instance for this specific cluster, if any — carries the
 * optional pod restriction (empty restrictedPodIds means unrestricted/full-cluster). */
function clusterHeadRole(user: CurrentUser, clusterId: string) {
  return user.roles.find((r) => r.role === "CLUSTER_HEAD" && r.clusterId === clusterId) ?? null;
}

/** Presence-only: does this user hold the Cluster Head role for this cluster at all? A
 * pod restriction never revokes this — it only narrows which pods' groups/data they can
 * see or manage once inside the cluster (see clusterHeadReachesProject/clusterHeadInPodScope). */
export function isClusterHeadOf(user: CurrentUser, clusterId: string) {
  return clusterHeadRole(user, clusterId) !== null;
}

/** Null = this Cluster Head is unrestricted (full-cluster access, the default) or the user
 * isn't Cluster Head of this cluster at all. Non-null = the specific pod IDs their every
 * privilege narrows to ("ROLE CHANGE — Pod-Restricted Cluster Head"). */
export function getClusterHeadPodRestriction(user: CurrentUser, clusterId: string): string[] | null {
  const role = clusterHeadRole(user, clusterId);
  if (!role || role.restrictedPodIds.length === 0) return null;
  return role.restrictedPodIds;
}

/** Is this specific pod within this Cluster Head's authority? Unrestricted → any pod in
 * their cluster. Restricted → only their selected pod(s). Not Cluster Head here → false. */
function clusterHeadInPodScope(user: CurrentUser, clusterId: string, podId: string | null) {
  const restriction = getClusterHeadPodRestriction(user, clusterId);
  if (restriction === null) return isClusterHeadOf(user, clusterId);
  return podId !== null && restriction.includes(podId);
}

/**
 * A pod-restricted Cluster Head's authority reaches a project only if it already has a
 * Task Group inside their pod scope — an unrestricted Cluster Head's authority reaches
 * every project in their cluster, unaffected. Gates project-level privileges (edit, assign
 * Account Manager, view max hours, view cost/margin) that apply to the whole project record
 * rather than one specific group.
 */
export function clusterHeadReachesProject(user: CurrentUser, project: ProjectWithGroups) {
  const role = clusterHeadRole(user, project.clusterId);
  if (!role) return false;
  if (role.restrictedPodIds.length === 0) return true;
  return project.taskGroups.some((g) => g.podId !== null && role.restrictedPodIds.includes(g.podId));
}

export function isAccountClientServicesFor(user: CurrentUser, clusterId: string) {
  return hasRole(user, "ACCOUNT_CLIENT_SERVICES", clusterId);
}

/** Is this user the Lead who owns any Task Group on this project? Cross-cluster by design. */
export function isProjectLead(user: CurrentUser, project: ProjectWithGroups) {
  return project.taskGroups.some((g) => g.leadUserId === user.id);
}

/** Is this user specifically the Lead who owns this one Task Group? */
export function isLeadOfGroup(user: CurrentUser, group: TaskGroupRef) {
  return group.leadUserId === user.id;
}

// ---------- Clients ----------
// Clients are global internal records (no clusterId on the model — a client can have
// projects across multiple clusters). Visibility and editing are restricted to Admin and
// Account/Client Services only — Cluster Head has no client access (v1.1 feedback).
export function canManageClients(user: CurrentUser) {
  // Cluster-scoped ACS only — a cluster-less Dependency Tracker coordinator (v1.26) has the ACS
  // ceiling but no cluster oversight and no client management (isAnyAccountClientServices
  // already excludes them). Admin unaffected; Harsha (cluster ACS) unaffected.
  return isAdmin(user) || isAnyAccountClientServices(user);
}

/** Creating a brand-new client: Admin or Accountant (intake) only — Account/Client
 * Services and Cluster Head can still view/edit existing ones, but never originate one. */
export function canCreateClient(user: CurrentUser) {
  return isAdmin(user) || isAccountant(user);
}

// ---------- Projects ----------

/** Creating a brand-new project: Admin or Accountant (intake) only — Cluster Head and
 * Account/Client Services cannot. */
export function canCreateProject(user: CurrentUser) {
  return isAdmin(user) || isAccountant(user);
}

/**
 * Broader than creation: Cluster Head keeps the ability to edit projects already in their
 * cluster — pod-restricted (see "ROLE CHANGE — Pod-Restricted Cluster Head") to projects
 * that already have a Task Group in their pod.
 */
export function canEditProjectInCluster(user: CurrentUser, project: ProjectWithGroups) {
  return (
    isAdmin(user) ||
    clusterHeadReachesProject(user, project) ||
    isAccountClientServicesFor(user, project.clusterId)
  );
}

/**
 * Create / edit / reorder / check off / remove Project Milestones (PRD — agency-wide). Same
 * authority tier as project management (Section 5.2): any Lead attached to the project, the
 * project's Cluster Head (pod-restricted where it applies), Admin, or an Account/Client Services
 * user with full grouped-view access to the project (e.g. a Project Account Manager). No new
 * permission tier. Contributors and Dependency Trackers see milestones but never manage them.
 */
export function canManageMilestones(user: CurrentUser, project: ProjectWithGroups) {
  return (
    canViewAllProjectGroups(user, project) || // Admin, unrestricted Cluster Head, cluster ACS, PAM
    clusterHeadReachesProject(user, project) || // pod-restricted Cluster Head reaching this project
    isProjectLead(user, project) // any Lead attached to the project
  );
}

/**
 * Attaching/removing discipline Task Groups is provisioning, not delivery work — Admin,
 * the project's home-cluster Cluster Head, or Account/Client Services for that cluster.
 * A Lead never attaches a new discipline to a project unilaterally. Presence-only gate:
 * a pod-restricted Cluster Head still sees the "manage Task Groups" section (so they can
 * attach their own pod's first Lead to a project) — canAttachLeadRole/canManageThisGroup
 * below narrow WHICH Lead/group they can actually attach or remove.
 */
export function canManageTaskGroups(user: CurrentUser, project: Project) {
  return (
    isAdmin(user) ||
    isClusterHeadOf(user, project.clusterId) ||
    isAccountClientServicesFor(user, project.clusterId)
  );
}

/**
 * Per-item gate for attaching a specific Lead's Task Group: a pod-restricted Cluster Head
 * may only attach a Lead whose own role-pod is within their scope. Unrestricted Cluster
 * Head, Admin, and Account/Client Services are unaffected.
 */
export function canAttachLeadRole(
  user: CurrentUser,
  project: Project,
  leadRole: { clusterId: string | null; podId: string | null },
) {
  if (isAdmin(user) || isAccountClientServicesFor(user, project.clusterId)) return true;
  const restriction = getClusterHeadPodRestriction(user, project.clusterId);
  if (restriction === null) return isClusterHeadOf(user, project.clusterId);
  return leadRole.podId !== null && restriction.includes(leadRole.podId);
}

/**
 * Per-item gate for removing an existing Task Group: mirrors canAttachLeadRole, keyed off
 * the group's own snapshotted podId.
 */
export function canManageThisGroup(user: CurrentUser, project: Project, group: TaskGroupRef) {
  if (isAdmin(user) || isAccountClientServicesFor(user, project.clusterId)) return true;
  return clusterHeadInPodScope(user, project.clusterId, group.podId ?? null);
}

/**
 * Set/edit a Team's planned Capacity (hrs/wk) — Admin or the group's Cluster Head only
 * (pod-scoped for a pod-restricted Cluster Head). NOT Account/Client Services, and never the
 * Lead (PRD Agile Sprint enhancement). Only surfaced on Development/QA groups by the caller.
 */
export function canSetTeamCapacity(user: CurrentUser, project: Project, group: TaskGroupRef) {
  return isAdmin(user) || clusterHeadInPodScope(user, project.clusterId, group.podId ?? null);
}

/**
 * Project Account Manager designation is top-down only, never self-service: Admin or the
 * Cluster Head who owns the project assigns it — Account/Client Services (the pool the
 * designee is drawn from) cannot assign themselves or anyone else. Pod-restricted per
 * clusterHeadReachesProject.
 */
export function canAssignAccountManager(user: CurrentUser, project: ProjectWithGroups) {
  return isAdmin(user) || clusterHeadReachesProject(user, project);
}

/**
 * Dependency Tracker designation (PRD 8.13, v1.26) — a SECOND, separate per-project
 * designation with the exact same assignment rule as Account Manager: Admin or the owning
 * Cluster Head, top-down only, per project, never self-assigned and never cluster-wide. Kept
 * distinct from canAssignAccountManager so the two designations stay independently assignable.
 */
export function canAssignDependencyTracker(user: CurrentUser, project: ProjectWithGroups) {
  return isAdmin(user) || clusterHeadReachesProject(user, project);
}

export function canViewMaxAllocatedHours(user: CurrentUser, project: ProjectWithGroups) {
  return isAdmin(user) || clusterHeadReachesProject(user, project) || isProjectLead(user, project);
}

/**
 * The full grouped view — every Task Group on a project, side by side, with no pod
 * filtering. Also granted to whoever is designated this specific project's Account
 * Manager, even outside their home cluster — that designation (see canAssignAccountManager)
 * is exactly what extends their oversight to a project homed in a different cluster. A
 * pod-restricted Cluster Head does NOT qualify here — they see only their own pod's
 * group(s), never "all" (see canOverseeGroup for the per-group equivalent).
 */
export function canViewAllProjectGroups(user: CurrentUser, project: Project) {
  return (
    isAdmin(user) ||
    (isClusterHeadOf(user, project.clusterId) && getClusterHeadPodRestriction(user, project.clusterId) === null) ||
    isAccountClientServicesFor(user, project.clusterId) ||
    project.accountManagerId === user.id
  );
}

/**
 * Per-group equivalent of canViewAllProjectGroups: true for every oversight role that sees
 * ALL groups unconditionally, plus a pod-restricted Cluster Head specifically for groups
 * inside their own pod scope.
 */
export function canOverseeGroup(user: CurrentUser, project: Project, group: TaskGroupRef) {
  return canViewAllProjectGroups(user, project) || clusterHeadInPodScope(user, project.clusterId, group.podId ?? null);
}

export async function canViewProject(user: CurrentUser, project: ProjectWithGroups): Promise<boolean> {
  if (isAdmin(user)) return true;

  // Cluster Head and Account/Client Services are designed for full-cluster oversight — any
  // role instance of theirs scoped to this cluster sees every project in it, unaffected
  // (a pod-restricted Cluster Head narrows to projects with a matching-pod Task Group).
  // Lead and Contributor are NOT oversight roles: blanket cluster membership doesn't grant
  // them every project in their cluster — only ones they're actually attached to, via a
  // Task Group (Lead) or an assigned task (either), checked below.
  for (const r of user.roles) {
    if (r.clusterId !== project.clusterId) continue;
    if (r.role === "ACCOUNT_CLIENT_SERVICES") return true;
    if (r.role === "CLUSTER_HEAD") {
      if (getClusterHeadPodRestriction(user, project.clusterId) === null) return true;
      if (clusterHeadReachesProject(user, project)) return true;
    }
  }

  if (isProjectLead(user, project)) return true;

  // A Lead or Contributor with no Task Group here can still see the project if it
  // contains a task assigned to them.
  const ownTaskOnProject = await prisma.task.findFirst({
    where: { projectId: project.id, assignedToId: user.id },
    select: { id: true },
  });
  if (ownTaskOnProject) return true;

  return hasOpenStudioTicketAccess(user, project.id);
}

/**
 * Task-level visibility is narrower still than group-level: within a group only its own
 * Lead (or an oversight role) sees every task — a plain Contributor only ever sees the
 * task(s) assigned to them, never a groupmate's (v1.1 feedback, generalized to groups).
 * The task's creator can also always see it — otherwise a Lead who creates a task
 * directly in a different team's group (cross-team task creation) would lose track of
 * their own hand-off the moment it's assigned to someone else.
 */
export async function canViewTask(
  user: CurrentUser,
  project: ProjectWithGroups,
  task: Task,
): Promise<boolean> {
  if (task.assignedToId === user.id) return true;
  if (task.createdById === user.id) return true;
  if (task.groupId) {
    const group = project.taskGroups.find((g) => g.id === task.groupId);
    if (group && (canOverseeGroup(user, project, group) || isLeadOfGroup(user, group))) return true;
    // Social Media cross-group read grant (PRD 8.2.2, broadened in v1.21): the project's own
    // Social Media pod — Sneha AND her Contributors — may read the Content/Design tasks that
    // her calendar entries spawned (to review the copy + comment). Scoped tightly to
    // CALENDAR-ORIGINATED tasks: a plain (non-calendar) Content task shows them nothing.
    if (
      group &&
      isCalendarPipelinePod(group.pod?.name) &&
      task.publishDate !== null &&
      task.contentTypeId !== null &&
      (await isProjectSocialMediaMember(user, project.id))
    ) {
      return true;
    }
  } else if (canViewAllProjectGroups(user, project)) {
    return true;
  }
  return hasOpenStudioTicketAccess(user, project.id);
}

// ---------- Time tracking ----------

/** Logging time is inherently personal — no Admin override, since it records who did the work. */
export function canLogTime(user: CurrentUser, task: Task) {
  return user.id === task.assignedToId;
}

/** A single group's time-log rollup: Admin/Cluster Head/ACS (full grouped view, or a
 * pod-restricted Cluster Head for their own pod's group), or that group's own Lead. */
export function canViewGroupTimeRollup(user: CurrentUser, project: Project, group: TaskGroupRef) {
  return canOverseeGroup(user, project, group) || isLeadOfGroup(user, group);
}

/** The whole-project time total spans every group — oversight roles only. */
export function canViewProjectTimeRollup(user: CurrentUser, project: Project) {
  return canViewAllProjectGroups(user, project);
}

/**
 * Screenshot attachments on a Bug (PRD 8.2.4): the people who actually work the bug may
 * add/remove images — its assignee, its creator, the group's Lead, or Admin. The action
 * additionally enforces that the task is a Bug and the per-image limits. Not a wide gate:
 * a passing oversight viewer doesn't get to mutate someone else's bug's evidence.
 */
export function canManageBugImages(
  user: CurrentUser,
  group: TaskGroupRef | null,
  task: { assignedToId: string | null; createdById: string },
) {
  return (
    isAdmin(user) ||
    task.assignedToId === user.id ||
    task.createdById === user.id ||
    (group !== null && isLeadOfGroup(user, group))
  );
}

/**
 * Editing a logged time entry (start/end/duration) is deliberately TIGHTER than every other
 * authority in the app (PRD 8.4): the Cluster Head only — within their pod scope for the
 * entry's Task Group. NOT the Contributor who logged it, and NOT even the group's Lead.
 * (Admin is intentionally not granted here either, per the literal "Cluster Head only" spec —
 * flagged in the delivery notes.) For a legacy ungrouped entry, an unrestricted Cluster Head
 * of the project's cluster qualifies.
 */
export function canEditTimeLog(user: CurrentUser, project: Project, group: TaskGroupRef | null) {
  return clusterHeadInPodScope(user, project.clusterId, group?.podId ?? null);
}

// ---------- Tasks ----------

/**
 * Task creation is project-wide for Leads, mirroring the original team-roster model: any
 * Lead attached to this project (owner of any Task Group on it) can create a task in any
 * of its groups and hand it directly to a different team's Lead — not just their own group.
 *
 * v1.2 team feedback #11 widens this beyond Lead+Admin to cover a Lead's absence without a
 * separate on-leave flag, as STANDING authority: the project's own Cluster Head (pod-scope
 * aware) and its designated Account Manager may also originate tasks. This is deliberately
 * narrower than "any oversight role" — a blanket Account/Client Services user for the
 * cluster is NOT granted creation here; only the one AM actually assigned to this project.
 *
 * Viewing (rule 2) stays strict; this only widens who may originate work into a group, not
 * who sees its full task list.
 */
/**
 * A Contributor may self-create a task in a Task Group that belongs to their own pod (or
 * cluster, for a pod-less role) — PRD 8.2. The task is ALWAYS auto-assigned to that same
 * Contributor by the action; this gate only says "may originate self-assigned work here",
 * never "may assign to someone else" (that stays Lead-only).
 */
export function canSelfCreateInGroup(
  user: CurrentUser,
  group: { clusterId: string | null; podId: string | null },
) {
  return user.roles.some(
    (r) =>
      r.role === "CONTRIBUTOR" &&
      ((r.podId != null && r.podId === group.podId) ||
        (r.podId == null && r.clusterId != null && r.clusterId === group.clusterId)),
  );
}

export function canCreateTaskInGroup(user: CurrentUser, project: ProjectWithGroups) {
  if (isAdmin(user)) return true;
  // The Social Media Lead's only path to originate work is the Content Calendar (see
  // createCalendarEntry) — she never gets the generic New Task form, in her own group or
  // anyone else's, so every calendar-originated task carries its Publish Date/Content Type
  // metadata rather than slipping in as an untracked ad hoc task.
  if (isSocialMediaLead(user)) return false;
  if (isProjectLead(user, project)) return true;
  if (project.accountManagerId === user.id) return true;
  return clusterHeadReachesProject(user, project);
}

/**
 * Cross-team task creation has a hand-off boundary: a Lead creating work in a
 * *different* team's group can only assign it to that group's own Lead — never
 * straight to one of that team's Contributors, bypassing their Lead. Within your own
 * group (or as Admin) there's no such restriction — the full assignee pool applies.
 *
 * Same authority also governs reassignment after the fact (see canReassignTask below):
 * a task landing on a Lead directly — whether self-created or received cross-team — is
 * theirs to keep or delegate to their own Contributor at any point, not just at creation.
 */
export function canAssignAnyoneInGroup(user: CurrentUser, group: TaskGroupRef) {
  return isAdmin(user) || isLeadOfGroup(user, group);
}

/**
 * WHO may delete a task (PRD 8.2): its original creator, or a Lead of its group, or Admin.
 * This is the authority half only — deletion is ALSO gated on the task having zero real
 * activity (no time logged, no comments, status never past New); that activity guard is
 * computed from the database in the deleteTask action + the task page, mirroring the user
 * hard-delete guard (PRD 5.7). Both must hold for a delete to be allowed.
 */
export function canDeleteTask(
  user: CurrentUser,
  group: TaskGroupRef | null,
  task: { createdById: string },
) {
  return isAdmin(user) || task.createdById === user.id || (group !== null && isLeadOfGroup(user, group));
}

/**
 * Reassigning an already-assigned task (distinct from canAssignHandoffTask, which only
 * covers a still-unassigned handoff task): that group's own Lead can redirect any task in
 * their group to a different member — most notably delegating one that landed on them
 * directly to one of their own Contributors instead. A Completed task is historical record
 * and is never reassigned.
 *
 * Subtasks are excluded (PRD 8.2 / v1.1 decision #11): a subtask is a private breakdown that
 * stays with its creator and is never reassigned. Reassigning one stranded it under a parent
 * the new assignee couldn't see — to delegate work to a teammate, create a normal task in the
 * group instead, which stays fully visible on the project.
 */
export function canReassignTask(user: CurrentUser, group: TaskGroupRef | null, task: Task) {
  return (
    task.parentTaskId === null &&
    task.status !== "COMPLETED" &&
    group !== null &&
    canAssignAnyoneInGroup(user, group)
  );
}

/**
 * Bug-only, same-group reassignment (PRD 8.2.4, corrected in v1.18, scoped in v1.24). There is
 * ONE Development Task Group — not a separate QA group — so a Bug moves between the developer
 * and QA by direct reassignment within the group rather than Cross-Group Handoff.
 *
 * This exception applies ONLY to the retest leg — after the Lead has triaged the Bug out to a
 * developer. On creation a Bug auto-assigns to the Lead (see createTaskCore), and while it still
 * sits with the Lead (assignedToId === leadUserId) reassignment stays Lead-only, so a
 * Contributor can't grab an un-triaged Bug and bypass triage. Once it's assigned to a
 * Contributor, any Contributor member of the group may reassign it with NO Lead step: developer
 * → QA to retest, QA → developer on reopen, repeating until closed. This authorizes the
 * REQUESTER only; reassignTask separately enforces that the TARGET is a Contributor in the same
 * group (never the Lead, never an outsider). Standard tasks are unaffected (Lead-only), and the
 * Lead's own authority over any task at any stage is unchanged (canReassignTask).
 */
export function canReassignBugWithinGroup(
  user: CurrentUser,
  group: (TaskGroupRef & { clusterId?: string | null; bugTrackingEnabled?: boolean }) | null,
  task: Task,
) {
  if (task.taskType !== "BUG") return false;
  // Every non-authority guard from canReassignTask still applies to the Bug path.
  if (task.parentTaskId !== null || task.status === "COMPLETED") return false;
  if (group === null || group.bugTrackingEnabled !== true) return false;
  // Post-triage only (v1.24): while the Bug is unassigned or still with the Lead, the
  // contributor exception is off — the Lead triages it out first via canReassignTask.
  if (task.assignedToId === null || task.assignedToId === group.leadUserId) return false;
  // A Contributor member of this group (same pod / cluster) — the exact membership predicate
  // used for self-create. Lead/Admin already have the standard canReassignTask path.
  return canSelfCreateInGroup(user, { clusterId: group.clusterId ?? null, podId: group.podId ?? null });
}

/**
 * Is a loaded UserRole a Contributor member of this Task Group (same pod, or same cluster for
 * a legacy pod-less group)? The TARGET-side counterpart to canReassignBugWithinGroup: that
 * gate authorizes the person doing the reassignment; this validates who a Bug may be handed to
 * — always a Contributor in the same group, never the Lead or an outsider (PRD v1.18).
 */
export function isRoleContributorInGroup(
  role: { role: RoleName; clusterId: string | null; podId: string | null } | null,
  group: { clusterId?: string | null; podId?: string | null },
) {
  if (!role || role.role !== "CONTRIBUTOR") return false;
  if (group.podId != null) return role.podId === group.podId;
  return group.clusterId != null && role.clusterId === group.clusterId;
}

/**
 * Assigning an unassigned cross-group-handoff task is narrower than creation: only that
 * specific destination group's own Lead (or Admin) — per the handoff feature, assignment
 * authority for a received handoff stays with the receiving Lead, not any project lead.
 */
export function canAssignHandoffTask(user: CurrentUser, group: TaskGroupRef | null) {
  return isAdmin(user) || (group !== null && isLeadOfGroup(user, group));
}

/**
 * Edit a task's planning attributes — Priority, and (for a Bug) Severity — after creation.
 * Introduced with the Dev/QA quick-edit drawer (PRD Agile Sprint enhancement). Kept to the
 * same authority that already governs a task within its group: the group's own Lead, or an
 * oversight role (Admin / Cluster Head / Account-Client-Services / the project's Account
 * Manager). Not the plain assignee — priority/severity are a Lead/PM call.
 */
export function canEditTaskAttributes(user: CurrentUser, project: Project, group: TaskGroupRef | null) {
  return (group !== null && isLeadOfGroup(user, group)) || (group !== null && canOverseeGroup(user, project, group)) || isAdmin(user);
}

/**
 * Subtasks stay locked to their creator (PRD v1.1 decision #11) — anyone who can see
 * the parent task and either owns it or has task authority on its group can add one,
 * but the subtask's assignee is always the creator, immutable thereafter.
 */
export function canCreateSubtaskInGroup(
  user: CurrentUser,
  group: TaskGroupRef | null,
  parentTask: Task,
) {
  // No new subtasks while the parent is On Hold (PRD 8.2.3) — a paused task shouldn't
  // keep spawning breakdown work. Comments stay open so the block can still be discussed.
  if (parentTask.status === "ON_HOLD") return false;
  return isAdmin(user) || (group !== null && isLeadOfGroup(user, group)) || user.id === parentTask.assignedToId;
}

// ---------- Task status workflow (PRD 8.3) ----------

/** New → In Progress, and In Progress → Review: the assignee drives their own task forward. */
export function canAdvanceTask(user: CurrentUser, task: Task) {
  return isAdmin(user) || user.id === task.assignedToId;
}

/** Review → Completed (approve) or Review → Revision (reject): the task's own group Lead reviews. */
export function canReviewGroupTask(user: CurrentUser, group: TaskGroupRef | null) {
  return isAdmin(user) || (group !== null && isLeadOfGroup(user, group));
}

/**
 * Reject & Return (PRD 8.2.1 v1.22): the task's own group Lead (or Admin) sends a
 * handoff-received task back to the group it came from for rework. Only offered on a task
 * that arrived via a handoff (has a Predecessor) — a chain-start task has nowhere to return
 * to. Deliberately NOT gated on Completed, unlike forward "Send to Next Group": a Lead
 * unhappy with received work returns it without first marking it done.
 */
export function canRejectAndReturn(user: CurrentUser, group: TaskGroupRef | null, task: Task) {
  return task.predecessorTaskId !== null && canReviewGroupTask(user, group);
}

/**
 * Bug verdict — Close (Review → Completed) / Reopen (Review → Revision) — on a BUG only
 * (PRD v1.18). Because QA is a Contributor inside the Development team, it retests and rules
 * on its own bugs without waiting for the Lead: any Contributor member of a Bug-Tracking
 * group may record the verdict, on top of the Lead/Admin who always can (canReviewGroupTask).
 * Scoped tightly to bugs — a Standard task's Review verdict stays Lead-only, unchanged.
 */
export function canRecordBugVerdict(
  user: CurrentUser,
  group: (TaskGroupRef & { clusterId?: string | null; bugTrackingEnabled?: boolean }) | null,
  task: Task,
) {
  if (canReviewGroupTask(user, group)) return true;
  if (task.taskType !== "BUG") return false;
  if (group === null || group.bugTrackingEnabled !== true) return false;
  return canSelfCreateInGroup(user, { clusterId: group.clusterId ?? null, podId: group.podId ?? null });
}

/**
 * On Hold is a Lead-level call, not the assignee's — a blocked Contributor comments on
 * the task instead, and their group's Lead decides whether to formally place it On Hold.
 */
export function canToggleHoldTask(user: CurrentUser, group: TaskGroupRef | null) {
  return isAdmin(user) || (group !== null && isLeadOfGroup(user, group));
}

export async function hasOpenStudioTicketAccess(
  user: CurrentUser,
  projectId: string,
): Promise<boolean> {
  const isStudioMember = user.roles.some((r) => r.cluster?.name === "Creative Studio");
  if (!isStudioMember) return false;

  const openTicket = await prisma.studioTicket.findFirst({
    where: { projectId, status: "OPEN" },
  });
  return openTicket !== null;
}

// ---------- Social Media Content Calendar (v1, Social Media pod only) ----------

/** The Social Media Lead plans the calendar and owns the Monthly Brief, but the actual
 * Content-stage task is created in this pod's own Task Group (Hamna's discipline) — a
 * distinct production stage from Social Media's own planning/scheduling work. */
export const SOCIAL_MEDIA_POD_NAME = "Social Media";
export const CONTENT_POD_NAME = "Content";

/** Presence-only: does this user hold the Lead role for the Social Media pod at all
 * (one role per user, so this is a fixed identity, not a per-project check)? Used to
 * gate the generic New Task form off entirely for her — see canCreateTaskInGroup. */
export function isSocialMediaLead(user: CurrentUser) {
  return user.roles.some((r) => r.role === "LEAD" && r.pod?.name === SOCIAL_MEDIA_POD_NAME);
}

/** The Design due-date auto-calculation (see sendTaskToNextGroup) applies specifically
 * when a Content Calendar task is handed off to this pod's Task Group — not any destination. */
export const DESIGN_POD_NAME = "Design";

/** Is this pod one of the Content Calendar's two production stages (Content, then
 * Design)? Used to extend a project's own Social Media Lead's oversight into these two
 * groups on that SAME project — read visibility only, never attach/remove/edit authority. */
export function isCalendarPipelinePod(podName: string | null | undefined) {
  return podName === CONTENT_POD_NAME || podName === DESIGN_POD_NAME;
}

/**
 * Is this user the Lead of `projectId`'s own Social Media Task Group? She planned the
 * calendar and owns the Monthly Brief, so she also gets read oversight into the
 * Content/Design tasks it generates on that same project (see isCalendarPipelinePod) —
 * without gaining any management authority over those groups.
 */
export async function isProjectSocialMediaLead(user: CurrentUser, projectId: string): Promise<boolean> {
  if (isAdmin(user)) return true;
  const group = await prisma.taskGroup.findFirst({
    where: { projectId, pod: { name: SOCIAL_MEDIA_POD_NAME } },
  });
  return group !== null && isLeadOfGroup(user, group);
}

/** Presence-only: does this user belong to the Social Media pod at all, as its Lead or a
 * Contributor? (Contributors aren't attached to a specific project group, so pod membership
 * is the only handle on "Sneha's Contributors".) */
export function isSocialMediaMember(user: CurrentUser) {
  return user.roles.some(
    (r) => r.pod?.name === SOCIAL_MEDIA_POD_NAME && (r.role === "LEAD" || r.role === "CONTRIBUTOR"),
  );
}

/**
 * Social Media cross-group read/comment grant, broadened in PRD v1.21 (8.2.2) from the Lead
 * alone to the whole Social Media pod — Sneha AND her Contributors. True when this project has
 * a Social Media Task Group (i.e. a calendar owner exists) and the user is a Social Media pod
 * member. The CALLER additionally restricts this to calendar-originated Content/Design tasks;
 * this only answers "is this person part of the Social Media team on this project". Grants read
 * + comment (comments flow from canViewTask) — never edit/status/assign in the other group.
 */
export async function isProjectSocialMediaMember(user: CurrentUser, projectId: string): Promise<boolean> {
  if (!isSocialMediaMember(user)) return false;
  const group = await prisma.taskGroup.findFirst({
    where: { projectId, pod: { name: SOCIAL_MEDIA_POD_NAME } },
  });
  return group !== null;
}

/**
 * Final sign-off before a completed Content Calendar task moves on to Design: a
 * checkpoint on top of the Content group's own Lead having already approved the work
 * itself. Same authority as isProjectSocialMediaLead (Admin, or that project's own
 * Social Media Lead) — named separately here for clarity at the handoff call site.
 */
export async function canApproveCalendarHandoff(user: CurrentUser, projectId: string): Promise<boolean> {
  return isProjectSocialMediaLead(user, projectId);
}

/**
 * The loop's final close-out: once the Design group's own Lead completes the last task in
 * the chain, the same Social Media Lead (or Admin) who approved the Content→Design handoff
 * gives final sign-off — the calendar entry doesn't just stop at Design, it comes back to
 * whoever planned it. Same authority as canApproveCalendarHandoff, named separately for
 * clarity at this second, later call site.
 */
export async function canApproveCalendarFinalDelivery(user: CurrentUser, projectId: string): Promise<boolean> {
  return isProjectSocialMediaLead(user, projectId);
}

/** Content Type settings (name + lead-time values) are Admin-managed only — no other
 * role originates or edits the list the Content/Design due-date math is computed from. */
export function canManageContentTypes(user: CurrentUser) {
  return isAdmin(user);
}

/** Bug Tracking is enabled per-discipline (pod) by an Admin only (PRD 8.2.4) — same
 * Admin-only settings pattern as Content Types. */
export function canManageBugTracking(user: CurrentUser) {
  return isAdmin(user);
}

/** The Content Body field is enabled per-discipline (pod) by an Admin only (PRD 8.12) —
 * same Admin-only settings pattern as Bug Tracking. */
export function canManageContentBody(user: CurrentUser) {
  return isAdmin(user);
}

/** Sprint Workflow is enabled per-discipline (pod) by an Admin only (PRD 8.14) — same
 * Admin-only settings pattern as Bug Tracking / Content Body. */
export function canManageSprintWorkflow(user: CurrentUser) {
  return isAdmin(user);
}

/**
 * Managing Sprints on a project — creating/editing them, moving their status, and assigning
 * tasks to a Sprint (PRD 8.14). Lead + Cluster Head + Admin. "Lead" here means the Lead who
 * owns a Sprint-enabled Task Group on THIS project (not a Lead of some other discipline);
 * callers pass that project's Sprint-enabled groups (pod.sprintWorkflowEnabled === true).
 */
export function canManageSprints(
  user: CurrentUser,
  project: ProjectWithGroups,
  sprintEnabledGroups: { leadUserId: string }[],
) {
  return (
    isAdmin(user) ||
    clusterHeadReachesProject(user, project) ||
    sprintEnabledGroups.some((g) => g.leadUserId === user.id)
  );
}

/**
 * Who may edit a task's Content Body (PRD 8.12): only its current assignee — the exact
 * "the content's author edits it" rule already used for OneDrive links (8.6), where a task
 * field's author is whoever the task is assigned to. Deliberately narrow: not the Lead, not
 * a Cluster Head, not even Admin — everyone else with task visibility reads it but can't edit.
 * (The action separately enforces that the task's discipline actually has Content Body on.)
 */
export function canEditContentBody(user: CurrentUser, task: { assignedToId: string | null }) {
  return task.assignedToId !== null && task.assignedToId === user.id;
}

/**
 * The Monthly Brief and Content Calendar for a project are owned by that project's own
 * Social Media Task Group Lead (or Admin) — the same "Lead of this specific group"
 * authority used everywhere else, not a blanket "any Social Media Lead, any project"
 * grant. `group` is that project's resolved Social Media Task Group, or null if none is
 * attached yet (nothing to manage until one is).
 */
export function canManageContentCalendar(user: CurrentUser, group: TaskGroupRef | null) {
  return isAdmin(user) || (group !== null && isLeadOfGroup(user, group));
}

/**
 * Read/oversight access to a project's Content Calendar. Everyone who can manage it (Admin,
 * the project's Social Media Lead) plus the overseeing Cluster Head — an unrestricted one
 * for the cluster, or a pod-restricted one whose scope covers the Social Media pod (Ashna).
 * The Cluster Head gets to view and edit topics, but not to add entries, reschedule, or edit
 * the Monthly Brief — those stay with the Lead/Admin (see canManageContentCalendar).
 */
export function canViewContentCalendar(
  user: CurrentUser,
  group: { leadUserId: string; clusterId: string | null; podId: string | null } | null,
) {
  if (isAdmin(user)) return true;
  if (group === null) return false;
  if (isLeadOfGroup(user, group)) return true;
  if (group.clusterId === null) return false;
  return clusterHeadInPodScope(user, group.clusterId, group.podId);
}

/** Nav-visibility check: does this user have any reason to open the Content Calendar at
 * all? Admin, a Social Media Lead, or any Cluster Head (oversight) — per-project authority
 * is still enforced by canViewContentCalendar once a project is selected. */
export function canAccessContentCalendar(user: CurrentUser) {
  return isAdmin(user) || isSocialMediaLead(user) || isAnyClusterHead(user);
}

// ---------- Account/Client Services assignment ----------

const ACCOUNT_SERVICES_CLUSTER_NAME = "Project Delivery & Client Services";

/**
 * Clients and Projects can each be assigned to one accountable Account/Client Services
 * person — the eligible pool is restricted to ACS users scoped to the Project Delivery &
 * Client Services cluster specifically (not any ACS role anywhere).
 */
export async function getEligibleAccountManagers() {
  const roles = await prisma.userRole.findMany({
    where: { role: "ACCOUNT_CLIENT_SERVICES", cluster: { name: ACCOUNT_SERVICES_CLUSTER_NAME } },
    include: { user: true },
  });
  const byId = new Map(
    roles.filter((r) => r.user.isActive).map((r) => [r.user.id, { id: r.user.id, name: r.user.name }]),
  );
  return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Eligible Dependency Trackers (PRD 8.13, v1.26): any active user holding the Account/Client
 * Services role — including a cluster-less "ceiling only" ACS coordinator (Vidhukrishna), who
 * would NOT qualify as an Account Manager. Broader than getEligibleAccountManagers on purpose:
 * a Dependency Tracker is a view-only cross-department coordinator, not a project owner.
 */
export async function getEligibleDependencyTrackers() {
  const roles = await prisma.userRole.findMany({
    where: { role: "ACCOUNT_CLIENT_SERVICES" },
    include: { user: true },
  });
  const byId = new Map(
    roles.filter((r) => r.user.isActive).map((r) => [r.user.id, { id: r.user.id, name: r.user.name }]),
  );
  return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
}
