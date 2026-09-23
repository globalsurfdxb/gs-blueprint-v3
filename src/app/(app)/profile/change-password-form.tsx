"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { changePassword, type ChangePasswordState } from "@/lib/actions/profile";

const initialState: ChangePasswordState = { ok: false, message: "" };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-1 flex min-h-11 items-center self-start rounded-md bg-gs-red px-4 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
    >
      {pending ? "Updating…" : "Update Password"}
    </button>
  );
}

const inputClass =
  "rounded-md border border-gs-gray/30 px-3 py-2 text-sm outline-none focus:border-gs-red focus:ring-1 focus:ring-gs-red";

export function ChangePasswordForm() {
  const [state, formAction] = useActionState(changePassword, initialState);

  return (
    <form
      action={formAction}
      key={state.ok ? "reset" : "form"}
      className="flex max-w-sm flex-col gap-4 rounded-lg border border-gs-gray/15 bg-white p-6"
    >
      <h2 className="text-sm font-semibold">Change Password</h2>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="currentPassword" className="text-sm font-medium">Current Password</label>
        <input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required className={inputClass} />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="newPassword" className="text-sm font-medium">New Password</label>
        <input id="newPassword" name="newPassword" type="password" autoComplete="new-password" required className={inputClass} />
        <p className="text-xs text-gs-gray">At least 8 characters.</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="confirmPassword" className="text-sm font-medium">Confirm New Password</label>
        <input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required className={inputClass} />
      </div>

      {state.message && (
        <p className={`text-sm font-medium ${state.ok ? "text-green-600" : "text-gs-red"}`} role="status">
          {state.ok ? "Changes saved ✓ — " : ""}{state.message}
        </p>
      )}

      <SubmitButton />
    </form>
  );
}
