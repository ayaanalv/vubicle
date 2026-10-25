// "Many into one" diagram: scattered material on the left, a tight band in the middle, ordered rows on the right.
const NS = 'http://www.w3.org/2000/svg';

function rng(seed: number) {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
}

export function drawMany(svg: SVGSVGElement, animate: boolean) {
  const r = rng(7);
  const tiles: { x: number; y: number; fill: string; size: number }[] = [];
  const S = 12;
  // Left third: loose scatter in two pale tones.
  for (let i = 0; i < 52; i++) tiles.push({ x: 10 + r() * 360, y: 20 + r() * 230, fill: r() < 0.5 ? '#f4f0ea' : '#a9a39a', size: S });
  // Middle third: a band three tiles high.
  for (let c = 0; c < 22; c++) for (let row = 0; row < 3; row++) tiles.push({ x: 410 + c * 17, y: 110 + row * 17, fill: '#1b1926', size: S });
  // Right third: neat rows.
  for (let row = 0; row < 7; row++) for (let c = 0; c < 10; c++) tiles.push({ x: 830 + c * 36, y: 26 + row * 34, fill: '#5b4bd6', size: 18 });

  const frag = document.createDocumentFragment();
  tiles.forEach((t, i) => {
    const rect = document.createElementNS(NS, 'rect');
    rect.setAttribute('x', String(t.x));
    rect.setAttribute('y', String(t.y));
    rect.setAttribute('width', String(t.size));
    rect.setAttribute('height', String(t.size));
    rect.setAttribute('rx', String(t.size / 3));
    rect.setAttribute('fill', t.fill);
    rect.classList.add('tile');
    if (animate) {
      // Start loose; settle into place when the section enters.
      rect.style.transform = `translate(${(r() - 0.5) * 160}px, ${(r() - 0.5) * 120}px)`;
      rect.style.opacity = '0';
      rect.style.transitionDelay = `${Math.round((t.x / 1200) * 700 + r() * 200)}ms`;
    }
    rect.dataset.i = String(i);
    frag.append(rect);
  });
  // A few glyphs among the scatter: the things students actually drop in.
  for (const [label, x, y] of [['PDF', 40, 60], ['.pptx', 210, 40], ['notes', 120, 200], ['.docx', 300, 150], ['∫', 250, 240], ['Σ', 60, 150]] as const) {
    const t = document.createElementNS(NS, 'text');
    t.setAttribute('x', String(x));
    t.setAttribute('y', String(y));
    t.setAttribute('fill', '#4a4656');
    t.setAttribute('font-size', label.length > 1 ? '20' : '30');
    t.setAttribute('font-family', 'var(--display)');
    t.setAttribute('font-weight', '600');
    t.textContent = label;
    t.classList.add('tile');
    if (animate) {
      t.style.opacity = '0';
      t.style.transform = `translate(${(r() - 0.5) * 80}px, 20px)`;
    }
    frag.append(t);
  }
  svg.append(frag);

  return () =>
    svg.querySelectorAll<SVGElement>('.tile').forEach((el) => {
      el.style.transform = '';
      el.style.opacity = '';
    });
}
