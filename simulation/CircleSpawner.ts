import { Circle, SimulationConfig, Vector2D } from "@/types/simulation";
import { randomRange, randomPick } from "@/utils/math";

/**
 * CircleSpawner — manages creation of circle entities from the right edge.
 * Handles difficulty scaling (decreasing spawn interval, increasing speed).
 */
export class CircleSpawner {
  private config: SimulationConfig;

  constructor(config: SimulationConfig) {
    this.config = config;
  }

  /**
   * Create a new circle at the right edge of the screen.
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
    };
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
   * Calculate the current speed bonus based on elapsed time.
   */
  getCurrentSpeedBonus(elapsedTime: number): number {
    return Math.min(
      this.config.maxCircleSpeed - this.config.circleSpeedMax,
      elapsedTime * this.config.speedIncreasePerSecond
    );
  }

  /**
   * Update a circle's position for one frame.
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
  }

  /**
   * Predict where a circle will be at a future time.
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
