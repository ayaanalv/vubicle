import { describe, it, expect } from 'vitest';
import { isNearDuplicate, dropRepeats, avoidList, words, AVOID } from '../../src/lib/cards';

const card = (front: string, back = '') => ({ front, back });

describe('near-duplicate cards', () => {
  it('ignores case, punctuation, spacing and filler words', () => {
    expect([...words('What is the  ESCAPE velocity?!')].sort()).toEqual(['escape', 'velocity']);
  });

  // These pairs came from three real batches of cards on the same lecture.
  it('catches the same question asked another way', () => {
    expect(isNearDuplicate(card('What is escape velocity?', 'The minimum launch speed, v_esc = sqrt(2 G M / r).'), card('What is the formula for escape velocity?', 'v_esc = sqrt(2 G M / r)'))).toBe(true);
    expect(
      isNearDuplicate(
        card('What are the characteristics of a geostationary orbit?', 'A period of 24 hours and an altitude about 35,800 km above the equator.'),
        card('What is the altitude and period of a geostationary orbit?', 'Altitude is about 35,800 km above the equator and the period is 24 hours.'),
      ),
    ).toBe(true);
  });

  it('keeps different questions about the same topic', () => {
    expect(isNearDuplicate(card('What is escape velocity?', 'The minimum launch speed to leave without more thrust.'), card("What is the escape velocity from Earth's surface compared to orbital speed?", 'About 11.2 km/s, sqrt(2) times orbital speed.'))).toBe(false);
    expect(isNearDuplicate(card('What is the formula for the speed of a circular orbit?', 'v = sqrt(G M / r)'), card('How does orbital speed relate to the altitude of a circular orbit?', 'Lower orbits are faster.'))).toBe(false);
  });

  it('drops repeats of old cards and of earlier cards in the same batch, and keeps the rest', () => {
    const old = [card('What is escape velocity?', 'The minimum launch speed.')];
    const fresh = [card('Define escape velocity.', 'The minimum launch speed.'), card("What is Kepler's first law?", 'Planets move in ellipses.'), card("State Kepler's first law.", 'Planets move in ellipses.')];
    expect(dropRepeats(fresh, old).map((c) => c.front)).toEqual(["What is Kepler's first law?"]);
  });
});

describe('the do-not-repeat list', () => {
  const at = (front: string, createdAt: number, chunkId?: string) => ({ front, back: '', createdAt, chunkId });
  it('puts cards from the passages being sent first, then the newest', () => {
    const cards = [at('old, other page', 1, 'b'), at('newest, other page', 3, 'b'), at('from this page', 2, 'a')];
    expect(avoidList(cards, new Set(['a']))).toEqual(['from this page', 'newest, other page', 'old, other page']);
  });
  it('stays within its size budget', () => {
    const many = Array.from({ length: 100 }, (_, i) => at(`card ${i} ${'x'.repeat(300)}`, i));
    const list = avoidList(many, new Set());
    expect(list.length).toBeLessThanOrEqual(AVOID.cards);
    expect(list.every((f) => f.length <= AVOID.chars)).toBe(true);
    expect(list.join('').length).toBeLessThanOrEqual(AVOID.total);
  });
});
