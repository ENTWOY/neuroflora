import { useEffect, useRef, useState, useCallback } from "react";

interface CanvasSetupResult {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  dimensions: {
    width: number;
    height: number;
    dpr: number;
    isLowPower: boolean;
    viewScale: number;
    virtualWidth: number;
    virtualHeight: number;
  };
}

// Width at which the desktop composition is tuned. Anything narrower
// renders into a virtual canvas of this size and scales down.
const REFERENCE_VIEWPORT_WIDTH = 960;

export function useCanvasSetup(): CanvasSetupResult {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dimensions, setDimensions] = useState({
    width: 0,
    height: 0,
    dpr: 1,
    isLowPower: false,
    viewScale: 1,
    virtualWidth: 0,
    virtualHeight: 0,
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

    const viewScale = Math.min(1, width / REFERENCE_VIEWPORT_WIDTH);
    const virtualWidth = width / viewScale;
    const virtualHeight = height / viewScale;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    setDimensions({
      width,
      height,
      dpr,
      isLowPower,
      viewScale,
      virtualWidth,
      virtualHeight,
    });
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
