// Every image the landing page asks for must load, on a high-DPI phone and on a desktop, since each picks
// different srcset sizes. Runs against the dev server; set SITE_URL=https://vubicle.com to check a deploy.
import { test, expect } from '@playwright/test';

if (process.env.SITE_URL) test.use({ baseURL: process.env.SITE_URL });

const sizes = [
  { name: 'phone, 390px at 3x', viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  { name: 'desktop, 1440px at 1x', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
];

for (const { name, ...device } of sizes) {
  test(`every landing image loads (${name})`, async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ ...device, baseURL });
    const page = await ctx.newPage();
    const images: { url: string; status: number }[] = [];
    page.on('response', (r) => {
      if (r.request().resourceType() === 'image') images.push({ url: r.url(), status: r.status() });
    });
    await page.goto('/', { waitUntil: 'networkidle' });
    // Portal cards are lazy-loaded below the fold.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForLoadState('networkidle');
    await expect.poll(() => page.$$eval('img', (els) => els.every((i) => i.complete))).toBe(true);

    const notOk = images.filter((i) => i.status !== 200);
    expect(notOk, `image requests that failed:\n${notOk.map((i) => `${i.status} ${i.url}`).join('\n')}`).toEqual([]);
    const art = images.filter((i) => i.url.includes('/art/'));
    expect(art.filter((i) => /hero-/.test(i.url)).length).toBeGreaterThan(0);
    expect(art.filter((i) => /(stem|chem|humanities)-/.test(i.url)).length).toBeGreaterThanOrEqual(3);

    const broken = await page.$$eval('img', (els) => els.filter((i) => i.naturalWidth === 0).map((i) => i.currentSrc || i.src || i.alt));
    expect(broken, 'images that did not decode').toEqual([]);
    await ctx.close();
  });
}
