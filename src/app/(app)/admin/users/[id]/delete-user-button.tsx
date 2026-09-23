"use client";

export function DeleteUserButton({
  userName,
  action,
}: {
  userName: string;
  action: (formData: FormData) => void;
}) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm(`Permanently delete ${userName}? This cannot be undone.`)) {
          e.preventDefault();
        }
      }}
    >
      <button
        type="submit"
        className="flex min-h-11 items-center rounded-md border border-gs-red px-4 text-sm font-medium text-gs-red hover:bg-gs-red/5"
      >
        Delete User
      </button>
    </form>
  );
}
