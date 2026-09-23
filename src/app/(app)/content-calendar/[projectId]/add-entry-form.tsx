"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { formatDate } from "@/lib/format";

type ContentType = { id: string; name: string; contentLeadTimeDays: number };

/** Today in the browser's own local calendar day — good enough for a client-side min-date
 * hint; the server re-validates against the Social Media Lead's own location (see
 * createCalendarEntry), which is the authoritative check. */
function todayString() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

// Lead times are counted in working days (Mon–Fri) — weekends aren't production days — so the
// earliest selectable Publish Date steps forward skipping Sat/Sun. Client-side hint only; the
// server re-validates the same way (subtractWorkingDays in the content-calendar action).
function addWorkingDaysToDateString(dateString: string, days: number) {
  const d = new Date(`${dateString}T00:00:00`);
  let remaining = Math.max(0, days);
  while (remaining > 0) {
    d.setDate(d.getDate() + 1);
    const day = d.getDay(); // 0 = Sun, 6 = Sat
    if (day !== 0 && day !== 6) remaining -= 1;
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function AddEntryForm({
  contentTypes,
  action,
}: {
  contentTypes: ContentType[];
  action: (formData: FormData) => void;
}) {
  const [contentTypeId, setContentTypeId] = useState("");
  const [publishDate, setPublishDate] = useState("");

  if (contentTypes.length === 0) {
    return (
      <p className="text-sm text-gs-gray">
        No Content Types exist yet — ask an Admin to add one under Admin &gt; Content Types.
      </p>
    );
  }

  const selectedContentType = contentTypes.find((ct) => ct.id === contentTypeId) ?? null;
  const minPublishDate = selectedContentType ? addWorkingDaysToDateString(todayString(), selectedContentType.contentLeadTimeDays) : undefined;

  return (
    <ActionForm action={action} successMessage="Calendar entry added." className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="publishDate" className="text-sm font-medium">Publish Date</label>
          <input
            id="publishDate"
            name="publishDate"
            type="date"
            required
            min={minPublishDate}
            value={publishDate}
            onChange={(e) => setPublishDate(e.target.value)}
            className="rounded-md border border-gs-gray/30 px-3 py-2 text-sm outline-none focus:border-gs-red focus:ring-1 focus:ring-gs-red"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="contentTypeId" className="text-sm font-medium">Content Type</label>
          <select
            id="contentTypeId"
            name="contentTypeId"
            required
            value={contentTypeId}
            onChange={(e) => {
              setContentTypeId(e.target.value);
              const nextMin = e.target.value
                ? addWorkingDaysToDateString(todayString(), contentTypes.find((ct) => ct.id === e.target.value)!.contentLeadTimeDays)
                : undefined;
              if (nextMin && publishDate && publishDate < nextMin) setPublishDate("");
            }}
            className="rounded-md border border-gs-gray/30 px-3 py-2 text-sm outline-none focus:border-gs-red focus:ring-1 focus:ring-gs-red"
          >
            <option value="" disabled>Select a Content Type</option>
            {contentTypes.map((ct) => (
              <option key={ct.id} value={ct.id}>{ct.name}</option>
            ))}
          </select>
        </div>
      </div>
      {selectedContentType && (
        <p className="text-xs text-gs-gray">
          &quot;{selectedContentType.name}&quot; needs at least {selectedContentType.contentLeadTimeDays} working days
          before Publish Date — earliest selectable is{" "}
          <span className="font-medium text-gs-black">{formatDate(minPublishDate!)}</span>.
        </p>
      )}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="title" className="text-sm font-medium">Topic/Title</label>
        <input
          id="title"
          name="title"
          required
          className="rounded-md border border-gs-gray/30 px-3 py-2 text-sm outline-none focus:border-gs-red focus:ring-1 focus:ring-gs-red"
        />
      </div>
      <SubmitButton
        pendingLabel="Adding…"
        className="flex min-h-11 items-center self-start rounded-md bg-gs-red px-4 text-sm font-medium text-white hover:opacity-90"
      >
        Add Entry
      </SubmitButton>
    </ActionForm>
  );
}
