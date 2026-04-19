import { Particle, SimulationConfig, Vector2D } from "@/types/simulation";
import { randomRange } from "@/utils/math";

/**
 * ParticleSystem — object-pooled particle effects.
 * Pre-allocates particles to eliminate garbage collection pressure.
 */
export class ParticleSystem {
  private pool: Particle[];
  private config: SimulationConfig;

  constructor(config: SimulationConfig) {
    this.config = config;
    this.pool = [];

    // Pre-allocate particle pool
    for (let i = 0; i < config.maxParticles; i++) {
      this.pool.push({
        position: { x: 0, y: 0 },
        velocity: { x: 0, y: 0 },
        life: 0,
        maxLife: 1,
        hue: 0,
        size: 2,
        active: false,
      });
    }
  }

  /**
   * Emit a burst of particles at a position with a given hue.
   */
  emit(position: Vector2D, hue: number, count?: number): void {
    const cfg = this.config;
    const burstCount = count ?? cfg.particlesPerBurst;

    for (let i = 0; i < burstCount; i++) {
      const particle = this.getInactive();
      if (!particle) break; // Pool exhausted

      const angle = randomRange(0, Math.PI * 2);
      const speed = randomRange(cfg.particleSpeedMin, cfg.particleSpeedMax);

      particle.position.x = position.x;
      particle.position.y = position.y;
      particle.velocity.x = Math.cos(angle) * speed;
      particle.velocity.y = Math.sin(angle) * speed;
      particle.life = randomRange(cfg.particleLifeMin, cfg.particleLifeMax);
      particle.maxLife = particle.life;
      particle.hue = hue + randomRange(-20, 20);
      particle.size = randomRange(cfg.particleSizeMin, cfg.particleSizeMax);
      particle.active = true;
    }
  }

  /**
   * Update all active particles.
   */
  update(dt: number): void {
    for (const p of this.pool) {
      if (!p.active) continue;

      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        continue;
      }

      // Move with drag
      p.position.x += p.velocity.x * dt;
      p.position.y += p.velocity.y * dt;
      p.velocity.x *= 0.96;
      p.velocity.y *= 0.96;

      // Slight gravity
      p.velocity.y += 30 * dt;
    }
  }

  /**
   * Get all currently active particles for rendering.
   */
  getActive(): Particle[] {
    return this.pool.filter((p) => p.active);
  }

  /**
   * Get the underlying pool for direct iteration (avoids allocation).
   */
  getPool(): Particle[] {
    return this.pool;
  }

  private getInactive(): Particle | null {
    for (const p of this.pool) {
      if (!p.active) return p;
    }
    return null;
  }
}
