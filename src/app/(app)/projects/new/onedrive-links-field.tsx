"use client";

import { useState } from "react";

export function OneDriveLinksField() {
  const [rowCount, setRowCount] = useState(1);

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">OneDrive Links <span className="text-gs-gray">(optional)</span></span>
      <div className="flex flex-col gap-2">
        {Array.from({ length: rowCount }, (_, i) => (
          <div key={i} className="flex flex-col gap-2 sm:flex-row">
            <input
              name="linkUrls"
              type="url"
              placeholder="https://..."
              className="min-w-0 flex-1 rounded-md border border-gs-gray/30 px-3 py-2 text-sm outline-none focus:border-gs-red focus:ring-1 focus:ring-gs-red"
            />
            <input
              name="linkLabels"
              placeholder="Label (optional)"
              className="w-full rounded-md border border-gs-gray/30 px-3 py-2 text-sm outline-none focus:border-gs-red focus:ring-1 focus:ring-gs-red sm:w-40"
            />
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => setRowCount((n) => n + 1)}
        className="self-start text-xs text-gs-red hover:underline"
      >
        + Add another link
      </button>
      <p className="text-xs text-gs-gray">Shared project documentation — brief, brand assets, reporting sheet, etc.</p>
    </div>
  );
}
