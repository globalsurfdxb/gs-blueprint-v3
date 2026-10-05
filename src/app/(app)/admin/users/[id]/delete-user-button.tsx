"use client";

import { useActionState } from "react";

export function DeleteUserButton({
  userName,
  action,
}: {
  userName: string;
  action: (prevState: { error?: string } | undefined, formData: FormData) => Promise<{ error?: string }>;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!confirm(`Permanently delete ${userName}? This cannot be undone.`)) {
          e.preventDefault();
        }
      }}
    >
      <button
        type="submit"
        disabled={pending}
        className="flex min-h-11 items-center rounded-md border border-gs-red px-4 text-sm font-medium text-gs-red hover:bg-gs-red/5 disabled:opacity-50"
      >
        {pending ? "Deleting…" : "Delete User"}
      </button>
      {state?.error && (
        <p role="alert" className="mt-2 text-sm text-gs-red">
          {state.error}
        </p>
      )}
    </form>
  );
}
