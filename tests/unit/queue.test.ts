import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ai, nextDelay, formatWait, getLine, generating, whenIdle, CancelledError } from '../../src/app/api';
import { waitMessage } from '../../src/app/ui';

const busy = (retryAfter: number, error = 'busy') => Response.json({ error, retryAfter, message: 'busy' }, { status: 429, headers: { 'retry-after': String(retryAfter) } });
const ok = (result: unknown) => Response.json({ result });

describe('wait times', () => {
  it('never schedules a retry sooner than a second, even if the server says 0', () => {
    expect(nextDelay(0, 0, () => 0)).toBe(2000);
    expect(nextDelay(0, 0.2, () => 0)).toBe(1000);
    expect(nextDelay(3, undefined, () => 0)).toBe(16_000);
    expect(nextDelay(9, undefined, () => 1)).toBe(78_000);
  });
  it('formats waits plainly and never as 0', () => {
    expect(formatWait(0)).toBe('1s');
    expect(formatWait(-500)).toBe('1s');
    expect(formatWait(8_200)).toBe('9s');
    expect(formatWait(125_000)).toBe('2 min 5s');
    expect(formatWait(41 * 60_000)).toBe('41 min');
    expect(formatWait(62 * 60_000)).toBe('1 h 2 min');
  });
  it('says what is happening in words, including long waits', () => {
    const now = 1_000_000;
    expect(waitMessage({ reason: 'busy', state: 'waiting', until: now + 12_000, since: now - 5_000 }, now)).toEqual({
      why: 'The free AI services are busy, so you are in line.',
      next: 'Next try in 12s.',
    });
    expect(waitMessage({ reason: 'busy', state: 'trying', until: now - 1, since: now - 5_000 }, now).next).toBe('Trying again now.');
    expect(waitMessage({ reason: 'busy', state: 'waiting', until: now + 45_000, since: now - 4 * 60_000 }, now).why).toMatch(/busy for 4 min/);
    expect(waitMessage({ reason: 'cap', state: 'waiting', until: now + 41 * 60_000, since: now }, now)).toEqual({
      why: 'You have used this hour’s free AI requests.',
      next: 'The next one opens in 41 min.',
    });
  });
});

describe('ai() waiting in line', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('waits the server’s retry time with a real countdown, shows "trying" in flight, then answers', async () => {
    let calls = 0;
    let release!: (r: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => (++calls === 1 ? Promise.resolve(busy(5)) : new Promise<Response>((r) => (release = r)))));
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const p = ai<string>('chat', {}, { label: 'Answering' });
    expect(generating()).toBe(true);
    await vi.advanceTimersByTimeAsync(10);
    const [w] = getLine();
    expect(w).toMatchObject({ label: 'Answering', reason: 'busy', state: 'waiting', tries: 1 });
    expect(w.until - Date.now()).toBeGreaterThan(4_900);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(getLine()[0].state).toBe('trying');
    release(ok('answer'));
    await expect(p).resolves.toBe('answer');
    expect(getLine()).toEqual([]);
    expect(generating()).toBe(false);
  });

  it('waits out a long hourly cap instead of failing, and Cancel ends it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => busy(41 * 60, 'cap')));
    const p = ai('chat', {}, { label: 'Answering' });
    const settled = p.catch((e) => e);
    await vi.advanceTimersByTimeAsync(10);
    const [w] = getLine();
    expect(w.reason).toBe('cap');
    expect(w.until - Date.now()).toBeGreaterThan(41 * 60_000 - 1_000);
    w.cancel();
    expect(await settled).toBeInstanceOf(CancelledError);
    expect(getLine()).toEqual([]);
  });

  it('lets background indexing resume only when no study request is running', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => busy(3)).mockResolvedValueOnce(busy(3)).mockResolvedValueOnce(ok('x')));
    let idle = false;
    void whenIdle().then(() => (idle = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(idle).toBe(true);
    idle = false;
    const p = ai('quiz', {}, { label: 'Writing your quiz' });
    void whenIdle().then(() => (idle = true));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(idle).toBe(false);
    await vi.advanceTimersByTimeAsync(10_000);
    await p;
    await vi.advanceTimersByTimeAsync(0);
    expect(idle).toBe(true);
  });
});
