"use client";

export function UnarchiveProjectButton({ action }: { action: (formData: FormData) => void }) {
  return (
    <form action={action}>
      <button
        type="submit"
        className="flex min-h-9 items-center rounded-md border border-gs-gray/30 px-3 text-sm font-medium hover:bg-gs-light"
      >
        Restore
      </button>
    </form>
  );
}
