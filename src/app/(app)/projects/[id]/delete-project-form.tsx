"use client";

import { useActionState, useState } from "react";

export function DeleteProjectForm({
  projectName,
  summary,
  action,
}: {
  projectName: string;
  summary: string;
  action: (prevState: { error?: string } | undefined, formData: FormData) => Promise<{ error?: string }>;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-11 items-center rounded-md border border-gs-red px-3 text-sm font-medium text-gs-red hover:bg-gs-red/5"
      >
        Delete Project
      </button>
    );
  }

  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-3 rounded-md border border-gs-red bg-gs-red/5 p-4">
      <p className="text-sm">
        Permanently delete <strong>{projectName}</strong> and everything attached to it: {summary}. This cannot be
        undone — use Archive instead to keep the history.
      </p>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Type the project name to confirm
        <input
          name="confirmName"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          className="min-h-11 rounded-md border border-gs-gray/30 bg-white px-3 text-sm font-normal"
        />
      </label>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending || typed.trim() !== projectName}
          className="flex min-h-11 items-center rounded-md bg-gs-red px-4 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Deleting…" : "Delete project permanently"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setOpen(false);
            setTyped("");
          }}
          className="flex min-h-11 items-center rounded-md border border-gs-gray/30 bg-white px-4 text-sm font-medium"
        >
          Cancel
        </button>
      </div>
      {state?.error && (
        <p role="alert" className="text-sm text-gs-red">
          {state.error}
        </p>
      )}
    </form>
  );
}
