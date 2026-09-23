"use client";

import { useState } from "react";
import { formatDate, addWorkingDays } from "@/lib/format";

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** Earliest Publish Date that still leaves the Content Type's working-day lead time — mirrors
 * the server rule (subtractWorkingDays) so the picker guides before the server re-validates. */
function minPublishDate(contentLeadTimeDays: number) {
  const now = new Date();
  const todayUtc = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const min = addWorkingDays(todayUtc, contentLeadTimeDays);
  return `${min.getUTCFullYear()}-${pad(min.getUTCMonth() + 1)}-${pad(min.getUTCDate())}`;
}

export function EditEntryDate({
  publishDateIso,
  contentLeadTimeDays,
  editable,
  action,
}: {
  publishDateIso: string; // yyyy-mm-dd
  contentLeadTimeDays: number;
  editable: boolean;
  action: (formData: FormData) => void;
}) {
  const [editing, setEditing] = useState(false);

  if (!editable) return <span>{formatDate(publishDateIso)}</span>;

  if (!editing) {
    return (
      <span className="flex items-center gap-2">
        {formatDate(publishDateIso)}
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-xs font-medium text-gs-red hover:underline"
        >
          Edit
        </button>
      </span>
    );
  }

  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input
        type="date"
        name="publishDate"
        required
        defaultValue={publishDateIso}
        min={minPublishDate(contentLeadTimeDays)}
        className="min-h-11 rounded-md border border-gs-gray/30 px-2 text-sm outline-none focus:border-gs-red focus:ring-1 focus:ring-gs-red"
      />
      <button
        type="submit"
        className="flex min-h-11 items-center rounded-md bg-gs-red px-3 text-sm font-medium text-white hover:opacity-90"
      >
        Save
      </button>
      <button
        type="button"
        onClick={() => setEditing(false)}
        className="flex min-h-11 items-center rounded-md border border-gs-gray/30 px-3 text-sm font-medium hover:bg-gs-light"
      >
        Cancel
      </button>
    </form>
  );
}
