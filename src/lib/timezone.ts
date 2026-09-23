const LOCATION_OFFSET_HOURS: Record<string, number> = {
  DUBAI: 4,
  INDIA: 5.5,
};

/** Calendar date (YYYY-MM-DD) at this fixed-offset location for a given UTC instant. */
export function getLocalDateString(location: string, atUtc: Date): string {
  const offsetMs = (LOCATION_OFFSET_HOURS[location] ?? 0) * 60 * 60 * 1000;
  const shifted = new Date(atUtc.getTime() + offsetMs);
  return shifted.toISOString().slice(0, 10);
}

export function addDays(dateString: string, days: number): string {
  const d = new Date(`${dateString}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Days late against a task's Due Date, computed in the assignee's own local calendar day
 * (PRD 9.5 — Overdue must be computed per-user's timezone, not server time, so a Dubai
 * Lead and an India Contributor never see conflicting overdue status on the same task).
 * Returns 0 on the due date itself, N on the Nth day past it, or null if not yet due
 * (or unassigned — nothing to compute against).
 */
export function daysOverdue(dueDate: Date, location: string | null | undefined, now: Date): number | null {
  if (!location) return null;
  const todayStr = getLocalDateString(location, now);
  const dueDateStr = dueDate.toISOString().slice(0, 10);
  const diffMs = new Date(`${todayStr}T00:00:00Z`).getTime() - new Date(`${dueDateStr}T00:00:00Z`).getTime();
  const diffDays = Math.round(diffMs / (24 * 60 * 60 * 1000));
  return diffDays >= 0 ? diffDays : null;
}

/** Local wall-clock date, shifted by the location's fixed offset (e.g. "10/07/2026"). */
export function formatLocalDate(atUtc: Date, location: string): string {
  const offsetMs = (LOCATION_OFFSET_HOURS[location] ?? 0) * 60 * 60 * 1000;
  const shifted = new Date(atUtc.getTime() + offsetMs);
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${shifted.getUTCFullYear()}`;
}

/** UTC instant → a <input type="datetime-local"> value ("YYYY-MM-DDTHH:MM") expressed in
 * the given location's wall-clock — used to prefill the Cluster-Head time-log edit form. */
export function utcToLocalInput(atUtc: Date, location: string): string {
  const offsetMs = (LOCATION_OFFSET_HOURS[location] ?? 0) * 60 * 60 * 1000;
  const shifted = new Date(atUtc.getTime() + offsetMs);
  return shifted.toISOString().slice(0, 16);
}

/** Inverse of utcToLocalInput: a datetime-local string, read as wall-clock at `location`,
 * converted back to the true UTC instant for storage. */
export function localInputToUtc(value: string, location: string): Date {
  const offsetMs = (LOCATION_OFFSET_HOURS[location] ?? 0) * 60 * 60 * 1000;
  return new Date(new Date(`${value}:00Z`).getTime() - offsetMs);
}

/** Local wall-clock time, shifted by the location's fixed offset (e.g. "9:00 AM"). */
export function formatLocalTime(atUtc: Date, location: string): string {
  const offsetMs = (LOCATION_OFFSET_HOURS[location] ?? 0) * 60 * 60 * 1000;
  const shifted = new Date(atUtc.getTime() + offsetMs);
  const hours = shifted.getUTCHours();
  const minutes = shifted.getUTCMinutes();
  const period = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${minutes.toString().padStart(2, "0")} ${period}`;
}
