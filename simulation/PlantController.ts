import {
  PlantState,
  PlantTentacle,
  PlantSegment,
  SimulationConfig,
  Circle,
  Vector2D,
} from "@/types/simulation";
import { sub, normalize, scale, add, distance } from "@/utils/vector";
import { layeredSine, lerpScalar, clamp } from "@/utils/math";

/**
 * PlantController — manages the procedurally animated plant creature.
 * Uses FABRIK inverse kinematics for tentacle movement with predictive targeting.
 */
export class PlantController {
  private config: SimulationConfig;

  constructor(config: SimulationConfig) {
    this.config = config;
  }

  /**
   * Create initial plant state.
   */
  createPlant(canvasWidth: number, canvasHeight: number): PlantState {
    const cfg = this.config;
    const baseX = canvasWidth * cfg.plantBaseXRatio;
    const baseY = canvasHeight * 0.5;
    const tentacles: PlantTentacle[] = [];

    for (let i = 0; i < cfg.tentacleCount; i++) {
      const segments: PlantSegment[] = [];
      // Spread tentacles in a fan from the base
      const fanAngle =
        -Math.PI * 0.3 +
        (Math.PI * 0.6 * i) / Math.max(1, cfg.tentacleCount - 1);

      for (let j = 0; j < cfg.segmentsPerTentacle; j++) {
        segments.push({
          position: {
            x: baseX + Math.cos(fanAngle) * cfg.segmentLength * j,
            y: baseY + Math.sin(fanAngle) * cfg.segmentLength * j,
          },
          angle: fanAngle,
          length: cfg.segmentLength,
        });
      }

      tentacles.push({
        segments,
        targetId: null,
        jawOpen: 0,
        jawTarget: 0,
        hueOffset: (i / cfg.tentacleCount) * 30,
        idlePhase: (i / cfg.tentacleCount) * Math.PI * 2,
        tipTarget: {
          x: baseX + Math.cos(fanAngle) * cfg.segmentLength * cfg.segmentsPerTentacle,
          y: baseY + Math.sin(fanAngle) * cfg.segmentLength * cfg.segmentsPerTentacle,
        },
      });
    }

    return {
      basePosition: { x: baseX, y: baseY },
      tentacles,
      time: 0,
    };
  }

  /**
   * Update plant state for one frame.
   */
  update(
    plant: PlantState,
    circles: Circle[],
    dt: number,
    canvasHeight: number,
    predictCirclePosition: (circle: Circle, time: number) => Vector2D
  ): void {
    plant.time += dt;

    // Gentle base sway
    plant.basePosition.y +=
      layeredSine(plant.time * 0.3, 0) * 0.3;

    // Update each tentacle
    for (const tentacle of plant.tentacles) {
      this.updateTentacle(
        tentacle,
        plant,
        circles,
        dt,
        canvasHeight,
        predictCirclePosition
      );
    }
  }

  private updateTentacle(
    tentacle: PlantTentacle,
    plant: PlantState,
    circles: Circle[],
    dt: number,
    canvasHeight: number,
    predictCirclePosition: (circle: Circle, time: number) => Vector2D
  ): void {
    const cfg = this.config;

    // Find or validate target
    this.assignTarget(tentacle, plant, circles);

    // Determine tip target
    if (tentacle.targetId !== null) {
      const target = circles.find(
        (c) => c.id === tentacle.targetId && !c.consumed
      );
      if (target) {
        // Predict interception point
        const tipPos =
          tentacle.segments[tentacle.segments.length - 1].position;
        const distToTarget = distance(tipPos, target.position);
        const interceptTime = distToTarget / 400; // estimated reach speed
        const predicted = predictCirclePosition(target, interceptTime);

        // Clamp predicted position to screen bounds
        predicted.y = clamp(predicted.y, 30, canvasHeight - 30);

        tentacle.tipTarget = predicted;
        tentacle.jawTarget = 1; // open jaw while reaching
      } else {
        // Target was consumed or lost
        tentacle.targetId = null;
      }
    }

    if (tentacle.targetId === null) {
      // Idle sway animation
      const idleAngle =
        -Math.PI * 0.3 +
        (Math.PI * 0.6 *
          plant.tentacles.indexOf(tentacle)) /
          Math.max(1, cfg.tentacleCount - 1);

      const swayX =
        cfg.idleSwayAmplitude *
        layeredSine(plant.time * cfg.idleSwayFrequency, tentacle.idlePhase);
      const swayY =
        cfg.idleSwayAmplitude *
        0.6 *
        layeredSine(
          plant.time * cfg.idleSwayFrequency * 0.7,
          tentacle.idlePhase + 1.5
        );

      const idleReach = cfg.segmentLength * cfg.segmentsPerTentacle * 0.6;
      tentacle.tipTarget = {
        x: plant.basePosition.x + Math.cos(idleAngle) * idleReach + swayX,
        y: plant.basePosition.y + Math.sin(idleAngle) * idleReach + swayY,
      };
      tentacle.jawTarget = 0; // close jaw when idle
    }

    // Smooth jaw interpolation
    tentacle.jawOpen = lerpScalar(tentacle.jawOpen, tentacle.jawTarget, dt * 8);

    // Solve IK (FABRIK)
    this.solveFABRIK(tentacle, plant.basePosition);
  }

  /**
   * Assign a target circle to this tentacle if it doesn't have one.
   */
  private assignTarget(
    tentacle: PlantTentacle,
    plant: PlantState,
    circles: Circle[]
  ): void {
    // If already targeting a valid circle, keep it
    if (tentacle.targetId !== null) {
      const existing = circles.find(
        (c) => c.id === tentacle.targetId && !c.consumed
      );
      if (existing) return;
      tentacle.targetId = null;
    }

    // Find nearest un-targeted circle
    const tipPos = tentacle.segments[tentacle.segments.length - 1].position;
    let bestCircle: Circle | null = null;
    let bestScore = Infinity;

    for (const circle of circles) {
      if (circle.consumed || circle.targeted) continue;

      // Score = distance, but prioritize circles closer to left edge (more urgent)
      const dist = distance(tipPos, circle.position);
      const urgency = 1 - circle.position.x / 1000; // higher urgency = closer to left
      const score = dist - urgency * 200;

      if (score < bestScore) {
        bestScore = score;
        bestCircle = circle;
      }
    }

    if (bestCircle) {
      tentacle.targetId = bestCircle.id;
      bestCircle.targeted = true;
    }
  }

  /**
   * FABRIK (Forward And Backward Reaching Inverse Kinematics) solver.
   * Produces natural, organic-looking joint chains.
   */
  private solveFABRIK(tentacle: PlantTentacle, basePos: Vector2D): void {
    const segments = tentacle.segments;
    const target = tentacle.tipTarget;
    const iterations = 3;

    for (let iter = 0; iter < iterations; iter++) {
      // Forward pass: from tip to base
      segments[segments.length - 1].position = { ...target };
      for (let i = segments.length - 2; i >= 0; i--) {
        const dir = sub(segments[i].position, segments[i + 1].position);
        const dirNorm = normalize(dir);
        segments[i].position = add(
          segments[i + 1].position,
          scale(dirNorm, segments[i].length)
        );
      }

      // Backward pass: from base to tip
      segments[0].position = { ...basePos };
      for (let i = 1; i < segments.length; i++) {
        const dir = sub(segments[i].position, segments[i - 1].position);
        const dirNorm = normalize(dir);
        segments[i].position = add(
          segments[i - 1].position,
          scale(dirNorm, segments[i - 1].length)
        );
      }
    }

    // Update angles
    for (let i = 0; i < segments.length - 1; i++) {
      const dir = sub(segments[i + 1].position, segments[i].position);
      segments[i].angle = Math.atan2(dir.y, dir.x);
    }
    if (segments.length > 1) {
      segments[segments.length - 1].angle =
        segments[segments.length - 2].angle;
    }
  }

  /**
   * Get the tip position and angle of a tentacle.
   */
  getTip(tentacle: PlantTentacle): { position: Vector2D; angle: number } {
    const last = tentacle.segments[tentacle.segments.length - 1];
    return { position: last.position, angle: last.angle };
  }
}
