import { Circle, OrbAnomaly, SimulationConfig, Vector2D } from "@/types/simulation";
import { randomRange, randomPick } from "@/utils/math";

/**
 * CircleSpawner — manages creation of circle entities from the right edge.
 * Handles difficulty scaling, anomalous orb types, and velocity breath waves.
 */
export class CircleSpawner {
  private config: SimulationConfig;

  constructor(config: SimulationConfig) {
    this.config = config;
  }

  /**
   * Create a new circle at the right edge of the screen.
   * May assign an anomaly type based on config probabilities.
   */
  spawn(
    canvasWidth: number,
    canvasHeight: number,
    nextId: number,
    speedBonus: number
  ): Circle {
    const cfg = this.config;
    const radius = randomRange(cfg.circleRadiusMin, cfg.circleRadiusMax);
    const y = randomRange(radius + 40, canvasHeight - radius - 40);
    const speed =
      randomRange(cfg.circleSpeedMin, cfg.circleSpeedMax) + speedBonus;

    const anomaly = this.rollAnomaly();

    return {
      id: nextId,
      position: { x: canvasWidth + radius, y },
      velocity: { x: -speed, y: 0 },
      radius,
      baseY: y,
      oscillationAmplitude: randomRange(
        cfg.oscillationAmplitudeMin,
        cfg.oscillationAmplitudeMax
      ),
      oscillationFrequency: randomRange(
        cfg.oscillationFrequencyMin,
        cfg.oscillationFrequencyMax
      ),
      oscillationPhase: randomRange(0, Math.PI * 2),
      elapsedTime: 0,
      hue: randomPick(cfg.circleHues),
      trail: [],
      consumed: false,
      targeted: false,
      anomaly,
      ghostPhase: 0,
      magneticStrength: anomaly === "magnetic"
        ? cfg.magneticStrength * (Math.random() > 0.5 ? 1 : -1)
        : 0,
      flutterTimer: randomRange(cfg.flutterDodgeIntervalMin, cfg.flutterDodgeIntervalMax),
      flutterTargetY: NaN,
      visible: true,
      lastKnownPosition: null,
    };
  }

  /**
   * Roll for an anomaly type based on config probabilities.
   */
  private rollAnomaly(): OrbAnomaly {
    const cfg = this.config;
    const roll = Math.random();
    const ghostCutoff = cfg.ghostOrbChance;
    const flutterCutoff = ghostCutoff + cfg.flutterOrbChance;
    const magneticCutoff = flutterCutoff + cfg.magneticOrbChance;

    if (roll < ghostCutoff) return "ghost";
    if (roll < flutterCutoff) return "flutter";
    if (roll < magneticCutoff) return "magnetic";
    return "normal";
  }

  /**
   * Calculate the current spawn interval based on elapsed time.
   */
  getCurrentSpawnInterval(elapsedTime: number): number {
    const decay = elapsedTime * this.config.spawnIntervalDecayPerSecond;
    return Math.max(
      this.config.minSpawnInterval,
      this.config.initialSpawnInterval - decay
    );
  }

  /**
   * Calculate the current speed bonus based on elapsed time,
   * modulated by the velocity breath wave multiplier.
   */
  getCurrentSpeedBonus(elapsedTime: number, waveMultiplier: number): number {
    return Math.min(
      this.config.maxCircleSpeed - this.config.circleSpeedMax,
      elapsedTime * this.config.speedIncreasePerSecond
    ) * waveMultiplier;
  }

  /**
   * Update the speed wave phase and return current multiplier.
   * Wave system: rise for N seconds, calm for M seconds, then spike.
   */
  updateSpeedWave(phase: number, dt: number): { phase: number; multiplier: number } {
    const cfg = this.config;
    const fullCycle = cfg.speedWaveRiseDuration + cfg.speedWaveCalmDuration;
    const newPhase = (phase + dt) % fullCycle;

    if (newPhase < cfg.speedWaveRiseDuration) {
      // Rising phase — gradually ramp from calm back to 1.0 then spike
      const t = newPhase / cfg.speedWaveRiseDuration;
      // Ease from calm multiplier up to spike
      const multiplier = cfg.speedWaveCalmMultiplier +
        (cfg.speedWaveSpikeMultiplier - cfg.speedWaveCalmMultiplier) * t;
      return { phase: newPhase, multiplier };
    } else {
      // Calm phase — speed drops
      const calmT = (newPhase - cfg.speedWaveRiseDuration) / cfg.speedWaveCalmDuration;
      // Ease from spike down to calm
      const multiplier = cfg.speedWaveSpikeMultiplier +
        (cfg.speedWaveCalmMultiplier - cfg.speedWaveSpikeMultiplier) * calmT;
      return { phase: newPhase, multiplier };
    }
  }

  /**
   * Update a circle's position for one frame, including anomaly behaviors.
   */
  updateCircle(circle: Circle, dt: number): void {
    circle.elapsedTime += dt;

    // Store trail position before moving
    circle.trail.push({ x: circle.position.x, y: circle.position.y });
    if (circle.trail.length > this.config.maxTrailLength) {
      circle.trail.shift();
    }

    // Move horizontally
    circle.position.x += circle.velocity.x * dt;

    // Oscillate vertically (sine wave around baseY)
    circle.baseY += circle.velocity.y * dt;
    circle.position.y =
      circle.baseY +
      circle.oscillationAmplitude *
        Math.sin(
          circle.elapsedTime * circle.oscillationFrequency +
            circle.oscillationPhase
        );

    // ── Anomaly-specific updates ──────────────────────────────────────

    if (circle.anomaly === "flutter") {
      this.updateFlutter(circle, dt);
    }

    if (circle.anomaly === "ghost") {
      this.updateGhost(circle, dt);
    }

    // Magnetic is handled in PlantController (needs tentacle tip positions)
  }

  /**
   * Flutter orbs: occasionally dodge vertically as if trying to evade tentacles.
   */
  private updateFlutter(circle: Circle, dt: number): void {
    circle.flutterTimer -= dt;

    if (circle.flutterTimer <= 0) {
      // Initiate a dodge maneuver — shift baseY abruptly
      const dodgeDir = Math.random() > 0.5 ? 1 : -1;
      circle.flutterTargetY = circle.baseY + dodgeDir * this.config.flutterDodgeDistance;
      circle.flutterTimer = randomRange(
        this.config.flutterDodgeIntervalMin,
        this.config.flutterDodgeIntervalMax
      );
    }

    // Smoothly dodge toward target Y
    if (!isNaN(circle.flutterTargetY)) {
      const dy = circle.flutterTargetY - circle.baseY;
      circle.baseY += dy * dt * 3; // Quick dodge
      if (Math.abs(dy) < 2) {
        circle.flutterTargetY = NaN;
      }
    }
  }

  /**
   * Ghost orbs: fade in and out of existence.
   * The orb oscillates between visible and invisible.
   */
  private updateGhost(circle: Circle, dt: number): void {
    const cycle = this.config.ghostCycleDuration;
    // Sinusoidal fade: 0 = fully visible, 1 = nearly invisible
    circle.ghostPhase = (circle.ghostPhase + dt / cycle * Math.PI * 2) % (Math.PI * 2);
    const fade = (1 - Math.cos(circle.ghostPhase)) * 0.5; // 0→1→0

    const minVis = this.config.ghostMinVisibility;
    circle.visible = fade < (1 - minVis);

    // Store last known position when visible (for predictive memory)
    if (circle.visible) {
      circle.lastKnownPosition = { x: circle.position.x, y: circle.position.y };
    }
  }

  /**
   * Apply magnetic influence to a circle from nearby tentacle tips.
   * Called from PlantController with tentacle tip positions.
   */
  applyMagneticInfluence(circle: Circle, tentacleTips: Vector2D[], dt: number): void {
    if (circle.anomaly !== "magnetic") return;

    const cfg = this.config;
    let totalForceX = 0;
    let totalForceY = 0;

    for (const tip of tentacleTips) {
      const dx = circle.position.x - tip.x;
      const dy = circle.position.y - tip.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;

      if (dist < cfg.magneticRadius) {
        // Attract if magneticStrength < 0, repel if > 0
        const influence = circle.magneticStrength * (1 - dist / cfg.magneticRadius) / dist;
        totalForceX += dx * influence;
        totalForceY += dy * influence;
      }
    }

    circle.position.x += totalForceX * dt;
    circle.position.y += totalForceY * dt;
    circle.baseY += totalForceY * dt;
  }

  /**
   * Predict where a circle will be at a future time.
   * For ghost orbs, if currently invisible, predicts from last known position.
   */
  predictCirclePosition(circle: Circle, futureTime: number): Vector2D {
    const futureElapsed = circle.elapsedTime + futureTime;
    return {
      x: circle.position.x + circle.velocity.x * futureTime,
      y:
        circle.baseY +
        circle.oscillationAmplitude *
          Math.sin(
            futureElapsed * circle.oscillationFrequency +
              circle.oscillationPhase
          ),
    };
  }
}
