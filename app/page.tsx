"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import SimulationCanvas, { type RunSummary } from "@/components/SimulationCanvas";
import {
  loadSurvivalStats,
  recordRun,
  formatDuration,
  type SurvivalStats,
  type RunRecord,
} from "@/utils/survivalStats";

export default function Home() {
  const [isObserving, setIsObserving] = useState(false);
  const [overlayHidden, setOverlayHidden] = useState(false);
  const [sessionId, setSessionId] = useState(0);
  const [stats, setStats] = useState<SurvivalStats | null>(null);
  const [lastRun, setLastRun] = useState<RunRecord | null>(null);
  const startDelayTimerRef = useRef<number | null>(null);
  const restartDelayTimerRef = useRef<number | null>(null);

  // Load persisted stats once on mount (client-only — avoids SSR mismatch)
  useEffect(() => {
    setStats(loadSurvivalStats());
  }, []);

  const handleInitialize = useCallback(() => {
    if (startDelayTimerRef.current) {
      window.clearTimeout(startDelayTimerRef.current);
    }
    if (restartDelayTimerRef.current) {
      window.clearTimeout(restartDelayTimerRef.current);
    }

    setIsObserving(false);
    setLastRun(null);
    setSessionId((prev) => prev + 1);
    setOverlayHidden(true);
    startDelayTimerRef.current = window.setTimeout(() => {
      setIsObserving(true);
    }, 800);
  }, []);

  const handleCollapseComplete = useCallback((summary: RunSummary) => {
    if (restartDelayTimerRef.current) {
      window.clearTimeout(restartDelayTimerRef.current);
    }

    const run: RunRecord = {
      endedAt: Date.now(),
      duration: summary.duration,
      captures: summary.captures,
    };
    setStats(recordRun(run));
    setLastRun(run);

    restartDelayTimerRef.current = window.setTimeout(() => {
      setIsObserving(false);
      setOverlayHidden(false);
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

  const isPostRun = lastRun !== null;
  const isNewBest =
    isPostRun &&
    stats?.bestRun != null &&
    stats.bestRun.endedAt === lastRun.endedAt;
  const bestDuration = stats?.bestRun?.duration ?? 0;

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
        <p className="neuroflora-subtitle">
          {isPostRun ? "Cycle Terminated" : "Artificial Life Observation"}
        </p>

        {isPostRun && lastRun && (
          <div className="flex flex-col items-center gap-1 mt-2">
            <span
              className={`font-mono text-[0.6rem] tracking-[0.28em] uppercase ${
                isNewBest ? "text-emerald-300/70" : "text-white/30"
              }`}
            >
              {isNewBest ? "New Record" : "Survived"}
            </span>
            <span className="font-mono text-3xl font-light tracking-wide text-white/85 tabular-nums">
              {formatDuration(lastRun.duration)}
            </span>
          </div>
        )}

        {stats && stats.totalRuns > 0 && bestDuration > 0 && !isNewBest && (
          <div className="flex flex-col items-center gap-1">
            <span className="font-mono text-[0.6rem] tracking-[0.28em] uppercase text-white/30">
              Best
            </span>
            <span className="font-mono text-base font-light tracking-wide text-white/55 tabular-nums">
              {formatDuration(bestDuration)}
            </span>
          </div>
        )}

        <button
          className="neuroflora-cta"
          onClick={handleInitialize}
          type="button"
        >
          {isPostRun ? "Re-Initialize" : "Initialize"}
        </button>
      </div>
    </div>
  );
}
