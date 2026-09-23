"use client";

import { ActionForm, SubmitButton } from "@/components/action-form";

/**
 * Reject & Return (PRD 8.2.1 v1.22) — sends a handoff-received task back to the group it came
 * from for rework, at any status. No inputs: the destination is fixed to the predecessor's
 * group and rejection context goes in Comments (no reason field). Only rendered when the
 * task has a predecessor and the viewer is its group's Lead/Admin.
 */
export function RejectReturnForm({
  destinationGroupName,
  action,
}: {
  destinationGroupName: string;
  action: (formData: FormData) => void;
}) {
  return (
    <ActionForm
      action={action}
      successMessage={`Returned to ${destinationGroupName} for rework.`}
      className="mt-4 rounded-lg border border-gs-gray/15 bg-white p-4"
    >
      <SubmitButton
        pendingLabel="Returning…"
        className="flex min-h-11 items-center rounded-md border border-gs-red/40 px-4 text-sm font-medium text-gs-red hover:bg-gs-red/5"
      >
        Reject &amp; Return to {destinationGroupName}
      </SubmitButton>
      <p className="mt-2 text-xs text-gs-gray">
        Sends this task back to {destinationGroupName} as a new linked round for rework — no need to
        mark it Completed first. Leave your feedback in the comments below.
      </p>
    </ActionForm>
  );
}
