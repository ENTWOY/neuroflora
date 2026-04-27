import {
  PlantState,
  PlantTentacle,
  PlantSegment,
  SimulationConfig,
  Circle,
  Vector2D,
  PlantBehaviorMode,
  ThreatMap,
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

  // Survival intelligence thresholds
  private static readonly ESCAPE_X = -50;
  private static readonly DESPERATION_REACH_BIAS = 1.0;
  private static readonly DESPERATION_COOLDOWN = 0.04;
  private static readonly DESPERATION_RESPONSIVENESS = 6;
  private static readonly BLACK_TRIAGE_SCORE = -1000;
  private static readonly SPEED_EMA_RATE = 0.5;
  private static readonly REACTION_BOOST_MAX = 5;
  private static readonly PREEMPTIVE_JAW_DIST_RATIO = 2.2;

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
        averageOrbSpeed: 150,
        captureCount: 0,
        reactionBoost: 0,
      },
      threatMap: this.createThreatMap(),
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

    // Rebuild spatial awareness before any decision-making.
    this.buildThreatMap(plant, circles, canvasWidth);

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
    let maxSpeed = 0;

    for (let i = 0; i < circles.length; i++) {
      const circle = circles[i];
      if (circle.consumed) continue;

      activeCount++;
      const speed = Math.abs(circle.velocity.x);
      const urgency = clamp(1 - circle.position.x / Math.max(canvasWidth, 1), 0, 1);
      const speedThreat = clamp(speed / this.config.maxCircleSpeed, 0, 1);

      if (urgency > maxUrgency) maxUrgency = urgency;
      if (speedThreat > maxSpeedThreat) maxSpeedThreat = speedThreat;
      if (speed > maxSpeed) maxSpeed = speed;
    }

    const stress = clamp(1 - integrity / 100, 0, 1);
    const rawPressure = clamp(
      activeCount * 0.12 + maxUrgency * 0.55 + maxSpeedThreat * 0.2 + stress * 0.65,
      0,
      1
    );

    // The organism tracks how fast the swarm is moving — a long memory that
    // sharpens prediction as difficulty ramps, rather than reacting frame-by-frame.
    plant.learning.averageOrbSpeed = lerpScalar(
      plant.learning.averageOrbSpeed,
      Math.max(maxSpeed, plant.learning.averageOrbSpeed * 0.98),
      dt * PlantController.SPEED_EMA_RATE
    );

    // A cornered organism fights harder — reaction time tightens as integrity drops.
    const desperationFactor = clamp(
      (this.config.desperationThreshold - integrity) / Math.max(this.config.desperationThreshold, 1),
      0,
      1
    );
    plant.learning.reactionBoost = lerpScalar(
      plant.learning.reactionBoost,
      desperationFactor * PlantController.REACTION_BOOST_MAX,
      dt * 2.5
    );

    // EMA-style blending creates lightweight adaptation without heavy state.
    plant.learning.pressure = lerpScalar(plant.learning.pressure, rawPressure, dt * 1.8);
    plant.learning.aggression = lerpScalar(
      plant.learning.aggression,
      clamp(0.35 + rawPressure * 0.8 + stress * 0.4 + desperationFactor * 0.5, 0.25, 1.45),
      dt * 0.9
    );
    plant.learning.predictionLead = lerpScalar(
      plant.learning.predictionLead,
      clamp(0.88 + rawPressure * 0.28 + stress * 0.12 + desperationFactor * 0.15, 0.82, 1.35),
      dt * 0.7
    );
    plant.learning.coordination = lerpScalar(
      plant.learning.coordination,
      clamp(1 - rawPressure * 0.35 - desperationFactor * 0.3, 0.35, 1),
      dt * 0.8
    );

    plant.mode = this.getMode(plant.learning.pressure, stress, desperationFactor);
  }

  private getMode(pressure: number, stress: number, desperation: number): PlantBehaviorMode {
    // The organism's will to survive overrides all other behavioral states.
    if (desperation > 0.1) return "desperate";
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
    const isDesperate = plant.mode === "desperate";

    // Desperation compresses retarget cooldown — snap between targets instantly.
    const cooldownDecay = isDesperate ? dt * 8 : dt;
    tentacle.retargetCooldown = Math.max(0, tentacle.retargetCooldown - cooldownDecay);

    // Reach bias extends to absolute maximum during last-stand.
    const reachBias = isDesperate
      ? PlantController.DESPERATION_REACH_BIAS
      : plant.mode === "idle"
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

    // Adaptive responsiveness: base skill + stress-driven reaction boost.
    const baseResponsiveness = 11 + plant.learning.aggression * 4;
    const adaptiveResponsiveness = baseResponsiveness + plant.learning.reactionBoost;

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
      // Noise suppressed under pressure — the organism becomes laser-focused.
      const noiseDampen = isDesperate ? 0.1 : (1 - plant.learning.pressure);
      const intentNoise =
        layeredSine(plant.time * 0.9, tentacle.noisePhase) * 4 * noiseDampen;

      let desiredX = predicted.x + intentNoise * 0.35;
      let desiredY = clamp(predicted.y + intentNoise, 30, canvasHeight - 30);

      // Lane preference relaxes during desperation — formation costs more than it saves.
      if (!isDesperate) {
        const laneY = this.getLaneY(tentacleIndex, plant.tentacles.length, canvasHeight);
        desiredY = lerpScalar(
          desiredY,
          laneY,
          (1 - plant.learning.coordination) * 0.15
        );
      }

      const dx = desiredX - plant.basePosition.x;
      const dy = desiredY - plant.basePosition.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const reachScale = dist > tentacle.desiredReach ? tentacle.desiredReach / dist : 1;

      desiredX = plant.basePosition.x + dx * reachScale;
      desiredY = plant.basePosition.y + dy * reachScale;

      // Preemptive jaw opening: if closing distance is below threshold and
      // commitment is high, open the jaw early for a wider capture window.
      const closingDist = distance(tipPos, target.position);
      const jawThreshold = (cfg.jawSize + target.radius) * PlantController.PREEMPTIVE_JAW_DIST_RATIO;
      const shouldPreempt = closingDist < jawThreshold && tentacle.commitment > 0.6;

      tentacle.jawTarget = shouldPreempt || isDesperate ? 1 : (plant.mode === "defensive" ? 1 : 0.9);
      tentacle.commitment = lerpScalar(tentacle.commitment, 1, dt * 4.5);

      this.smoothTipTarget(tentacle, desiredX, desiredY, dt, adaptiveResponsiveness);
    } else {
      // In desperation, even idle tentacles push outward toward patrol zones
      // rather than swaying gently — every limb stays ready.
      const idleTarget = isDesperate
        ? this.getPatrolTarget(tentacleIndex, plant, canvasHeight)
        : this.getIdleTarget(tentacle, tentacleIndex, plant, canvasHeight);

      tentacle.jawTarget = isDesperate ? 0.6 : 0;
      tentacle.commitment = lerpScalar(tentacle.commitment, 0, dt * 3.5);

      this.smoothTipTarget(
        tentacle,
        idleTarget.x,
        idleTarget.y,
        dt,
        isDesperate ? adaptiveResponsiveness * 0.6 : 4.5
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
    const cfg = this.config;
    const tipPos = tentacle.segments[tentacle.segments.length - 1].position;
    const maxReach = cfg.segmentLength * cfg.segmentsPerTentacle;
    const speed = Math.abs(circle.velocity.x);

    // BLACK triage: if the orb will escape before any tentacle can reach it,
    // don't waste motion chasing something already lost.
    const etaToEscape = speed > 1
      ? (circle.position.x - PlantController.ESCAPE_X) / speed
      : Infinity;

    if (etaToEscape < cfg.triageBlackMargin) {
      const reachSpeed = 340 + plant.learning.aggression * 120;
      const timeToReach = distance(tipPos, circle.position) / reachSpeed;
      if (timeToReach > etaToEscape) {
        return PlantController.BLACK_TRIAGE_SCORE;
      }
    }

    const urgency = clamp(
      1 - (circle.position.x - plant.basePosition.x) / Math.max(120, canvasWidth - plant.basePosition.x),
      0,
      1
    );
    const speedThreat = clamp(speed / cfg.maxCircleSpeed, 0, 1);
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

    // RED triage: imminent threats get a massive urgency multiplier.
    const isRed = etaToEscape < cfg.triageRedETA;
    const urgencyMult = isRed
      ? 4.2
      : (plant.mode === "defensive" || plant.mode === "desperate" ? 3.4 : 2.4);

    let score =
      urgency * urgencyMult +
      (1 / (1 + etaToBase)) * 1.6 +
      reachScore * (plant.mode === "hunting" || plant.mode === "desperate" ? 2.8 : 1.8) +
      speedThreat * 1.3 +
      trajectoryStability * 0.6 -
      lanePenalty * plant.learning.coordination * 1.1;

    if (circle.id === tentacle.targetId) {
      score += 0.65 + tentacle.commitment * 0.75;
    }

    if (circle.targeted && circle.id !== tentacle.targetId) {
      // In desperation, overlap penalty is reduced — better two tentacles
      // on a real threat than one tentacle on nothing.
      score -= plant.mode === "desperate" ? 0.5 : 1.25;
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
    // 2 iterations — enough for organic accuracy, removes ~33% IK cost vs 3
    const iterations = 2;

    for (let iter = 0; iter < iterations; iter++) {
      // Forward pass: from tip to base
      // Direct assignment avoids { ...target } object allocation
      segments[segments.length - 1].position.x = target.x;
      segments[segments.length - 1].position.y = target.y;
      for (let i = segments.length - 2; i >= 0; i--) {
        const dir = sub(segments[i].position, segments[i + 1].position);
        const dirNorm = normalize(dir);
        segments[i].position = add(
          segments[i + 1].position,
          scale(dirNorm, segments[i].length)
        );
      }

      // Backward pass: from base to tip
      // Direct assignment avoids { ...basePos } object allocation
      segments[0].position.x = basePos.x;
      segments[0].position.y = basePos.y;
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

  // ─── Survival Intelligence Methods ──────────────────────────────────────

  /** Pre-allocate the threat map structure once — reused every frame. */
  private createThreatMap(): ThreatMap {
    return {
      zones: [
        { count: 0, fastestSpeed: 0, lowestETA: Infinity },
        { count: 0, fastestSpeed: 0, lowestETA: Infinity },
        { count: 0, fastestSpeed: 0, lowestETA: Infinity },
        { count: 0, fastestSpeed: 0, lowestETA: Infinity },
      ],
      globalMostDangerous: -1,
      totalActive: 0,
      averageSpeed: 0,
    };
  }

  /**
   * Rebuild spatial awareness from live orb positions.
   * Zones: [far, mid, near, critical] based on horizontal position.
   * This gives the organism a "peripheral vision" of the entire field
   * rather than tunnel-visioning on individual targets.
   */
  private buildThreatMap(
    plant: PlantState,
    circles: Circle[],
    canvasWidth: number
  ): void {
    const map = plant.threatMap;

    // Reset without re-allocation.
    for (let z = 0; z < 4; z++) {
      map.zones[z].count = 0;
      map.zones[z].fastestSpeed = 0;
      map.zones[z].lowestETA = Infinity;
    }
    map.globalMostDangerous = -1;
    map.totalActive = 0;
    map.averageSpeed = 0;

    let speedSum = 0;
    let lowestGlobalETA = Infinity;

    for (let i = 0; i < circles.length; i++) {
      const c = circles[i];
      if (c.consumed) continue;

      map.totalActive++;
      const speed = Math.abs(c.velocity.x);
      speedSum += speed;

      // Classify into horizontal zone.
      const xRatio = c.position.x / Math.max(canvasWidth, 1);
      const zoneIdx = xRatio >= 0.6 ? 0 : xRatio >= 0.35 ? 1 : xRatio >= 0.15 ? 2 : 3;
      const zone = map.zones[zoneIdx];

      zone.count++;
      if (speed > zone.fastestSpeed) zone.fastestSpeed = speed;

      const eta = speed > 1
        ? (c.position.x - PlantController.ESCAPE_X) / speed
        : Infinity;
      if (eta < zone.lowestETA) zone.lowestETA = eta;
      if (eta < lowestGlobalETA) {
        lowestGlobalETA = eta;
        map.globalMostDangerous = c.id;
      }
    }

    map.averageSpeed = map.totalActive > 0 ? speedSum / map.totalActive : 0;
  }

  /**
   * During desperation, idle tentacles don't sway — they hold extended
   * patrol positions covering maximum vertical range, ready to snap
   * onto the next threat the moment it appears.
   */
  private getPatrolTarget(
    tentacleIndex: number,
    plant: PlantState,
    canvasHeight: number
  ): Vector2D {
    const cfg = this.config;
    const maxReach = cfg.segmentLength * cfg.segmentsPerTentacle;
    const patrolReach = maxReach * 0.85;
    const laneY = this.getLaneY(tentacleIndex, plant.tentacles.length, canvasHeight);
    const dx = patrolReach * 0.7;
    const dy = laneY - plant.basePosition.y;

    return {
      x: plant.basePosition.x + dx,
      y: plant.basePosition.y + dy,
    };
  }

  /**
   * Post-capture momentum: update learning state and immediately seek a new
   * target so the tentacle never wastes time drifting back to idle.
   * Called by SimulationEngine after collision processing.
   */
  onCapture(
    plant: PlantState,
    tentacleIndex: number,
    circles: Circle[],
    canvasWidth: number,
    canvasHeight: number,
    predictCirclePosition: (circle: Circle, time: number) => Vector2D
  ): void {
    plant.learning.captureCount++;

    const tentacle = plant.tentacles[tentacleIndex];

    // Don't celebrate — immediately look for the next threat.
    this.assignTarget(
      tentacle,
      tentacleIndex,
      plant,
      circles,
      canvasWidth,
      canvasHeight,
      predictCirclePosition
    );
  }
}
