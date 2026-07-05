'use client';

/**
 * useSmoothed — exponential smoothing for live telemetry values.
 *
 * Visual properties bound to telemetry must interpolate, not snap: when a new
 * value arrives (WebSocket push / poll), the rendered value glides toward it
 * with time-constant `tau` (ms). Runs on requestAnimationFrame only while
 * converging — zero cost at rest.
 */

import { useEffect, useRef, useState } from 'react';

export function useSmoothed(target: number, tau = 500): number {
  const [value, setValue] = useState(target);
  const raf = useRef<number | null>(null);
  const state = useRef({ value: target, target, last: 0 });

  useEffect(() => {
    state.current.target = target;
    if (raf.current !== null) return; // loop already running

    state.current.last = performance.now();
    const tick = (now: number) => {
      const s = state.current;
      const dt = now - s.last;
      s.last = now;
      const k = 1 - Math.exp(-dt / tau);
      s.value += (s.target - s.value) * k;
      if (Math.abs(s.target - s.value) < 0.0005) {
        s.value = s.target;
        setValue(s.value);
        raf.current = null;
        return;
      }
      setValue(s.value);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current !== null) {
        cancelAnimationFrame(raf.current);
        raf.current = null;
      }
    };
  }, [target, tau]);

  return value;
}
