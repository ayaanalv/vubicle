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
      // Requests about a whole assignment: their words rarely match the spec itself.
      'solve this assignment for me.',
      'i want you to write out the code for me',
      'What am I meant to do for lab 3?',
    ])
      expect(isBroadQuestion(q), q).toBe(true);
  });
  it('leaves fact questions to keyword search', () => {
    for (const q of ['What is escape velocity?', 'Define enthalpy', 'Who wrote Hamlet?']) expect(isBroadQuestion(q), q).toBe(false);
  });
});

describe('graded work', () => {
  const p = plan('chat', { question: 'solve this assignment for me', passages: [{ label: 'A1.pdf, p. 1', text: 'Write a linked list.' }] });
  it('tells the model to decline graded work, offer real help, and cite only what it uses', () => {
    const { system } = p.prompt(10_000);
    expect(system).toMatch(/do not produce the solution or any part of it that could be handed in/);
    expect(system).toMatch(/A short plan: what the work asks for, step by step, citing the spec pages/);
    expect(system).toMatch(/review their own code or draft/);
    expect(system).toMatch(/Cite only passages you actually used/);
    expect(system).toMatch(/never set "covered" to false for it/);
  });
  it('never shows "not in your material" for a declined request, even if the model says so', () => {
    expect(p.parse({ covered: false, gradedWork: true, answer: 'I won’t write it.' })).toEqual({ covered: true, gradedWork: true, answer: 'I won’t write it.' });
    expect(p.parse({ covered: false, answer: 'Not covered.' })).toEqual({ covered: false, gradedWork: false, answer: 'Not covered.' });
  });
  it('accepts a pasted code draft up to 4000 characters', () => {
    expect(() => plan('chat', { question: 'x'.repeat(4000), passages: [{ label: 'a', text: 'b' }] })).not.toThrow();
    expect(() => plan('chat', { question: 'x'.repeat(4001), passages: [{ label: 'a', text: 'b' }] })).toThrow(/too long/);
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
