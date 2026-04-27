import { SimulationConfig, SimulationState, Circle, PlantTentacle, PlantState, Vector2D } from "@/types/simulation";
import { DEFAULT_CONFIG } from "@/constants/simulation";
import { CircleSpawner } from "./CircleSpawner";
import { PlantController } from "./PlantController";
import { CollisionEngine } from "./CollisionEngine";
import { ParticleSystem } from "./ParticleSystem";
import { hsla, plantColor } from "@/utils/color";
import { clamp, lerpScalar } from "@/utils/math";

/**
 * SimulationEngine — top-level orchestrator.
 * Owns all subsystems and manages the update/render pipeline.
 * Keeps all mutable state outside React for maximum performance.
 */
export class SimulationEngine {
  private static readonly INITIAL_INTEGRITY = 100;
  private static readonly ESCAPE_DAMAGE = 5;
  private static readonly DAMAGE_FLASH_DECAY = 1.35;
  private static readonly DAMAGE_FLASH_BASE_ALPHA = 0.14;
  private static readonly DAMAGE_FLASH_PEAK_ALPHA = 0.42;
  private static readonly COLLAPSE_DURATION = 1.5;

  private config: SimulationConfig;
  private state!: SimulationState;
  private spawner: CircleSpawner;
  private plant: PlantController;
  private collision: CollisionEngine;
  private particles: ParticleSystem;
  private ctx!: CanvasRenderingContext2D;
  private dpr: number = 1;
  private backgroundGradient: CanvasGradient | null = null;

  constructor(config?: Partial<SimulationConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.spawner = new CircleSpawner(this.config);
    this.plant = new PlantController(this.config);
    this.collision = new CollisionEngine(this.config);
    this.particles = new ParticleSystem(this.config);
  }

  init(ctx: CanvasRenderingContext2D, width: number, height: number, dpr: number): void {
    this.ctx = ctx;
    this.dpr = dpr;
    this.backgroundGradient = this.createBackgroundGradient(width, height);

    this.state = {
      circles: [],
      plant: this.plant.createPlant(width, height),
      particles: this.particles.getPool(),
      elapsedTime: 0,
      score: 0,
      captures: 0,
      integrity: SimulationEngine.INITIAL_INTEGRITY,
      damageFlash: 0,
      isCollapsing: false,
      collapseProgress: 0,
      collapseElapsed: 0,
      collapseComplete: false,
      currentSpawnInterval: this.config.initialSpawnInterval,
      currentSpeedBonus: 0,
      timeSinceLastSpawn: 0,
      nextCircleId: 0,
      canvasWidth: width,
      canvasHeight: height,
      speedWavePhase: 0,
      speedWaveMultiplier: 1,
      escapedCircleIds: [],
    };
  }

  resize(width: number, height: number, dpr: number): void {
    this.dpr = dpr;
    this.state.canvasWidth = width;
    this.state.canvasHeight = height;

    const newBaseX = width * this.config.plantBaseXRatio;
    const newBaseY = height * 0.5;
    const dx = newBaseX - this.state.plant.basePosition.x;
    const dy = newBaseY - this.state.plant.basePosition.y;
    this.state.plant.basePosition.x = newBaseX;
    this.state.plant.basePosition.y = newBaseY;
    this.state.plant.anchorY = newBaseY;

    if (dx !== 0 || dy !== 0) {
      for (const tentacle of this.state.plant.tentacles) {
        for (const seg of tentacle.segments) {
          seg.position.x += dx;
          seg.position.y += dy;
        }
        tentacle.tipTarget.x += dx;
        tentacle.tipTarget.y += dy;
        tentacle.lastTipTarget.x += dx;
        tentacle.lastTipTarget.y += dy;
        tentacle.vanityTarget.x += dx;
        tentacle.vanityTarget.y += dy;
      }
    }

    this.backgroundGradient = this.createBackgroundGradient(width, height);
  }

  update(dt: number): void {
    const s = this.state;
    s.elapsedTime += dt;
    s.damageFlash = Math.max(0, s.damageFlash - dt * SimulationEngine.DAMAGE_FLASH_DECAY);
    s.escapedCircleIds = [];

    if (s.isCollapsing) {
      s.collapseElapsed += dt;
      s.collapseProgress = clamp(s.collapseElapsed / SimulationEngine.COLLAPSE_DURATION, 0, 1);
      if (s.collapseProgress >= 1) s.collapseComplete = true;
      this.particles.update(dt);
      return;
    }

    // ─── Velocity Breath: speed wave system ───────────────────────────
    const wave = this.spawner.updateSpeedWave(s.speedWavePhase, dt);
    s.speedWavePhase = wave.phase;
    s.speedWaveMultiplier = wave.multiplier;

    // ─── Difficulty Scaling ────────────────────────────────────────────
    s.currentSpawnInterval = this.spawner.getCurrentSpawnInterval(s.elapsedTime);
    s.currentSpeedBonus = this.spawner.getCurrentSpeedBonus(s.elapsedTime, s.speedWaveMultiplier);

    // ─── Spawn Circles ────────────────────────────────────────────────
    s.timeSinceLastSpawn += dt * 1000;
    if (s.timeSinceLastSpawn >= s.currentSpawnInterval) {
      s.timeSinceLastSpawn = 0;
      const circle = this.spawner.spawn(
        s.canvasWidth, s.canvasHeight, s.nextCircleId++, s.currentSpeedBonus
      );
      s.circles.push(circle);
    }

    // ─── Update Circles ───────────────────────────────────────────────
    // Collect tentacle tips for magnetic influence
    const tentacleTips = s.plant.tentacles.map(t =>
      t.segments[t.segments.length - 1].position
    );

    for (const circle of s.circles) {
      if (!circle.consumed) {
        this.spawner.updateCircle(circle, dt);
        this.spawner.applyMagneticInfluence(circle, tentacleTips, dt);
      }
    }

    // ─── Update Plant ─────────────────────────────────────────────────
    this.plant.update(
      s.plant,
      s.circles,
      dt,
      s.canvasWidth,
      s.canvasHeight,
      s.integrity,
      (circle, time) => this.spawner.predictCirclePosition(circle, time),
      s.escapedCircleIds
    );

    // ─── Anomalous AoE / Forces ───────────────────────────────────────
    this.processAnomalousEffects(s, dt);

    // ─── Collision Detection ──────────────────────────────────────────
    const collisions = this.collision.detectCollisions(
      s.plant.tentacles, s.circles
    );

    const predictor = (circle: Circle, time: number) =>
      this.spawner.predictCirclePosition(circle, time);

    for (const hit of collisions) {
      this.particles.emit(hit.position, hit.circleHue);
      s.captures += 1;

      if (s.integrity < this.config.regenIntegrityCap) {
        s.integrity = Math.min(
          s.integrity + this.config.captureRegenAmount,
          this.config.regenIntegrityCap
        );
      }

      this.plant.onCapture(
        s.plant, hit.tentacleIndex, s.circles,
        s.canvasWidth, s.canvasHeight, predictor
      );
    }

    // ─── Update Particles ─────────────────────────────────────────────
    this.particles.update(dt);

    // ─── Neural Pulse ─────────────────────────────────────────────────
    this.processNeuralPulses(s);

    // ─── Cleanup consumed/off-screen circles ──────────────────────────
    const survivors: Circle[] = [];
    for (const circle of s.circles) {
      if (circle.consumed) continue;
      if (circle.position.x <= -50) {
        this.applyIntegrityDamage(SimulationEngine.ESCAPE_DAMAGE);
        s.escapedCircleIds.push(circle.id);
        continue;
      }
      survivors.push(circle);
    }
    s.circles = survivors;
  }

  render(): void {
    const ctx = this.ctx;
    const s = this.state;
    const w = s.canvasWidth;
    const h = s.canvasHeight;

    ctx.save();
    ctx.scale(this.dpr, this.dpr);

    this.renderBackground(ctx, w, h);
    this.renderCircleTrails(ctx, s.circles);
    this.renderCircles(ctx, s.circles);
    this.renderPlant(ctx);
    this.renderParticles(ctx);
    this.renderAnomalies(ctx);

    this.renderHUD(ctx, w);
    this.renderCollapseOverlay(ctx, w, h);
    ctx.restore();
  }

  // ─── Rendering Subroutines ───────────────────────────────────────────────

  private renderBackground(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number
  ): void {
    ctx.fillStyle = this.backgroundGradient ?? this.createBackgroundGradient(w, h);
    ctx.fillRect(0, 0, w, h);
  }

  private createBackgroundGradient(width: number, height: number): CanvasGradient {
    const gradient = this.ctx.createRadialGradient(
      width * 0.3, height * 0.5, 0,
      width * 0.5, height * 0.5,
      Math.max(width, height) * 0.8
    );
    gradient.addColorStop(0, this.config.backgroundGradientInner);
    gradient.addColorStop(1, this.config.backgroundGradientOuter);
    return gradient;
  }

  private renderCircleTrails(
    ctx: CanvasRenderingContext2D,
    circles: Circle[]
  ): void {
    ctx.lineCap = "round";
    for (const circle of circles) {
      // Ghost orbs: fade trail when invisible
      let alphaMod = 1;
      if (circle.anomaly === "ghost") {
        alphaMod = circle.visible ? 1 : 0.15;
      }

      const trail = circle.trail;
      const len = trail.length;
      if (len < 2) continue;

      const baseAlpha = this.config.trailAlpha * alphaMod;

      for (let i = 0; i < len - 1; i++) {
        const t = (i + 1) / len;
        const alpha = t * t * baseAlpha;
        const width = circle.radius * (0.1 + t * 0.5);

        ctx.beginPath();
        ctx.moveTo(trail[i].x, trail[i].y);
        ctx.lineTo(trail[i + 1].x, trail[i + 1].y);
        ctx.strokeStyle = hsla(circle.hue, 70, 50 + t * 25, alpha);
        ctx.lineWidth = width;
        ctx.stroke();
      }

      const last = trail[len - 1];
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(circle.position.x, circle.position.y);
      ctx.strokeStyle = hsla(circle.hue, 60, 72, baseAlpha * 0.95);
      ctx.lineWidth = circle.radius * 0.6;
      ctx.stroke();
    }
  }

  private renderCircles(
    ctx: CanvasRenderingContext2D,
    circles: Circle[]
  ): void {
    const TAU = Math.PI * 2;
    const SIDES = 7;
    const PHI = 1.618033988749;

    for (const circle of circles) {
      // Ghost orbs: render with reduced opacity when fading
      let alphaMod = 1;
      if (circle.anomaly === "ghost") {
        alphaMod = circle.visible ? 1 : this.config.ghostMinVisibility;
      }

      const cx = circle.position.x;
      const cy = circle.position.y;
      const r = circle.radius;
      const moveAngle = Math.atan2(circle.velocity.y, circle.velocity.x);
      const seed = circle.id * PHI;

      // Rocky irregular body
      ctx.beginPath();
      for (let i = 0; i < SIDES; i++) {
        const angle = moveAngle + (TAU * i) / SIDES;
        const irregularity = 0.82 + 0.18 * Math.sin(seed + i * 2.3);
        const px = cx + Math.cos(angle) * r * irregularity;
        const py = cy + Math.sin(angle) * r * irregularity;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = hsla(circle.hue, 65, 38, 0.94 * alphaMod);
      ctx.fill();

      // Incandescent leading-edge crescent
      const frontX = cx + Math.cos(moveAngle) * r * 0.2;
      const frontY = cy + Math.sin(moveAngle) * r * 0.2;
      ctx.beginPath();
      ctx.arc(frontX, frontY, r * 0.62, moveAngle - 0.85, moveAngle + 0.85);
      ctx.lineTo(frontX, frontY);
      ctx.closePath();
      ctx.fillStyle = hsla(circle.hue, 50, 82, 0.72 * alphaMod);
      ctx.fill();

      // White-hot core
      ctx.beginPath();
      ctx.arc(
        cx + Math.cos(moveAngle) * r * 0.15,
        cy + Math.sin(moveAngle) * r * 0.15,
        r * 0.28, 0, TAU
      );
      ctx.fillStyle = `rgba(255, 255, 255, ${0.88 * alphaMod})`;
      ctx.fill();

      // ── Magnetic aura ────────────────────────────────────────────────
      if (circle.anomaly === "magnetic") {
        const isAttract = circle.magneticStrength < 0;
        const auraAlpha = 0.12 * alphaMod;
        ctx.beginPath();
        ctx.arc(cx, cy, this.config.magneticRadius * 0.3, 0, TAU);
        ctx.strokeStyle = isAttract
          ? `rgba(100, 200, 255, ${auraAlpha})`
          : `rgba(255, 100, 100, ${auraAlpha})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // ── Flutter visual: subtle vibration lines ───────────────────────
      if (circle.anomaly === "flutter" && !isNaN(circle.flutterTargetY)) {
        ctx.beginPath();
        ctx.moveTo(cx - r * 0.8, cy - r * 1.2);
        ctx.lineTo(cx + r * 0.3, cy - r * 1.2);
        ctx.strokeStyle = hsla(circle.hue, 50, 70, 0.3 * alphaMod);
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
  }

  private renderPlant(ctx: CanvasRenderingContext2D): void {
    const plant = this.state.plant;
    const cfg = this.config;
    const damageFlash = this.state.damageFlash;

    // ── Strobe: modulate core brightness ───────────────────────────────
    let coreBrightness = 0.9;
    if (plant.anomalousEvent === "strobe" && this.state.circles.length > 0) {
      // Find nearest orb distance to base
      let nearestDist = Infinity;
      for (const c of this.state.circles) {
        if (c.consumed) continue;
        const dx = c.position.x - plant.basePosition.x;
        const dy = c.position.y - plant.basePosition.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < nearestDist) nearestDist = d;
      }
      // Pulse brightness with distance — sonar effect
      const maxDist = cfg.segmentLength * cfg.segmentsPerTentacle * 2;
      const proximity = 1 - clamp(nearestDist / maxDist, 0, 1);
      coreBrightness = 0.5 + proximity * 0.5 + Math.sin(plant.time * 12) * 0.15;
    }

    // ── Metabolic visual: meditative glow ──────────────────────────────
    let meditativeGlow = 0;
    if (plant.metabolicState === "meditative") {
      meditativeGlow = plant.metabolicTransition * 0.15;
    }

    // Base bulb
    ctx.beginPath();
    ctx.arc(plant.basePosition.x, plant.basePosition.y, 18, 0, Math.PI * 2);
    ctx.fillStyle = plantColor(0, coreBrightness);
    ctx.fill();

    // Meditative glow ring
    if (meditativeGlow > 0.01) {
      ctx.beginPath();
      ctx.arc(plant.basePosition.x, plant.basePosition.y, 24, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(0, 255, 180, ${meditativeGlow})`;
      ctx.fill();
    }

    // Strobe pulse ring
    if (plant.anomalousEvent === "strobe") {
      const pulseAlpha = Math.max(0, Math.sin(plant.time * 12) * 0.3);
      ctx.beginPath();
      ctx.arc(plant.basePosition.x, plant.basePosition.y, 28, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 255, 255, ${pulseAlpha})`;
      ctx.fill();
    }

    // Damage feedback flash
    if (damageFlash > 0.01) {
      ctx.beginPath();
      ctx.arc(plant.basePosition.x, plant.basePosition.y, 22, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 72, 72, ${
        SimulationEngine.DAMAGE_FLASH_BASE_ALPHA +
        damageFlash * SimulationEngine.DAMAGE_FLASH_PEAK_ALPHA
      })`;
      ctx.fill();
    }

    // Render each tentacle
    for (let ti = 0; ti < plant.tentacles.length; ti++) {
      const tentacle = plant.tentacles[ti];
      const segs = tentacle.segments;

      // Draw stem as a smooth curve
      ctx.beginPath();
      ctx.moveTo(segs[0].position.x, segs[0].position.y);

      for (let i = 1; i < segs.length; i++) {
        const prev = segs[i - 1].position;
        const curr = segs[i].position;
        const cpx = (prev.x + curr.x) / 2;
        const cpy = (prev.y + curr.y) / 2;
        ctx.quadraticCurveTo(prev.x, prev.y, cpx, cpy);
      }

      const lastSeg = segs[segs.length - 1];
      ctx.lineTo(lastSeg.position.x, lastSeg.position.y);

      const t = ti / Math.max(1, plant.tentacles.length - 1);

      // Mourning: darken the drooping tentacle
      let tentacleAlpha = 0.92;
      if (tentacle.mourningTimer > 0) {
        tentacleAlpha = 0.45;
      }

      ctx.strokeStyle = plantColor(t, tentacleAlpha);
      ctx.lineWidth = cfg.tentacleThickness * (1 - t * 0.3);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();

      // Draw jaw at tip
      this.renderJaw(ctx, tentacle, t);
    }
  }

  private renderJaw(
    ctx: CanvasRenderingContext2D,
    tentacle: PlantTentacle,
    colorT: number
  ): void {
    const tip = this.plant.getTip(tentacle);
    const jawAngle = tentacle.jawOpen * 0.5;
    const jawSize = this.config.jawSize;

    // Curiosity: slightly different jaw color
    let fillColor: string;
    if (tentacle.curiosityTimer > 0) {
      fillColor = hsla(50, 80, 60, 0.96); // Yellowish — inspecting
    } else if (tentacle.mourningTimer > 0) {
      fillColor = hsla(0, 40, 30, 0.6); // Dark red — mourning
    } else {
      fillColor = plantColor(colorT + 0.2, 0.96);
    }

    ctx.save();
    ctx.translate(tip.position.x, tip.position.y);
    ctx.rotate(tip.angle);

    // Upper jaw
    ctx.beginPath();
    ctx.arc(0, 0, jawSize, -jawAngle - 0.4, -jawAngle + 0.1, false);
    ctx.lineTo(0, 0);
    ctx.closePath();
    ctx.fillStyle = fillColor;
    ctx.fill();

    // Lower jaw
    ctx.beginPath();
    ctx.arc(0, 0, jawSize, jawAngle - 0.1, jawAngle + 0.4, false);
    ctx.lineTo(0, 0);
    ctx.closePath();
    ctx.fillStyle = fillColor;
    ctx.fill();

    ctx.restore();
  }

  private renderAnomalies(ctx: CanvasRenderingContext2D): void {
    const plant = this.state.plant;
    switch (plant.anomalousEvent) {
      case "strobe":
        this.renderStrobeEffect(ctx, plant);
        break;
      case "anger":
        this.renderAngerEffect(ctx, plant);
        break;
      case "whirlpool":
        this.renderWhirlpoolEffect(ctx, plant);
        break;
      case "supernova":
        this.renderSupernovaEffect(ctx, plant);
        break;
      case "blackHole":
        this.renderBlackHoleEffect(ctx, plant);
        break;
      case "lightning":
        this.renderLightningEffect(ctx, plant);
        break;
    }
  }

  /** Strobe: concentric white pulse rings from the base. */
  private renderStrobeEffect(
    ctx: CanvasRenderingContext2D,
    plant: PlantState
  ): void {
    const baseX = plant.basePosition.x;
    const baseY = plant.basePosition.y;
    const time = plant.time;
    for (let i = 0; i < 3; i++) {
      const phase = (time * 3 + i * 0.7) % 2;
      const radius = phase * 200;
      const alpha = (1 - phase / 2) * 0.12;
      if (alpha <= 0) continue;
      ctx.beginPath();
      ctx.arc(baseX, baseY, radius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  /** Anger: hot red AoE with expanding shockwave rings. */
  private renderAngerEffect(
    ctx: CanvasRenderingContext2D,
    plant: PlantState
  ): void {
    const cfg = this.config;
    const baseX = plant.basePosition.x;
    const baseY = plant.basePosition.y;
    const aoeR = cfg.angerRadius;

    // Steady-state crimson aura — the kill zone
    const auraGrad = ctx.createRadialGradient(baseX, baseY, 8, baseX, baseY, aoeR);
    auraGrad.addColorStop(0, "rgba(255, 70, 60, 0.35)");
    auraGrad.addColorStop(0.55, "rgba(255, 60, 60, 0.12)");
    auraGrad.addColorStop(1, "rgba(255, 40, 40, 0)");
    ctx.fillStyle = auraGrad;
    ctx.beginPath();
    ctx.arc(baseX, baseY, aoeR, 0, Math.PI * 2);
    ctx.fill();

    // Hard outline marking the AoE boundary
    ctx.beginPath();
    ctx.arc(baseX, baseY, aoeR, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255, 90, 90, 0.42)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Expanding shockwave from current pulse
    const pulseR = plant.anomalyRadius;
    if (pulseR > 4 && pulseR <= aoeR * 1.05) {
      const fade = 1 - pulseR / aoeR;
      ctx.beginPath();
      ctx.arc(baseX, baseY, pulseR, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255, 110, 80, ${0.45 * fade})`;
      ctx.lineWidth = 3 + fade * 4;
      ctx.stroke();
    }

    // Tiny ember flecks to sell the menace
    const flecks = 5;
    for (let i = 0; i < flecks; i++) {
      const a = plant.time * 1.4 + i * (Math.PI * 2 / flecks);
      const r = aoeR * (0.55 + 0.4 * ((Math.sin(plant.time * 3 + i) + 1) * 0.5));
      const x = baseX + Math.cos(a) * r;
      const y = baseY + Math.sin(a) * r;
      ctx.beginPath();
      ctx.arc(x, y, 1.6, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255, 180, 90, 0.55)";
      ctx.fill();
    }
  }

  /** Whirlpool: spiral arcs rotating around the base. */
  private renderWhirlpoolEffect(
    ctx: CanvasRenderingContext2D,
    plant: PlantState
  ): void {
    const cfg = this.config;
    const baseX = plant.basePosition.x;
    const baseY = plant.basePosition.y;
    const r = cfg.whirlpoolRadius;
    const spinPhase = plant.time * cfg.whirlpoolSpeed;

    // Capture-radius hint
    ctx.beginPath();
    ctx.arc(baseX, baseY, r, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(120, 200, 255, 0.16)";
    ctx.lineWidth = 1;
    ctx.stroke();

    // Spiral arms — each arm samples (theta → radius) along an Archimedean curve.
    const arms = 4;
    const samples = 36;
    for (let arm = 0; arm < arms; arm++) {
      const armPhase = spinPhase + arm * (Math.PI * 2 / arms);
      ctx.beginPath();
      for (let i = 0; i <= samples; i++) {
        const t = i / samples; // 0 → 1
        const radius = r * (0.05 + t * 0.95);
        const theta = armPhase + t * Math.PI * 1.6;
        const x = baseX + Math.cos(theta) * radius;
        const y = baseY + Math.sin(theta) * radius;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `rgba(140, 220, 255, ${0.25})`;
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }

    // Hot core
    const coreGrad = ctx.createRadialGradient(baseX, baseY, 0, baseX, baseY, cfg.whirlpoolCoreRadius * 2);
    coreGrad.addColorStop(0, "rgba(220, 240, 255, 0.7)");
    coreGrad.addColorStop(1, "rgba(120, 180, 255, 0)");
    ctx.fillStyle = coreGrad;
    ctx.beginPath();
    ctx.arc(baseX, baseY, cfg.whirlpoolCoreRadius * 2, 0, Math.PI * 2);
    ctx.fill();
  }

  /** Supernova: bright expanding shell. */
  private renderSupernovaEffect(
    ctx: CanvasRenderingContext2D,
    plant: PlantState
  ): void {
    const cfg = this.config;
    const baseX = plant.basePosition.x;
    const baseY = plant.basePosition.y;
    const r = plant.anomalyRadius;
    if (r <= 1) return;

    const fade = 1 - Math.min(1, r / cfg.supernovaMaxRadius);

    // Outer thin ring
    ctx.beginPath();
    ctx.arc(baseX, baseY, r, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255, 240, 200, ${0.85 * fade})`;
    ctx.lineWidth = 2 + fade * 3;
    ctx.stroke();

    // Inner glow band
    ctx.beginPath();
    ctx.arc(baseX, baseY, Math.max(1, r - 22), 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255, 200, 120, ${0.35 * fade})`;
    ctx.lineWidth = 18;
    ctx.stroke();

    // Soft halo
    const halo = ctx.createRadialGradient(baseX, baseY, Math.max(0, r - 60), baseX, baseY, r + 30);
    halo.addColorStop(0, `rgba(255, 230, 170, 0)`);
    halo.addColorStop(0.7, `rgba(255, 230, 170, ${0.18 * fade})`);
    halo.addColorStop(1, `rgba(255, 230, 170, 0)`);
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(baseX, baseY, r + 30, 0, Math.PI * 2);
    ctx.fill();
  }

  /** Black hole: dark singularity with rotating accretion disk. */
  private renderBlackHoleEffect(
    ctx: CanvasRenderingContext2D,
    plant: PlantState
  ): void {
    const cfg = this.config;
    if (!plant.anomalyPosition) return;
    const cx = plant.anomalyPosition.x;
    const cy = plant.anomalyPosition.y;
    const r = cfg.blackHoleRadius;

    // Pull-radius haze (inverse — gets brighter near center)
    const haze = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    haze.addColorStop(0, "rgba(180, 120, 220, 0.45)");
    haze.addColorStop(0.45, "rgba(80, 50, 120, 0.18)");
    haze.addColorStop(1, "rgba(20, 10, 30, 0)");
    ctx.fillStyle = haze;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    // Accretion disk — three rotating ellipses
    const spin = plant.time * 1.6;
    for (let i = 0; i < 3; i++) {
      const ringR = cfg.blackHoleCoreRadius + 14 + i * 14;
      const phase = spin + i * 0.8;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(phase);
      ctx.beginPath();
      ctx.ellipse(0, 0, ringR, ringR * 0.35, 0, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(220, 170, 255, ${0.45 - i * 0.1})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    }

    // Event horizon — pure black disk
    ctx.beginPath();
    ctx.arc(cx, cy, cfg.blackHoleCoreRadius, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(5, 0, 12, 0.95)";
    ctx.fill();

    // Thin bright rim
    ctx.beginPath();
    ctx.arc(cx, cy, cfg.blackHoleCoreRadius + 1, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(220, 180, 255, 0.7)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  /** Lightning: jagged polyline visiting each chained orb position. */
  private renderLightningEffect(
    ctx: CanvasRenderingContext2D,
    plant: PlantState
  ): void {
    if (plant.anomalyChain.length < 2 || plant.anomalyChainLife <= 0) return;
    const fade = Math.min(1, plant.anomalyChainLife / 0.35);
    const chain = plant.anomalyChain;

    const drawBolt = (alpha: number, width: number, jitter: number) => {
      ctx.beginPath();
      ctx.moveTo(chain[0].x, chain[0].y);
      for (let i = 1; i < chain.length; i++) {
        const a = chain[i - 1];
        const b = chain[i];
        const segments = 6;
        for (let s = 1; s <= segments; s++) {
          const t = s / segments;
          const x = a.x + (b.x - a.x) * t + (Math.random() - 0.5) * jitter;
          const y = a.y + (b.y - a.y) * t + (Math.random() - 0.5) * jitter;
          ctx.lineTo(x, y);
        }
      }
      ctx.strokeStyle = `rgba(200, 230, 255, ${alpha * fade})`;
      ctx.lineWidth = width;
      ctx.stroke();
    };

    drawBolt(0.18, 6, 9);  // outer halo
    drawBolt(0.55, 2.4, 5); // mid bolt
    drawBolt(1.0, 1.2, 2);  // bright core

    // Glow nodes at each junction
    for (const p of chain) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4 + 6 * fade, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(220, 240, 255, ${0.4 * fade})`;
      ctx.fill();
    }
  }

  /** Apply AoE damage and gravitational forces from the active anomaly. */
  private processAnomalousEffects(s: SimulationState, dt: number): void {
    const cfg = this.config;
    const plant = s.plant;
    if (plant.anomalousEvent === null) return;

    switch (plant.anomalousEvent) {
      case "anger":
        this.applyAngerAoE(s, dt);
        break;
      case "whirlpool":
        this.applyWhirlpoolForce(s, dt);
        break;
      case "supernova":
        this.applySupernovaShell(s);
        break;
      case "blackHole":
        this.applyBlackHoleForce(s, dt);
        break;
      case "lightning":
        this.applyLightningStrike(s, dt);
        break;
    }

    // Cap supernova radius so it doesn't grow forever
    if (plant.anomalousEvent === "supernova" && plant.anomalyRadius > cfg.supernovaMaxRadius) {
      plant.anomalyRadius = cfg.supernovaMaxRadius;
    }
  }

  private applyAngerAoE(s: SimulationState, dt: number): void {
    const cfg = this.config;
    const plant = s.plant;
    const baseX = plant.basePosition.x;
    const baseY = plant.basePosition.y;

    // Pulse cycle: when sub-timer expires, reset the visible shockwave
    plant.anomalySubTimer -= dt;
    if (plant.anomalySubTimer <= 0) {
      plant.anomalySubTimer = cfg.angerPulseInterval;
      plant.anomalyRadius = 0;
    }
    plant.anomalyRadius += (cfg.angerRadius / cfg.angerPulseInterval) * dt;

    const r2 = cfg.angerRadius * cfg.angerRadius;
    for (const c of s.circles) {
      if (c.consumed) continue;
      const dx = c.position.x - baseX;
      const dy = c.position.y - baseY;
      if (dx * dx + dy * dy < r2) {
        this.consumeOrb(s, c);
      }
    }
  }

  private applyWhirlpoolForce(s: SimulationState, dt: number): void {
    const cfg = this.config;
    const plant = s.plant;
    const baseX = plant.basePosition.x;
    const baseY = plant.basePosition.y;
    const r = cfg.whirlpoolRadius;
    const r2 = r * r;
    const core2 = cfg.whirlpoolCoreRadius * cfg.whirlpoolCoreRadius;

    for (const c of s.circles) {
      if (c.consumed) continue;
      const dx = c.position.x - baseX;
      const dy = c.position.y - baseY;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;

      if (d2 < core2) {
        this.consumeOrb(s, c);
        continue;
      }

      const d = Math.sqrt(d2) || 1;
      const nx = dx / d;
      const ny = dy / d;
      // Tangent (90° rotation) — counter-clockwise
      const tx = -ny;
      const ty = nx;
      const proximity = 1 - d / r;
      const inward = cfg.whirlpoolPullSpeed * (0.4 + proximity);
      const tangent = cfg.whirlpoolPullSpeed * (0.5 + proximity * 0.7);

      c.position.x += (tx * tangent - nx * inward) * dt;
      c.position.y += (ty * tangent - ny * inward) * dt;
      c.baseY = c.position.y;
      // Damp horizontal escape velocity so the vortex actually holds them
      c.velocity.x *= 1 - Math.min(0.9, dt * 4);
    }
  }

  private applySupernovaShell(s: SimulationState): void {
    const plant = s.plant;
    const baseX = plant.basePosition.x;
    const baseY = plant.basePosition.y;
    const outer = plant.anomalyRadius;
    const inner = Math.max(0, outer - 40);
    const inner2 = inner * inner;
    const outer2 = outer * outer;
    for (const c of s.circles) {
      if (c.consumed) continue;
      const dx = c.position.x - baseX;
      const dy = c.position.y - baseY;
      const d2 = dx * dx + dy * dy;
      if (d2 >= inner2 && d2 <= outer2) {
        this.consumeOrb(s, c);
      }
    }
  }

  private applyBlackHoleForce(s: SimulationState, dt: number): void {
    const cfg = this.config;
    const plant = s.plant;
    if (!plant.anomalyPosition) return;
    const cx = plant.anomalyPosition.x;
    const cy = plant.anomalyPosition.y;
    const r = cfg.blackHoleRadius;
    const r2 = r * r;
    const core2 = cfg.blackHoleCoreRadius * cfg.blackHoleCoreRadius;

    for (const c of s.circles) {
      if (c.consumed) continue;
      const dx = c.position.x - cx;
      const dy = c.position.y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      if (d2 < core2) {
        this.consumeOrb(s, c);
        continue;
      }
      const d = Math.sqrt(d2) || 1;
      const proximity = 1 - d / r;
      const pull = cfg.blackHolePullStrength * (0.3 + proximity * proximity);
      const nx = dx / d;
      const ny = dy / d;
      c.position.x -= nx * pull * dt;
      c.position.y -= ny * pull * dt;
      c.baseY = c.position.y;
    }
  }

  private applyLightningStrike(s: SimulationState, dt: number): void {
    const cfg = this.config;
    const plant = s.plant;
    plant.anomalySubTimer -= dt;
    if (plant.anomalySubTimer > 0) return;
    plant.anomalySubTimer = cfg.lightningInterval;

    const live: Circle[] = [];
    for (const c of s.circles) {
      if (!c.consumed) live.push(c);
    }
    if (live.length === 0) return;

    const start = live[Math.floor(Math.random() * live.length)];
    const used = new Set<number>([start.id]);
    const chain: Circle[] = [start];
    const maxJump2 = cfg.lightningJumpRadius * cfg.lightningJumpRadius;
    let current = start;
    for (let step = 1; step < cfg.lightningChainCount; step++) {
      let best: Circle | null = null;
      let bestD2 = Infinity;
      for (const c of live) {
        if (used.has(c.id)) continue;
        const dx = c.position.x - current.position.x;
        const dy = c.position.y - current.position.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2 && d2 < maxJump2) {
          bestD2 = d2;
          best = c;
        }
      }
      if (!best) break;
      chain.push(best);
      used.add(best.id);
      current = best;
    }

    const visual: Vector2D[] = [{ x: plant.basePosition.x, y: plant.basePosition.y }];
    for (const c of chain) {
      visual.push({ x: c.position.x, y: c.position.y });
      this.consumeOrb(s, c);
    }
    plant.anomalyChain = visual;
    plant.anomalyChainLife = 0.35;
  }

  private consumeOrb(s: SimulationState, circle: Circle): void {
    if (circle.consumed) return;
    circle.consumed = true;
    circle.targeted = false;
    s.captures += 1;
    this.particles.emit(circle.position, circle.hue);
    if (s.integrity < this.config.regenIntegrityCap) {
      s.integrity = Math.min(
        s.integrity + this.config.captureRegenAmount * 0.5,
        this.config.regenIntegrityCap
      );
    }
  }

  private renderParticles(ctx: CanvasRenderingContext2D): void {
    const pool = this.particles.getPool();

    ctx.lineCap = "butt";
    for (const p of pool) {
      if (!p.active) continue;
      const alpha = p.life / p.maxLife;
      const len = p.size * alpha * 2.5;
      const halfLen = len * 0.5;
      const cosR = Math.cos(p.rotation);
      const sinR = Math.sin(p.rotation);

      ctx.beginPath();
      ctx.moveTo(p.position.x - cosR * halfLen, p.position.y - sinR * halfLen);
      ctx.lineTo(p.position.x + cosR * halfLen, p.position.y + sinR * halfLen);
      ctx.strokeStyle = hsla(p.hue, 70, 72, alpha * 0.8);
      ctx.lineWidth = Math.max(1, p.size * alpha * 0.5);
      ctx.stroke();
    }
  }

  private renderHUD(ctx: CanvasRenderingContext2D, w: number): void {
    const integrity = Math.round(this.state.integrity);
    const color = this.getIntegrityColor(integrity);

    ctx.save();
    ctx.font = "12px 'Geist Mono', monospace";
    ctx.fillStyle = color;
    ctx.textAlign = "right";
    ctx.fillText(`${integrity}`, w - 16, 24);
    ctx.restore();

    // ─── Status labels: top-left, subtle ─────────────────────────────
    this.renderStatusLabels(ctx);
  }

  private renderStatusLabels(ctx: CanvasRenderingContext2D): void {
    const plant = this.state.plant;
    const labels: { text: string; alpha: number }[] = [];

    // Metabolic state
    const metaNames: Record<string, string> = {
      meditative: "MEDITATIVE",
      hyperfixation: "HYPER-FIXATION",
      entropy: "ENTROPY",
    };
    if (plant.metabolicTransition > 0.1) {
      labels.push({
        text: metaNames[plant.metabolicState] ?? plant.metabolicState,
        alpha: plant.metabolicTransition * 0.45,
      });
    }

    // Anomalous event
    const eventNames: Record<string, string> = {
      whirlpool: "WHIRLPOOL",
      anger: "ANGER",
      strobe: "STROBE",
      supernova: "SUPERNOVA",
      blackHole: "BLACK HOLE",
      lightning: "LIGHTNING",
    };
    if (plant.anomalousEvent !== null) {
      labels.push({
        text: eventNames[plant.anomalousEvent] ?? plant.anomalousEvent,
        alpha: 0.55,
      });
    }

    // Psychological expressions (per-tentacle, but show globally if any)
    const hasMourning = plant.tentacles.some(t => t.mourningTimer > 0);
    const hasCuriosity = plant.tentacles.some(t => t.curiosityTimer > 0);
    const hasShiver = plant.tentacles.some(t => t.shiverIntensity > 0.1);
    if (hasMourning) labels.push({ text: "MOURNING", alpha: 0.45 });
    if (hasCuriosity) labels.push({ text: "CURIOSITY", alpha: 0.4 });
    if (hasShiver) labels.push({ text: "SHIVER", alpha: 0.35 });

    // Hyperfixation hue indicator
    if (plant.hyperfixationHue !== null && plant.metabolicState === "hyperfixation") {
      labels.push({
        text: `FIx ${plant.hyperfixationHue}°`,
        alpha: plant.metabolicTransition * 0.35,
      });
    }

    if (labels.length === 0) return;

    ctx.save();
    ctx.font = "10px 'Geist Mono', monospace";
    ctx.textAlign = "left";

    const x = 16;
    let y = 24;

    for (const label of labels) {
      ctx.fillStyle = `rgba(255, 255, 255, ${label.alpha})`;
      ctx.fillText(label.text, x, y);
      y += 16;
    }

    ctx.restore();
  }

  private renderCollapseOverlay(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number
  ): void {
    if (!this.state.isCollapsing && this.state.collapseProgress <= 0) return;

    const alpha = lerpScalar(0, 0.92, this.state.collapseProgress);
    ctx.save();
    ctx.fillStyle = `rgba(0, 0, 0, ${alpha})`;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  private getIntegrityColor(integrity: number): string {
    if (integrity <= 25) return "rgba(255, 86, 86, 0.86)";
    if (integrity <= 50) return "rgba(255, 191, 88, 0.82)";
    return "rgba(255, 255, 255, 0.35)";
  }

  private applyIntegrityDamage(amount: number): void {
    const s = this.state;
    if (s.isCollapsing) return;

    s.integrity = Math.max(0, s.integrity - amount);
    s.damageFlash = 1;

    if (s.integrity <= 0) {
      s.isCollapsing = true;
      s.collapseElapsed = 0;
      s.collapseProgress = 0;
      s.collapseComplete = false;
    }
  }

  isCollapseComplete(): boolean {
    return this.state.collapseComplete;
  }

  /** Snapshot of the current run — read by the UI when the entity collapses. */
  getRunSummary(): { duration: number; captures: number } {
    return {
      duration: this.state.elapsedTime,
      captures: this.state.captures,
    };
  }

  /**
   * Neural Pulse: Calculated sacrifice.
   */
  private processNeuralPulses(s: SimulationState): void {
    const cfg = this.config;
    const maxReachWithSurge = cfg.segmentLength * cfg.segmentsPerTentacle * cfg.surgeReachMultiplier;

    for (const circle of s.circles) {
      if (circle.consumed) continue;

      const speed = Math.abs(circle.velocity.x);
      const eta = speed > 1 ? (circle.position.x - (-50)) / speed : Infinity;

      if (eta < cfg.neuralPulseETA) {
        const dx = circle.position.x - s.plant.basePosition.x;
        const dy = circle.position.y - s.plant.basePosition.y;
        const distFromBase = Math.sqrt(dx * dx + dy * dy);

        if (distFromBase > maxReachWithSurge * 1.05) {
          circle.consumed = true;
          this.applyIntegrityDamage(cfg.neuralPulseCost);
          this.particles.emit(circle.position, circle.hue);
        }
      }
    }
  }
}
