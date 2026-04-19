/** Create an HSL color string */
export function hsl(h: number, s: number, l: number, a: number = 1): string {
  if (a < 1) {
    return `hsla(${h}, ${s}%, ${l}%, ${a})`;
  }
  return `hsl(${h}, ${s}%, ${l}%)`;
}

/** Create an HSLA color string with alpha */
export function hsla(h: number, s: number, l: number, a: number): string {
  return `hsla(${h}, ${s}%, ${l}%, ${a})`;
}

/** Linearly interpolate between two hue values (shortest path) */
export function lerpHue(a: number, b: number, t: number): number {
  let diff = b - a;
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;
  return ((a + diff * t) % 360 + 360) % 360;
}

/** Get a glow-friendly color for a given hue */
export function glowColor(hue: number, alpha: number = 0.6): string {
  return hsla(hue, 100, 60, alpha);
}

/** Plant color gradient: emerald base to cyan tip */
export function plantColor(t: number, alpha: number = 1): string {
  // t: 0 = base (emerald), 1 = tip (cyan)
  const hue = 150 + t * 30; // 150 (green) → 180 (cyan)
  const lightness = 50 + t * 10;
  return hsla(hue, 90, lightness, alpha);
}
