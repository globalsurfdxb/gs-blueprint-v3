import { getLocalDateString, addDays, daysOverdue } from "@/lib/timezone";

// Project Completion % (final build). A per-Task-Group progress readout shown only on projects
// that carry a discipline with a clean "done" state — Development and Design/Creative. Retainer
// disciplines (SEO, Social Media, Content, Performance, Photography) have no 100% state and are
// deliberately excluded. Pure math over existing task/status data — no stored field, no weighting.

// Detected by discipline (pod), per the "no new field" guardrail — not an admin toggle.
const COMPLETION_PODS = new Set(["dev", "development", "design"]);

/** True for a Task Group whose discipline has a meaningful completion percentage. */
export function isCompletionTrackedPod(podName: string | null | undefined): boolean {
  return !!podName && COMPLETION_PODS.has(podName.trim().toLowerCase());
}

export type CompletionColor = "green" | "amber" | "red";

export type GroupCompletion = {
  completed: number;
  total: number;
  percent: number;
  color: CompletionColor;
};

/**
 * Completion for one Task Group: completed ÷ total tasks, plus a Green/Amber/Red health colour
 * that is deliberately INDEPENDENT of the percentage (a 90%-done group with one overdue task is
 * still Red). Colour reuses the same per-viewer overdue rule used across Dashboards and the
 * Dependency Tracker (daysOverdue), so it is always explainable in one sentence ("Task X is
 * overdue"):
 *   Red   — at least one non-completed task is past its Due Date.
 *   Amber — nothing overdue, but something is due within the next 2 days (an early warning).
 *   Green — neither.
 */
export function computeGroupCompletion(
  tasks: { status: string; dueDate: Date }[],
  location: string,
  now: Date,
): GroupCompletion {
  const total = tasks.length;
  const completed = tasks.filter((t) => t.status === "COMPLETED").length;
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100);

  const todayStr = getLocalDateString(location, now);
  const soonStr = addDays(todayStr, 2);
  let overdue = false;
  let dueSoon = false;
  for (const t of tasks) {
    if (t.status === "COMPLETED") continue;
    const late = daysOverdue(t.dueDate, location, now);
    if (late !== null && late > 0) {
      overdue = true;
    } else {
      // Not overdue — is it due within the next 2 days (today included)?
      const dueStr = t.dueDate.toISOString().slice(0, 10);
      if (dueStr <= soonStr) dueSoon = true;
    }
  }

  const color: CompletionColor = overdue ? "red" : dueSoon ? "amber" : "green";
  return { completed, total, percent, color };
}
