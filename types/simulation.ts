// ─── Core Primitives ────────────────────────────────────────────────────────

export interface Vector2D {
  x: number;
  y: number;
}

// ─── Circle Entity ──────────────────────────────────────────────────────────

export interface Circle {
  id: number;
  position: Vector2D;
  velocity: Vector2D;
  radius: number;
  /** Base Y coordinate for oscillation center */
  baseY: number;
  /** Oscillation amplitude in pixels */
  oscillationAmplitude: number;
  /** Oscillation frequency (radians/second) */
  oscillationFrequency: number;
  /** Phase offset for oscillation */
  oscillationPhase: number;
  /** Elapsed time for oscillation calculation */
  elapsedTime: number;
  /** HSL hue value */
  hue: number;
  /** Trail of recent positions for motion trail effect */
  trail: Vector2D[];
  /** Whether this circle has been consumed */
  consumed: boolean;
  /** Whether a tentacle is already targeting this circle */
  targeted: boolean;
  /** Anomaly type that modifies orb behavior */
  anomaly: OrbAnomaly;
  /** Phase for ghost fade in/out (0 = fully visible, 1 = invisible) */
  ghostPhase: number;
  /** Strength of magnetic pull/repulsion toward tentacle tips */
  magneticStrength: number;
  /** Timer until next flutter dodge maneuver */
  flutterTimer: number;
  /** Target Y for flutter dodge; NaN if not dodging */
  flutterTargetY: number;
  /** Whether the orb is currently visible (ghost orbs fade in/out) */
  visible: boolean;
  /** Last known position before ghosting — for predictive memory */
  lastKnownPosition: Vector2D | null;
}

// ─── Plant Structures ───────────────────────────────────────────────────────

export interface PlantSegment {
  position: Vector2D;
  angle: number;
  length: number;
}

export type PlantBehaviorMode = "idle" | "hunting" | "defensive" | "desperate";

// ─── Stochastic Sentience Types ──────────────────────────────────────────

export type MetabolicState = "meditative" | "hyperfixation" | "entropy";

export type AnomalousEventType =
  | "whirlpool"
  | "anger"
  | "strobe"
  | "supernova"
  | "blackHole"
  | "lightning";

export type OrbAnomaly = "normal" | "flutter" | "ghost" | "magnetic";

// ─── Spatial Threat Assessment ──────────────────────────────────────────────

/** Snapshot of one horizontal zone — reused each frame, never re-allocated */
export interface ThreatZone {
  count: number;
  fastestSpeed: number;
  lowestETA: number;
}

/** Battlefield overview rebuilt each frame from live orb positions */
export interface ThreatMap {
  /** [far, mid, near, critical] — 4 fixed pre-allocated slots */
  zones: ThreatZone[];
  /** Circle id with the lowest ETA to escape, -1 if field is clear */
  globalMostDangerous: number;
  totalActive: number;
  averageSpeed: number;
}

export interface PlantLearningState {
  pressure: number;
  aggression: number;
  predictionLead: number;
  coordination: number;
  /** Running average of orb speeds — sharpens prediction as the swarm accelerates */
  averageOrbSpeed: number;
  /** Cumulative captures — modulates confidence in intercept trajectories */
  captureCount: number;
  /** Stress-driven reaction multiplier — a cornered organism fights harder */
  reactionBoost: number;
}

export interface PlantTentacle {
  segments: PlantSegment[];
  /** Current target circle id, or null if idle */
  targetId: number | null;
  /** Jaw open angle (0 = closed, 1 = fully open) */
  jawOpen: number;
  /** Target jaw open value for smooth interpolation */
  jawTarget: number;
  /** Hue offset for this tentacle */
  hueOffset: number;
  /** Idle sway phase offset */
  idlePhase: number;
  /** Current tip target for IK solving */
  tipTarget: Vector2D;
  /** Biases target persistence so tentacles feel intentional rather than twitchy */
  commitment: number;
  /** Prevents wasteful target swapping every frame */
  retargetCooldown: number;
  /** Soft reach limit used to adapt behavior under pressure */
  desiredReach: number;
  /** Smoothed tip velocity for anticipatory motion */
  tipVelocity: Vector2D;
  /** Last desired tip target before smoothing */
  lastTipTarget: Vector2D;
  /** Small per-tentacle offset for intentional motion variety */
  noisePhase: number;
  /** Mourning reflex timer — tentacle droops after losing an orb (seconds remaining) */
  mourningTimer: number;
  /** Curiosity lag timer — tentacle follows orb at distance before snapping (seconds remaining) */
  curiosityTimer: number;
  /** Target circle id being inspected during curiosity lag */
  curiosityTarget: number | null;
  /** Invisible drifting point that adds micro-movements (nervous energy / breathing) */
  vanityTarget: Vector2D;
  /** Phase offset for vanity target drift */
  vanityPhase: number;
  /** Shiver intensity — rapid non-functional oscillation (0 = none, 1 = full) */
  shiverIntensity: number;
}

export interface PlantState {
  /** Base anchor point of the plant (left side of screen). Animated each frame. */
  basePosition: Vector2D;
  /** Canonical vertical center; basePosition.y oscillates around this without drifting. */
  anchorY: number;
  /** Desired vertical position the organism is migrating toward */
  targetAnchorY: number;
  /** Smoothed vertical velocity for damped base movement */
  baseVelocityY: number;
  tentacles: PlantTentacle[];
  /** Global time for idle animation */
  time: number;
  /** High-level plant behavior used to blend heuristics smoothly */
  mode: PlantBehaviorMode;
  /** Lightweight adaptive state that evolves over time */
  learning: PlantLearningState;
  /** Spatial threat assessment rebuilt each frame — the organism's "vision" */
  threatMap: ThreatMap;
  /** Current metabolic rhythm — modulates all heuristics on a 2-3 minute cycle */
  metabolicState: MetabolicState;
  /** Timer for metabolic state cycle (seconds since last transition) */
  metabolicTimer: number;
  /** Duration of current metabolic phase before next transition */
  metabolicPhaseDuration: number;
  /** Blend factor 0→1 for transitioning between metabolic states */
  metabolicTransition: number;
  /** Previous metabolic state (for blending) */
  metabolicPrev: MetabolicState;
  /** Hue that the plant is obsessed with during hyperfixation, null otherwise */
  hyperfixationHue: number | null;
  /** Currently active anomalous event, null if none */
  anomalousEvent: AnomalousEventType | null;
  /** Timer for anomalous event duration (seconds remaining) */
  anomalousEventTimer: number;
  /** Cooldown until next anomalous event can trigger */
  anomalousEventCooldown: number;
  /** Anchor point for spatial events (blackHole). Null when not in use. */
  anomalyPosition: Vector2D | null;
  /** Expanding radius used by supernova / anger pulse rings (pixels) */
  anomalyRadius: number;
  /** Sub-event timer used by lightning chains and anger pulses (seconds) */
  anomalySubTimer: number;
  /** Visual chain segments — flat list of points, rendered as a polyline */
  anomalyChain: Vector2D[];
  /** Lifetime of the current chain visual, fades to 0 (seconds) */
  anomalyChainLife: number;
  /** Global chaos factor 0→1 — weights intensity of all anomalous behaviors */
  chaosFactor: number;
  /** Phase for synchronized breathing sway across all tentacles */
  breathPhase: number;
}

// ─── Particle System ────────────────────────────────────────────────────────

export interface Particle {
  position: Vector2D;
  velocity: Vector2D;
  life: number;
  maxLife: number;
  hue: number;
  size: number;
  /** Rotation angle for angular fragment rendering */
  rotation: number;
  /** Whether this particle slot is currently active */
  active: boolean;
}

// ─── Configuration ──────────────────────────────────────────────────────────

export interface SimulationConfig {
  // Canvas
  backgroundColor: string;
  glowIntensity: number;

  // Plant
  plantBaseXRatio: number;
  tentacleCount: number;
  segmentsPerTentacle: number;
  segmentLength: number;
  springStiffness: number;
  springDamping: number;
  jawSize: number;
  tentacleThickness: number;
  idleSwayAmplitude: number;
  idleSwayFrequency: number;

  // Circles
  initialSpawnInterval: number;
  minSpawnInterval: number;
  circleSpeedMin: number;
  circleSpeedMax: number;
  circleRadiusMin: number;
  circleRadiusMax: number;
  oscillationAmplitudeMin: number;
  oscillationAmplitudeMax: number;
  oscillationFrequencyMin: number;
  oscillationFrequencyMax: number;
  maxTrailLength: number;
  circleHues: number[];

  // Particles
  particlesPerBurst: number;
  particleLifeMin: number;
  particleLifeMax: number;
  particleSpeedMin: number;
  particleSpeedMax: number;
  particleSizeMin: number;
  particleSizeMax: number;
  maxParticles: number;

  // Difficulty
  spawnIntervalDecayPerSecond: number;
  speedIncreasePerSecond: number;
  maxCircleSpeed: number;

  // Rendering
  trailAlpha: number;
  plantGlowColor: string;
  backgroundGradientInner: string;
  backgroundGradientOuter: string;
  particleGlowBlur: number;
  useAdditiveParticles: boolean;

  // Survival Intelligence
  /** Integrity restored per successful capture — rewards competence */
  captureRegenAmount: number;
  /** Regen ceiling — early mistakes leave permanent scars */
  regenIntegrityCap: number;
  /** Integrity threshold that triggers the desperation protocol */
  desperationThreshold: number;
  /** ETA (seconds) below which an orb is classified as critical (RED triage) */
  triageRedETA: number;
  /** ETA (seconds) below which an unreachable orb is abandoned (BLACK triage) */
  triageBlackMargin: number;

  // Somatic Mobility
  /** Maximum vertical speed the base can slide along the wall (px/s) */
  baseMoveSpeed: number;
  /** Damping factor for base movement — prevents jitter */
  baseMoveDamping: number;

  // Reach Surge
  /** Maximum temporary reach extension multiplier under critical pressure */
  surgeReachMultiplier: number;

  // Neural Pulse (calculated sacrifice)
  /** Integrity cost of a neural pulse — voluntary sacrifice to prevent worse loss */
  neuralPulseCost: number;
  /** ETA threshold below which a neural pulse is triggered for unreachable orbs */
  neuralPulseETA: number;

  // ─── Stochastic Sentience ──────────────────────────────────────────────

  // Metabolic Rhythms
  /** Minimum duration of a metabolic phase (seconds) */
  metabolicPhaseMin: number;
  /** Maximum duration of a metabolic phase (seconds) */
  metabolicPhaseMax: number;
  /** Blend speed between metabolic states (higher = faster transition) */
  metabolicBlendSpeed: number;

  // Orb Anomalies
  /** Probability that a spawned orb is a flutter orb (0-1) */
  flutterOrbChance: number;
  /** Probability that a spawned orb is a ghost orb (0-1) */
  ghostOrbChance: number;
  /** Probability that a spawned orb is a magnetic orb (0-1) */
  magneticOrbChance: number;
  /** Flutter dodge interval range min (seconds) */
  flutterDodgeIntervalMin: number;
  /** Flutter dodge interval range max (seconds) */
  flutterDodgeIntervalMax: number;
  /** Flutter dodge distance (pixels) */
  flutterDodgeDistance: number;
  /** Ghost orb full fade cycle duration (seconds) */
  ghostCycleDuration: number;
  /** Ghost orb minimum visibility (0 = invisible, 1 = fully visible) */
  ghostMinVisibility: number;
  /** Magnetic orb pull/repel strength */
  magneticStrength: number;
  /** Magnetic orb influence radius (pixels) */
  magneticRadius: number;

  // Psychological Expressions
  /** Duration of mourning droop when an orb escapes (seconds) */
  mourningDuration: number;
  /** Duration of curiosity lag before snapping jaw (seconds) */
  curiosityLagDuration: number;
  /** Distance tentacle follows orb during curiosity lag (pixels) */
  curiosityFollowDistance: number;
  /** Probability of curiosity lag occurring on a capture attempt (0-1) */
  curiosityLagChance: number;
  /** Duration of synchronized shiver from high-speed orbs (seconds) */
  shiverDuration: number;
  /** Speed threshold to trigger synchronized shiver */
  shiverSpeedThreshold: number;

  // Stochastic Mutations
  /** Cooldown between anomalous events (seconds) */
  anomalousEventCooldown: number;
  /** Duration of each anomalous event (seconds) */
  anomalousEventDuration: number;
  /** Whirlpool rotation speed (radians/second) */
  whirlpoolSpeed: number;
  /** Whirlpool capture radius — orbs inside are pulled toward the base (pixels) */
  whirlpoolRadius: number;
  /** Whirlpool inward pull speed (px/s at the outer ring) */
  whirlpoolPullSpeed: number;
  /** Whirlpool consume radius — orbs reaching this distance from base are devoured */
  whirlpoolCoreRadius: number;
  /** Anger AoE max radius (pixels) — pulse expands to this size */
  angerRadius: number;
  /** Anger pulse interval — seconds between expanding shockwaves */
  angerPulseInterval: number;
  /** Supernova shell expansion speed (px/s) */
  supernovaSpeed: number;
  /** Supernova maximum radius before fading (pixels) */
  supernovaMaxRadius: number;
  /** Black hole capture radius — orbs inside this range are pulled in (pixels) */
  blackHoleRadius: number;
  /** Black hole pull strength (px/s² at the edge) */
  blackHolePullStrength: number;
  /** Black hole consume radius — orbs reaching this distance are devoured */
  blackHoleCoreRadius: number;
  /** Lightning chain trigger interval (seconds) */
  lightningInterval: number;
  /** Lightning chain max links per strike */
  lightningChainCount: number;
  /** Lightning maximum jump distance between orbs (pixels) */
  lightningJumpRadius: number;

  // Adaptive Randomness
  /** Probability of picking a random/wrong target instead of optimal (0-1) */
  randomTargetChance: number;
  /** Speed wave: duration of acceleration phase (seconds) */
  speedWaveRiseDuration: number;
  /** Speed wave: duration of calm phase (seconds) */
  speedWaveCalmDuration: number;
  /** Speed wave: multiplier during calm phase (0-1) */
  speedWaveCalmMultiplier: number;
  /** Speed wave: multiplier during spike phase (>1) */
  speedWaveSpikeMultiplier: number;
}

// ─── Engine State ───────────────────────────────────────────────────────────

export interface SimulationState {
  circles: Circle[];
  plant: PlantState;
  particles: Particle[];
  elapsedTime: number;
  score: number;
  integrity: number;
  damageFlash: number;
  isCollapsing: boolean;
  collapseProgress: number;
  collapseElapsed: number;
  collapseComplete: boolean;
  currentSpawnInterval: number;
  currentSpeedBonus: number;
  timeSinceLastSpawn: number;
  nextCircleId: number;
  canvasWidth: number;
  canvasHeight: number;
  /** Speed wave phase for velocity breath system */
  speedWavePhase: number;
  /** Current speed wave multiplier applied to speed bonus */
  speedWaveMultiplier: number;
  /** Set of circle ids that escaped this frame (for mourning reflex) */
  escapedCircleIds: number[];
}
