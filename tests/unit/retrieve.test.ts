import { describe, it, expect } from 'vitest';
import { isBroadQuestion } from '../../src/app/retrieve';
import { plan } from '../../api/_lib/tasks';

describe('isBroadQuestion', () => {
  it('spots judgment and overview questions', () => {
    for (const q of [
      'Explain the hardest idea here simply',
      'What is the most important concept?',
      'What should I focus on?',
      'What is likely on the exam?',
      'Summarize the main ideas in lecture 4',
      'What are the key takeaways?',
    ])
      expect(isBroadQuestion(q), q).toBe(true);
  });
  it('leaves fact questions to keyword search', () => {
    for (const q of ['What is escape velocity?', 'Define enthalpy', 'Who wrote Hamlet?']) expect(isBroadQuestion(q), q).toBe(false);
  });
});

describe('chat prompt', () => {
  it('lets the model make judgment calls from the material and keeps "not covered" for missing facts', () => {
    const { system } = plan('chat', { question: 'Explain the hardest idea here simply', passages: [{ label: 'a', text: 'b' }] }).prompt(10_000);
    expect(system).toMatch(/about facts, not judgment/);
    expect(system).toMatch(/say in a sentence why/);
    expect(system).toMatch(/"covered" to false only when the facts needed to answer are not in the passages/);
  });
});
