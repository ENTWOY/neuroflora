import {
  Circle,
  PlantTentacle,
  SimulationConfig,
  Vector2D,
} from "@/types/simulation";
import { distance } from "@/utils/vector";

export interface CollisionResult {
  circleId: number;
  tentacleIndex: number;
  position: Vector2D;
  circleHue: number;
}

/**
 * CollisionEngine — handles detection of contact between tentacle tips and circles.
 */
export class CollisionEngine {
  private config: SimulationConfig;

  constructor(config: SimulationConfig) {
    this.config = config;
  }

  /**
   * Check all tentacle tips against all active circles.
   * Returns an array of collision events this frame.
   */
  detectCollisions(
    tentacles: PlantTentacle[],
    circles: Circle[]
  ): CollisionResult[] {
    const results: CollisionResult[] = [];
    const jawRadius = this.config.jawSize;

    for (let ti = 0; ti < tentacles.length; ti++) {
      const tentacle = tentacles[ti];
      const segments = tentacle.segments;
      const tipPos = segments[segments.length - 1].position;

      for (const circle of circles) {
        if (circle.consumed) continue;

        const dist = distance(tipPos, circle.position);
        const collisionDist = jawRadius + circle.radius;

        if (dist < collisionDist) {
          results.push({
            circleId: circle.id,
            tentacleIndex: ti,
            position: { ...circle.position },
            circleHue: circle.hue,
          });

          // Mark circle consumed immediately to prevent double-hits
          circle.consumed = true;
          circle.targeted = false;

          // Release this tentacle's target
          tentacle.targetId = null;
          tentacle.jawTarget = 0;

          break; // One collision per tentacle per frame
        }
      }
    }

    return results;
  }

  /**
   * Safety net: forcibly consume any circle that gets too close to the left edge.
   * This guarantees the requirement that NO circle ever reaches the left boundary.
   */
  sweepLeftBoundary(
    circles: Circle[],
    leftBoundary: number
  ): CollisionResult[] {
    const results: CollisionResult[] = [];

    for (const circle of circles) {
      if (circle.consumed) continue;

      if (circle.position.x - circle.radius <= leftBoundary) {
        circle.consumed = true;
        circle.targeted = false;
        results.push({
          circleId: circle.id,
          tentacleIndex: -1,
          position: { ...circle.position },
          circleHue: circle.hue,
        });
      }
    }

    return results;
  }
}
