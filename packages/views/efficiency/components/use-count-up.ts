import { useEffect, useRef, useState } from "react";

/** Motion is allowed unless the user asked the OS for reduced motion (a11y). */
function motionAllowed(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return true;
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Number-roll animation: eases from 0 to `target` over `duration` ms via
 * requestAnimationFrame (ease-out cubic). With prefers-reduced-motion: reduce
 * the final value is returned immediately, no roll. Changing `target` restarts
 * the roll from 0 (e.g. when the date range changes).
 *
 * Ported from the source project's hooks/useCountUp.ts — the "AI 提效总览"
 * hero numbers are meant to roll up on load.
 */
export function useCountUp(target: number, duration = 1200): number {
  const [value, setValue] = useState(() => (motionAllowed() ? 0 : target));
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!motionAllowed() || !Number.isFinite(target)) {
      setValue(Number.isFinite(target) ? target : 0);
      return;
    }
    const start = performance.now();
    const tick = () => {
      // performance.now() over the rAF timestamp param: same clock in
      // browsers, but jsdom's rAF timestamp uses a different origin.
      const t = Math.min(1, (performance.now() - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      setValue(target * eased);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setValue(target);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [target, duration]);

  return value;
}
