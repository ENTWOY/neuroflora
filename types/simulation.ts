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
}

// ─── Plant Structures ───────────────────────────────────────────────────────

export interface PlantSegment {
  position: Vector2D;
  angle: number;
  length: number;
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
}

export interface PlantState {
  /** Base anchor point of the plant (left side of screen) */
  basePosition: Vector2D;
  tentacles: PlantTentacle[];
  /** Global time for idle animation */
  time: number;
}

// ─── Particle System ────────────────────────────────────────────────────────

export interface Particle {
  position: Vector2D;
  velocity: Vector2D;
  life: number;
  maxLife: number;
  hue: number;
  size: number;
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
}

// ─── Engine State ───────────────────────────────────────────────────────────

export interface SimulationState {
  circles: Circle[];
  plant: PlantState;
  particles: Particle[];
  elapsedTime: number;
  score: number;
  currentSpawnInterval: number;
  currentSpeedBonus: number;
  timeSinceLastSpawn: number;
  nextCircleId: number;
  canvasWidth: number;
  canvasHeight: number;
}
