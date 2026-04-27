import {
  PlantState,
  PlantTentacle,
  PlantSegment,
  SimulationConfig,
  Circle,
  Vector2D,
  PlantBehaviorMode,
  ThreatMap,
  MetabolicState,
  AnomalousEventType,
} from "@/types/simulation";
import { sub, normalize, scale, add, distance } from "@/utils/vector";
import { layeredSine, lerpScalar, clamp, randomRange, randomPick } from "@/utils/math";

/**
 * PlantController — manages the procedurally animated plant creature.
 * Uses FABRIK inverse kinematics with behavioral heuristics for predictive
 * targeting, adaptation, and tentacle coordination.
 *
 * Extended with Stochastic Sentience: metabolic rhythms, anomalous orb
 * heuristics, psychological expressions, stochastic mutations, and
 * adaptive randomness.
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
        tipTarget: { x: tipX, y: tipY },
        commitment: 0,
        retargetCooldown: 0,
        desiredReach: maxReach * 0.82,
        tipVelocity: { x: 0, y: 0 },
        lastTipTarget: { x: tipX, y: tipY },
        noisePhase: 1.37 * i,
        mourningTimer: 0,
        curiosityTimer: 0,
        curiosityTarget: null,
        vanityTarget: { x: tipX, y: tipY },
        vanityPhase: i * 2.17,
        shiverIntensity: 0,
      });
    }

    return {
      basePosition: { x: baseX, y: baseY },
      anchorY: baseY,
      targetAnchorY: baseY,
      baseVelocityY: 0,
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
      metabolicState: "meditative",
      metabolicTimer: 0,
      metabolicPhaseDuration: randomRange(cfg.metabolicPhaseMin, cfg.metabolicPhaseMax),
      metabolicTransition: 1, // Start fully transitioned
      metabolicPrev: "meditative",
      hyperfixationHue: null,
      anomalousEvent: null,
      anomalousEventTimer: 0,
      anomalousEventCooldown: cfg.anomalousEventCooldown * 0.5,
      chaosFactor: 0.3,
      breathPhase: 0,
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
    predictCirclePosition: (circle: Circle, time: number) => Vector2D,
    escapedCircleIds: number[] = []
  ): void {
    plant.time += dt;

    for (let i = 0; i < circles.length; i++) {
      circles[i].targeted = false;
    }

    this.buildThreatMap(plant, circles, canvasWidth);
    this.updateSomaticPosition(plant, circles, dt, canvasHeight);
    this.updateMetabolicState(plant, circles, dt);
    this.updateAnomalousEvent(plant, dt);
    this.updateSynchronizedShiver(plant, circles, dt);
    this.processMourningReflex(plant, escapedCircleIds);
    this.updateBehaviorState(plant, circles, dt, canvasWidth, integrity);

    for (let i = 0; i < plant.tentacles.length; i++) {
      const tentacle = plant.tentacles[i];
      this.updateVanityTarget(tentacle, plant, dt, canvasHeight);
      this.updateTentacle(
        tentacle, i, plant, circles, dt, canvasWidth, canvasHeight, predictCirclePosition
      );
    }
  }

  // ─── Metabolic Rhythms ──────────────────────────────────────────────────

  private updateMetabolicState(
    plant: PlantState,
    circles: Circle[],
    dt: number
  ): void {
    const cfg = this.config;
    plant.metabolicTimer += dt;
    plant.breathPhase += dt * 0.8;

    plant.chaosFactor = lerpScalar(
      plant.chaosFactor,
      0.3 + plant.learning.pressure * 0.5,
      dt * 0.1
    );

    if (plant.metabolicTimer >= plant.metabolicPhaseDuration) {
      plant.metabolicTimer = 0;
      plant.metabolicPhaseDuration = randomRange(cfg.metabolicPhaseMin, cfg.metabolicPhaseMax);
      plant.metabolicPrev = plant.metabolicState;

      const pressure = plant.learning.pressure;
      const roll = Math.random();
      let nextState: MetabolicState;
      if (pressure > 0.6) {
        nextState = roll < 0.5 ? "entropy" : roll < 0.8 ? "hyperfixation" : "meditative";
      } else if (pressure < 0.25) {
        nextState = roll < 0.6 ? "meditative" : roll < 0.85 ? "hyperfixation" : "entropy";
      } else {
        nextState = randomPick(["meditative", "hyperfixation", "entropy"] as MetabolicState[]);
      }

      plant.metabolicState = nextState;
      plant.metabolicTransition = 0;

      if (nextState === "hyperfixation" && circles.length > 0) {
        const activeCircles = circles.filter(c => !c.consumed);
        plant.hyperfixationHue = activeCircles.length > 0
          ? randomPick(activeCircles).hue
          : randomPick(cfg.circleHues);
      } else if (nextState !== "hyperfixation") {
        plant.hyperfixationHue = null;
      }
    }

    plant.metabolicTransition = Math.min(1, plant.metabolicTransition + dt * cfg.metabolicBlendSpeed);
  }

  private getMetabolicInfluence(plant: PlantState): {
    meditative: number;
    hyperfixation: number;
    entropy: number;
  } {
    const t = plant.metabolicTransition;
    const smoothT = t * t * (3 - 2 * t);
    const influences = { meditative: 0, hyperfixation: 0, entropy: 0 };

    if (plant.metabolicState === "meditative") {
      influences.meditative = smoothT;
      influences[plant.metabolicPrev] = 1 - smoothT;
    } else if (plant.metabolicState === "hyperfixation") {
      influences.hyperfixation = smoothT;
      influences[plant.metabolicPrev] = 1 - smoothT;
    } else {
      influences.entropy = smoothT;
      influences[plant.metabolicPrev] = 1 - smoothT;
    }

    return influences;
  }

  // ─── Anomalous Events (Stochastic Mutations) ────────────────────────────

  private updateAnomalousEvent(plant: PlantState, dt: number): void {
    if (plant.anomalousEvent !== null) {
      plant.anomalousEventTimer -= dt;
      if (plant.anomalousEventTimer <= 0) {
        plant.anomalousEvent = null;
      }
      return;
    }

    plant.anomalousEventCooldown -= dt;
    if (plant.anomalousEventCooldown <= 0) {
      const events: AnomalousEventType[] = ["whirlpool", "basePulse", "strobe"];
      plant.anomalousEvent = randomPick(events);
      plant.anomalousEventTimer = this.config.anomalousEventDuration;
      plant.anomalousEventCooldown = this.config.anomalousEventCooldown;
    }
  }

  private getWhirlpoolOffset(tentacleIndex: number, plant: PlantState): Vector2D {
    const cfg = this.config;
    const angle = plant.time * cfg.whirlpoolSpeed + tentacleIndex * (Math.PI * 2 / cfg.tentacleCount);
    const radius = 80;
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  }

  private getBasePulseOffset(plant: PlantState): number {
    return Math.sin(plant.time * 18) * 25;
  }

  // ─── Psychological Expressions ──────────────────────────────────────────

  private updateSynchronizedShiver(
    plant: PlantState,
    circles: Circle[],
    dt: number
  ): void {
    const threshold = this.config.shiverSpeedThreshold;
    let shouldShiver = false;

    for (const circle of circles) {
      if (circle.consumed) continue;
      if (Math.abs(circle.velocity.x) > threshold) {
        shouldShiver = true;
        break;
      }
    }

    if (shouldShiver) {
      for (const tentacle of plant.tentacles) {
        tentacle.shiverIntensity = Math.max(
          tentacle.shiverIntensity,
          0.6 + plant.chaosFactor * 0.4
        );
      }
    }

    for (const tentacle of plant.tentacles) {
      if (tentacle.shiverIntensity > 0) {
        tentacle.shiverIntensity = Math.max(0, tentacle.shiverIntensity - dt / this.config.shiverDuration);
      }
    }
  }

  private processMourningReflex(
    plant: PlantState,
    escapedCircleIds: number[]
  ): void {
    for (const circleId of escapedCircleIds) {
      let nearestIndex = -1;

      // Find which tentacle was targeting this orb
      for (let i = 0; i < plant.tentacles.length; i++) {
        if (plant.tentacles[i].targetId === circleId) {
          nearestIndex = i;
          break;
        }
      }

      // If no tentacle was targeting it, find the nearest unoccupied one
      if (nearestIndex === -1) {
        let nearestDist = Infinity;
        for (let i = 0; i < plant.tentacles.length; i++) {
          if (plant.tentacles[i].mourningTimer > 0) continue;
          if (plant.tentacles[i].targetId !== null) continue;
          const tipPos = plant.tentacles[i].segments[plant.tentacles[i].segments.length - 1].position;
          const dist = Math.abs(tipPos.y - plant.basePosition.y);
          if (dist < nearestDist) {
            nearestDist = dist;
            nearestIndex = i;
          }
        }
      }

      if (nearestIndex >= 0) {
        plant.tentacles[nearestIndex].mourningTimer = this.config.mourningDuration;
        plant.tentacles[nearestIndex].targetId = null;
        plant.tentacles[nearestIndex].commitment = 0;
      }
    }
  }

  private updateVanityTarget(
    tentacle: PlantTentacle,
    plant: PlantState,
    dt: number,
    canvasHeight: number
  ): void {
    tentacle.vanityPhase += dt * 0.3;

    const driftX = layeredSine(tentacle.vanityPhase, tentacle.noisePhase * 0.7) * 12;
    const driftY = layeredSine(tentacle.vanityPhase * 0.8, tentacle.noisePhase * 1.3) * 8;

    const baseVanity = tentacle.segments[tentacle.segments.length - 1].position;
    tentacle.vanityTarget.x = baseVanity.x + driftX;
    tentacle.vanityTarget.y = clamp(baseVanity.y + driftY, 30, canvasHeight - 30);
  }

  // ─── Core Update ────────────────────────────────────────────────────────

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
      if (circle.anomaly === "ghost" && !circle.visible) continue;

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
      0, 1
    );

    plant.learning.averageOrbSpeed = lerpScalar(
      plant.learning.averageOrbSpeed,
      Math.max(maxSpeed, plant.learning.averageOrbSpeed * 0.98),
      dt * PlantController.SPEED_EMA_RATE
    );

    const desperationFactor = clamp(
      (this.config.desperationThreshold - integrity) / Math.max(this.config.desperationThreshold, 1),
      0, 1
    );
    plant.learning.reactionBoost = lerpScalar(
      plant.learning.reactionBoost,
      desperationFactor * PlantController.REACTION_BOOST_MAX,
      dt * 2.5
    );

    const meta = this.getMetabolicInfluence(plant);
    const meditativeMod = 1 - meta.meditative * 0.6;
    const hyperfixAggressionMod = 1 + meta.hyperfixation * 0.4;
    const hyperfixCoordinationMod = 1 - meta.hyperfixation * 0.3;
    const entropyChaosMod = 1 + meta.entropy * 0.5;

    plant.learning.pressure = lerpScalar(plant.learning.pressure, rawPressure, dt * 1.8) * meditativeMod;

    plant.learning.aggression = lerpScalar(
      plant.learning.aggression,
      clamp(
        (0.35 + rawPressure * 0.8 + stress * 0.4 + desperationFactor * 0.5)
        * hyperfixAggressionMod * meditativeMod,
        0.15, 1.6
      ),
      dt * 0.9
    );
    plant.learning.predictionLead = lerpScalar(
      plant.learning.predictionLead,
      clamp(
        (0.88 + rawPressure * 0.28 + stress * 0.12 + desperationFactor * 0.15)
        * meditativeMod / entropyChaosMod,
        0.6, 1.5
      ),
      dt * 0.7
    );
    plant.learning.coordination = lerpScalar(
      plant.learning.coordination,
      clamp(
        (1 - rawPressure * 0.35 - desperationFactor * 0.3) * hyperfixCoordinationMod,
        0.2, 1
      ),
      dt * 0.8
    );

    plant.mode = this.getMode(plant.learning.pressure, stress, desperationFactor);
  }

  private getMode(pressure: number, stress: number, desperation: number): PlantBehaviorMode {
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
    const meta = this.getMetabolicInfluence(plant);

    // ── Mourning reflex: droop and freeze ──────────────────────────────
    if (tentacle.mourningTimer > 0) {
      tentacle.mourningTimer -= dt;
      tentacle.targetId = null;
      tentacle.jawTarget = 0;
      tentacle.commitment = lerpScalar(tentacle.commitment, 0, dt * 3);
      const droopTarget = {
        x: plant.basePosition.x + 20,
        y: plant.basePosition.y + 60 + tentacleIndex * 15,
      };
      this.smoothTipTarget(tentacle, droopTarget.x, droopTarget.y, dt, 2);
      tentacle.jawOpen = lerpScalar(tentacle.jawOpen, tentacle.jawTarget, dt * 8);
      this.solveFABRIK(tentacle, plant.basePosition);
      return;
    }

    // ── Curiosity lag: follow orb at distance before snapping ──────────
    if (tentacle.curiosityTimer > 0) {
      tentacle.curiosityTimer -= dt;
      const target = this.findCircleById(circles, tentacle.curiosityTarget);
      if (target && !target.consumed) {
        const tipPos = tentacle.segments[tentacle.segments.length - 1].position;
        const dir = sub(target.position, tipPos);
        const dirNorm = normalize(dir);
        const followDist = cfg.curiosityFollowDistance;
        const rawDist = distance(tipPos, target.position);
        const followTarget = rawDist > followDist
          ? add(tipPos, scale(dirNorm, rawDist - followDist))
          : target.position;

        tentacle.jawTarget = 0.3;
        this.smoothTipTarget(tentacle, followTarget.x, followTarget.y, dt, 6);

        if (tentacle.curiosityTimer <= 0) {
          if (Math.random() > 0.3) {
            tentacle.jawTarget = 1;
            tentacle.commitment = 1;
          } else {
            tentacle.targetId = null;
            tentacle.curiosityTarget = null;
            tentacle.commitment = 0;
          }
        }
      } else {
        tentacle.curiosityTimer = 0;
        tentacle.curiosityTarget = null;
      }

      tentacle.jawOpen = lerpScalar(tentacle.jawOpen, tentacle.jawTarget, dt * 8);
      this.solveFABRIK(tentacle, plant.basePosition);
      return;
    }

    // Desperation compresses retarget cooldown
    const cooldownDecay = isDesperate ? dt * 8 : dt;
    tentacle.retargetCooldown = Math.max(0, tentacle.retargetCooldown - cooldownDecay);

    let reachBias = isDesperate
      ? PlantController.DESPERATION_REACH_BIAS
      : plant.mode === "idle" ? 0.72
      : plant.mode === "defensive" ? 0.9
      : 0.98 + plant.learning.aggression * 0.06;

    reachBias *= (1 - meta.meditative * 0.3);

    const surgeActive = isDesperate || plant.mode === "defensive";
    const effectiveMaxReach = surgeActive ? maxReach * cfg.surgeReachMultiplier : maxReach;

    tentacle.desiredReach = lerpScalar(
      tentacle.desiredReach, effectiveMaxReach * reachBias, dt * 3.2
    );

    const target = this.assignTarget(
      tentacle, tentacleIndex, plant, circles,
      canvasWidth, canvasHeight, predictCirclePosition
    );

    let baseResponsiveness = 11 + plant.learning.aggression * 4;
    const adaptiveResponsiveness = baseResponsiveness + plant.learning.reactionBoost;
    const responsiveMod = 1 - meta.meditative * 0.65;

    if (target) {
      const tipPos = tentacle.segments[tentacle.segments.length - 1].position;
      const reachSpeed = 340 + plant.learning.aggression * 120;
      const interceptTime =
        clamp(distance(tipPos, target.position) / reachSpeed, PlantController.MIN_LEAD_TIME, PlantController.MAX_LEAD_TIME)
        * plant.learning.predictionLead;

      const predicted = predictCirclePosition(target, interceptTime);
      const noiseDampen = isDesperate ? 0.1 : (1 - plant.learning.pressure);
      const entropyNoiseMod = 1 + meta.entropy * 3 * plant.chaosFactor;
      const intentNoise = layeredSine(plant.time * 0.9, tentacle.noisePhase) * 4 * noiseDampen * entropyNoiseMod;

      let desiredX = predicted.x + intentNoise * 0.35;
      let desiredY = clamp(predicted.y + intentNoise, 30, canvasHeight - 30);

      if (!isDesperate) {
        const laneY = this.getLaneY(tentacleIndex, plant.tentacles.length, canvasHeight);
        desiredY = lerpScalar(desiredY, laneY, (1 - plant.learning.coordination) * 0.15);
      }

      const dx = desiredX - plant.basePosition.x;
      const dy = desiredY - plant.basePosition.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const reachScale = dist > tentacle.desiredReach ? tentacle.desiredReach / dist : 1;

      desiredX = plant.basePosition.x + dx * reachScale;
      desiredY = plant.basePosition.y + dy * reachScale;

      // Vanity target: micro-movements
      const vanityBlend = 0.08 + tentacle.shiverIntensity * 0.15;
      desiredX = lerpScalar(desiredX, tentacle.vanityTarget.x, vanityBlend);
      desiredY = lerpScalar(desiredY, tentacle.vanityTarget.y, vanityBlend);

      // Shiver overlay
      if (tentacle.shiverIntensity > 0) {
        desiredX += Math.sin(plant.time * 35 + tentacleIndex * 1.7) * tentacle.shiverIntensity * 6;
        desiredY += Math.cos(plant.time * 42 + tentacleIndex * 2.3) * tentacle.shiverIntensity * 4;
      }

      // Anomalous event: whirlpool overrides target
      if (plant.anomalousEvent === "whirlpool") {
        const whirlpool = this.getWhirlpoolOffset(tentacleIndex, plant);
        desiredX = lerpScalar(desiredX, plant.basePosition.x + whirlpool.x, 0.7);
        desiredY = lerpScalar(desiredY, plant.basePosition.y + whirlpool.y, 0.7);
      }

      const closingDist = distance(tipPos, target.position);
      const jawThreshold = (cfg.jawSize + target.radius) * PlantController.PREEMPTIVE_JAW_DIST_RATIO;
      const shouldPreempt = closingDist < jawThreshold && tentacle.commitment > 0.6;

      // Curiosity lag trigger
      if (shouldPreempt && tentacle.commitment > 0.7 && Math.random() < cfg.curiosityLagChance * plant.chaosFactor) {
        tentacle.curiosityTimer = cfg.curiosityLagDuration;
        tentacle.curiosityTarget = target.id;
      } else {
        tentacle.jawTarget = shouldPreempt || isDesperate ? 1 : (plant.mode === "defensive" ? 1 : 0.9);
      }

      tentacle.commitment = lerpScalar(tentacle.commitment, 1, dt * 4.5);
      this.smoothTipTarget(tentacle, desiredX, desiredY, dt, adaptiveResponsiveness * responsiveMod);
    } else {
      let idleTarget: Vector2D;

      if (plant.anomalousEvent === "whirlpool") {
        const whirlpool = this.getWhirlpoolOffset(tentacleIndex, plant);
        idleTarget = {
          x: plant.basePosition.x + whirlpool.x,
          y: plant.basePosition.y + whirlpool.y,
        };
      } else if (isDesperate) {
        idleTarget = this.getPatrolTarget(tentacleIndex, plant, canvasHeight);
      } else {
        idleTarget = this.getIdleTarget(tentacle, tentacleIndex, plant, canvasHeight);
      }

      // Meditative: enhance idle sway (breathing)
      if (meta.meditative > 0.1) {
        const breathSway = Math.sin(plant.breathPhase + tentacleIndex * 0.5) * 25 * meta.meditative;
        idleTarget.y += breathSway;
      }

      const vanityBlend = 0.15 + tentacle.shiverIntensity * 0.2;
      idleTarget.x = lerpScalar(idleTarget.x, tentacle.vanityTarget.x, vanityBlend);
      idleTarget.y = lerpScalar(idleTarget.y, tentacle.vanityTarget.y, vanityBlend);

      if (tentacle.shiverIntensity > 0) {
        idleTarget.x += Math.sin(plant.time * 35 + tentacleIndex * 1.7) * tentacle.shiverIntensity * 6;
        idleTarget.y += Math.cos(plant.time * 42 + tentacleIndex * 2.3) * tentacle.shiverIntensity * 4;
      }

      tentacle.jawTarget = isDesperate ? 0.6 : 0;
      tentacle.commitment = lerpScalar(tentacle.commitment, 0, dt * 3.5);

      this.smoothTipTarget(
        tentacle, idleTarget.x, idleTarget.y, dt,
        isDesperate ? adaptiveResponsiveness * 0.6 : 4.5 * responsiveMod
      );
    }

    tentacle.jawOpen = lerpScalar(tentacle.jawOpen, tentacle.jawTarget, dt * 8);
    this.solveFABRIK(tentacle, plant.basePosition);
  }

  /**
   * Assign a target circle to this tentacle.
   * Includes hyperfixation filtering and random target selection.
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
    const meta = this.getMetabolicInfluence(plant);

    // Adaptive Randomness: 15% chance to pick a non-optimal target
    if (Math.random() < this.config.randomTargetChance * plant.chaosFactor) {
      const activeCircles = circles.filter(c =>
        !c.consumed &&
        (!c.targeted || c.id === tentacle.targetId) &&
        this.isCircleVisible(c)
      );

      const filtered = plant.hyperfixationHue !== null
        ? activeCircles.filter(c => c.hue === plant.hyperfixationHue)
        : activeCircles;

      const candidates = filtered.length > 0 ? filtered : activeCircles;
      if (candidates.length > 0) {
        const randomTarget = randomPick(candidates);
        randomTarget.targeted = true;
        tentacle.targetId = randomTarget.id;
        return randomTarget;
      }
    }

    let currentCircle: Circle | null = null;
    let currentScore = -Infinity;

    if (tentacle.targetId !== null) {
      for (let i = 0; i < circles.length; i++) {
        const circle = circles[i];
        if (circle.id === tentacle.targetId && !circle.consumed) {
          currentCircle = circle;
          currentScore =
            this.evaluateTarget(
              tentacle, tentacleIndex, plant, circle,
              canvasWidth, canvasHeight, predictCirclePosition
            ) + 0.9 + tentacle.commitment * 0.8;
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
      if (!this.isCircleVisible(circle)) continue;
      if (circle.targeted && circle.id !== tentacle.targetId) continue;

      // Hyperfixation: ignore non-matching orbs unless urgent
      if (plant.hyperfixationHue !== null && circle.hue !== plant.hyperfixationHue && meta.hyperfixation > 0.5) {
        const urgency = clamp(1 - (circle.position.x - plant.basePosition.x) / Math.max(120, canvasWidth - plant.basePosition.x), 0, 1);
        if (urgency < 0.8) continue;
      }

      const score = this.evaluateTarget(
        tentacle, tentacleIndex, plant, circle,
        canvasWidth, canvasHeight, predictCirclePosition
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

    const switching = tentacle.targetId !== null && bestCircle.id !== tentacle.targetId;

    if (switching && currentCircle && tentacle.retargetCooldown > 0 &&
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

  private isCircleVisible(circle: Circle): boolean {
    if (circle.anomaly === "ghost") return circle.visible;
    return true;
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
      0, 1
    );
    const speedThreat = clamp(speed / cfg.maxCircleSpeed, 0, 1);
    const etaToBase = Math.max(
      0.05,
      (circle.position.x - plant.basePosition.x) / Math.max(20, -circle.velocity.x)
    );

    const reachSpeed = 340 + plant.learning.aggression * 120;
    const interceptTime =
      clamp(distance(tipPos, circle.position) / reachSpeed, PlantController.MIN_LEAD_TIME, PlantController.MAX_LEAD_TIME)
      * plant.learning.predictionLead;

    const predicted = predictCirclePosition(circle, interceptTime);
    const interceptDist = distance(tipPos, predicted);
    const reachScore = 1 - clamp(interceptDist / Math.max(maxReach, 1), 0, 1);

    const laneY = this.getLaneY(tentacleIndex, plant.tentacles.length, canvasHeight);
    const lanePenalty = Math.abs(predicted.y - laneY) / Math.max(canvasHeight, 1);

    const trajectoryStability = 1 - clamp(Math.abs(predicted.y - circle.position.y) / 140, 0, 1);

    const isRed = etaToEscape < cfg.triageRedETA;
    const urgencyMult = isRed ? 4.2
      : (plant.mode === "defensive" || plant.mode === "desperate" ? 3.4 : 2.4);

    const meta = this.getMetabolicInfluence(plant);

    // Hyperfixation bonus for matching hue
    let hyperfixBonus = 0;
    if (plant.hyperfixationHue !== null && circle.hue === plant.hyperfixationHue) {
      hyperfixBonus = 2.5 * meta.hyperfixation;
    }

    // Entropy: add randomness to scores
    const entropyNoise = meta.entropy * (Math.random() - 0.5) * 3 * plant.chaosFactor;

    // Anomaly modifiers
    let anomalyMod = 1;
    if (circle.anomaly === "flutter") anomalyMod = 0.9;
    if (circle.anomaly === "ghost") anomalyMod = 0.85;
    if (circle.anomaly === "magnetic" && circle.magneticStrength < 0) anomalyMod = 1.1;

    let score =
      urgency * urgencyMult +
      (1 / (1 + etaToBase)) * 1.6 +
      reachScore * (plant.mode === "hunting" || plant.mode === "desperate" ? 2.8 : 1.8) +
      speedThreat * 1.3 +
      trajectoryStability * 0.6 -
      lanePenalty * plant.learning.coordination * 1.1 +
      hyperfixBonus +
      entropyNoise;

    score *= anomalyMod;

    if (circle.id === tentacle.targetId) {
      score += 0.65 + tentacle.commitment * 0.75;
    }

    if (circle.targeted && circle.id !== tentacle.targetId) {
      score -= plant.mode === "desperate" ? 0.5 : 1.25;
    }

    if (plant.mode === "idle") {
      score *= 0.55 * (1 + meta.meditative * 0.4);
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
      cfg.idleSwayAmplitude * 0.35 *
      layeredSine(plant.time * cfg.idleSwayFrequency, tentacle.idlePhase);
    const swayY =
      cfg.idleSwayAmplitude * 0.28 *
      layeredSine(plant.time * cfg.idleSwayFrequency * 0.7, tentacle.idlePhase + tentacle.noisePhase);

    return {
      x: plant.basePosition.x + Math.cos(idleAngle) * idleReach + swayX,
      y: clamp(plant.basePosition.y + Math.sin(idleAngle) * idleReach + swayY, 40, canvasHeight - 40),
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
   */
  private solveFABRIK(tentacle: PlantTentacle, basePos: Vector2D): void {
    const segments = tentacle.segments;
    const target = tentacle.tipTarget;
    const iterations = 2;

    for (let iter = 0; iter < iterations; iter++) {
      // Forward pass: from tip to base
      segments[segments.length - 1].position.x = target.x;
      segments[segments.length - 1].position.y = target.y;
      for (let i = segments.length - 2; i >= 0; i--) {
        const dir = sub(segments[i].position, segments[i + 1].position);
        const dirNorm = normalize(dir);
        segments[i].position = add(segments[i + 1].position, scale(dirNorm, segments[i].length));
      }

      // Backward pass: from base to tip
      segments[0].position.x = basePos.x;
      segments[0].position.y = basePos.y;
      for (let i = 1; i < segments.length; i++) {
        const dir = sub(segments[i].position, segments[i - 1].position);
        const dirNorm = normalize(dir);
        segments[i].position = add(segments[i - 1].position, scale(dirNorm, segments[i - 1].length));
      }
    }

    // Update angles
    for (let i = 0; i < segments.length - 1; i++) {
      const dir = sub(segments[i + 1].position, segments[i].position);
      segments[i].angle = Math.atan2(dir.y, dir.x);
    }
    if (segments.length > 1) {
      segments[segments.length - 1].angle = segments[segments.length - 2].angle;
    }
  }

  getTip(tentacle: PlantTentacle): { position: Vector2D; angle: number } {
    const last = tentacle.segments[tentacle.segments.length - 1];
    return { position: last.position, angle: last.angle };
  }

  private findCircleById(circles: Circle[], id: number | null): Circle | null {
    if (id === null) return null;
    for (const c of circles) {
      if (c.id === id) return c;
    }
    return null;
  }

  // ─── Survival Intelligence Methods ──────────────────────────────────────

  private updateSomaticPosition(
    plant: PlantState,
    circles: Circle[],
    dt: number,
    canvasHeight: number
  ): void {
    const cfg = this.config;

    let weightedY = 0;
    let totalWeight = 0;

    for (let i = 0; i < circles.length; i++) {
      const c = circles[i];
      if (c.consumed) continue;
      if (c.anomaly === "ghost" && !c.visible) continue;

      const speed = Math.abs(c.velocity.x);
      const eta = speed > 1 ? (c.position.x - PlantController.ESCAPE_X) / speed : 10;
      const urgencyWeight = 1 / (0.5 + eta);
      weightedY += c.position.y * urgencyWeight;
      totalWeight += urgencyWeight;
    }

    const meta = this.getMetabolicInfluence(plant);

    let targetY: number;
    if (meta.meditative > 0.6) {
      targetY = canvasHeight * 0.5;
    } else if (totalWeight > 0.01) {
      targetY = weightedY / totalWeight;
    } else {
      targetY = canvasHeight * 0.5;
    }

    plant.targetAnchorY = clamp(targetY, 60, canvasHeight - 60);

    const delta = plant.targetAnchorY - plant.anchorY;
    const acceleration = delta * 8;
    plant.baseVelocityY += acceleration * dt;
    plant.baseVelocityY *= cfg.baseMoveDamping;

    const maxV = cfg.baseMoveSpeed;
    if (plant.baseVelocityY > maxV) plant.baseVelocityY = maxV;
    if (plant.baseVelocityY < -maxV) plant.baseVelocityY = -maxV;

    plant.anchorY += plant.baseVelocityY * dt;
    plant.anchorY = clamp(plant.anchorY, 60, canvasHeight - 60);

    let basePulseOffset = 0;
    if (plant.anomalousEvent === "basePulse") {
      basePulseOffset = this.getBasePulseOffset(plant);
    }

    plant.basePosition.y =
      plant.anchorY + layeredSine(plant.time * 0.3, 0) * 3 + basePulseOffset;

    if (meta.meditative > 0.1) {
      plant.basePosition.y += Math.sin(plant.breathPhase) * 5 * meta.meditative;
    }
  }

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

  private buildThreatMap(plant: PlantState, circles: Circle[], canvasWidth: number): void {
    const map = plant.threatMap;

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

      const xRatio = c.position.x / Math.max(canvasWidth, 1);
      const zoneIdx = xRatio >= 0.6 ? 0 : xRatio >= 0.35 ? 1 : xRatio >= 0.15 ? 2 : 3;
      const zone = map.zones[zoneIdx];

      zone.count++;
      if (speed > zone.fastestSpeed) zone.fastestSpeed = speed;

      const eta = speed > 1 ? (c.position.x - PlantController.ESCAPE_X) / speed : Infinity;
      if (eta < zone.lowestETA) zone.lowestETA = eta;
      if (eta < lowestGlobalETA) {
        lowestGlobalETA = eta;
        map.globalMostDangerous = c.id;
      }
    }

    map.averageSpeed = map.totalActive > 0 ? speedSum / map.totalActive : 0;
  }

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

    this.assignTarget(
      tentacle, tentacleIndex, plant, circles,
      canvasWidth, canvasHeight, predictCirclePosition
    );
  }
}
