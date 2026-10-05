"use client";

import { useActionState, useState } from "react";

export function DeleteClientForm({
  clientName,
  action,
}: {
  clientName: string;
  action: (prevState: { error?: string } | undefined, formData: FormData) => Promise<{ error?: string }>;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const [confirming, setConfirming] = useState(false);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      {!confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="flex min-h-11 w-fit items-center rounded-md border border-gs-red px-4 text-sm font-medium text-gs-red hover:bg-gs-red/5"
        >
          Delete Client
        </button>
      ) : (
        <div role="alertdialog" className="flex max-w-xl flex-col gap-3 rounded-md border border-gs-red bg-gs-red/5 p-4">
          <p className="text-sm">
            Permanently delete <strong>{clientName}</strong>? This cannot be undone.
          </p>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={pending}
              className="flex min-h-11 items-center rounded-md bg-gs-red px-4 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {pending ? "Deleting…" : "Yes, delete client"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setConfirming(false)}
              className="flex min-h-11 items-center rounded-md border border-gs-gray/30 bg-white px-4 text-sm font-medium"
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
