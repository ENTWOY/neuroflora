import { SimulationConfig, SimulationState, Circle, PlantTentacle } from "@/types/simulation";
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

  /**
   * Initialize the engine with a canvas context and dimensions.
   */
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
    };
  }

  /**
   * Handle canvas resize.
   */
  resize(width: number, height: number, dpr: number): void {
    this.dpr = dpr;
    this.state.canvasWidth = width;
    this.state.canvasHeight = height;

    // Translate the plant by the delta so tentacle segments follow the base.
    // Without this, FABRIK would only resync on the next update() call —
    // and when the start overlay is shown the simulation is paused, leaving
    // the rendered bulb visibly detached from the tentacles on large screens.
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
      }
    }

    this.backgroundGradient = this.createBackgroundGradient(width, height);
  }

  /**
   * Advance simulation by dt seconds.
   */
  update(dt: number): void {
    const s = this.state;
    s.elapsedTime += dt;
    s.damageFlash = Math.max(0, s.damageFlash - dt * SimulationEngine.DAMAGE_FLASH_DECAY);

    if (s.isCollapsing) {
      s.collapseElapsed += dt;
      s.collapseProgress = clamp(
        s.collapseElapsed / SimulationEngine.COLLAPSE_DURATION,
        0,
        1
      );
      if (s.collapseProgress >= 1) {
        s.collapseComplete = true;
      }
      this.particles.update(dt);
      return;
    }

    // ─── Difficulty Scaling ───────────────────────────────────────
    s.currentSpawnInterval = this.spawner.getCurrentSpawnInterval(s.elapsedTime);
    s.currentSpeedBonus = this.spawner.getCurrentSpeedBonus(s.elapsedTime);

    // ─── Spawn Circles ────────────────────────────────────────────
    s.timeSinceLastSpawn += dt * 1000; // convert to ms
    if (s.timeSinceLastSpawn >= s.currentSpawnInterval) {
      s.timeSinceLastSpawn = 0;
      const circle = this.spawner.spawn(
        s.canvasWidth,
        s.canvasHeight,
        s.nextCircleId++,
        s.currentSpeedBonus
      );
      s.circles.push(circle);
    }

    // ─── Update Circles ───────────────────────────────────────────
    for (const circle of s.circles) {
      if (!circle.consumed) {
        this.spawner.updateCircle(circle, dt);
      }
    }

    // ─── Update Plant ─────────────────────────────────────────────
    this.plant.update(
      s.plant,
      s.circles,
      dt,
      s.canvasWidth,
      s.canvasHeight,
      s.integrity,
      (circle, time) => this.spawner.predictCirclePosition(circle, time)
    );

    // ─── Collision Detection ──────────────────────────────────────
    const collisions = this.collision.detectCollisions(
      s.plant.tentacles,
      s.circles
    );

    // ─── Process Collisions (tentacle captures only) ──────────────
    const predictor = (circle: Circle, time: number) =>
      this.spawner.predictCirclePosition(circle, time);

    for (const hit of collisions) {
      this.particles.emit(hit.position, hit.circleHue);

      // Regeneration: competence buys time, but early scars never fully heal.
      if (s.integrity < this.config.regenIntegrityCap) {
        s.integrity = Math.min(
          s.integrity + this.config.captureRegenAmount,
          this.config.regenIntegrityCap
        );
      }

      // Post-capture momentum: freed tentacle immediately seeks next target.
      this.plant.onCapture(
        s.plant,
        hit.tentacleIndex,
        s.circles,
        s.canvasWidth,
        s.canvasHeight,
        predictor
      );
    }

    // ─── Update Particles ─────────────────────────────────────────
    this.particles.update(dt);

    // ─── Cleanup consumed/off-screen circles ──────────────────────
    const survivors: Circle[] = [];
    for (const circle of s.circles) {
      if (circle.consumed) continue;
      if (circle.position.x <= -50) {
        this.applyIntegrityDamage(SimulationEngine.ESCAPE_DAMAGE);
        continue;
      }
      survivors.push(circle);
    }
    s.circles = survivors;
  }

  /**
   * Render the full scene.
   */
  render(): void {
    const ctx = this.ctx;
    const s = this.state;
    const w = s.canvasWidth;
    const h = s.canvasHeight;

    ctx.save();
    ctx.scale(this.dpr, this.dpr);

    // ─── Background ───────────────────────────────────────────────
    this.renderBackground(ctx, w, h);

    // ─── Circle Trails ────────────────────────────────────────────
    this.renderCircleTrails(ctx, s.circles);

    // ─── Circles ──────────────────────────────────────────────────
    this.renderCircles(ctx, s.circles);

    // ─── Plant ────────────────────────────────────────────────────
    this.renderPlant(ctx);

    // ─── Particles ────────────────────────────────────────────────
    this.renderParticles(ctx);

    // ─── HUD ──────────────────────────────────────────────────────
    this.renderHUD(ctx, w);

    // ─── Collapse Overlay ─────────────────────────────────────────
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
      width * 0.3,
      height * 0.5,
      0,
      width * 0.5,
      height * 0.5,
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
      const trail = circle.trail;
      const len = trail.length;
      if (len < 2) continue;

      const baseAlpha = this.config.trailAlpha;

      // Draw each segment with conical tapering: thin + faint at tail → thick + bright near head
      for (let i = 0; i < len - 1; i++) {
        const t = (i + 1) / len; // 0→1 from tail to head
        const alpha = t * t * baseAlpha;
        const width = circle.radius * (0.1 + t * 0.5);

        ctx.beginPath();
        ctx.moveTo(trail[i].x, trail[i].y);
        ctx.lineTo(trail[i + 1].x, trail[i + 1].y);
        ctx.strokeStyle = hsla(circle.hue, 70, 50 + t * 25, alpha);
        ctx.lineWidth = width;
        ctx.stroke();
      }

      // Final segment: last trail point → current position (brightest, widest)
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
    const PHI = 1.618033988749; // Golden ratio for pseudo-random variation

    for (const circle of circles) {
      const cx = circle.position.x;
      const cy = circle.position.y;
      const r = circle.radius;
      const moveAngle = Math.atan2(circle.velocity.y, circle.velocity.x);
      const seed = circle.id * PHI;

      // ── Rocky irregular body (7-sided polygon) ──────────────────────
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
      ctx.fillStyle = hsla(circle.hue, 65, 38, 0.94);
      ctx.fill();

      // ── Incandescent leading-edge crescent ──────────────────────────
      const frontX = cx + Math.cos(moveAngle) * r * 0.2;
      const frontY = cy + Math.sin(moveAngle) * r * 0.2;
      ctx.beginPath();
      ctx.arc(frontX, frontY, r * 0.62, moveAngle - 0.85, moveAngle + 0.85);
      ctx.lineTo(frontX, frontY);
      ctx.closePath();
      ctx.fillStyle = hsla(circle.hue, 50, 82, 0.72);
      ctx.fill();

      // ── White-hot core shifted toward front ─────────────────────────
      ctx.beginPath();
      ctx.arc(
        cx + Math.cos(moveAngle) * r * 0.15,
        cy + Math.sin(moveAngle) * r * 0.15,
        r * 0.28,
        0,
        TAU
      );
      ctx.fillStyle = "rgba(255, 255, 255, 0.88)";
      ctx.fill();
    }
  }

  private renderPlant(ctx: CanvasRenderingContext2D): void {
    const plant = this.state.plant;
    const cfg = this.config;
    const damageFlash = this.state.damageFlash;

    // Base bulb — solid fill, no shadow
    ctx.beginPath();
    ctx.arc(
      plant.basePosition.x,
      plant.basePosition.y,
      18,
      0,
      Math.PI * 2
    );
    ctx.fillStyle = plantColor(0, 0.9);
    ctx.fill();

    // Damage feedback flash on plant core
    if (damageFlash > 0.01) {
      ctx.beginPath();
      ctx.arc(
        plant.basePosition.x,
        plant.basePosition.y,
        22,
        0,
        Math.PI * 2
      );
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

      // Draw stem as a smooth curve — no shadow
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
      ctx.strokeStyle = plantColor(t, 0.92);
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
    const jawAngle = tentacle.jawOpen * 0.5; // Max opening angle
    const jawSize = this.config.jawSize;
    const fillColor = plantColor(colorT + 0.2, 0.96);

    ctx.save();
    ctx.translate(tip.position.x, tip.position.y);
    ctx.rotate(tip.angle);

    // Upper jaw — solid fill, no shadow
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

  private renderParticles(ctx: CanvasRenderingContext2D): void {
    const pool = this.particles.getPool();

    // Angular fragment shards — drawn as short rotated lines
    ctx.lineCap = "butt";
    for (const p of pool) {
      if (!p.active) continue;
      const alpha = p.life / p.maxLife;
      const len = p.size * alpha * 2.5; // shard length
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
    if (integrity <= 25) {
      return "rgba(255, 86, 86, 0.86)";
    }
    if (integrity <= 50) {
      return "rgba(255, 191, 88, 0.82)";
    }
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
}
