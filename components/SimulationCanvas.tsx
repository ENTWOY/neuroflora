"use client";

import { useEffect, useRef, useCallback } from "react";
import { useCanvasSetup } from "@/hooks/useCanvasSetup";
import { useAnimationLoop } from "@/hooks/useAnimationLoop";
import { SimulationEngine } from "@/simulation/SimulationEngine";
import { MOBILE_CONFIG_OVERRIDES } from "@/constants/simulation";

export interface RunSummary {
  duration: number;
  captures: number;
}

interface SimulationCanvasProps {
  /** When false, the canvas renders the static scene but does not advance the simulation. */
  isRunning: boolean;
  /** Fired once the internal collapse sequence reaches full blackout. */
  onCollapseComplete?: (summary: RunSummary) => void;
}

export default function SimulationCanvas({
  isRunning,
  onCollapseComplete,
}: SimulationCanvasProps) {
  const { canvasRef, dimensions } = useCanvasSetup();
  const engineRef = useRef<SimulationEngine | null>(null);
  const initializedRef = useRef(false);
  const isRunningRef = useRef(isRunning);
  const collapseReportedRef = useRef(false);

  // RAF callback closes over this once; mirror the prop into a ref so it
  // doesn't read a stale value between renders.
  useEffect(() => {
    isRunningRef.current = isRunning;
  }, [isRunning]);

  const onTick = useCallback((dt: number) => {
    const engine = engineRef.current;
    if (!engine) return;

    if (isRunningRef.current) {
      engine.update(dt);
      if (engine.isCollapseComplete() && !collapseReportedRef.current) {
        collapseReportedRef.current = true;
        onCollapseComplete?.(engine.getRunSummary());
      }
    }
    engine.render();
  }, [onCollapseComplete]);

  const { start, stop } = useAnimationLoop(onTick);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || dimensions.width === 0) return;

    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    // Plegamos viewScale dentro del dpr: el ctx.scale(dpr, dpr) interno
    // del engine pasa de coords virtuales a píxeles reales en un solo paso.
    const effectiveDpr = dimensions.dpr * dimensions.viewScale;

    if (!initializedRef.current) {
      const engine = new SimulationEngine(
        dimensions.isLowPower ? MOBILE_CONFIG_OVERRIDES : undefined
      );
      engine.init(
        ctx,
        dimensions.virtualWidth,
        dimensions.virtualHeight,
        effectiveDpr
      );
      engineRef.current = engine;
      initializedRef.current = true;
      collapseReportedRef.current = false;
      start();
    } else {
      engineRef.current?.resize(
        dimensions.virtualWidth,
        dimensions.virtualHeight,
        effectiveDpr
      );
    }
  }, [dimensions, canvasRef, start]);

  useEffect(() => {
    return () => {
      stop();
    };
  }, [stop]);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 w-full h-full block"
      style={{ touchAction: "none" }}
    />
  );
}
