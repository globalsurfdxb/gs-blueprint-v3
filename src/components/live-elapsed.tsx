"use client";

import { useEffect, useState } from "react";

function formatClock(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

export function LiveElapsed({ startedAtIso }: { startedAtIso: string }) {
  const startedAt = new Date(startedAtIso).getTime();
  const [elapsedSeconds, setElapsedSeconds] = useState(() => Math.max(0, Math.round((Date.now() - startedAt) / 1000)));

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsedSeconds(Math.max(0, Math.round((Date.now() - startedAt) / 1000)));
    }, 1000);
    return () => clearInterval(interval);
  }, [startedAt]);

  return <span>{formatClock(elapsedSeconds)}</span>;
}
