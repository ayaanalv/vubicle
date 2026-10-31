// Screenshots for the README, taken on the live site with real AI answers.
// Run: README_SHOTS=1 npx playwright test readme --project=desktop
// It sends about eight AI requests from a fresh browser profile, using sample material written for the demo.
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { makePdf, makeDocx } from '../fixtures/make';

test.skip(!process.env.README_SHOTS, 'README screenshots: README_SHOTS=1 npx playwright test readme --project=desktop');
test.use({ baseURL: process.env.README_URL || 'https://vubicle.com', viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
test.setTimeout(8 * 60_000);

const OUT = 'docs/screenshots';
const AI = { timeout: 120_000 };

const lecture = makePdf([
  ['PHYS 1080 Lecture 4: Orbits and gravitation', '', 'Newton: every mass attracts every other mass with a force', 'F = G m1 m2 / r^2, where G = 6.67 x 10^-11 N m^2 / kg^2.', 'Gravity is always attractive and acts along the line between the masses.'],
  ['Kepler\'s first law: planets move in ellipses with the Sun at one focus.', 'An orbit is bound when total energy is below zero; the path is an ellipse.', 'Kepler\'s second law: a line from the Sun sweeps equal areas in equal times,', 'so a planet moves fastest at perihelion and slowest at aphelion.', 'This follows from conservation of angular momentum.'],
  ['Kepler\'s third law: T^2 is proportional to a^3.', 'For orbits around the Sun, T in years and a in astronomical units give T^2 = a^3.', 'Example: Mars has a = 1.52 AU, so T = 1.52^1.5 = 1.87 years.'],
  ['Circular orbits: set gravity equal to the centripetal force.', 'G M m / r^2 = m v^2 / r gives v = sqrt(G M / r).', 'Lower orbits are faster. The ISS at 400 km moves at about 7.7 km/s.'],
  ['Escape velocity is the minimum launch speed to leave without more thrust.', 'Setting kinetic plus potential energy to zero gives v_esc = sqrt(2 G M / r).', 'From Earth\'s surface v_esc is about 11.2 km/s, sqrt(2) times orbital speed.'],
  ['Gravitational potential energy: U = -G M m / r, with zero at infinity.', 'It is negative because work must be done to separate the masses.', 'Common mistake: using U = m g h far from the surface. It only holds near it.'],
  ['Geostationary orbit: period 24 h, altitude about 35,800 km above the equator.', 'Satellites there stay over one point and are used for weather and TV.', 'Exam note: expect one question on orbital period and one on escape speed.'],
]);
const syllabus = makeDocx([
  '# PHYS 1080 course outline',
  'Instructor office hours are Tuesdays 2 to 4 pm.',
  '# Evaluation',
  'Weekly online quizzes, 10% in total.',
  'Lab reports, 15% in total, due each Friday.',
  'Assignment 1 due October 2, 2026, worth 5%.',
  'Midterm exam on November 3, 2026, worth 25%.',
  'Assignment 2 due November 14, 2026, worth 5%.',
  'Final exam during the December exam period, worth 40%.',
]);

const shot = (page: Page, name: string) => page.screenshot({ path: `${OUT}/${name}.jpg`, type: 'jpeg', quality: 82 });

test('readme screenshots', async ({ page }) => {
  mkdirSync(OUT, { recursive: true });

  await page.goto('/');
  await page.waitForTimeout(2500);
  await shot(page, 'landing');

  await page.goto('/app/');
  await page.getByRole('button', { name: 'I understand' }).click();
  await page.getByRole('button', { name: 'Create a cubicle' }).click();
  await page.getByLabel('Course name').fill('PHYS 1080: Physics for life sciences');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.locator('input[type=file][multiple]').setInputFiles([
    { name: 'PHYS1080-Lecture4-Orbits.pdf', mimeType: 'application/pdf', buffer: Buffer.from(lecture) },
    { name: 'PHYS1080-Course-Outline.docx', mimeType: 'application/octet-stream', buffer: Buffer.from(syllabus) },
  ]);
  await expect(page.getByText('7 pages', { exact: false })).toBeVisible();

  // Chat with a citation open beside it.
  await page.getByRole('tab', { name: 'Chat' }).click();
  await page.getByLabel('Ask about your material').fill('Why is escape velocity higher than orbital speed?');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Open source 1' }).first()).toBeVisible(AI);
  await page.getByRole('button', { name: 'Open source 1' }).first().click();
  await page.waitForTimeout(600);
  await shot(page, 'chat');
  await page.keyboard.press('Escape');

  // Flashcards, mid-review with the answer shown.
  await page.getByRole('tab', { name: /Flashcards/ }).click();
  await page.getByRole('button', { name: 'Make cards' }).click();
  await expect(page.getByRole('button', { name: /^Review \d/ })).toBeVisible(AI);
  await page.getByRole('button', { name: /^Review/ }).click();
  await page.getByRole('button', { name: 'Show the answer' }).click();
  await shot(page, 'flashcards');
  await page.getByRole('button', { name: 'Stop' }).click();

  // Quiz, graded.
  await page.getByRole('tab', { name: 'Quiz' }).click();
  await page.getByRole('button', { name: 'Write a quiz' }).click();
  await expect(page.getByRole('button', { name: 'Check my answers' })).toBeVisible(AI);
  for (const q of await page.locator('fieldset.question').all()) {
    const radio = q.getByRole('radio').first();
    if (await radio.count()) await radio.check();
    else await q.getByPlaceholder('Your answer').fill('Because kinetic plus potential energy must reach zero, which needs twice the kinetic energy of a circular orbit.');
  }
  await page.getByRole('button', { name: 'Check my answers' }).click();
  await expect(page.locator('.score')).toBeVisible(AI);
  // Retake like a student who studied: the right answers, except one, so the screenshot shows both kinds of feedback.
  const right = await page.locator('fieldset.question').evaluateAll((qs) =>
    qs.map((q) => [...q.querySelectorAll('.option')].findIndex((o) => o.classList.contains('right'))),
  );
  await page.getByRole('button', { name: 'Retake' }).click();
  const qs = await page.locator('fieldset.question').all();
  const missed = right.findIndex((r) => r >= 0);
  for (const [i, q] of qs.entries()) {
    if (right[i] >= 0) await q.getByRole('radio').nth(i === missed ? (right[i] + 1) % 4 : right[i]).check();
    else await q.getByPlaceholder('Your answer').fill('Because kinetic plus potential energy must reach zero, which takes twice the kinetic energy of a circular orbit at that radius.');
  }
  await page.getByRole('button', { name: 'Check my answers' }).click();
  await expect(page.locator('.score')).toBeVisible(AI);
  await page.evaluate(() => document.querySelector('.panel')?.scrollTo(0, 0));
  await shot(page, 'quiz');

  // Tutor, after one answer.
  await page.getByRole('tab', { name: 'Tutor' }).click();
  await page.getByLabel('Topic (optional)').fill('escape velocity');
  await page.getByRole('button', { name: 'Start a session' }).click();
  await expect(page.locator('.msg.ai')).toBeVisible(AI);
  await page.getByLabel('Your answer').fill('It is about 11.2 km/s from Earth, because the total energy has to reach zero.');
  await page.keyboard.press('Enter');
  await expect(page.locator('.verdict')).toBeVisible(AI);
  await shot(page, 'tutor');

  // Concept map with a topic picked.
  await page.getByRole('tab', { name: 'Concept map' }).click();
  await page.getByRole('button', { name: 'Map the topics' }).click();
  await expect(page.locator('.node').first()).toBeVisible(AI);
  await page.locator('.node').nth(1).click();
  await shot(page, 'concept-map');

  // Deadlines from the course outline.
  await page.getByRole('tab', { name: 'Deadlines' }).click();
  await page.getByLabel('Syllabus file').selectOption({ label: 'PHYS1080-Course-Outline.docx' });
  await page.getByRole('button', { name: 'Find deadlines' }).click();
  await expect(page.locator('tbody tr').first()).toBeVisible(AI);
  await shot(page, 'deadlines');

  // Phone: chat.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('tab', { name: 'Chat' }).click();
  await page.waitForTimeout(500);
  await shot(page, 'phone-chat');
});
