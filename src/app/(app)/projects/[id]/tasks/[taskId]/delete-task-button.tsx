"use client";

export function DeleteTaskButton({
  taskName,
  action,
}: {
  taskName: string;
  action: (formData: FormData) => void;
}) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (
          !confirm(
            `Permanently delete "${taskName}"?\n\nOnly possible because it has no time logged, comments, or started work. Any subtasks and attachments are removed too. This cannot be undone.`,
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
        Delete Task
      </button>
    </form>
  );
}
