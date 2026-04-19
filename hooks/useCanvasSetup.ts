import { useEffect, useRef, useState, useCallback } from "react";

interface CanvasSetupResult {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  dimensions: { width: number; height: number; dpr: number; isLowPower: boolean };
}

/**
 * useCanvasSetup — handles DPR-aware canvas sizing and resize events.
 */
export function useCanvasSetup(): CanvasSetupResult {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dimensions, setDimensions] = useState({
    width: 0,
    height: 0,
    dpr: 1,
    isLowPower: false,
  });

  const updateSize = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const width = window.innerWidth;
    const height = window.innerHeight;
    const isLowPower =
      window.matchMedia("(pointer: coarse)").matches ||
      navigator.maxTouchPoints > 0 ||
      width < 768;
    const dprCap = isLowPower ? 1.5 : 2;
    const dpr = Math.min(window.devicePixelRatio || 1, dprCap);

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    setDimensions({ width, height, dpr, isLowPower });
  }, []);

  useEffect(() => {
    updateSize();

    let resizeTimer: ReturnType<typeof setTimeout>;
    const handleResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(updateSize, 100);
    };

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      clearTimeout(resizeTimer);
    };
  }, [updateSize]);

  return { canvasRef, dimensions };
}
