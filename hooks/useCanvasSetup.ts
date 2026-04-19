import { useEffect, useRef, useState, useCallback } from "react";

interface CanvasSetupResult {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  dimensions: { width: number; height: number; dpr: number };
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
  });

  const updateSize = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const width = window.innerWidth;
    const height = window.innerHeight;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    setDimensions({ width, height, dpr });
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
