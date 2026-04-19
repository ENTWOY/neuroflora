import { SimulationConfig, SimulationState, Circle, PlantTentacle } from "@/types/simulation";
import { DEFAULT_CONFIG } from "@/constants/simulation";
import { CircleSpawner } from "./CircleSpawner";
import { PlantController } from "./PlantController";
import { CollisionEngine } from "./CollisionEngine";
import { ParticleSystem } from "./ParticleSystem";
import { hsla, plantColor } from "@/utils/color";

/**
 * SimulationEngine — top-level orchestrator.
 * Owns all subsystems and manages the update/render pipeline.
 * Keeps all mutable state outside React for maximum performance.
 */
export class SimulationEngine {
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
    this.state.plant.basePosition.x = width * this.config.plantBaseXRatio;
    this.state.plant.basePosition.y = height * 0.5;
    this.backgroundGradient = this.createBackgroundGradient(width, height);
  }

  /**
   * Advance simulation by dt seconds.
   */
  update(dt: number): void {
    const s = this.state;
    s.elapsedTime += dt;

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
      s.canvasHeight,
      (circle, time) => this.spawner.predictCirclePosition(circle, time)
    );

    // ─── Collision Detection ──────────────────────────────────────
    const collisions = this.collision.detectCollisions(
      s.plant.tentacles,
      s.circles
    );

    // ─── Process Collisions (tentacle captures only) ──────────────
    for (const hit of collisions) {
      this.particles.emit(hit.position, hit.circleHue);
    }

    // ─── Update Particles ─────────────────────────────────────────
    this.particles.update(dt);

    // ─── Cleanup consumed/off-screen circles ──────────────────────
    s.circles = s.circles.filter(
      (c) => !c.consumed && c.position.x > -50
    );
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
    this.renderHUD(ctx, w, h);

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
    for (const circle of circles) {
      if (circle.trail.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(circle.trail[0].x, circle.trail[0].y);
      for (let i = 1; i < circle.trail.length; i++) {
        ctx.lineTo(circle.trail[i].x, circle.trail[i].y);
      }
      ctx.lineTo(circle.position.x, circle.position.y);
      ctx.strokeStyle = hsla(circle.hue, 100, 60, this.config.trailAlpha);
      ctx.lineWidth = circle.radius * 0.8;
      ctx.lineCap = "round";
      ctx.stroke();
    }
  }

  private renderCircles(
    ctx: CanvasRenderingContext2D,
    circles: Circle[]
  ): void {
    for (const circle of circles) {
      // Outer glow
      ctx.beginPath();
      ctx.arc(
        circle.position.x,
        circle.position.y,
        circle.radius,
        0,
        Math.PI * 2
      );
      ctx.fillStyle = hsla(circle.hue, 100, 60, 0.9);
      ctx.shadowColor = hsla(circle.hue, 100, 60, 0.8);
      ctx.shadowBlur = this.config.glowIntensity;
      ctx.fill();
      ctx.shadowBlur = 0;

      // Inner bright core
      ctx.beginPath();
      ctx.arc(
        circle.position.x,
        circle.position.y,
        circle.radius * 0.45,
        0,
        Math.PI * 2
      );
      ctx.fillStyle = hsla(circle.hue, 100, 85, 0.9);
      ctx.fill();
    }
  }

  private renderPlant(ctx: CanvasRenderingContext2D): void {
    const plant = this.state.plant;
    const cfg = this.config;

    // Render base bulb
    ctx.beginPath();
    ctx.arc(
      plant.basePosition.x,
      plant.basePosition.y,
      18,
      0,
      Math.PI * 2
    );
    ctx.fillStyle = plantColor(0, 0.8);
    ctx.shadowColor = this.config.plantGlowColor;
    ctx.shadowBlur = 25;
    ctx.fill();
    ctx.shadowBlur = 0;

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

      // Gradient stroke: thicker at base, thinner at tip
      const t = ti / Math.max(1, plant.tentacles.length - 1);
      ctx.strokeStyle = plantColor(t, 0.9);
      ctx.lineWidth = cfg.tentacleThickness * (1 - t * 0.3);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.shadowColor = plantColor(t, 0.5);
      ctx.shadowBlur = 12;
      ctx.stroke();
      ctx.shadowBlur = 0;

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

    ctx.save();
    ctx.translate(tip.position.x, tip.position.y);
    ctx.rotate(tip.angle);

    // Upper jaw
    ctx.beginPath();
    ctx.arc(0, 0, jawSize, -jawAngle - 0.4, -jawAngle + 0.1, false);
    ctx.lineTo(0, 0);
    ctx.closePath();
    ctx.fillStyle = plantColor(colorT + 0.2, 0.95);
    ctx.shadowColor = plantColor(colorT, 0.6);
    ctx.shadowBlur = 8;
    ctx.fill();

    // Lower jaw
    ctx.beginPath();
    ctx.arc(0, 0, jawSize, jawAngle - 0.1, jawAngle + 0.4, false);
    ctx.lineTo(0, 0);
    ctx.closePath();
    ctx.fillStyle = plantColor(colorT + 0.2, 0.95);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.restore();
  }

  private renderParticles(ctx: CanvasRenderingContext2D): void {
    const pool = this.particles.getPool();

    ctx.save();
    if (this.config.useAdditiveParticles) {
      ctx.globalCompositeOperation = "lighter";
    }

    for (const p of pool) {
      if (!p.active) continue;
      const alpha = p.life / p.maxLife;
      ctx.beginPath();
      ctx.arc(p.position.x, p.position.y, p.size * alpha, 0, Math.PI * 2);
      ctx.fillStyle = hsla(p.hue, 100, 65, alpha * 0.8);
      ctx.shadowColor = hsla(p.hue, 100, 60, alpha * 0.5);
      ctx.shadowBlur = this.config.particleGlowBlur;
      ctx.fill();
    }

    ctx.restore();
  }

  private renderHUD(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    ctx.save();
    ctx.font = "11px 'Geist Mono', monospace";
    ctx.fillStyle = "rgba(255, 255, 255, 0.12)";
    ctx.textAlign = "right";
    ctx.fillText(
      `${Math.round(this.config.circleSpeedMax + this.state.currentSpeedBonus)}`,
      w - 16,
      h - 16
    );
    ctx.restore();
  }
}
