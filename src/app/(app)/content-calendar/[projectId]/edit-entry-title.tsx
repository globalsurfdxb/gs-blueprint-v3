"use client";

import Link from "next/link";
import { useState } from "react";

export function EditEntryTitle({
  title,
  taskHref,
  editable,
  action,
}: {
  title: string;
  taskHref: string;
  editable: boolean;
  action: (formData: FormData) => void;
}) {
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return (
      <span className="flex flex-wrap items-center gap-2">
        <Link href={taskHref} className="font-medium hover:underline">
          {title}
        </Link>
        {editable && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-xs font-medium text-gs-red hover:underline"
          >
            Edit
          </button>
        )}
      </span>
    );
  }

  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input
        type="text"
        name="title"
        required
        defaultValue={title}
        className="min-h-11 min-w-0 flex-1 rounded-md border border-gs-gray/30 px-2 text-sm outline-none focus:border-gs-red focus:ring-1 focus:ring-gs-red"
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
