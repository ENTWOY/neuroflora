import {
  PlantState,
  PlantTentacle,
  PlantSegment,
  SimulationConfig,
  Circle,
  Vector2D,
  PlantBehaviorMode,
} from "@/types/simulation";
import { sub, normalize, scale, add, distance } from "@/utils/vector";
import { layeredSine, lerpScalar, clamp } from "@/utils/math";

/**
 * PlantController — manages the procedurally animated plant creature.
 * Uses FABRIK inverse kinematics with lightweight behavioral heuristics
 * for predictive targeting, adaptation, and tentacle coordination.
 */
export class PlantController {
  private static readonly MAX_RETARGET_COOLDOWN = 0.16;
  private static readonly RETARGET_THRESHOLD = 0.55;
  private static readonly MIN_LEAD_TIME = 0.06;
  private static readonly MAX_LEAD_TIME = 0.52;

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
    const maxReach = cfg.segmentLength * cfg.segmentsPerTentacle;
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

      const tipX =
        baseX + Math.cos(fanAngle) * cfg.segmentLength * cfg.segmentsPerTentacle;
      const tipY =
        baseY + Math.sin(fanAngle) * cfg.segmentLength * cfg.segmentsPerTentacle;

      tentacles.push({
        segments,
        targetId: null,
        jawOpen: 0,
        jawTarget: 0,
        hueOffset: (i / cfg.tentacleCount) * 30,
        idlePhase: (i / cfg.tentacleCount) * Math.PI * 2,
        tipTarget: {
          x: tipX,
          y: tipY,
        },
        commitment: 0,
        retargetCooldown: 0,
        desiredReach: maxReach * 0.82,
        tipVelocity: { x: 0, y: 0 },
        lastTipTarget: { x: tipX, y: tipY },
        noisePhase: 1.37 * i,
      });
    }

    return {
      basePosition: { x: baseX, y: baseY },
      anchorY: baseY,
      tentacles,
      time: 0,
      mode: "idle",
      learning: {
        pressure: 0,
        aggression: 0.35,
        predictionLead: 0.9,
        coordination: 1,
      },
    };
  }

  /**
   * Update plant state for one frame.
   */
  update(
    plant: PlantState,
    circles: Circle[],
    dt: number,
    canvasWidth: number,
    canvasHeight: number,
    integrity: number,
    predictCirclePosition: (circle: Circle, time: number) => Vector2D
  ): void {
    plant.time += dt;

    // Gentle base sway — derived from a stable anchor so the position never
    // drifts and is independent of frame rate. anchorY is set on
    // create/resize and represents the canonical vertical center.
    plant.basePosition.y =
      plant.anchorY + layeredSine(plant.time * 0.3, 0) * 4;

    // Claims are rebuilt each frame so tentacles can re-coordinate as threats change.
    for (let i = 0; i < circles.length; i++) {
      circles[i].targeted = false;
    }

    this.updateBehaviorState(plant, circles, dt, canvasWidth, integrity);

    // Update each tentacle
    for (let i = 0; i < plant.tentacles.length; i++) {
      const tentacle = plant.tentacles[i];
      this.updateTentacle(
        tentacle,
        i,
        plant,
        circles,
        dt,
        canvasWidth,
        canvasHeight,
        predictCirclePosition
      );
    }
  }

  private updateBehaviorState(
    plant: PlantState,
    circles: Circle[],
    dt: number,
    canvasWidth: number,
    integrity: number
  ): void {
    let activeCount = 0;
    let maxUrgency = 0;
    let maxSpeedThreat = 0;

    for (let i = 0; i < circles.length; i++) {
      const circle = circles[i];
      if (circle.consumed) continue;

      activeCount++;
      const urgency = clamp(1 - circle.position.x / Math.max(canvasWidth, 1), 0, 1);
      const speedThreat = clamp(
        Math.abs(circle.velocity.x) / this.config.maxCircleSpeed,
        0,
        1
      );

      if (urgency > maxUrgency) maxUrgency = urgency;
      if (speedThreat > maxSpeedThreat) maxSpeedThreat = speedThreat;
    }

    const stress = clamp(1 - integrity / 100, 0, 1);
    const rawPressure = clamp(
      activeCount * 0.12 + maxUrgency * 0.55 + maxSpeedThreat * 0.2 + stress * 0.65,
      0,
      1
    );

    // EMA-style blending creates lightweight adaptation without heavy state.
    plant.learning.pressure = lerpScalar(plant.learning.pressure, rawPressure, dt * 1.8);
    plant.learning.aggression = lerpScalar(
      plant.learning.aggression,
      clamp(0.35 + rawPressure * 0.8 + stress * 0.4, 0.25, 1.25),
      dt * 0.9
    );
    plant.learning.predictionLead = lerpScalar(
      plant.learning.predictionLead,
      clamp(0.88 + rawPressure * 0.28 + stress * 0.12, 0.82, 1.22),
      dt * 0.7
    );
    plant.learning.coordination = lerpScalar(
      plant.learning.coordination,
      clamp(1 - rawPressure * 0.35, 0.58, 1),
      dt * 0.8
    );

    plant.mode = this.getMode(plant.learning.pressure, stress);
  }

  private getMode(pressure: number, stress: number): PlantBehaviorMode {
    if (pressure < 0.22) return "idle";
    if (stress > 0.45 || pressure > 0.72) return "defensive";
    return "hunting";
  }

  private updateTentacle(
    tentacle: PlantTentacle,
    tentacleIndex: number,
    plant: PlantState,
    circles: Circle[],
    dt: number,
    canvasWidth: number,
    canvasHeight: number,
    predictCirclePosition: (circle: Circle, time: number) => Vector2D
  ): void {
    const cfg = this.config;
    const maxReach = cfg.segmentLength * cfg.segmentsPerTentacle;

    tentacle.retargetCooldown = Math.max(0, tentacle.retargetCooldown - dt);

    const reachBias =
      plant.mode === "idle"
        ? 0.72
        : plant.mode === "defensive"
          ? 0.9
          : 0.98 + plant.learning.aggression * 0.06;

    tentacle.desiredReach = lerpScalar(
      tentacle.desiredReach,
      maxReach * reachBias,
      dt * 3.2
    );

    const target = this.assignTarget(
      tentacle,
      tentacleIndex,
      plant,
      circles,
      canvasWidth,
      canvasHeight,
      predictCirclePosition
    );

    if (target) {
      const tipPos = tentacle.segments[tentacle.segments.length - 1].position;
      const reachSpeed = 340 + plant.learning.aggression * 120;
      const interceptTime =
        clamp(
          distance(tipPos, target.position) / reachSpeed,
          PlantController.MIN_LEAD_TIME,
          PlantController.MAX_LEAD_TIME
        ) * plant.learning.predictionLead;

      const predicted = predictCirclePosition(target, interceptTime);
      const intentNoise =
        layeredSine(plant.time * 0.9, tentacle.noisePhase) *
        4 *
        (1 - plant.learning.pressure);

      let desiredX = predicted.x + intentNoise * 0.35;
      let desiredY = clamp(predicted.y + intentNoise, 30, canvasHeight - 30);

      // A soft lane preference keeps tentacles from piling onto the same vertical corridor.
      const laneY = this.getLaneY(tentacleIndex, plant.tentacles.length, canvasHeight);
      desiredY = lerpScalar(
        desiredY,
        laneY,
        (1 - plant.learning.coordination) * 0.15
      );

      const dx = desiredX - plant.basePosition.x;
      const dy = desiredY - plant.basePosition.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const reachScale = dist > tentacle.desiredReach ? tentacle.desiredReach / dist : 1;

      desiredX = plant.basePosition.x + dx * reachScale;
      desiredY = plant.basePosition.y + dy * reachScale;

      tentacle.jawTarget = plant.mode === "defensive" ? 1 : 0.9;
      tentacle.commitment = lerpScalar(tentacle.commitment, 1, dt * 4.5);

      this.smoothTipTarget(
        tentacle,
        desiredX,
        desiredY,
        dt,
        11 + plant.learning.aggression * 4
      );
    } else {
      const idleTarget = this.getIdleTarget(
        tentacle,
        tentacleIndex,
        plant,
        canvasHeight
      );

      tentacle.jawTarget = 0;
      tentacle.commitment = lerpScalar(tentacle.commitment, 0, dt * 3.5);

      this.smoothTipTarget(
        tentacle,
        idleTarget.x,
        idleTarget.y,
        dt,
        4.5
      );
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
    tentacleIndex: number,
    plant: PlantState,
    circles: Circle[],
    canvasWidth: number,
    canvasHeight: number,
    predictCirclePosition: (circle: Circle, time: number) => Vector2D
  ): Circle | null {
    let currentCircle: Circle | null = null;
    let currentScore = -Infinity;

    if (tentacle.targetId !== null) {
      for (let i = 0; i < circles.length; i++) {
        const circle = circles[i];
        if (circle.id === tentacle.targetId && !circle.consumed) {
          currentCircle = circle;
          currentScore =
            this.evaluateTarget(
              tentacle,
              tentacleIndex,
              plant,
              circle,
              canvasWidth,
              canvasHeight,
              predictCirclePosition
            ) +
            0.9 +
            tentacle.commitment * 0.8;
          break;
        }
      }

      if (!currentCircle) {
        tentacle.targetId = null;
      }
    }

    let bestCircle = currentCircle;
    let bestScore = currentScore;

    for (let i = 0; i < circles.length; i++) {
      const circle = circles[i];
      if (circle.consumed) continue;
      if (circle.targeted && circle.id !== tentacle.targetId) continue;

      const score = this.evaluateTarget(
        tentacle,
        tentacleIndex,
        plant,
        circle,
        canvasWidth,
        canvasHeight,
        predictCirclePosition
      );

      if (score > bestScore) {
        bestScore = score;
        bestCircle = circle;
      }
    }

    if (!bestCircle) {
      tentacle.targetId = null;
      return null;
    }

    const switching =
      tentacle.targetId !== null && bestCircle.id !== tentacle.targetId;

    if (
      switching &&
      currentCircle &&
      tentacle.retargetCooldown > 0 &&
      bestScore < currentScore + PlantController.RETARGET_THRESHOLD
    ) {
      currentCircle.targeted = true;
      return currentCircle;
    }

    if (switching) {
      tentacle.retargetCooldown = PlantController.MAX_RETARGET_COOLDOWN;
    }

    tentacle.targetId = bestCircle.id;
    bestCircle.targeted = true;
    return bestCircle;
  }

  private evaluateTarget(
    tentacle: PlantTentacle,
    tentacleIndex: number,
    plant: PlantState,
    circle: Circle,
    canvasWidth: number,
    canvasHeight: number,
    predictCirclePosition: (circle: Circle, time: number) => Vector2D
  ): number {
    const tipPos = tentacle.segments[tentacle.segments.length - 1].position;
    const maxReach = this.config.segmentLength * this.config.segmentsPerTentacle;
    const urgency = clamp(
      1 - (circle.position.x - plant.basePosition.x) / Math.max(120, canvasWidth - plant.basePosition.x),
      0,
      1
    );
    const speedThreat = clamp(
      Math.abs(circle.velocity.x) / this.config.maxCircleSpeed,
      0,
      1
    );
    const etaToBase = Math.max(
      0.05,
      (circle.position.x - plant.basePosition.x) /
        Math.max(20, -circle.velocity.x)
    );

    const reachSpeed = 340 + plant.learning.aggression * 120;
    const interceptTime =
      clamp(
        distance(tipPos, circle.position) / reachSpeed,
        PlantController.MIN_LEAD_TIME,
        PlantController.MAX_LEAD_TIME
      ) * plant.learning.predictionLead;

    const predicted = predictCirclePosition(circle, interceptTime);
    const interceptDist = distance(tipPos, predicted);
    const reachScore = 1 - clamp(interceptDist / Math.max(maxReach, 1), 0, 1);

    const laneY = this.getLaneY(tentacleIndex, plant.tentacles.length, canvasHeight);
    const lanePenalty =
      Math.abs(predicted.y - laneY) / Math.max(canvasHeight, 1);

    const trajectoryStability =
      1 -
      clamp(Math.abs(predicted.y - circle.position.y) / 140, 0, 1);

    let score =
      urgency * (plant.mode === "defensive" ? 3.4 : 2.4) +
      (1 / (1 + etaToBase)) * 1.6 +
      reachScore * (plant.mode === "hunting" ? 2.8 : 1.8) +
      speedThreat * 1.3 +
      trajectoryStability * 0.6 -
      lanePenalty * plant.learning.coordination * 1.1;

    if (circle.id === tentacle.targetId) {
      score += 0.65 + tentacle.commitment * 0.75;
    }

    if (circle.targeted && circle.id !== tentacle.targetId) {
      score -= 1.25;
    }

    if (plant.mode === "idle") {
      score *= 0.55;
    }

    return score;
  }

  private getLaneY(
    tentacleIndex: number,
    tentacleCount: number,
    canvasHeight: number
  ): number {
    const top = canvasHeight * 0.2;
    const bottom = canvasHeight * 0.8;
    const t = tentacleIndex / Math.max(1, tentacleCount - 1);
    return lerpScalar(top, bottom, t);
  }

  private getIdleTarget(
    tentacle: PlantTentacle,
    tentacleIndex: number,
    plant: PlantState,
    canvasHeight: number
  ): Vector2D {
    const cfg = this.config;
    const idleAngle =
      -Math.PI * 0.3 +
      (Math.PI * 0.6 * tentacleIndex) / Math.max(1, cfg.tentacleCount - 1);

    const calmness = 1 - plant.learning.pressure;
    const idleReach =
      cfg.segmentLength * cfg.segmentsPerTentacle * (0.48 + calmness * 0.16);

    const swayX =
      cfg.idleSwayAmplitude *
      0.35 *
      layeredSine(plant.time * cfg.idleSwayFrequency, tentacle.idlePhase);
    const swayY =
      cfg.idleSwayAmplitude *
      0.28 *
      layeredSine(
        plant.time * cfg.idleSwayFrequency * 0.7,
        tentacle.idlePhase + tentacle.noisePhase
      );

    return {
      x: plant.basePosition.x + Math.cos(idleAngle) * idleReach + swayX,
      y: clamp(
        plant.basePosition.y + Math.sin(idleAngle) * idleReach + swayY,
        40,
        canvasHeight - 40
      ),
    };
  }

  private smoothTipTarget(
    tentacle: PlantTentacle,
    desiredX: number,
    desiredY: number,
    dt: number,
    responsiveness: number
  ): void {
    const safeDt = Math.max(dt, 0.001);
    const rawVX = (desiredX - tentacle.lastTipTarget.x) / safeDt;
    const rawVY = (desiredY - tentacle.lastTipTarget.y) / safeDt;

    tentacle.tipVelocity.x = lerpScalar(tentacle.tipVelocity.x, rawVX, dt * 10);
    tentacle.tipVelocity.y = lerpScalar(tentacle.tipVelocity.y, rawVY, dt * 10);

    // A small anticipation term improves interception without making motion snappy.
    const anticipation = 0.018 + tentacle.commitment * 0.028;
    const anticipatedX = desiredX + tentacle.tipVelocity.x * anticipation;
    const anticipatedY = desiredY + tentacle.tipVelocity.y * anticipation;
    const blend = 1 - Math.exp(-responsiveness * dt);

    tentacle.tipTarget.x = lerpScalar(tentacle.tipTarget.x, anticipatedX, blend);
    tentacle.tipTarget.y = lerpScalar(tentacle.tipTarget.y, anticipatedY, blend);
    tentacle.lastTipTarget.x = desiredX;
    tentacle.lastTipTarget.y = desiredY;
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
