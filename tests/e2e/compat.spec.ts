// Browsers that differ from the developer's: older engines, and ones that block site storage.
import { test, expect, type Page } from '@playwright/test';
import { mockAi } from '../mock-ai';
import { makePdf } from '../fixtures/make';

const lecture = makePdf([['Lecture 4: Orbits', 'Kepler showed that planets move in elliptical orbits around the Sun.'], ['Escape velocity is about 11.2 km per second from Earth.']]);

// Features pdf.js 6 calls with no fallback of its own. Browsers before roughly Chrome 147 and Safari 26.2
// lack Math.sumPrecise, and before Chrome 119 and Safari 17.4 lack Promise.withResolvers.
const PRETEND_OLD = 'delete Promise.withResolvers; delete Math.sumPrecise; delete Uint8Array.fromBase64;';

async function mockApi(page: Page) {
  await page.route('**/api/ai', async (r) => r.fulfill({ json: { result: mockAi(r.request().postDataJSON()) } }));
  await page.route('**/api/embed', (r) => r.fulfill({ status: 503, json: {} }));
}

test('PDFs read in a browser without the newest JavaScript features', async ({ page, context }) => {
  await mockApi(page);
  await page.addInitScript(PRETEND_OLD);
  // The PDF worker has its own globals. Imports run in order, so giving the worker entry a first import that
  // removes the features reproduces an old browser there, before the polyfill or pdf.js runs.
  await context.route('**/__pretend-old.js', (route) => route.fulfill({ contentType: 'text/javascript', body: `${PRETEND_OLD}\nexport {};` }));
  // Only the worker's own request (?worker_file). The page's "?worker&url" import of the same file just returns
  // its URL, and must stay untouched, or the features would be removed from the page after its polyfill ran.
  await context.route(/\/src\/app\/pdf\.worker\.ts\?worker_file/, async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, body: `import '/__pretend-old.js';\n${await res.text()}` });
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Expected noise: the mock answers embeddings with 503 on purpose, and the dev server's reload client
  // logs "[vite] ..." lines that do not exist in production.
  page.on('console', (m) => m.type() === 'error' && !/503|\[vite\]|@vite\/client|Vite server/.test(m.text()) && errors.push(m.text()));

  await page.goto('/app/');
  const missing = await page.evaluate(() => typeof (Math as { sumPrecise?: unknown }).sumPrecise);
  expect(missing).toBe('undefined');
  await page.getByRole('button', { name: 'I understand' }).click();
  await page.getByRole('button', { name: 'Create a cubicle' }).click();
  await page.getByLabel('Course name').fill('Older browser');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.locator('input[type=file][multiple]').setInputFiles({ name: 'lecture4.pdf', mimeType: 'application/pdf', buffer: Buffer.from(lecture) });

  const list = page.getByRole('list', { name: 'Files in this cubicle' });
  await expect(list.getByText('2 pages', { exact: false })).toBeVisible();
  await expect(list.getByText('Could not read')).toBeHidden();
  expect(errors).toEqual([]);
});

test('a browser that blocks site storage gets an explanation, not a blank page', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', {
      configurable: true,
      get() {
        throw new DOMException('The user denied permission to access the database.', 'SecurityError');
      },
    });
  });
  await page.goto('/app/');
  await expect(page.getByRole('heading', { name: 'Vubicle can’t save here' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Open vubicle.com in a regular Chrome, Edge, Firefox or Safari window');
  await expect(page.getByRole('alert')).toContainText('Details: SecurityError');
});
