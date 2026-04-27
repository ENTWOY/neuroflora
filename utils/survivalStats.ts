import { createPersistedStore } from "./storage";

/**
 * One completed observation cycle — captured the moment the entity collapses.
 */
export interface RunRecord {
  /** UNIX timestamp (ms) at the moment the run ended. */
  endedAt: number;
  /** How long the entity survived, in seconds. */
  duration: number;
  /** Total orbs the entity captured during the run. */
  captures: number;
}

/**
 * Aggregated survival history persisted across sessions.
 */
export interface SurvivalStats {
  totalRuns: number;
  totalSurvivalSeconds: number;
  totalCaptures: number;
  bestRun: RunRecord | null;
  lastRun: RunRecord | null;
}

const DEFAULTS: SurvivalStats = {
  totalRuns: 0,
  totalSurvivalSeconds: 0,
  totalCaptures: 0,
  bestRun: null,
  lastRun: null,
};

const store = createPersistedStore<SurvivalStats>({
  key: "neuroflora.survivalStats",
  version: 1,
  defaults: DEFAULTS,
});

export const loadSurvivalStats = (): SurvivalStats => store.read();

export function recordRun(run: RunRecord): SurvivalStats {
  return store.update((current) => {
    const isNewBest = !current.bestRun || run.duration > current.bestRun.duration;
    return {
      totalRuns: current.totalRuns + 1,
      totalSurvivalSeconds: current.totalSurvivalSeconds + run.duration,
      totalCaptures: current.totalCaptures + run.captures,
      bestRun: isNewBest ? run : current.bestRun,
      lastRun: run,
    };
  });
}

export const clearSurvivalStats = (): void => store.reset();

/** Format seconds as `M:SS` for compact display. */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Captures-per-minute, or 0 when duration is too small to be meaningful. */
export function capturesPerMinute(run: RunRecord): number {
  if (run.duration < 1) return 0;
  return (run.captures / run.duration) * 60;
}
