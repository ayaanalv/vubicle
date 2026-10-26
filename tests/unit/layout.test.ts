import { describe, it, expect } from 'vitest';
import { forceLayout } from '../../src/lib/layout';

describe('forceLayout', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
  const links = [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'd', to: 'e' }];

  it('keeps every node inside the box', () => {
    for (const p of forceLayout(ids, links).values()) {
      expect(p.x).toBeGreaterThanOrEqual(0.1);
      expect(p.x).toBeLessThanOrEqual(0.9);
      expect(p.y).toBeGreaterThanOrEqual(0.09);
      expect(p.y).toBeLessThanOrEqual(0.91);
    }
  });
  it('is deterministic and spreads nodes apart', () => {
    const a = forceLayout(ids, links);
    expect([...forceLayout(ids, links).values()]).toEqual([...a.values()]);
    const pts = [...a.values()];
    for (let i = 0; i < pts.length; i++)
      for (let j = i + 1; j < pts.length; j++) expect(Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y)).toBeGreaterThan(0.05);
  });
  it('ignores links to unknown topics and handles one node', () => {
    expect(forceLayout(['x'], [{ from: 'x', to: 'nope' }]).get('x')).toEqual({ x: 0.5, y: 0.5 });
  });
});
