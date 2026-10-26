import { test } from '@playwright/test';
import { mockAi } from '../mock-ai';
import { makePdf, makeDocx } from '../fixtures/make';
const lecture = makePdf([
  ['Lecture 4: Orbits and gravitation', 'Kepler showed that planets move in elliptical orbits with the Sun at one focus.', 'A line from the Sun to a planet sweeps equal areas in equal times.'],
  ['Escape velocity is the minimum speed needed to leave a body without further thrust.', 'From the surface of Earth it is about 11.2 km per second.'],
  ['Circular orbit speed follows from setting gravity equal to the centripetal force.', 'Satellites in lower orbits move faster.'],
]);
for (const [name, vp, scheme] of [['desk', { width: 1440, height: 900 }, 'light'], ['desk-dark', { width: 1440, height: 900 }, 'dark'], ['phone', { width: 390, height: 844 }, 'light']] as const) {
  test(`shots ${name}`, async ({ page }) => {
    await page.setViewportSize(vp);
    await page.emulateMedia({ colorScheme: scheme });
    await page.route('**/api/ai', async (r) => r.fulfill({ json: { result: mockAi(r.request().postDataJSON()) } }));
    await page.route('**/api/embed', (r) => r.fulfill({ status: 503, json: {} }));
    const shot = (n: string) => page.screenshot({ path: `.taste-skill/app/${name}-${n}.png` });
    await page.goto('/app/');
    await shot('0-privacy');
    await page.getByRole('button', { name: 'I understand' }).click();
    await shot('1-first-run');
    await page.getByRole('button', { name: 'Create a cubicle' }).click();
    await page.getByLabel('Course name').fill('PHYS 1080');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await page.waitForTimeout(300);
    await shot('2-empty');
    await page.locator('input[type=file][multiple]').setInputFiles([{ name: 'lecture4.pdf', mimeType: 'application/pdf', buffer: Buffer.from(lecture) }, { name: 'syllabus.docx', mimeType: 'application/octet-stream', buffer: Buffer.from(makeDocx(['# Grading', 'Midterm on November 3, 25%.'])) }]);
    await page.waitForTimeout(1500);
    await shot('3-files');
    if (name === 'phone') await page.getByRole('button', { name: 'Done' }).click();
    await page.getByRole('tab', { name: 'Chat' }).click();
    await page.getByLabel('Ask about your material').fill('What is escape velocity?');
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Open source 1' }).waitFor();
    await shot('4-chat');
    await page.getByRole('button', { name: 'Open source 1' }).click();
    await page.waitForTimeout(400);
    await shot('5-viewer');
    await page.keyboard.press('Escape');
    await page.getByRole('tab', { name: /Flashcards/ }).click();
    await page.getByRole('button', { name: 'Make cards' }).click();
    await page.waitForTimeout(900);
    await shot('6-cards');
    await page.getByRole('tab', { name: 'Quiz' }).click();
    await page.getByRole('button', { name: 'Write a quiz' }).click();
    await page.waitForTimeout(900);
    await shot('7-quiz');
    await page.getByRole('tab', { name: 'Concept map' }).click();
    await page.getByRole('button', { name: 'Map the topics' }).click();
    await page.waitForTimeout(900);
    await page.locator('.node').first().click();
    await shot('8-map');
    await page.getByRole('tab', { name: 'Deadlines' }).click();
    await page.getByRole('button', { name: 'Find deadlines' }).click();
    await page.waitForTimeout(900);
    await shot('9-deadlines');
    await page.getByRole('button', { name: /Focus timer/ }).click();
    await shot('10-timer');
  });
}
