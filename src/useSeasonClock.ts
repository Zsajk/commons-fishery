import { useEffect, useState } from "react";

export function useSeasonSeconds(
  startedAt: number | null,
  durationSeconds: number,
  running: boolean,
): number {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [running, startedAt]);

  if (!running || startedAt === null) return durationSeconds;
  const elapsedSeconds = Math.max(0, (now - startedAt) / 1000);
  return Math.max(0, Math.ceil(durationSeconds - elapsedSeconds));
}

export function formatSeasonTime(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
