import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { mockAi } from '../mock-ai';
import { makePdf, makePptx, makeDocx } from '../fixtures/make';

const lecture = makePdf([
  ['Lecture 4: Orbits and gravitation', 'Kepler showed that planets move in elliptical orbits with the Sun at one focus.'],
  ['Escape velocity is the minimum speed needed to leave a body without further thrust.', 'From the surface of Earth it is about 11.2 km per second.'],
]);
const slides = makePptx([{ paras: ['Newton', 'Every mass attracts every other mass.'] }, { paras: ['Satellites in lower orbits move faster.'], notes: 'Mention the ISS.' }]);
const syllabus = makeDocx(['# Grading', 'Midterm exam on November 3, worth 25%.', 'Assignment 2 due November 14, worth 15%.', 'Weekly quizzes are worth 10% in total.']);

type Busy = { remaining: number };

/** Routes /api to the mock. `busy.remaining` > 0 makes the next calls answer 429 first. */
async function mockApi(page: Page, busy: Busy = { remaining: 0 }) {
  await page.route('**/api/ai', async (route) => {
    if (busy.remaining > 0) {
      busy.remaining--;
      return route.fulfill({ status: 429, headers: { 'retry-after': '1' }, json: { error: 'busy', retryAfter: 1, message: 'busy' } });
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

test('landing page leads into the app and states the privacy terms', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Virtual cubicle\.\s*Boundless mind\./);
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
});

test('subject portal starts a cubicle for that subject', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');
  await page.getByRole('link', { name: /Molecular chemistry/ }).click();
  await page.getByRole('button', { name: 'I understand' }).click();
  await expect(page.getByLabel('Course name')).toHaveValue('Molecular chemistry');
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

test('a busy AI service puts the request in line, then answers', async ({ page }) => {
  await setUp(page, { busy: { remaining: 2 } });
  await addFiles(page, [{ name: 'lecture4.pdf', buffer: buf(lecture), mimeType: 'application/pdf' }]);
  await page.getByLabel('Ask about your material').fill('Why are orbits elliptical?');
  await page.keyboard.press('Enter');
  await expect(page.getByText(/you are in line/)).toBeVisible();
  await expect(page.locator('.line')).toContainText('In line');
  await expect(page.getByRole('button', { name: 'Open source 1' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/you are in line/)).toBeHidden();
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

test('quizzes grade instantly, give partial credit, and are saved for retakes', async ({ page }) => {
  await setUp(page);
  await addFiles(page, [{ name: 'lecture4.pdf', buffer: buf(lecture), mimeType: 'application/pdf' }]);
  await page.getByRole('tab', { name: 'Quiz' }).click();
  await page.getByRole('button', { name: 'Write a quiz' }).click();
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
  await page.getByRole('tab', { name: 'Tutor' }).click();
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
  await page.getByRole('tab', { name: 'Concept map' }).click();
  await page.getByRole('button', { name: 'Map the topics' }).click();
  const node = page.locator('.node').first();
  await node.click();
  await expect(page.locator('.topic-panel')).toBeVisible();
  await page.getByRole('button', { name: 'Ask about it' }).click();
  await expect(page.getByRole('tab', { name: 'Chat' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'Open source 1' })).toBeVisible();
});

test('deadlines are found, edited, and exported to a calendar', async ({ page }) => {
  await setUp(page);
  await addFiles(page, [{ name: 'syllabus.docx', buffer: buf(syllabus) }]);
  await page.getByRole('tab', { name: 'Deadlines' }).click();
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

for (const path of ['/', '/app/']) {
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
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test('landing is usable from the keyboard', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Vubicle home' })).toBeFocused();
});
