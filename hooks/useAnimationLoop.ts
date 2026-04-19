import { useCallback, useRef } from "react";

/**
 * useAnimationLoop — manages a requestAnimationFrame loop with delta time.
 * Delta is capped to prevent spiral-of-death on tab switches.
 */
export function useAnimationLoop(
  onTick: (dt: number) => void
) {
  const rafRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const runningRef = useRef(false);

  const loop = useCallback(
    function frame(timestamp: number) {
      if (!runningRef.current) return;

      if (lastTimeRef.current === 0) {
        lastTimeRef.current = timestamp;
      }

      let dt = (timestamp - lastTimeRef.current) / 1000;
      lastTimeRef.current = timestamp;

      // Cap delta to prevent huge jumps (e.g., after tab switch)
      if (dt > 0.032) dt = 0.032;

      onTick(dt);

      rafRef.current = requestAnimationFrame(frame);
    },
    [onTick]
  );

  const start = useCallback(() => {
    if (runningRef.current) return;
    runningRef.current = true;
    lastTimeRef.current = 0;
    rafRef.current = requestAnimationFrame(loop);
  }, [loop]);

  const stop = useCallback(() => {
    runningRef.current = false;
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
  }, []);

  return { start, stop };
}
