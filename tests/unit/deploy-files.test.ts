import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

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

describe('search and link previews', () => {
  const read = (f: string) => readFileSync(f, 'utf8');
  it('points link previews at a full URL for an image that ships', () => {
    const html = read('index.html');
    const img = html.match(/property="og:image" content="([^"]+)"/)?.[1];
    expect(img).toMatch(/^https:\/\/vubicle\.com\//);
    expect(existsSync('public' + new URL(img!).pathname)).toBe(true);
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
  });
  it('lists only pages that exist in the sitemap, and points robots.txt at it', () => {
    const pages = [...read('public/sitemap.xml').matchAll(/<loc>https:\/\/vubicle\.com\/([^<]*)<\/loc>/g)].map((m) => m[1]);
    expect(pages.length).toBeGreaterThan(0);
    for (const p of pages) expect(existsSync(p ? `${p}index.html` : 'index.html')).toBe(true);
    expect(read('public/robots.txt')).toContain('Sitemap: https://vubicle.com/sitemap.xml');
  });
  it('keeps the workspace and the 404 page out of search results', () => {
    expect(read('app/index.html')).toContain('<meta name="robots" content="noindex" />');
    expect(read('404.html')).toContain('<meta name="robots" content="noindex" />');
  });
});

describe('security headers', () => {
  const headers: { key: string; value: string }[] = JSON.parse(readFileSync('vercel.json', 'utf8')).headers[0].headers;
  const get = (k: string) => headers.find((h) => h.key.toLowerCase() === k.toLowerCase())?.value ?? '';
  it('enforces a policy that allows only the site\'s own scripts and connections', () => {
    const csp = get('Content-Security-Policy');
    const script = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src'));
    expect(script).toBe("script-src 'self'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
  });
  it('turns off device features the site never uses', () => {
    expect(get('Permissions-Policy')).toContain('camera=()');
    expect(get('Permissions-Policy')).toContain('microphone=()');
  });
  it('tells browsers to use HTTPS only, without joining the preload list', () => {
    expect(get('Strict-Transport-Security')).toBe('max-age=63072000; includeSubDomains');
  });

  // Text recognition runs WebAssembly, which needs 'wasm-unsafe-eval'. Only files under /ocr/ get it; pages never do.
  const rules: { source: string; headers: { key: string; value: string }[] }[] = JSON.parse(readFileSync('vercel.json', 'utf8')).headers;
  const ORIGINAL =
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";
  // Vercel matches sources as whole-path regular expressions; this is the same test for these simple patterns.
  const cspFor = (path: string) =>
    rules
      .filter((r) => new RegExp(`^${r.source}$`).test(path))
      .flatMap((r) => r.headers)
      .filter((h) => h.key === 'Content-Security-Policy')
      .map((h) => h.value);
  it('keeps the original policy, without WebAssembly, on every page', () => {
    for (const path of ['/', '/app/', '/app/index.html', '/privacy/', '/assets/app-1.js', '/samples/physics.vubicle', '/ocrx', '/app/ocr/']) expect(cspFor(path)).toEqual([ORIGINAL]);
  });
  it('allows WebAssembly only for the text recognition files, with nothing else changed', () => {
    for (const path of ['/ocr/worker.min.js', '/ocr/tesseract-core-simd-lstm.wasm.js', '/ocr/eng.traineddata.gz'])
      expect(cspFor(path)).toEqual([ORIGINAL.replace("script-src 'self';", "script-src 'self' 'wasm-unsafe-eval';")]);
    const strip = (hs: { key: string; value: string }[]) => hs.filter((h) => h.key !== 'Content-Security-Policy');
    expect(strip(rules.find((r) => r.source === '/ocr/(.*)')!.headers)).toEqual(strip(headers));
  });
});
