"use client";

export function ArchiveProjectButton({
  projectName,
  action,
}: {
  projectName: string;
  action: (formData: FormData) => void;
}) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (
          !confirm(
            `Archive "${projectName}"?\n\nIt will be hidden from all listings, dashboards and reports, but its data is kept and it can be restored later.`,
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <button
        type="submit"
        className="flex min-h-11 items-center rounded-md border border-gs-red px-3 text-sm font-medium text-gs-red hover:bg-gs-red/5"
      >
        Archive Project
      </button>
    </form>
  );
}
