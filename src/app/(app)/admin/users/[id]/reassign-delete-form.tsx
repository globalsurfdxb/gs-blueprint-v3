"use client";

import { useActionState, useState } from "react";

type Candidate = { id: string; label: string };

export function ReassignDeleteForm({
  userName,
  candidates,
  defaultTargetId,
  action,
}: {
  userName: string;
  candidates: Candidate[];
  defaultTargetId: string;
  action: (prevState: { error?: string } | undefined, formData: FormData) => Promise<{ error?: string }>;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const [targetId, setTargetId] = useState(defaultTargetId);
  const [confirming, setConfirming] = useState(false);
  const targetLabel = candidates.find((c) => c.id === targetId)?.label ?? "";

  return (
    <form
      action={formAction}
      className="mt-4 flex flex-col gap-3 rounded-lg border border-gs-gray/15 bg-white p-6"
    >
      <h2 className="text-sm font-semibold uppercase text-gs-gray">Reassign &amp; delete</h2>
      <p className="text-xs text-gs-gray">
        Moves everything {userName} owns (projects, Task Groups, assigned tasks, time logs, comments,
        attachments) to the user you pick, then deletes this inactive account.
      </p>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Hand work over to
        <select
          name="targetUserId"
          required
          value={targetId}
          onChange={(e) => {
            setTargetId(e.target.value);
            setConfirming(false);
          }}
          className="min-h-11 rounded-md border border-gs-gray/30 bg-white px-3 text-sm font-normal"
        >
          <option value="" disabled>
            Select a user…
          </option>
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </label>

      {!confirming ? (
        <button
          type="button"
          disabled={!targetId}
          onClick={() => setConfirming(true)}
          className="flex min-h-11 w-fit items-center rounded-md border border-gs-red px-4 text-sm font-medium text-gs-red hover:bg-gs-red/5 disabled:opacity-50"
        >
          Reassign &amp; delete user
        </button>
      ) : (
        <div role="alertdialog" className="flex flex-col gap-3 rounded-md border border-gs-red bg-gs-red/5 p-4">
          <p className="text-sm">
            Move all of {userName}&apos;s projects, tasks and records to <strong>{targetLabel}</strong>, then
            permanently delete {userName}? This cannot be undone.
          </p>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={pending}
              className="flex min-h-11 items-center rounded-md bg-gs-red px-4 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {pending ? "Reassigning…" : "Yes, reassign & delete"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setConfirming(false)}
              className="flex min-h-11 items-center rounded-md border border-gs-gray/30 px-4 text-sm font-medium"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {state?.error && (
        <p role="alert" className="text-sm text-gs-red">
          {state.error}
        </p>
      )}
    </form>
  );
}
