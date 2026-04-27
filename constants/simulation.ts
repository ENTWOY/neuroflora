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

  // ─── Survival Intelligence ────────────────────────────────────────────
  captureRegenAmount: 1.5,     // Small reward per capture — competence buys time
  regenIntegrityCap: 80,       // Can never fully heal — early mistakes leave scars
  desperationThreshold: 20,    // Below this integrity, the organism enters last-stand
  triageRedETA: 0.5,           // Seconds to escape that trigger critical priority
  triageBlackMargin: 0.2,      // Seconds below which an unreachable orb is abandoned

  // ─── Somatic Mobility ──────────────────────────────────────────────
  baseMoveSpeed: 200,            // Max vertical slide speed (px/s)
  baseMoveDamping: 0.85,         // Damping to prevent jitter

  // ─── Reach Surge ───────────────────────────────────────────────────
  surgeReachMultiplier: 1.2,     // 20% temporary reach extension under critical pressure

  // ─── Neural Pulse ──────────────────────────────────────────────────
  neuralPulseCost: 3,            // Voluntary sacrifice (less than 5pt escape damage)
  neuralPulseETA: 0.35,          // Trigger window — orb about to escape, physically unreachable

  // ─── Stochastic Sentience ────────────────────────────────────────────

  // Metabolic Rhythms (2-3 minute cycles)
  metabolicPhaseMin: 120,          // Minimum phase duration (seconds)
  metabolicPhaseMax: 180,          // Maximum phase duration (seconds)
  metabolicBlendSpeed: 0.4,        // Blend speed between metabolic states

  // Orb Anomalies
  flutterOrbChance: 0.12,          // 12% of orbs are flutter orbs
  ghostOrbChance: 0.06,            // 6% of orbs are ghost orbs
  magneticOrbChance: 0.08,         // 8% of orbs are magnetic orbs
  flutterDodgeIntervalMin: 1.5,    // Min seconds between dodge maneuvers
  flutterDodgeIntervalMax: 4.0,    // Max seconds between dodge maneuvers
  flutterDodgeDistance: 80,         // Dodge distance in pixels
  ghostCycleDuration: 3.0,         // Full fade in/out cycle (seconds)
  ghostMinVisibility: 0.08,        // Ghost orbs fade to near-invisible
  magneticStrength: 45,            // Magnetic pull/repel force
  magneticRadius: 150,             // Magnetic influence radius (pixels)

  // Psychological Expressions
  mourningDuration: 1.5,           // Droop duration after an orb escapes (seconds)
  curiosityLagDuration: 1.0,       // Inspection time before snapping (seconds)
  curiosityFollowDistance: 10,      // Follow distance during inspection (pixels)
  curiosityLagChance: 0.2,         // 20% chance of curiosity lag per capture
  shiverDuration: 0.6,             // Synchronized shiver duration (seconds)
  shiverSpeedThreshold: 320,       // Speed threshold to trigger shiver

  // Stochastic Mutations
  anomalousEventCooldown: 45,      // Seconds between anomalous events
  anomalousEventDuration: 5,       // Duration of each anomalous event (seconds)
  whirlpoolSpeed: 2.5,             // Rotation speed for whirlpool (radians/second)

  // Adaptive Randomness
  randomTargetChance: 0.15,        // 15% chance to pick a non-optimal target
  speedWaveRiseDuration: 20,       // Seconds of accelerating speed
  speedWaveCalmDuration: 10,       // Seconds of calm between waves
  speedWaveCalmMultiplier: 0.4,    // Speed drops to 40% during calm
  speedWaveSpikeMultiplier: 1.3,   // Speed spikes 30% above base after calm
};

export const MOBILE_CONFIG_OVERRIDES: Partial<SimulationConfig> = {
  maxTrailLength: 3,
  particlesPerBurst: 6,
  maxParticles: 120,
  particleLifeMax: 0.5,
  trailAlpha: 0.18,
};
