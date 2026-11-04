// Canned AI answers built from the passages a request sends. Used by `npm run dev` when no keys are set,
// and by the end-to-end tests, so neither needs a real provider.

type P = { label: string; text: string };

const first = (t: string) => (t.match(/[^.!?]+[.!?]/)?.[0] ?? t).trim().slice(0, 200);

export function mockAi(body: any): unknown {
  const ps: P[] = body.passages ?? [];
  switch (body.task) {
    case 'chat': {
      const q: string = body.question ?? '';
      if (/mona lisa|weather/i.test(q)) return { covered: false, answer: 'Your material does not cover that. It covers ' + ps.map((p) => p.label).slice(0, 2).join(' and ') + '.' };
      // What the prompt asks for when a student wants their graded work done for them.
      if (/solve this assignment|write (out )?the code for me|do my assignment/i.test(q))
        return {
          covered: true,
          gradedWork: true,
          answer: [
            'I won’t write your assignment for you, since it’s graded work, but I can help you get there.',
            '',
            '**The plan**',
            '1. Read the input file format [1]',
            '2. Build the linked list in order [2]',
            '',
            'Paste your code and I’ll check it against the spec, or try Tutor mode.',
          ].join('\n'),
        };
      // The shape of a real reply that showed literal backticks on the live site, plus a block and a list.
      if (/hardest idea/i.test(q))
        return {
          covered: true,
          answer: [
            'The hardest idea is an `Amoeba` implementing a unique rotation instead of using the general `Shape` rotation [1].',
            '',
            '```java',
            'class Amoeba extends Shape {',
            '    @Override void rotate(double degrees) { this.wobble(degrees * Math.PI / 180.0, Shape.DEFAULT_PIVOT_X, Shape.DEFAULT_PIVOT_Y); }',
            '}',
            '```',
            '',
            'Why it is hard:',
            '- `rotate()` is **overridden**, not overloaded [1]',
            '- callers still hold a `Shape` reference',
          ].join('\n'),
        };
      return { covered: true, answer: `${first(ps[0]?.text ?? '')} [1]${ps[1] ? `\n\n- ${first(ps[1].text)} [2]` : ''}` };
    }
    case 'tutor': {
      const last = body.history?.at(-1);
      if (body.request === 'hint') return { message: 'Hint: look at the first passage again [1].', verdict: 'none' };
      if (last?.role === 'student') return { message: `**Correct.** ${first(ps[0].text)} [1]\n\nNext question: what does passage 2 say?`, verdict: 'correct' };
      return { message: `Welcome. First question: ${first(ps[0].text).replace(/\.$/, '')}. True or false?`, verdict: 'none' };
    }
    case 'flashcards':
      return { cards: ps.slice(0, body.count ?? 5).map((p, i) => ({ front: `Card ${i + 1}: ${p.label}?`, back: first(p.text), source: i + 1 })) };
    case 'quiz':
      return {
        questions: [
          { type: 'mcq', question: `Which file is passage 1 from?`, options: [ps[0].label, 'None of these', 'A textbook', 'A website'], answer: 0, explanation: 'It is labelled in the passage.', source: 1 },
          { type: 'mcq', question: 'Is this a practice quiz?', options: ['Yes', 'No', 'Maybe', 'Unknown'], answer: 0, explanation: 'It is.', source: 1 },
          { type: 'short', question: 'Summarize passage 1 in one sentence.', answer: first(ps[0].text), explanation: 'From passage 1.', source: 1 },
        ],
      };
    case 'grade':
      return { score: String(body.answer).length > 20 ? 0.75 : 0.25, feedback: 'You named the main idea but left out a detail [1].' };
    case 'map':
      return {
        topics: ps.slice(0, 6).map((p, i) => ({ id: `t${i + 1}`, label: p.text.split(/\s+/).slice(0, 3).join(' '), summary: first(p.text), sources: [i + 1] })),
        links: ps.slice(1, 6).map((_, i) => ({ from: `t${i + 1}`, to: `t${i + 2}`, label: 'leads to' })),
      };
    case 'brief':
      return { text: `**${body.format === 'terms' ? 'Terms' : 'Main ideas'}**\n\n- ${first(ps[0]?.text ?? '')} [1]${ps[1] ? `\n- ${first(ps[1].text)} [2]` : ''}` };
    case 'image':
      return { readable: true, text: 'Kepler’s second law: a line from the Sun to a planet sweeps out equal areas in equal times.\nDiagram: an ellipse with the Sun at one focus and two shaded wedges of equal area.' };
    case 'deadlines':
      return {
        items: [
          { title: 'Midterm exam', date: '2026-11-03', weight: 25, kind: 'exam', source: 1 },
          { title: 'Assignment 2', date: '2026-11-14', weight: 15, kind: 'assignment', source: 1 },
          { title: 'Weekly quizzes', date: null, weight: 10, kind: 'quiz', source: 1 },
        ],
      };
  }
  return null;
}
