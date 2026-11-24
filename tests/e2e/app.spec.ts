import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { mockAi } from '../mock-ai';
import { makePdf, makePptx, makeDocx, makeScannedPdf } from '../fixtures/make';
import { SAMPLES } from '../../src/app/samples';

const lecture = makePdf([
  ['Lecture 4: Orbits and gravitation', 'Kepler showed that planets move in elliptical orbits with the Sun at one focus.'],
  ['Escape velocity is the minimum speed needed to leave a body without further thrust.', 'From the surface of Earth it is about 11.2 km per second.'],
]);
const slides = makePptx([{ paras: ['Newton', 'Every mass attracts every other mass.'] }, { paras: ['Satellites in lower orbits move faster.'], notes: 'Mention the ISS.' }]);
const syllabus = makeDocx(['# Grading', 'Midterm exam on November 3, worth 25%.', 'Assignment 2 due November 14, worth 15%.', 'Weekly quizzes are worth 10% in total.']);

type Busy = { remaining: number; error?: 'busy' | 'cap'; retryAfter?: number };

/** Routes /api to the mock. `busy.remaining` > 0 makes the next calls answer 429 first. */
async function mockApi(page: Page, busy: Busy = { remaining: 0 }) {
  await page.route('**/api/ai', async (route) => {
    if (busy.remaining > 0) {
      busy.remaining--;
      const retryAfter = busy.retryAfter ?? 1;
      return route.fulfill({ status: 429, headers: { 'retry-after': String(retryAfter) }, json: { error: busy.error ?? 'busy', retryAfter, message: 'busy' } });
    }
    await route.fulfill({ json: { result: mockAi(route.request().postDataJSON()), provider: 'mock' } });
  });
  await page.route('**/api/embed', (route) => route.fulfill({ status: 503, json: { error: 'config' } }));
}

async function setUp(page: Page, opts: { busy?: Busy } = {}) {
  await mockApi(page, opts.busy);
  await page.goto('/app/');
  await expect(page.getByRole('dialog', { name: 'Before you start' })).toBeVisible();
  await expect(page.getByText('Do not upload anything confidential')).toBeVisible();
  await page.getByRole('button', { name: 'I understand' }).click();
  await page.getByRole('button', { name: 'Create a cubicle' }).click();
  await page.getByLabel('Course name').fill('PHYS 1080');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByLabel('Cubicle', { exact: true })).toHaveValue(/.+/);
}

async function addFiles(page: Page, files: { name: string; buffer: Buffer; mimeType?: string }[]) {
  await page.locator('input[type=file][multiple]').setInputFiles(files.map((f) => ({ mimeType: 'application/octet-stream', ...f })));
}

const buf = (u: Uint8Array) => Buffer.from(u);

/** Opens a tool that lives in the "More tools" drawer. */
async function openTool(page: Page, name: string) {
  await page.getByRole('button', { name: /^More tools/ }).click();
  await page.getByRole('dialog', { name: 'More tools' }).getByRole('button', { name: new RegExp('^' + name) }).click();
}

test('landing page leads into the app and states the privacy terms', async ({ page }) => {
  const api: string[] = [];
  page.on('request', (r) => r.url().includes('/api/') && api.push(r.url()));
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ask your course files. Every answer cites the page.');
  await expect(page.getByRole('link', { name: /Try a sample/ })).toHaveAttribute('href', '/app/?sample=physics');

  // The hero shows a real sample answer; a citation shows the page it came from.
  const demo = page.getByRole('region', { name: /answers from a sample course/ });
  const cited = demo.getByRole('complementary', { name: 'Cited page' });
  await expect(cited.getByText('Keplers-laws-excerpt.pdf')).toBeVisible();
  await expect(cited.locator('.hc-passage.hit')).toHaveCount(1);
  await demo.getByRole('button', { name: /How did Kepler's model/ }).click();
  await expect(demo.getByRole('button', { name: /How did Kepler's model/ })).toHaveAttribute('aria-pressed', 'true');
  const before = await cited.locator('.hc-passage.hit').textContent();
  const chips = demo.locator('.source');
  await chips.last().click();
  await expect(chips.last()).toHaveAttribute('aria-pressed', 'true');
  if ((await chips.count()) > 1) await expect(cited.locator('.hc-passage.hit')).not.toHaveText(before!);
  await demo.getByRole('button', { name: 'Literature' }).click();
  await expect(cited.getByText('The-Tell-Tale-Heart.pdf')).toBeVisible();

  await expect(page.getByText(/sent to Google Gemini, or to Groq/)).toBeVisible();
  await expect(page.getByText(/do not upload anything confidential/i)).toBeVisible();
  // The live search demo finds the cited slide, and says so when the lecture does not cover a question.
  await page.getByLabel(/Ask the sample lecture/).fill('What is escape velocity?');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByText('Orbits and gravitation, slide 9')).toBeVisible();
  await page.getByRole('button', { name: 'Who painted the Mona Lisa?' }).click();
  await expect(page.getByText('The sample lecture does not cover that.', { exact: false })).toBeVisible();
  await page.getByRole('link', { name: /Launch workspace/ }).first().click();
  await expect(page).toHaveURL(/\/app\/$/);
  // The landing page itself never calls the API: the hero reads the sample file.
  expect(api).toEqual([]);
});

test('the privacy page and the 404 page are reachable and lead back in', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('contentinfo').getByRole('link', { name: 'Privacy' }).click();
  await expect(page).toHaveURL(/\/privacy\/$/);
  await expect(page.getByRole('heading', { name: 'Privacy', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'What is sent to the AI' })).toBeVisible();
  await page.goto('/404.html');
  await expect(page.getByRole('heading', { name: 'This page isn’t here' })).toBeVisible();
  await page.getByRole('link', { name: 'Open the workspace' }).click();
  await expect(page).toHaveURL(/\/app\/$/);
});

test('a sample card on the landing page opens that sample', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');
  await page.getByRole('link', { name: /Molecular Chemistry/ }).click();
  await page.getByRole('button', { name: 'I understand' }).click();
  await expect(page.getByLabel('Cubicle', { exact: true }).locator('option:checked')).toHaveText(SAMPLES[1].name);
});

test('files are read in the browser, with clear errors for unsupported ones', async ({ page }) => {
  await setUp(page);
  await addFiles(page, [
    { name: 'lecture4.pdf', buffer: buf(lecture), mimeType: 'application/pdf' },
    { name: 'newton.pptx', buffer: buf(slides) },
    { name: 'syllabus.docx', buffer: buf(syllabus) },
    { name: 'scan.pdf', buffer: buf(makePdf([[], []])), mimeType: 'application/pdf' },
    { name: 'old.ppt', buffer: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 1, 2, 3]) },
  ]);
  const list = page.getByRole('list', { name: 'Files in this cubicle' });
  await expect(list.getByText('2 pages · keyword search')).toBeVisible();
  await expect(list.getByText('2 slides', { exact: false })).toBeVisible();
  await expect(list.getByText(/scanned PDF/)).toBeVisible();
  await expect(list.getByText(/older PowerPoint file/)).toBeVisible();
});

/** Draws lines of text as a "scanned" page in the browser and returns it as JPEG bytes, like a phone scan. */
async function scanOf(page: Page, lines: string[]) {
  const b64 = await page.evaluate((ls) => {
    const c = document.createElement('canvas');
    c.width = 1275;
    c.height = 1650;
    const g = c.getContext('2d')!;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#111';
    g.font = '34px Georgia, serif';
    ls.forEach((l, i) => g.fillText(l, 110, 180 + i * 56));
    return c.toDataURL('image/jpeg', 0.9).split(',')[1];
  }, lines);
  return { width: 1275, height: 1650, jpeg: new Uint8Array(Buffer.from(b64, 'base64')) };
}

test('a scanned PDF is read in the browser page by page, and answers cite the right page', async ({ page }) => {
  test.setTimeout(120_000);
  const sentOut: string[] = [];
  page.on('request', (r) => {
    if (!r.url().startsWith('http://localhost')) sentOut.push(r.url());
  });
  await setUp(page);
  const pdf = makeScannedPdf([
    ['Lecture 4: Orbits and gravitation', 'Kepler showed that planets move in elliptical orbits.'],
    await scanOf(page, ['Escape velocity is the minimum speed needed', 'to leave a body without further thrust.']),
    await scanOf(page, ['Satellites in lower orbits move faster', 'than satellites in higher orbits.']),
  ]);
  await addFiles(page, [{ name: 'scanned-notes.pdf', buffer: buf(pdf), mimeType: 'application/pdf' }]);
  const list = page.getByRole('list', { name: 'Files in this cubicle' });
  // The first PDF on a fresh test server waits for the PDF reader to be prepared, which can pass 5 seconds.
  await expect(list.getByText(/Reading scanned page \d of 2|getting text recognition ready/)).toBeVisible({ timeout: 30_000 });
  await expect(list.getByRole('button', { name: 'Cancel' })).toBeVisible();
  await expect(list.getByText('3 pages', { exact: false })).toBeVisible({ timeout: 90_000 });

  await page.getByLabel('Ask about your material').fill('What is escape velocity?');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await page.getByRole('button', { name: 'Open source 1' }).click();
  const viewer = page.getByRole('complementary', { name: 'Source' });
  await expect(viewer.getByText('p. 2', { exact: true })).toBeVisible();
  await expect(viewer.locator('.passage.hit')).toContainText(/minimum speed/i);
  // Recognition ran here: nothing went to any other server.
  expect(sentOut).toEqual([]);
});

test('a normal PDF never loads the text recognition files', async ({ page }) => {
  const ocr: string[] = [];
  page.on('request', (r) => {
    if (/\/ocr\/|tesseract/i.test(r.url())) ocr.push(r.url());
  });
  await setUp(page);
  await addFiles(page, [{ name: 'lecture4.pdf', buffer: buf(lecture), mimeType: 'application/pdf' }]);
  await expect(page.getByText('2 pages', { exact: false })).toBeVisible();
  await page.getByLabel('Ask about your material').fill('What is escape velocity?');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open source 1' })).toBeVisible();
  expect(ocr).toEqual([]);
});

test('a scanned PDF shows an error, not endless loading, when the OCR files are missing', async ({ page }) => {
  // What CI once served: the site's own page in place of the worker script.
  await page.route('**/ocr/worker.min.js', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Vubicle</title>' }));
  await setUp(page);
  const pdf = makeScannedPdf([await scanOf(page, ['Escape velocity is the minimum speed needed', 'to leave a body without further thrust.'])]);
  await addFiles(page, [{ name: 'scan.pdf', buffer: buf(pdf), mimeType: 'application/pdf' }]);
  const list = page.getByRole('list', { name: 'Files in this cubicle' });
  await expect(list.getByText(/text recognition tools could not be loaded/)).toBeVisible({ timeout: 30_000 });
});

test('reading a scanned PDF can be cancelled', async ({ page }) => {
  await setUp(page);
  const pages = [];
  for (let i = 0; i < 6; i++) pages.push(await scanOf(page, [`Page ${i + 1}: Newton's law of gravitation applies to every mass.`]));
  await addFiles(page, [{ name: 'long-scan.pdf', buffer: buf(makeScannedPdf(pages)), mimeType: 'application/pdf' }]);
  const list = page.getByRole('list', { name: 'Files in this cubicle' });
  await list.getByRole('button', { name: 'Cancel' }).click();
  await expect(list.getByText('long-scan.pdf')).toHaveCount(0);
  // It stays gone: no late progress update brings the row back.
  await page.waitForTimeout(3000);
  await expect(list.getByText('long-scan.pdf')).toHaveCount(0);
});

test('chat answers with citations that open the passage in context', async ({ page }) => {
  await setUp(page);
  await addFiles(page, [{ name: 'lecture4.pdf', buffer: buf(lecture), mimeType: 'application/pdf' }]);
  await page.getByLabel('Ask about your material').fill('What is escape velocity?');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  const cite = page.getByRole('button', { name: 'Open source 1' });
  await expect(cite).toBeVisible();
  await cite.click();
  const viewer = page.getByRole('complementary', { name: 'Source' });
  await expect(viewer.getByRole('heading', { name: 'lecture4.pdf' })).toBeVisible();
  await expect(viewer.locator('.passage.hit')).toContainText('Escape velocity');
  await page.keyboard.press('Escape');
  await expect(viewer).toBeHidden();

  // A question with no matching words is answered locally, without an AI call.
  await page.getByLabel('Ask about your material').fill('mitochondria ribosomes');
  await page.keyboard.press('Enter');
  await expect(page.getByText('I could not find anything about that in your material.', { exact: false })).toBeVisible();
});

for (const tag of ['', ' @phone']) {
  test(`chat renders code, lists and citations without raw markdown${tag}`, async ({ page }) => {
    await setUp(page);
    await addFiles(page, [{ name: 'lecture4.pdf', buffer: buf(lecture), mimeType: 'application/pdf' }]);
    if (tag) await page.getByRole('button', { name: 'Done' }).click();
    await page.getByRole('button', { name: 'Explain the hardest idea here simply' }).click();
    const msg = page.locator('.msg.ai').last();
    await expect(msg.locator('code.code-inline').first()).toHaveText('Amoeba');
    await expect(msg).not.toContainText('`');
    await expect(msg).not.toContainText('**');
    await expect(msg.locator('pre.code-block')).toContainText('    @Override void rotate');
    await expect(msg.locator('.code-lang')).toHaveText('java');
    await expect(msg.locator('li strong')).toHaveText('overridden');
    // The long line scrolls inside its block; the page itself never scrolls sideways.
    const pre = await msg.locator('pre.code-block').evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth, right: el.getBoundingClientRect().right }));
    expect(pre.scroll).toBeGreaterThan(pre.client);
    expect(pre.right).toBeLessThanOrEqual(page.viewportSize()!.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    // A citation chip right after code still opens the source.
    await msg.getByRole('button', { name: 'Open source 1' }).first().click();
    await expect(page.getByRole('complementary', { name: 'Source' })).toBeVisible();
  });
}

test('a busy AI service puts the request in line, then answers', async ({ page }) => {
  await setUp(page, { busy: { remaining: 2 } });
  await addFiles(page, [{ name: 'lecture4.pdf', buffer: buf(lecture), mimeType: 'application/pdf' }]);
  await page.getByLabel('Ask about your material').fill('Why are orbits elliptical?');
  await page.keyboard.press('Enter');
  await expect(page.getByText(/you are in line/)).toBeVisible();
  await expect(page.locator('.line')).toContainText('In line');
  // The wait shows a real number of seconds, or "Trying again now" while a try is in flight. Never 0s.
  await expect(page.locator('.wait strong')).toHaveText(/^(Next try in [1-9]\d*s\.|Trying again now\.)$/);
  await expect(page.locator('.wait')).not.toContainText(/\b0s\b/);
  await expect(page.getByRole('button', { name: 'Open source 1' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/you are in line/)).toBeHidden();
});

test('a long hourly-cap wait is stated plainly and can be cancelled', async ({ page }) => {
  await setUp(page, { busy: { remaining: 1, error: 'cap', retryAfter: 41 * 60 } });
  await addFiles(page, [{ name: 'lecture4.pdf', buffer: buf(lecture), mimeType: 'application/pdf' }]);
  await page.getByLabel('Ask about your material').fill('Why are orbits elliptical?');
  await page.keyboard.press('Enter');
  await expect(page.getByText('You have used this hour’s free AI requests.')).toBeVisible();
  await expect(page.locator('.wait strong')).toHaveText(/The next one opens in 4[1-9] min\./);
  await expect(page.locator('.line')).toContainText('min');
  await page.locator('.wait').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByText(/Cancelled\./)).toBeVisible();
  await expect(page.locator('.line')).toBeHidden();
});

test('flashcards are generated, reviewed and rescheduled', async ({ page }) => {
  await setUp(page);
  await addFiles(page, [{ name: 'lecture4.pdf', buffer: buf(lecture), mimeType: 'application/pdf' }]);
  await page.getByRole('tab', { name: /Flashcards/ }).click();
  await page.getByRole('button', { name: 'Make cards' }).click();
  await expect(page.getByRole('button', { name: /^Review \d/ })).toBeVisible();
  await page.getByRole('button', { name: /^Review/ }).click();
  await page.getByRole('button', { name: 'Show the answer' }).click();
  await page.getByRole('button', { name: /^Good/ }).click();
  // Keyboard review: Space shows, 4 grades Easy.
  await page.keyboard.press(' ');
  await page.keyboard.press('4');
  await expect(page.getByRole('heading', { name: 'All caught up' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to flashcards' }).click();
  await expect(page.getByText('Tomorrow').first()).toBeVisible();

  await page.getByRole('button', { name: 'Write a card' }).click();
  await page.getByLabel('Front', { exact: true }).fill('What is G?');
  await page.getByLabel('Back', { exact: true }).fill('The gravitational constant.');
  await page.getByRole('button', { name: 'Save card' }).click();
  await expect(page.getByText('What is G?')).toBeVisible();
});

test('flashcards have difficulty levels, and more cards never repeat old ones', async ({ page }) => {
  const sent: any[] = [];
  page.on('request', (r) => r.url().endsWith('/api/ai') && sent.push(r.postDataJSON()));
  await setUp(page);
  await addFiles(page, [{ name: 'lecture4.pdf', buffer: buf(lecture), mimeType: 'application/pdf' }]);
  await page.getByRole('tab', { name: /Flashcards/ }).click();
  await expect(page.getByLabel('Difficulty', { exact: true })).toHaveValue('mixed');
  // The lecture has two passages, so ten cards cannot be made: what was made is saved, with a note.
  await page.getByRole('button', { name: 'Make cards' }).click();
  await expect(page.locator('.notice[role=status]')).toHaveText('Made 2 new cards. This material may be mostly covered; try Hard or upload more material.');
  await expect(page.locator('ul.list > li')).toHaveCount(2);
  await expect(page.locator('ul.list .level')).toHaveCount(2);
  expect((await page.locator('ul.list .level').allTextContents()).sort()).toEqual(['Difficulty: Easy', 'Difficulty: Medium']);
  // The same material again: both new cards would repeat old ones, so none are added and nothing is padded.
  await page.getByLabel('Difficulty', { exact: true }).selectOption({ label: 'Hard' });
  await page.getByRole('button', { name: 'Make cards' }).click();
  await expect(page.locator('.notice[role=status]')).toHaveText(/^No new cards this time\./);
  await expect(page.locator('ul.list > li')).toHaveCount(2);
  const asks = sent.filter((b) => b.task === 'flashcards');
  expect(asks.map((b) => b.difficulty)).toEqual(['mixed', 'hard']);
  expect(asks[1].avoid).toHaveLength(2);
  // A hand-written card has no difficulty, so it shows no label.
  await page.getByRole('button', { name: 'Write a card' }).click();
  await page.getByLabel('Front', { exact: true }).fill('What is G?');
  await page.getByLabel('Back', { exact: true }).fill('The gravitational constant.');
  await page.getByRole('button', { name: 'Save card' }).click();
  await expect(page.locator('ul.list > li')).toHaveCount(3);
  await expect(page.locator('ul.list .level')).toHaveCount(2);
});

test('quizzes grade instantly, give partial credit, and are saved for retakes', async ({ page }) => {
  await setUp(page);
  await addFiles(page, [{ name: 'lecture4.pdf', buffer: buf(lecture), mimeType: 'application/pdf' }]);
  await page.getByRole('tab', { name: 'Quiz' }).click();
  await page.getByRole('button', { name: 'Write a quiz' }).click();
  // The question number and its text share one line: the legend is one line tall.
  const legend = page.locator('fieldset.question legend').first();
  await expect(legend).toHaveText(/^1\. \S/);
  const lineHeight = await legend.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight) || parseFloat(getComputedStyle(el).fontSize) * 1.6);
  expect((await legend.boundingBox())!.height).toBeLessThan(lineHeight * 1.5);
  await page.getByLabel(/lecture4\.pdf, p\. \d/).check();
  await page.getByLabel('Yes').check();
  await page.getByPlaceholder('Your answer').fill('Planets move in ellipses around the Sun.');
  await page.getByRole('button', { name: 'Check my answers' }).click();
  await expect(page.getByText('92%')).toBeVisible();
  await expect(page.getByText('Partly right, 75%')).toBeVisible();
  await page.getByRole('button', { name: 'All quizzes' }).click();
  await expect(page.getByText(/best 92%, 1 attempt/)).toBeVisible();
  await page.getByRole('button', { name: 'Retake' }).click();
  await expect(page.getByRole('button', { name: 'Check my answers' })).toBeVisible();
});

test('tutor asks, checks the answer and gives hints', async ({ page }) => {
  await setUp(page);
  await addFiles(page, [{ name: 'lecture4.pdf', buffer: buf(lecture), mimeType: 'application/pdf' }]);
  await openTool(page, 'Tutor');
  await page.getByRole('button', { name: 'Start a session' }).click();
  await expect(page.getByText(/First question/)).toBeVisible();
  await page.getByRole('button', { name: 'Hint' }).click();
  await expect(page.getByText(/Hint: look at the first passage/)).toBeVisible();
  await page.getByLabel('Your answer').fill('True');
  await page.keyboard.press('Enter');
  await expect(page.locator('.verdict.correct')).toBeVisible();
});

test('concept map topics lead to the other tools', async ({ page }) => {
  await setUp(page);
  await addFiles(page, [{ name: 'lecture4.pdf', buffer: buf(lecture), mimeType: 'application/pdf' }]);
  await openTool(page, 'Concept map');
  await page.getByRole('button', { name: 'Map the topics' }).click();
  const node = page.locator('.node').first();
  await node.click();
  await expect(page.locator('.topic-panel')).toBeVisible();
  await page.getByRole('button', { name: 'Ask about it' }).click();
  await expect(page.getByRole('tab', { name: 'Chat' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'Open source 1' })).toBeVisible();
});

test('photos are read by the AI once, then studied and cited like any file', async ({ page }) => {
  const sent: any[] = [];
  page.on('request', (r) => r.url().endsWith('/api/ai') && sent.push(r.postDataJSON()));
  await setUp(page);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC', 'base64');
  await addFiles(page, [{ name: 'whiteboard.png', buffer: png, mimeType: 'image/png' }]);
  await expect(page.getByText('1 photo ·', { exact: false })).toBeVisible();
  // The browser redraws the photo as a JPEG before sending it.
  expect(sent[0]).toMatchObject({ task: 'image', mime: 'image/jpeg' });
  expect(Buffer.from(sent[0].image, 'base64').subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
  await page.getByLabel('Ask about your material').fill('What does Kepler’s second law say?');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await page.getByRole('button', { name: 'Open source 1' }).click();
  const viewer = page.getByRole('complementary', { name: 'Source' });
  await expect(viewer.getByRole('heading', { name: 'whiteboard.png' })).toBeVisible();
  await viewer.getByRole('button', { name: 'Show the photo' }).click();
  await expect(viewer.getByRole('img', { name: 'The photo whiteboard.png' })).toBeVisible();
});

test('a photo with nothing to read says so', async ({ page }) => {
  await setUp(page);
  await page.route('**/api/ai', (route) => route.fulfill({ json: { result: { readable: false, text: '' }, provider: 'mock' } }));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC', 'base64');
  await addFiles(page, [{ name: 'cat.png', buffer: png, mimeType: 'image/png' }]);
  await expect(page.getByText('"cat.png" has no text or diagrams Vubicle could read.')).toBeVisible();
});

test('briefs cover each chosen file, cite their pages, and are saved', async ({ page }) => {
  await setUp(page);
  await addFiles(page, [
    { name: 'lecture4.pdf', buffer: buf(lecture), mimeType: 'application/pdf' },
    { name: 'slides.pptx', buffer: buf(slides) },
  ]);
  await expect(page.getByText('2 slides', { exact: false })).toBeVisible();
  await expect(page.getByText('2 pages', { exact: false })).toBeVisible();
  await openTool(page, 'Briefs');
  await expect(page.getByRole('checkbox', { name: 'lecture4.pdf' })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'slides.pptx' })).toBeChecked();
  await page.getByLabel('Length').selectOption('short');
  await page.getByRole('button', { name: 'Write a brief' }).click();
  await expect(page.getByRole('heading', { name: 'Summary' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'lecture4.pdf' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'slides.pptx' })).toBeVisible();
  await page.locator('section.brief', { has: page.getByRole('heading', { name: 'lecture4.pdf' }) }).getByRole('button', { name: 'Open source 1' }).first().click();
  const viewer = page.getByRole('complementary', { name: 'Source' });
  await expect(viewer.getByRole('heading', { name: 'lecture4.pdf' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'All briefs' }).click();
  await expect(page.getByRole('button', { name: /^Summary: (lecture4, slides|slides, lecture4)$/ })).toBeVisible();
});

test('deadlines are found, edited, and exported to a calendar', async ({ page }) => {
  await setUp(page);
  await addFiles(page, [{ name: 'syllabus.docx', buffer: buf(syllabus) }]);
  await openTool(page, 'Deadlines');
  await page.getByRole('button', { name: 'Find deadlines' }).click();
  await expect(page.getByLabel('Date for Midterm exam')).toHaveValue('2026-11-03');
  await expect(page.getByText('50%')).toBeVisible();
  await page.getByLabel('Mark Midterm exam done').click();
  await expect(page.getByLabel('Mark Midterm exam done')).toBeChecked();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Add to calendar' }).click();
  const ics = readFileSync(await (await download).path(), 'utf8');
  expect(ics).toContain('SUMMARY:Assignment 2 (15%)');
  expect(ics).not.toContain('Midterm');
});

test('deleting offers a backup first, and a backup restores the cubicle', async ({ page }) => {
  await setUp(page);
  await addFiles(page, [{ name: 'lecture4.pdf', buffer: buf(lecture), mimeType: 'application/pdf' }]);
  await expect(page.getByText('2 pages', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Cubicle and app settings' }).click();
  await page.getByRole('menuitem', { name: 'Delete this cubicle' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete PHYS 1080' });
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Export a backup first' }).click();
  const file = await (await download).path();
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Make your first cubicle' })).toBeVisible();
  await page.locator('input[type=file][accept=".vubicle,.zip"]').setInputFiles({ name: 'PHYS-1080.vubicle', mimeType: 'application/zip', buffer: readFileSync(file) });
  await expect(page.getByLabel('Cubicle', { exact: true }).locator('option:checked')).toHaveText('PHYS 1080');
  await expect(page.getByRole('list', { name: 'Files in this cubicle' }).getByText('lecture4.pdf')).toBeVisible();
});

test('the menu shows the last backup, and a week without one brings a reminder', async ({ page }) => {
  await setUp(page);
  const menu = page.getByRole('button', { name: 'Cubicle and app settings' });
  const reminder = page.getByRole('status').filter({ hasText: 'Your work is stored only in this browser' });
  await addFiles(page, [{ name: 'lecture4.pdf', buffer: buf(lecture), mimeType: 'application/pdf' }]);
  await expect(page.getByText('2 pages', { exact: false })).toBeVisible();

  await menu.click();
  await expect(page.getByText('Never backed up')).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Export a backup' }).click();
  await download;
  await menu.click();
  await expect(page.getByText('Last backed up today')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(reminder).toHaveCount(0);

  // Clearing the stored date brings back "Never backed up".
  const key = await page.evaluate(() => `vubicle.backup.${localStorage.getItem('vubicle.current')}`);
  await page.evaluate((k) => localStorage.removeItem(k), key);
  await page.reload();
  await menu.click();
  await expect(page.getByText('Never backed up')).toBeVisible();
  await page.keyboard.press('Escape');

  // Nine days since the last backup: the reminder shows, exporting from it clears it.
  await page.evaluate((k) => localStorage.setItem(k, String(Date.now() - 9 * 86_400_000)), key);
  await page.reload();
  await expect(reminder).toContainText('PHYS 1080 was last backed up 9 days ago.');
  const again = page.waitForEvent('download');
  await reminder.getByRole('button', { name: 'Export a backup' }).click();
  await again;
  await expect(reminder).toHaveCount(0);

  // Dismissing it keeps it away after a reload.
  await page.evaluate((k) => localStorage.setItem(k, String(Date.now() - 9 * 86_400_000)), key);
  await page.reload();
  await page.getByRole('button', { name: 'Dismiss backup reminder' }).click();
  await expect(reminder).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Chat' })).toBeVisible();
  await expect(reminder).toHaveCount(0);
});

test('persistent storage is asked for once per visit, and not when already granted', async ({ page }) => {
  // A stand-in for the browser's storage API that counts calls. `vubicle.test.persisted` says whether storage is already persistent.
  await page.addInitScript(() => {
    const w = window as unknown as { persistCalls: number };
    w.persistCalls = 0;
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: Object.assign(Object.create(navigator.storage), {
        persisted: async () => localStorage.getItem('vubicle.test.persisted') === '1',
        persist: async () => (w.persistCalls++, false),
      }),
    });
  });
  await setUp(page);
  const calls = () => page.evaluate(() => (window as unknown as { persistCalls: number }).persistCalls);
  const add = async (name: string) => {
    await addFiles(page, [{ name, buffer: buf(lecture), mimeType: 'application/pdf' }]);
    await expect(page.getByRole('list', { name: 'Files in this cubicle' }).getByText(name)).toBeVisible();
  };
  await add('one.pdf');
  await expect.poll(calls).toBe(1);
  await add('two.pdf');
  expect(await calls()).toBe(1);

  // A new visit asks again on its first file.
  await page.reload();
  expect(await calls()).toBe(0);
  await add('three.pdf');
  await expect.poll(calls).toBe(1);

  // Already persistent: nothing to ask.
  await page.evaluate(() => localStorage.setItem('vubicle.test.persisted', '1'));
  await page.reload();
  await add('four.pdf');
  await page.waitForTimeout(300);
  expect(await calls()).toBe(0);
});

for (const path of ['/', '/app/', '/privacy/', '/404.html']) {
  test(`no horizontal scrolling on ${path} @phone`, async ({ page }) => {
    await mockApi(page);
    await page.goto(path);
    if (path === '/app/') {
      await page.getByRole('button', { name: 'I understand' }).click();
      await page.getByRole('button', { name: 'Create a cubicle' }).click();
      await page.getByLabel('Course name').fill('Phone course');
      await page.getByRole('button', { name: 'Create', exact: true }).click();
      await addFiles(page, [{ name: 'lecture4.pdf', buffer: buf(lecture), mimeType: 'application/pdf' }]);
      await expect(page.getByText('2 pages', { exact: false })).toBeVisible();
      await page.getByRole('button', { name: 'Done' }).click();
      // A long first question makes a long chat title in the history row, which once pushed "New" off screen.
      await page.getByLabel('Ask about your material').fill('Why is escape velocity higher than the circular orbital speed at the same radius?');
      await page.keyboard.press('Enter');
      const newChat = page.getByRole('button', { name: 'New', exact: true });
      await expect(newChat).toBeVisible();
      const box = await newChat.boundingBox();
      expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test('chat declines to do graded work and offers study help instead', async ({ page }) => {
  await setUp(page);
  await addFiles(page, [{ name: 'lecture4.pdf', buffer: buf(lecture), mimeType: 'application/pdf' }]);
  await page.getByLabel('Ask about your material').fill('solve this assignment for me.');
  await page.keyboard.press('Enter');
  // The declined reply stays the first answer; the follow-up below adds a second one after it.
  const msg = page.locator('.msg.ai').first();
  await expect(msg.locator('.verdict.info')).toHaveText('Study help, not a solution');
  await expect(msg).not.toContainText('Not in your material');
  // Only the passages the reply cites get source chips.
  await expect(msg.locator('.sources .source')).toHaveCount(2);
  // "Review my code" readies the box for pasted code without sending anything.
  await msg.getByRole('button', { name: 'Review my code' }).click();
  const box = page.getByLabel('Ask about your material');
  await expect(box).toBeFocused();
  await expect(box).toHaveValue(/^Here is my code so far\./);
  await box.fill('');
  // "Make me a plan" asks a follow-up that is answered normally.
  await msg.getByRole('button', { name: 'Make me a plan' }).click();
  await expect(page.locator('.msg.student').last()).toContainText('Break down what this assignment asks for');
  await expect(page.locator('.msg.ai')).toHaveCount(2);
  await expect(page.locator('.msg.ai').last().locator('.verdict')).toHaveCount(0);
  // "Quiz me on it" opens a tutor session.
  await msg.getByRole('button', { name: 'Quiz me on it' }).click();
  await expect(page.getByRole('button', { name: 'More tools: Tutor' })).toBeVisible();
});

for (const tag of ['', ' @phone']) {
  test(`three main tabs, every other tool in the drawer, and samples in the menu${tag}`, async ({ page }) => {
    const api: string[] = [];
    await setUp(page);
    await addFiles(page, [{ name: 'lecture4.pdf', buffer: buf(lecture), mimeType: 'application/pdf' }]);
    await expect(page.getByText('2 pages', { exact: false })).toBeVisible();
    if (tag) await page.getByRole('button', { name: 'Done' }).click();
    const tabs = page.getByRole('tablist', { name: 'Study tools' }).getByRole('tab');
    // What is on screen (hidden labels for the other screen size are left out).
    expect((await tabs.filter({ visible: true }).allInnerTexts()).map((t) => t.trim())).toEqual(tag ? ['Files', 'Chat', 'Cards', 'Quizzes'] : ['Cited chat', 'Flashcards', 'Quizzes']);
    // Every tab and the More tools button are fully on screen, with no sideways scrolling.
    const width = page.viewportSize()!.width;
    for (const el of [...(await tabs.filter({ visible: true }).all()), page.getByRole('button', { name: /^More tools/ })]) {
      const box = (await el.boundingBox())!;
      expect(box.x + box.width).toBeLessThanOrEqual(width);
    }
    const overflow = () => page.locator('.tools').evaluate((t) => [t, t.querySelector('.tablist')!].map((e) => e.scrollWidth - e.clientWidth));
    expect(await overflow()).toEqual([0, 0]);
    // With a source open beside the chat the study area narrows; every tab must still fit.
    await page.getByLabel('Ask about your material').fill('What is escape velocity?');
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Open source 1' }).click();
    if (!tag) expect(await overflow()).toEqual([0, 0]);
    await page.keyboard.press('Escape');

    // The drawer lists every other tool, and the timer.
    await page.getByRole('button', { name: /^More tools/ }).click();
    const drawer = page.getByRole('dialog', { name: 'More tools' });
    for (const name of ['Tutor', 'Concept map', 'Briefs', 'Deadlines']) await expect(drawer.getByRole('button', { name: new RegExp('^' + name) })).toBeVisible();
    await expect(drawer.getByRole('heading', { name: 'Focus timer' })).toBeVisible();
    // A running timer shows its countdown in the top bar, which reopens the drawer.
    await drawer.getByRole('button', { name: 'Start' }).click();
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await page.getByRole('button', { name: /^Focus timer, Focus, 2\d:\d\d left/ }).click();
    await expect(drawer).toBeVisible();
    await drawer.getByRole('button', { name: 'Pause' }).click();
    await drawer.getByRole('button', { name: /^Deadlines/ }).click();
    await expect(page.getByRole('button', { name: 'More tools: Deadlines' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Find deadlines' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Focus timer/ })).toHaveCount(0);

    // Samples open from the workspace menu, with no request to the API.
    page.on('request', (r) => r.url().includes('/api/') && api.push(r.url()));
    await page.getByRole('button', { name: 'Cubicle and app settings' }).click();
    await page.getByRole('menuitem', { name: SAMPLES[0].label }).click();
    await expect(page.getByLabel('Cubicle', { exact: true }).locator('option:checked')).toHaveText(SAMPLES[0].name);
    expect(api).toEqual([]);
  });
}

test('the focus timer starts at its full length even after the page sat idle', async ({ page }) => {
  // A controllable clock: let the timer sit paused for a while, as on the live site, then press Start.
  await page.clock.install();
  await setUp(page);
  const face = page.locator('.timer-face');
  await page.getByRole('button', { name: /^More tools/ }).click();
  await expect(face).toHaveText('25:00');
  // Pause the clock so no tick can correct the display before it is read.
  await page.clock.pauseAt(new Date((await page.evaluate(() => Date.now())) + 1000));
  await page.clock.runFor(4 * 60_000 + 5_000);
  await page.getByRole('button', { name: 'Start' }).click();
  // Read once, at once. Before the fix this said 29:05: 25 minutes plus the idle time.
  expect(await face.textContent()).toMatch(/^(25:00|24:59)$/);
  await page.clock.runFor(60_000);
  expect(await face.textContent()).toMatch(/^(24:00|23:59)$/);
});

test('landing is usable from the keyboard', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Vubicle home' })).toBeFocused();
});

test('the AI endpoints refuse requests without a valid token, and the page gets one on its own', async ({ page, request, baseURL }) => {
  const origin = { origin: baseURL! };
  const body = { task: 'chat', question: 'x', passages: [] };
  expect((await request.post('/api/ai', { headers: origin, data: body })).status()).toBe(401);
  expect((await request.post('/api/embed', { headers: origin, data: { texts: ['x'] } })).status()).toBe(401);
  expect((await request.post('/api/ai', { headers: { ...origin, 'x-vubicle-token': 'made.up' }, data: body })).status()).toBe(401);
  const tokenRes = await request.post('/api/token', { headers: origin });
  expect(tokenRes.status()).toBe(200);
  const { token } = await tokenRes.json();
  // With the token the request gets past the check. The empty passage list is then refused as bad input before any
  // AI is called (or, with no keys set, the stand-in answers), so this never spends real quota.
  expect([200, 400]).toContain((await request.post('/api/ai', { headers: { ...origin, 'x-vubicle-token': token }, data: body })).status());

  // The page itself fetches a token from the real /api/token and sends it with every AI and embedding request.
  // Those requests go to the stand-in AI, so tests never spend real quota even when .env.local holds keys.
  const issued: string[] = [];
  const sent: (string | null)[] = [];
  page.on('response', async (r) => {
    if (r.url().endsWith('/api/token') && r.ok()) issued.push((await r.json()).token);
  });
  await page.route('**/api/ai', async (route) => {
    sent.push(route.request().headers()['x-vubicle-token'] ?? null);
    await route.fulfill({ json: { result: mockAi(route.request().postDataJSON()), provider: 'mock' } });
  });
  await page.route('**/api/embed', async (route) => {
    sent.push(route.request().headers()['x-vubicle-token'] ?? null);
    await route.fulfill({ status: 503, json: { error: 'config' } });
  });
  await page.goto('/app/');
  await page.getByRole('button', { name: 'I understand' }).click();
  await page.getByRole('button', { name: 'Create a cubicle' }).click();
  await page.getByLabel('Course name').fill('PHYS 1080');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await addFiles(page, [{ name: 'lecture4.pdf', buffer: buf(lecture), mimeType: 'application/pdf' }]);
  await page.getByLabel('Ask about your material').fill('What is escape velocity?');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open source 1' })).toBeVisible();
  await expect.poll(() => sent.length).toBeGreaterThan(0);
  await expect.poll(() => issued.length).toBeGreaterThan(0);
  expect(sent.every((t) => t !== null && issued.includes(t))).toBe(true);
});

for (const sample of SAMPLES) {
  test(`the ${sample.id} sample opens with everything made, and sends nothing to the API`, async ({ page }) => {
    const api: string[] = [];
    page.on('request', (r) => r.url().includes('/api/') && api.push(r.url()));
    await page.goto('/app/');
    await page.getByRole('button', { name: 'I understand' }).click();
    await page.getByRole('button', { name: sample.label }).click();
    await expect(page.getByLabel('Cubicle', { exact: true }).locator('option:checked')).toHaveText(sample.name);
    const files = page.getByRole('list', { name: 'Files in this cubicle' });
    await expect(files.getByText(sample.file)).toBeVisible();
    await expect(files.getByText('About this sample')).toBeVisible();

    // Three cited answers, and a citation opens the page it came from.
    await page.getByRole('tab', { name: 'Chat' }).click();
    await expect(page.locator('.msg.ai')).toHaveCount(3);
    await page.locator('.msg.ai').first().getByRole('button', { name: /^Open source/ }).first().click();
    await expect(page.getByRole('complementary', { name: 'Source' }).getByRole('heading', { name: sample.file })).toBeVisible();
    await page.keyboard.press('Escape');

    await page.getByRole('tab', { name: /Flashcards/ }).click();
    await expect(page.locator('ul.list > li')).toHaveCount(10);
    expect(new Set(await page.locator('ul.list .level').allTextContents())).toEqual(new Set(['Difficulty: Easy', 'Difficulty: Medium', 'Difficulty: Hard']));
    await page.getByRole('tab', { name: 'Quiz' }).click();
    await expect(page.getByText('8 questions · not taken yet')).toBeVisible();
    await openTool(page, 'Concept map');
    // The map draws after the tool opens; wait for its topics instead of counting at once.
    await expect.poll(() => page.locator('.node').count()).toBeGreaterThanOrEqual(4);

    // Opening it again goes to the same cubicle instead of a second copy.
    await page.goto(`/app/?sample=${sample.id}`);
    await expect(page.getByLabel('Cubicle', { exact: true }).locator('option:checked')).toHaveText(sample.name);
    await expect(page.getByLabel('Cubicle', { exact: true }).locator('option', { hasText: sample.name })).toHaveCount(1);
    expect(api).toEqual([]);
  });
}

test('a sample link opens the sample on a first visit', async ({ page }) => {
  const api: string[] = [];
  page.on('request', (r) => r.url().includes('/api/') && api.push(r.url()));
  await page.goto('/app/?sample=chemistry');
  await page.getByRole('button', { name: 'I understand' }).click();
  await expect(page.getByLabel('Cubicle', { exact: true }).locator('option:checked')).toHaveText(SAMPLES[1].name);
  await expect(page).toHaveURL(/\/app\/$/);
  expect(api).toEqual([]);
});
