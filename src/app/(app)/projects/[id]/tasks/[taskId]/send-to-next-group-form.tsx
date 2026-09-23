"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/action-form";

function ShareIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
      <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16 6l-4-4-4 4M12 2v14" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

type DestinationGroup = { id: string; name: string; isDesign: boolean };

export function SendToNextGroupForm({
  destinationGroups,
  defaultDescription,
  autoDesignDueDate,
  action,
}: {
  destinationGroups: DestinationGroup[];
  defaultDescription: string;
  // Set only when this task originated from the Content Calendar (carries a Publish Date
  // + Content Type) — the date Design's Due Date auto-calculates to, formatted for
  // display. Null for an ordinary task, which always takes a manually-entered Due Date.
  autoDesignDueDate: string | null;
  action: (formData: FormData) => void;
}) {
  const [destinationGroupId, setDestinationGroupId] = useState("");

  if (destinationGroups.length === 0) {
    return (
      <p className="mt-4 text-xs text-gs-gray">
        No other Task Group is attached to this project yet — attach one before handing off this task.
      </p>
    );
  }

  const selectedIsDesign = destinationGroups.find((g) => g.id === destinationGroupId)?.isDesign ?? false;
  const dueDateIsAutomatic = autoDesignDueDate !== null && selectedIsDesign;

  // Sharing to another group is an explicit, deliberate action — not every completed task
  // needs a handoff, so the form stays collapsed behind this button rather than always
  // rendering open (which read as if every task were required to be forwarded).
  return (
    <details className="mt-4">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 text-sm font-medium text-gs-red hover:underline [&::-webkit-details-marker]:hidden">
        <ShareIcon className="h-4 w-4" />
        Share to Another Group
      </summary>
      <ActionForm action={action} successMessage="Handed off to the next group." className="mt-3 flex flex-col gap-3 rounded-lg border border-gs-gray/15 bg-white p-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-gs-gray">Destination Task Group</label>
          <select
            name="destinationGroupId"
            required
            value={destinationGroupId}
            onChange={(e) => setDestinationGroupId(e.target.value)}
            className="rounded-md border border-gs-gray/30 px-3 py-2 text-sm"
          >
            <option value="" disabled>Select a Task Group</option>
            {destinationGroups.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-gs-gray">Brief for the receiving Lead (editable)</label>
          <textarea
            name="description"
            rows={3}
            defaultValue={defaultDescription}
            className="rounded-md border border-gs-gray/30 px-3 py-2 text-sm"
          />
        </div>
        {dueDateIsAutomatic ? (
          <p className="text-xs text-gs-gray">
            Design Due Date: <span className="font-medium text-gs-black">{autoDesignDueDate}</span> — set
            automatically from this Content Calendar entry&apos;s Publish Date and Content Type, not editable here.
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-gs-gray">Due Date</label>
            <input name="dueDate" type="date" required className="rounded-md border border-gs-gray/30 px-3 py-2 text-sm" />
          </div>
        )}
        <SubmitButton
          pendingLabel="Sending…"
          className="flex min-h-11 items-center self-start rounded-md border border-gs-gray/30 px-4 text-sm font-medium hover:bg-gs-light"
        >
          Send to Next Group
        </SubmitButton>
        <p className="text-xs text-gs-gray">
          Creates a new task in the destination group, linked back to this one — this task stays as the
          historical record and is never altered.
        </p>
      </ActionForm>
    </details>
  );
}
