import type { CurrentUser } from "@/lib/auth";
import {
  isAdmin,
  isLead,
  isDependencyCoordinator,
  canManageClients,
  canCreateClient,
  canAccessContentCalendar,
  canViewDashboard,
  canViewHoursReport,
  canViewReports,
  canSearch,
} from "@/lib/permissions";

export type NavItem = {
  label: string;
  href: string;
};

/** The Studio Intake Queue lands in a later sprint per the PRD's build sequence (Section 13);
 * Dashboards, Reports, and Search arrived in Sprint 3. */
export function getNavItems(user: CurrentUser, opts: { isDependencyTracker?: boolean } = {}): NavItem[] {
  // A view-only Dependency Tracker coordinator (cluster-less ACS, e.g. Vidhukrishna) has no
  // delivery involvement — Projects, My Tasks and Clients would all be empty for them. Their
  // only surface is the Dependency Tracker, so give them just that rather than dead-end tabs.
  if (isDependencyCoordinator(user)) {
    return [
      { label: "Dashboard", href: "/dependencies" },
      { label: "Dependency Tracker", href: "/dependencies/tracker" },
      { label: "Projects", href: "/dependencies/projects" },
    ];
  }

  const items: NavItem[] = [];

  // Dashboard landing: Admin + Cluster Head get the oversight view, a Lead gets their own
  // "My Team" roll-up. Everyone else's home is their task list, so no Dashboard nav item
  // that would just bounce them.
  if (canViewDashboard(user) || isLead(user)) {
    items.push({ label: "Dashboard", href: "/" });
  }

  // Dependency Tracker (PRD 8.13): shown to any non-coordinator who also holds a designation.
  if (opts.isDependencyTracker) {
    items.push({ label: "Dependency Tracker", href: "/dependencies" });
  }

  items.push({ label: "Projects", href: "/projects" });
  items.push({ label: "My Tasks", href: "/my-tasks" });

  if (isLead(user)) {
    items.push({ label: "My Reviews", href: "/my-reviews" });
  }

  if (canViewHoursReport(user) || canViewReports(user)) {
    items.push({ label: "Reports", href: "/reports" });
  }

  if (canSearch(user)) {
    items.push({ label: "Search", href: "/search" });
  }

  if (canAccessContentCalendar(user)) {
    items.push({ label: "Content Calendar", href: "/content-calendar" });
  }

  // Accountant can't manage existing clients, but still needs the nav path to reach
  // New Client for intake.
  if (canManageClients(user) || canCreateClient(user)) {
    items.push({ label: "Clients", href: "/clients" });
  }

  if (isAdmin(user)) {
    items.push({ label: "Users & Roles", href: "/admin/users" });
    items.push({ label: "Content Types", href: "/admin/content-types" });
    items.push({ label: "Bug Tracking", href: "/admin/bug-tracking" });
    items.push({ label: "Content Body", href: "/admin/content-body" });
    items.push({ label: "Sprint Workflow", href: "/admin/sprint-workflow" });
  }

  return items;
}
