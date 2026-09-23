"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

/**
 * Submit button with built-in save feedback: shows "Saving…" while the server
 * action runs, then a transient "Saved ✓" once it settles on the same page.
 * (For forms that redirect on success this simply unmounts — no confirmation
 * needed, the navigation is the feedback.) Must be rendered inside a <form>.
 */
export function SaveButton({
  children = "Save Changes",
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  const { pending } = useFormStatus();
  const wasPending = useRef(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (wasPending.current && !pending) {
      setSaved(true);
      const id = setTimeout(() => setSaved(false), 2500);
      return () => clearTimeout(id);
    }
    wasPending.current = pending;
  }, [pending]);

  return (
    <div className="mt-2 flex items-center gap-3">
      <button
        type="submit"
        disabled={pending}
        className={
          className ??
          "flex min-h-11 items-center self-start rounded-md bg-gs-red px-4 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
        }
      >
        {pending ? "Saving…" : children}
      </button>
      {saved && !pending && (
        <span className="text-sm font-medium text-green-600" role="status">
          Changes saved ✓
        </span>
      )}
    </div>
  );
}
