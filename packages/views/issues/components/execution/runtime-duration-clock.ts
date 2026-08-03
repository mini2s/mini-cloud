import { useEffect, useState } from "react";

const RUNTIME_DURATION_REFRESH_MS = 10_000;

export function useRuntimeDurationClock(active: boolean): number {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return undefined;

    setNowMs(Date.now());
    const interval = setInterval(() => {
      setNowMs(Date.now());
    }, RUNTIME_DURATION_REFRESH_MS);
    return () => clearInterval(interval);
  }, [active]);

  return nowMs;
}
