// Builds the sample cubicles in public/samples/ with the real AI, once. Opt in, with AI keys in .env.local and
// `npm run dev` running:  MAKE_SAMPLES=1 npx playwright test samples --project=desktop
// For each sample it uploads the source as a PDF, asks three questions in Chat, makes 10 Mixed flashcards, a quiz
// and a concept map, adds the "About this sample" note, waits until search is ready, and exports a backup. About
// 7 AI requests per sample. The sources and notes live in samples/.
import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { makeTextPdf } from '../fixtures/make';
import { SAMPLES } from '../../src/app/samples';

test.skip(!process.env.MAKE_SAMPLES, 'Builds public/samples/ with real AI: MAKE_SAMPLES=1 npx playwright test samples --project=desktop');
test.use({ baseURL: process.env.SAMPLES_URL || 'http://localhost:5173', viewport: { width: 1440, height: 900 } });
test.describe.configure({ mode: 'serial' });
test.setTimeout(15 * 60_000);
const AI = { timeout: 180_000 };

for (const sample of SAMPLES) {
  test(`build the ${sample.id} sample`, async ({ page }) => {
    mkdirSync('public/samples', { recursive: true });
    await page.goto('/app/');
    await page.getByRole('button', { name: 'I understand' }).click();
    await page.getByRole('button', { name: 'Create a cubicle' }).click();
    await page.getByLabel('Course name').fill(sample.name);
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    const pdf = makeTextPdf(readFileSync(`samples/${sample.id}.txt`, 'utf8'));
    await page.locator('input[type=file][multiple]').setInputFiles([{ name: sample.file, mimeType: 'application/pdf', buffer: Buffer.from(pdf) }]);
    await expect(page.getByText(/\d pages/)).toBeVisible({ timeout: 60_000 });

    // Three cited answers in one chat.
    await page.getByRole('tab', { name: 'Chat' }).click();
    for (const [i, q] of sample.questions.entries()) {
      await page.getByLabel('Ask about your material').fill(q);
      await page.getByRole('button', { name: 'Ask', exact: true }).click();
      await expect(page.locator('.msg.ai')).toHaveCount(i + 1, AI);
      await expect(page.locator('.msg.ai').nth(i).getByRole('button', { name: /^Open source/ }).first()).toBeVisible(AI);
    }

    // Ten flashcards at mixed difficulty.
    await page.getByRole('tab', { name: /Flashcards/ }).click();
    await page.locator('#card-level').selectOption('mixed');
    await page.getByRole('button', { name: 'Make cards' }).click();
    await expect(page.getByRole('button', { name: /^Review \d/ })).toBeVisible(AI);

    // A quiz, not taken.
    await page.getByRole('tab', { name: 'Quiz' }).click();
    await page.getByRole('button', { name: 'Write a quiz' }).click();
    await expect(page.getByRole('button', { name: 'Check my answers' })).toBeVisible(AI);

    // A concept map.
    await page.getByRole('button', { name: /^More tools/ }).click();
    await page.getByRole('dialog', { name: 'More tools' }).getByRole('button', { name: /^Concept map/ }).click();
    await page.getByRole('button', { name: 'Map the topics' }).click();
    await expect(page.locator('.node').first()).toBeVisible(AI);

    // The source, author and license, as a note in the cubicle. Added last so no card or answer comes from it.
    await page.getByRole('button', { name: 'Write or paste notes' }).click();
    await page.getByPlaceholder('Week 3 lecture notes').fill('About this sample');
    await page.locator('form', { has: page.getByPlaceholder('Week 3 lecture notes') }).locator('textarea').fill(readFileSync(`samples/${sample.id}-about.txt`, 'utf8').replace(/^About this sample\s*/, ''));
    await page.getByRole('button', { name: 'Add notes' }).click();

    // Every passage embedded, so opening the sample later sends nothing to the embedding service either.
    await expect(page.getByText('smart search ready')).toHaveCount(2, { timeout: 300_000 });

    await page.getByRole('tab', { name: 'Chat' }).click();
    await page.getByRole('button', { name: 'Cubicle and app settings' }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: 'Export a backup' }).click();
    writeFileSync(`public/samples/${sample.id}.vubicle`, readFileSync(await (await download).path()));
  });
}
