"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import SimulationCanvas from "@/components/SimulationCanvas";

export default function Home() {
  const [isObserving, setIsObserving] = useState(false);
  const [overlayHidden, setOverlayHidden] = useState(false);
  const [sessionId, setSessionId] = useState(0);
  const startDelayTimerRef = useRef<number | null>(null);
  const restartDelayTimerRef = useRef<number | null>(null);

  const handleInitialize = useCallback(() => {
    if (startDelayTimerRef.current) {
      window.clearTimeout(startDelayTimerRef.current);
    }
    if (restartDelayTimerRef.current) {
      window.clearTimeout(restartDelayTimerRef.current);
    }

    setIsObserving(false);
    setSessionId((prev) => prev + 1);
    setOverlayHidden(true);
    // Wait for the CSS fade-out transition to finish before starting updates
    startDelayTimerRef.current = window.setTimeout(() => {
      setIsObserving(true);
    }, 800);
  }, []);

  const handleCollapseComplete = useCallback(() => {
    if (restartDelayTimerRef.current) {
      window.clearTimeout(restartDelayTimerRef.current);
    }

    restartDelayTimerRef.current = window.setTimeout(() => {
      setIsObserving(false);
      setOverlayHidden(false);
      // Reset the canvas session so the menu returns over a fresh scene, not the collapsed frame.
      setSessionId((prev) => prev + 1);
    }, 450);
  }, []);

  useEffect(() => {
    return () => {
      if (startDelayTimerRef.current) {
        window.clearTimeout(startDelayTimerRef.current);
      }
      if (restartDelayTimerRef.current) {
        window.clearTimeout(restartDelayTimerRef.current);
      }
    };
  }, []);

  return (
    <div className="relative w-full h-screen overflow-hidden bg-[#020a0f]">
      <SimulationCanvas
        key={sessionId}
        isRunning={isObserving}
        onCollapseComplete={handleCollapseComplete}
      />

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
