import Link from "next/link";
import { statusLabel } from "@/lib/bug";
import { formatDate } from "@/lib/format";
import { getLocalDateString, daysOverdue } from "@/lib/timezone";

// Shared rendering for both Dependency Tracker surfaces (the active tracker and the per-project
// full view): tasks grouped by project, then sub-grouped by discipline. Read-only rows link to
// the dedicated read-only task view. Columns include Assigned (created) alongside Due Date.

export type DependencyRow = {
  task: {
    id: string;
    name: string;
    status: string;
    taskType: string;
    dueDate: Date;
    createdAt: Date;
    updatedAt: Date;
    completedAt: Date | null;
    assignedTo: { name: string } | null;
    group: { pod: { name: string } | null } | null;
  };
  round: number;
};

export type DependencyGroup = {
  project: { id: string; name: string; client: { name: string } };
  rows: DependencyRow[];
};

/**
 * Due-date annotation. Overdue is shown with the NUMBER of days late, measured against the
 * completion timestamp for a completed task (how late it was actually finished) or against today
 * for a still-open one. A not-yet-due open task within 2 days reads "Approaching". All computed
 * in the viewer's local calendar day (PRD 9.5).
 */
function dueInfo(
  dueDate: Date,
  completedAt: Date | null,
  location: string,
  now: Date,
): { tone: "red" | "amber" | "gray"; suffix: string } {
  const reference = completedAt ?? now;
  const late = daysOverdue(dueDate, location, reference); // days past due at that reference (null if not past)
  if (late !== null && late > 0) {
    return { tone: "red", suffix: ` · ${late} day${late === 1 ? "" : "s"} overdue` };
  }
  if (!completedAt) {
    const today = getLocalDateString(location, now);
    const due = dueDate.toISOString().slice(0, 10);
    const diff = Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / (24 * 60 * 60 * 1000));
    if (diff >= 0 && diff <= 2) return { tone: "amber", suffix: " · Approaching" };
  }
  return { tone: "gray", suffix: "" };
}

export function DependencyProjectGroups({
  groups,
  viewerLocation,
  showProjectHeading = true,
  orderByAppearance = false,
}: {
  groups: DependencyGroup[];
  viewerLocation: string;
  showProjectHeading?: boolean;
  /** Order the discipline sub-groups (and the projects) by the row order they arrive in rather
   * than alphabetically. Used by the Overdue view so a caller-supplied worst-days-overdue-first
   * sort survives the grouping — the worst offender's discipline leads. */
  orderByAppearance?: boolean;
}) {
  const now = new Date();
  return (
    <div className="mt-6 flex flex-col gap-8">
      {groups.map(({ project, rows }) => {
        // Sub-group by discipline (pod) so it reads by department, not one flat list.
        const byDiscipline = new Map<string, DependencyRow[]>();
        for (const r of rows) {
          const key = r.task.group?.pod?.name ?? "Ungrouped";
          const bucket = byDiscipline.get(key) ?? [];
          bucket.push(r);
          byDiscipline.set(key, bucket);
        }
        // Insertion order (byDiscipline is a Map) already reflects the incoming row order, so
        // when the caller pre-sorted rows (Overdue → worst first) we keep that; otherwise sort
        // disciplines alphabetically.
        const disciplines = Array.from(byDiscipline.keys());
        if (!orderByAppearance) disciplines.sort();
        return (
          <div key={project.id}>
            {showProjectHeading && (
              <h2 className="text-sm font-semibold">
                {project.name} <span className="text-gs-gray">· {project.client.name}</span>
              </h2>
            )}
            <div className="mt-2 flex flex-col gap-4">
              {disciplines.map((discipline) => (
                <div key={discipline}>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-gs-red">{discipline}</h3>
                  <div className="mt-1 overflow-hidden rounded-lg border border-gs-gray/15 bg-white">
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[680px] text-sm">
                        <thead className="bg-gs-light text-left text-xs uppercase text-gs-gray">
                          <tr>
                            <th className="whitespace-nowrap px-4 py-2">Task</th>
                            <th className="whitespace-nowrap px-4 py-2">Owner</th>
                            <th className="whitespace-nowrap px-4 py-2">Status</th>
                            <th className="whitespace-nowrap px-4 py-2">Assigned</th>
                            <th className="whitespace-nowrap px-4 py-2">Due Date</th>
                            <th className="whitespace-nowrap px-4 py-2">Round</th>
                          </tr>
                        </thead>
                        <tbody>
                          {byDiscipline.get(discipline)!.map(({ task, round }) => {
                            const due = dueInfo(task.dueDate, task.completedAt, viewerLocation, now);
                            return (
                              <tr key={task.id} className="border-t border-gs-gray/10">
                                <td className="px-4 py-2">
                                  <Link href={`/dependencies/${task.id}`} className="font-medium hover:underline">
                                    {task.name}
                                  </Link>
                                </td>
                                <td className="whitespace-nowrap px-4 py-2 text-gs-gray">{task.assignedTo?.name ?? "Unassigned"}</td>
                                <td className="whitespace-nowrap px-4 py-2 text-gs-gray">{statusLabel(task.status, task.taskType)}</td>
                                <td className="whitespace-nowrap px-4 py-2 text-gs-gray">{formatDate(task.createdAt)}</td>
                                <td className="whitespace-nowrap px-4 py-2">
                                  <span className={due.tone === "red" ? "text-gs-red" : due.tone === "amber" ? "text-amber-600" : "text-gs-gray"}>
                                    {formatDate(task.dueDate)}
                                    {due.suffix}
                                  </span>
                                </td>
                                <td className="whitespace-nowrap px-4 py-2 text-gs-gray">Round {round}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
