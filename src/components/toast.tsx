"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";

type ToastKind = "success" | "error";
type Toast = { id: number; message: string; kind: ToastKind };

type ToastContextValue = {
  addToast: (message: string, kind?: ToastKind) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

/** Every user action confirms with a toast (PRD 8.2.3) — nothing happens silently. */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  // A no-op fallback keeps components usable outside the provider (e.g. the login screen)
  // rather than throwing — they simply show no toast there.
  return ctx ?? { addToast: () => {} };
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const addToast = useCallback((message: string, kind: ToastKind = "success") => {
    const id = nextId.current++;
    setToasts((prev) => [...prev, { id, message, kind }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3500);
  }, []);

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      <div
        className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[calc(100vw-2rem)] max-w-xs flex-col gap-2"
        aria-live="polite"
        role="status"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto rounded-md px-4 py-3 text-sm font-medium text-white shadow-lg ${
              t.kind === "error" ? "bg-gs-red" : "bg-gs-black"
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
