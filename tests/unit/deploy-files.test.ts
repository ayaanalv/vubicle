import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';

// Reads .vercelignore with git's own gitignore matching. Vercel uses the same pattern rules.
function ignored(paths: string[]): string[] {
  try {
    return execFileSync('git', ['-c', 'core.excludesFile=.vercelignore', 'check-ignore', '--no-index', ...paths], { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);
  } catch (e) {
    // check-ignore exits 1 when nothing matched.
    if ((e as { status?: number }).status === 1) return [];
    throw e;
  }
}

const publicFiles = execFileSync('git', ['ls-files', 'public'], { encoding: 'utf8' }).split('\n').filter(Boolean);

describe('.vercelignore', () => {
  it('keeps every file the site serves (a bare "art" rule once removed public/art from the deploy)', () => {
    expect(publicFiles.some((f) => f.startsWith('public/art/'))).toBe(true);
    expect(ignored(publicFiles)).toEqual([]);
  });
  it('still leaves the root source art and screenshots out of uploads', () => {
    expect(ignored(['art/hero.jpg', 'docs/screenshots/chat.jpg'])).toEqual(['art/hero.jpg', 'docs/screenshots/chat.jpg']);
  });
});
