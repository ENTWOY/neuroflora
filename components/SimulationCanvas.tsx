"use client";

import { useEffect, useRef, useCallback } from "react";
import { useCanvasSetup } from "@/hooks/useCanvasSetup";
import { useAnimationLoop } from "@/hooks/useAnimationLoop";
import { SimulationEngine } from "@/simulation/SimulationEngine";
import { MOBILE_CONFIG_OVERRIDES } from "@/constants/simulation";

interface SimulationCanvasProps {
  /** When false, the canvas renders the static scene but does not advance the simulation. */
  isRunning: boolean;
  /** Fired once the internal collapse sequence reaches full blackout. */
  onCollapseComplete?: () => void;
}

/**
 * SimulationCanvas — the main client component.
 * Creates the simulation engine outside React state and drives it via RAF.
 */
export default function SimulationCanvas({
  isRunning,
  onCollapseComplete,
}: SimulationCanvasProps) {
  const { canvasRef, dimensions } = useCanvasSetup();
  const engineRef = useRef<SimulationEngine | null>(null);
  const initializedRef = useRef(false);
  const isRunningRef = useRef(isRunning);
  const collapseReportedRef = useRef(false);

  // Keep a ref in sync so the RAF callback always reads the latest value
  useEffect(() => {
    isRunningRef.current = isRunning;
  }, [isRunning]);

  // Tick callback — runs every frame, outside React render cycle
  const onTick = useCallback((dt: number) => {
    const engine = engineRef.current;
    if (!engine) return;

    // Only advance simulation when running; always render the static scene
    if (isRunningRef.current) {
      engine.update(dt);
      if (engine.isCollapseComplete() && !collapseReportedRef.current) {
        collapseReportedRef.current = true;
        onCollapseComplete?.();
      }
    }
    engine.render();
  }, [onCollapseComplete]);

  const { start, stop } = useAnimationLoop(onTick);

  // Initialize engine when canvas + dimensions are ready
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || dimensions.width === 0) return;

    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    if (!initializedRef.current) {
      const engine = new SimulationEngine(
        dimensions.isLowPower ? MOBILE_CONFIG_OVERRIDES : undefined
      );
      engine.init(ctx, dimensions.width, dimensions.height, dimensions.dpr);
      engineRef.current = engine;
      initializedRef.current = true;
      collapseReportedRef.current = false;
      start();
    } else {
      // Resize existing engine
      engineRef.current?.resize(
        dimensions.width,
        dimensions.height,
        dimensions.dpr
      );
    }
  }, [dimensions, canvasRef, start]);

  // Cleanup on unmount
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
