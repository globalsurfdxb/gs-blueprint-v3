export function secondsSince(start: Date): number {
  return Math.max(0, Math.round((Date.now() - start.getTime()) / 1000));
}

/**
 * Working-days (Mon–Fri) date math for the Content Calendar. Lead times are expressed as
 * "N working days before Publish Date" — weekends (Sat/Sun) don't count as production days,
 * so counting calendar days would give teams less real runway than intended. UTC-based to
 * match how Publish Dates are stored (yyyy-mm-dd → UTC midnight). The result always lands on
 * a working day, so auto-calculated Due Dates never fall on a weekend.
 */
function stepWorkingDays(date: Date, n: number, direction: 1 | -1): Date {
  const result = new Date(date);
  let remaining = Math.max(0, n);
  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() + direction);
    const day = result.getUTCDay(); // 0 = Sun, 6 = Sat
    if (day !== 0 && day !== 6) remaining -= 1;
  }
  return result;
}

/** N working days before `date` (skips Sat/Sun). */
export function subtractWorkingDays(date: Date, days: number): Date {
  return stepWorkingDays(date, days, -1);
}

/** N working days after `date` (skips Sat/Sun). */
export function addWorkingDays(date: Date, days: number): Date {
  return stepWorkingDays(date, days, 1);
}

/**
 * Display format for calendar dates — DD/MM/YYYY, the agency-wide standard.
 * UTC-based to match how due/publish dates are stored and compared everywhere else
 * (they use `toISOString().slice(0,10)`), so a date never shifts a day in display.
 * Accepts a Date or an ISO date string.
 */
export function formatDate(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d.length === 10 ? `${d}T00:00:00Z` : d) : d;
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${date.getUTCFullYear()}`;
}

/** Date + 24h time for activity timestamps (comments, notifications): "DD/MM/YYYY HH:MM". */
export function formatDateTime(d: Date): string {
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const hours = String(d.getUTCHours()).padStart(2, "0");
  const minutes = String(d.getUTCMinutes()).padStart(2, "0");
  return `${day}/${month}/${d.getUTCFullYear()} ${hours}:${minutes}`;
}

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours === 0 && minutes === 0) return `${Math.round(totalSeconds)}s`;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}
