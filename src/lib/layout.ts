// A small force-directed layout for the concept map. Deterministic, so a saved map always looks the same.

export interface Pt {
  x: number;
  y: number;
}

/**
 * Pull toward the centre. Strong enough that a topic with no links stays near the others: at 0.05 a lone
 * topic drifted to a corner and, once the layout was stretched to fit, squeezed the rest into a strip.
 */
const GRAVITY = 1.5;

/**
 * Above this many topics the force layout's all-pairs loop gets slow (400 rounds of n squared), so topics go
 * on a circle instead. Maps from the AI have at most 16.
 */
export const FORCE_LIMIT = 300;

/** Topics evenly spaced on an ellipse that fills the box. Instant for any number of topics. */
export function circleLayout(ids: string[]): Map<string, Pt> {
  const n = ids.length;
  return new Map(ids.map((id, i) => {
    const a = (i / Math.max(1, n)) * Math.PI * 2 - Math.PI / 2;
    return [id, n === 1 ? { x: 0.5, y: 0.5 } : { x: 0.5 + Math.cos(a) * 0.38, y: 0.5 + Math.sin(a) * 0.4 }];
  }));
}

/** Positions in 0..1 on both axes for an area of the given aspect ratio (width / height). */
export function forceLayout(ids: string[], links: { from: string; to: string }[], aspect = 1.6, iterations = 400): Map<string, Pt> {
  const n = ids.length;
  if (n > FORCE_LIMIT) return circleLayout(ids);
  const pos = ids.map((_, i) => {
    const a = (i / Math.max(1, n)) * Math.PI * 2;
    return { x: Math.cos(a) * 0.35 * aspect, y: Math.sin(a) * 0.35 };
  });
  const index = new Map(ids.map((id, i) => [id, i]));
  const edges = links.map((l) => [index.get(l.from), index.get(l.to)]).filter((e): e is [number, number] => e[0] !== undefined && e[1] !== undefined);
  const k = Math.sqrt((aspect * 1) / Math.max(1, n)) * 0.75;
  for (let it = 0; it < iterations; it++) {
    const t = 0.08 * (1 - it / iterations) + 0.005;
    const disp = pos.map(() => ({ x: 0, y: 0 }));
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        const dx = pos[i].x - pos[j].x || 1e-3;
        const dy = pos[i].y - pos[j].y || 1e-3;
        const d = Math.max(0.01, Math.hypot(dx, dy));
        const f = (k * k) / d;
        disp[i].x += (dx / d) * f;
        disp[i].y += (dy / d) * f;
        disp[j].x -= (dx / d) * f;
        disp[j].y -= (dy / d) * f;
      }
    for (const [a, b] of edges) {
      const dx = pos[a].x - pos[b].x;
      const dy = pos[a].y - pos[b].y;
      const d = Math.max(0.01, Math.hypot(dx, dy));
      const f = (d * d) / k;
      disp[a].x -= (dx / d) * f;
      disp[a].y -= (dy / d) * f;
      disp[b].x += (dx / d) * f;
      disp[b].y += (dy / d) * f;
    }
    for (let i = 0; i < n; i++) {
      disp[i].x -= pos[i].x * GRAVITY;
      disp[i].y -= pos[i].y * GRAVITY;
      const d = Math.hypot(disp[i].x, disp[i].y) || 1;
      pos[i].x += (disp[i].x / d) * Math.min(d, t);
      pos[i].y += (disp[i].y / d) * Math.min(d, t);
    }
  }
  // Fit into the unit box with margins.
  const xs = pos.map((p) => p.x);
  const ys = pos.map((p) => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const out = new Map<string, Pt>();
  ids.forEach((id, i) =>
    out.set(id, {
      x: n === 1 ? 0.5 : 0.12 + ((pos[i].x - x0) / (x1 - x0 || 1)) * 0.76,
      y: n === 1 ? 0.5 : 0.1 + ((pos[i].y - y0) / (y1 - y0 || 1)) * 0.8,
    }),
  );
  return out;
}
