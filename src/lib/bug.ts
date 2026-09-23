// QA / Bug Tracking (PRD 8.2.4) — pure display helpers. A Bug reuses the Task status
// workflow unchanged; only the LABELS differ when taskType === "BUG". No new state machine.

const STANDARD_STATUS_LABELS: Record<string, string> = {
  NEW: "New",
  IN_PROGRESS: "In Progress",
  REVIEW: "Review",
  REVISION: "Revision",
  COMPLETED: "Completed",
  ON_HOLD: "On Hold",
};

const BUG_STATUS_LABELS: Record<string, string> = {
  NEW: "Open",
  IN_PROGRESS: "In Progress",
  REVIEW: "Ready for Retest",
  REVISION: "Reopened",
  COMPLETED: "Closed",
  ON_HOLD: "On Hold",
};

/** The status label to show, relabelled for Bugs (Open / Ready for Retest / Reopened / Closed). */
export function statusLabel(status: string, taskType: string | null | undefined): string {
  const map = taskType === "BUG" ? BUG_STATUS_LABELS : STANDARD_STATUS_LABELS;
  return map[status] ?? status;
}

/** revisionCount doubles as a Bug's "Reopen Count" — same value, relabelled column header. */
export function revisionCountLabel(taskType: string | null | undefined): string {
  return taskType === "BUG" ? "Reopens" : "Revisions";
}

export const SEVERITY_LABELS: Record<string, string> = {
  CRITICAL: "Critical",
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
};

export const ENVIRONMENT_LABELS: Record<string, string> = {
  FRONTEND: "Frontend",
  BACKEND: "Backend",
  BOTH: "Both",
};

export const SEVERITY_VALUES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;
export const ENVIRONMENT_VALUES = ["FRONTEND", "BACKEND", "BOTH"] as const;
