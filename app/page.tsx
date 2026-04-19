"use client";

import { useState, useCallback } from "react";
import SimulationCanvas from "@/components/SimulationCanvas";

export default function Home() {
  const [isObserving, setIsObserving] = useState(false);
  const [overlayHidden, setOverlayHidden] = useState(false);

  const handleInitialize = useCallback(() => {
    setOverlayHidden(true);
    // Wait for the CSS fade-out transition to finish before starting updates
    setTimeout(() => {
      setIsObserving(true);
    }, 800);
  }, []);

  return (
    <div className="relative w-full h-screen overflow-hidden bg-[#020a0f]">
      <SimulationCanvas isRunning={isObserving} />

      {/* Start screen overlay */}
      <div
        className={`neuroflora-overlay ${overlayHidden ? "neuroflora-overlay--hidden" : ""}`}
      >
        <h1 className="neuroflora-title">Neuroflora</h1>
        <p className="neuroflora-subtitle">Artificial Life Observation</p>
        <button
          className="neuroflora-cta"
          onClick={handleInitialize}
          type="button"
        >
          Initialize
        </button>
      </div>
    </div>
  );
}
