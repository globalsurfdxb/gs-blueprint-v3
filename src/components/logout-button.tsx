"use client";

import { useRouter } from "next/navigation";

export function LogoutButton() {
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      onClick={handleLogout}
      className="flex min-h-11 items-center rounded-md border border-gs-gray/30 px-4 text-sm font-medium hover:bg-gs-light"
    >
      Sign out
    </button>
  );
}
