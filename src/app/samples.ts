// The sample cubicles a visitor can open without uploading anything. Each one is a backup file in
// public/samples/, built once with the real AI by tests/e2e/samples.spec.ts from the sources in samples/.
// Opening one imports it like any backup, through the same checks, and makes no AI request.

export interface Sample {
  id: 'physics' | 'chemistry' | 'literature';
  /** What the button says. */
  label: string;
  /** The cubicle's name once opened. */
  name: string;
  /** The source file's name inside the cubicle. */
  file: string;
  /** Asked once in Chat when the sample is built, so it opens with cited answers. */
  questions: string[];
}

export const SAMPLES: Sample[] = [
  {
    id: 'physics',
    label: 'STEM & Physics',
    name: "Sample: Kepler's laws (physics)",
    file: 'Keplers-laws-excerpt.pdf',
    questions: ['Why does a planet move faster when it is closer to the Sun?', "How did Kepler's model of the orbits differ from Copernicus's?", 'Explain the hardest idea here simply'],
  },
  {
    id: 'chemistry',
    label: 'Molecular Chemistry',
    name: 'Sample: VSEPR theory (chemistry)',
    file: 'VSEPR-theory-excerpt.pdf',
    questions: ['Why is the bond angle in water smaller than in methane?', 'What is the difference between electron geometry and molecular shape?', 'How do you find the steric number of XeF4?'],
  },
  {
    id: 'literature',
    label: 'Literature',
    name: 'Sample: The Tell-Tale Heart (literature)',
    file: 'The-Tell-Tale-Heart.pdf',
    questions: ['Why does the narrator insist he is not mad?', "What role does the old man's eye play in the story?", 'What does the beating heart at the end represent?'],
  },
];
