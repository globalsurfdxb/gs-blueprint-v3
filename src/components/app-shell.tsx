"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { LogoutButton } from "@/components/logout-button";
import { ToastProvider } from "@/components/toast";
import type { NavItem } from "@/lib/nav";

type RunningTimer = {
  taskId: string;
  projectId: string;
  taskName: string;
  startedAtMs: number;
};

function elapsedLabel(seconds: number): string {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

function RunningTimerPill({ timer }: { timer: RunningTimer }) {
  // Tick locally off the server-provided start time so the header stays live
  // without re-fetching. Seeds to 0 on first paint to avoid a hydration mismatch.
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const update = () => setElapsed(Math.round((Date.now() - timer.startedAtMs) / 1000));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [timer.startedAtMs]);

  return (
    <Link
      href={`/projects/${timer.projectId}/tasks/${timer.taskId}`}
      title={`Timer running on "${timer.taskName}"`}
      className="flex min-h-11 items-center gap-1.5 rounded-md bg-gs-red/10 px-3 text-sm font-medium text-gs-red hover:bg-gs-red/15"
    >
      <span aria-hidden>⏱</span>
      <span className="tabular-nums">{elapsedLabel(elapsed)}</span>
      <span className="hidden max-w-[10rem] truncate sm:inline">{timer.taskName}</span>
    </Link>
  );
}

function MenuIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
      <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />
    </svg>
  );
}

export function AppShell({
  navItems,
  userName,
  unreadCount,
  runningTimer,
  children,
}: {
  navItems: NavItem[];
  userName: string;
  unreadCount: number;
  runningTimer: RunningTimer | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  // The sidebar is a persistent column at tablet width and up (confirmed usable at
  // 768px); below that it would eat well over half the viewport, so it becomes an
  // off-canvas drawer opened via the header's menu button instead.
  const [navOpen, setNavOpen] = useState(false);

  return (
    <ToastProvider>
    <div className="flex min-h-screen">
      {navOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() => setNavOpen(false)}
          className="fixed inset-0 z-30 bg-gs-black/40 md:hidden"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col overflow-y-auto border-r border-gs-gray/15 bg-white transition-transform md:sticky md:top-0 md:z-auto md:h-screen md:w-56 md:translate-x-0 ${
          navOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center gap-2 px-5 py-5">
          <span className="inline-block h-3 w-3 bg-gs-red" aria-hidden />
          <span className="font-heading text-base font-semibold leading-tight">GS Blueprint</span>
        </div>
        <nav className="flex flex-col gap-0.5 px-3">
          {navItems.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setNavOpen(false)}
                className={`flex min-h-11 items-center rounded-md px-3 text-sm font-medium ${
                  active ? "bg-gs-light text-gs-black" : "text-gs-gray hover:bg-gs-light"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-gs-gray/15 bg-white px-4 py-3 md:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              aria-label="Open navigation"
              onClick={() => setNavOpen(true)}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-gs-black hover:bg-gs-light md:hidden"
            >
              <MenuIcon className="h-5 w-5" />
            </button>
            <Link
              href="/profile"
              className={`flex items-center gap-2 rounded-md px-2 py-1 text-sm text-gs-gray hover:bg-gs-light ${
                pathname === "/profile" ? "bg-gs-light" : ""
              }`}
              title="View your profile"
            >
              <span
                aria-hidden
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gs-red/10 text-xs font-semibold text-gs-red"
              >
                {userName.charAt(0).toUpperCase()}
              </span>
              <span className="hidden truncate sm:inline">{userName}</span>
            </Link>
          </div>
          <div className="flex items-center gap-3">
            {runningTimer && <RunningTimerPill timer={runningTimer} />}
            <Link
              href="/notifications"
              className={`relative flex min-h-11 items-center rounded-md px-3 text-sm font-medium ${
                pathname === "/notifications" ? "bg-gs-light" : "hover:bg-gs-light"
              }`}
            >
              Notifications
              {unreadCount > 0 && (
                <span className="ml-1.5 rounded-full bg-gs-red px-1.5 py-0.5 text-xs font-semibold text-white">
                  {unreadCount}
                </span>
              )}
            </Link>
            <LogoutButton />
          </div>
        </header>
        <main className="flex-1 bg-gs-light p-4 md:p-6">{children}</main>
      </div>
    </div>
    </ToastProvider>
  );
}
