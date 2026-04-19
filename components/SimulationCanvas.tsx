"use client";

import { useEffect, useRef, useCallback } from "react";
import { useCanvasSetup } from "@/hooks/useCanvasSetup";
import { useAnimationLoop } from "@/hooks/useAnimationLoop";
import { SimulationEngine } from "@/simulation/SimulationEngine";

/**
 * SimulationCanvas — the main client component.
 * Creates the simulation engine outside React state and drives it via RAF.
 */
export default function SimulationCanvas() {
  const { canvasRef, dimensions } = useCanvasSetup();
  const engineRef = useRef<SimulationEngine | null>(null);
  const initializedRef = useRef(false);

  // Tick callback — runs every frame, outside React render cycle
  const onTick = useCallback((dt: number) => {
    const engine = engineRef.current;
    if (!engine) return;

    engine.update(dt);
    engine.render();
  }, []);

  const { start, stop } = useAnimationLoop(onTick);

  // Initialize engine when canvas + dimensions are ready
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || dimensions.width === 0) return;

    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    if (!initializedRef.current) {
      const engine = new SimulationEngine();
      engine.init(ctx, dimensions.width, dimensions.height, dimensions.dpr);
      engineRef.current = engine;
      initializedRef.current = true;
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
