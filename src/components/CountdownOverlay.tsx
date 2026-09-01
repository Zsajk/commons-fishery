import { useEffect, useState } from "react";

export function useCountdownSeconds(countdownEndsAt: number | null): number {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!countdownEndsAt || countdownEndsAt <= Date.now()) return;
    setNow(Date.now());
    const timer = window.setInterval(() => {
      const nextNow = Date.now();
      setNow(nextNow);
      if (nextNow >= countdownEndsAt) window.clearInterval(timer);
    }, 100);
    return () => window.clearInterval(timer);
  }, [countdownEndsAt]);

  if (!countdownEndsAt) return 0;
  return Math.max(0, Math.ceil((countdownEndsAt - now) / 1000));
}

export function CountdownOverlay({ endsAt }: { endsAt: number | null }) {
  const seconds = useCountdownSeconds(endsAt);
  if (seconds <= 0) return null;
  return (
    <div className="countdown-overlay" role="status" aria-live="assertive">
      <span>Get ready</span>
      <strong key={seconds}>{seconds}</strong>
      <small>Fishing starts together</small>
    </div>
  );
}
