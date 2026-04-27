import { SimulationConfig } from "@/types/simulation";

export const DEFAULT_CONFIG: SimulationConfig = {
  // ─── Canvas ─────────────────────────────────────────────────────────────
  backgroundColor: "#040d12",
  glowIntensity: 0, // Disabled — shadowBlur removed from render pipeline

  // ─── Plant ──────────────────────────────────────────────────────────────
  plantBaseXRatio: 0.08,
  tentacleCount: 5,
  segmentsPerTentacle: 12,
  segmentLength: 28,
  springStiffness: 0.15,
  springDamping: 0.82,
  jawSize: 22,
  tentacleThickness: 6,
  idleSwayAmplitude: 60,
  idleSwayFrequency: 0.8,

  // ─── Circles ────────────────────────────────────────────────────────────
  initialSpawnInterval: 800,
  minSpawnInterval: 200,
  circleSpeedMin: 120,
  circleSpeedMax: 200,
  circleRadiusMin: 10,
  circleRadiusMax: 22,
  oscillationAmplitudeMin: 20,
  oscillationAmplitudeMax: 100,
  oscillationFrequencyMin: 1.0,
  oscillationFrequencyMax: 3.5,
  maxTrailLength: 5, // Reduced from 8 — lighter per-frame draw load
  circleHues: [330, 270, 45, 15, 190], // pink, violet, amber, coral, cyan

  // ─── Particles ──────────────────────────────────────────────────────────
  particlesPerBurst: 14,
  particleLifeMin: 0.3,
  particleLifeMax: 0.8,
  particleSpeedMin: 80,
  particleSpeedMax: 280,
  particleSizeMin: 2,
  particleSizeMax: 6,
  maxParticles: 300,

  // ─── Difficulty ─────────────────────────────────────────────────────────
  spawnIntervalDecayPerSecond: 3,
  speedIncreasePerSecond: 2,
  maxCircleSpeed: 450,

  // ─── Rendering ──────────────────────────────────────────────────────────
  trailAlpha: 0.28,
  plantGlowColor: "rgba(0, 255, 136, 0.6)", // kept for damage flash reference
  backgroundGradientInner: "#0a1f2b",
  backgroundGradientOuter: "#020a0f",
  particleGlowBlur: 0,       // Disabled — shadowBlur removed from particles
  useAdditiveParticles: false, // Disabled — 'lighter' composite removed
};

export const MOBILE_CONFIG_OVERRIDES: Partial<SimulationConfig> = {
  maxTrailLength: 3,
  particlesPerBurst: 6,
  maxParticles: 120,
  particleLifeMax: 0.5,
  trailAlpha: 0.18,
};
