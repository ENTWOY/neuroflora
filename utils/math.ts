/** Clamp a value between min and max */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Random float in [min, max) */
export function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** Random integer in [min, max] (inclusive) */
export function randomInt(min: number, max: number): number {
  return Math.floor(randomRange(min, max + 1));
}

/** Sine-based oscillation */
export function oscillate(
  time: number,
  frequency: number,
  amplitude: number,
  phase: number = 0
): number {
  return amplitude * Math.sin(time * frequency + phase);
}

/** Cubic ease-out */
export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** Quadratic ease-in-out */
export function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

/** Simple spring step — returns new velocity */
export function springStep(
  current: number,
  target: number,
  velocity: number,
  stiffness: number,
  damping: number,
  dt: number
): { value: number; velocity: number } {
  const force = (target - current) * stiffness;
  const newVelocity = (velocity + force * dt) * damping;
  return {
    value: current + newVelocity * dt,
    velocity: newVelocity,
  };
}

/** Linear interpolation for scalars */
export function lerpScalar(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Smooth-step interpolation (Hermite) */
export function smoothStep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Pick a random element from an array */
export function randomPick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Multi-layered sine for organic noise-like motion */
export function layeredSine(time: number, phase: number): number {
  return (
    Math.sin(time * 0.7 + phase) * 0.5 +
    Math.sin(time * 1.3 + phase * 2.1) * 0.3 +
    Math.sin(time * 2.7 + phase * 0.7) * 0.2
  );
}
