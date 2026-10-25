import '@fontsource-variable/fredoka';
import '@fontsource-variable/figtree';
import './landing.css';
import { initDemo } from './demo';
import { drawMany } from './many';
import { startRift } from './rift';

const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

const canvas = document.querySelector<HTMLCanvasElement>('.rift');
const art = document.querySelector<HTMLImageElement>('.hero-art img');
if (canvas && art && !still) startRift(canvas, art);

initDemo();

const many = document.querySelector<SVGSVGElement>('.many');
const settle = many ? drawMany(many, !still) : undefined;

// Section entrances: heading, then text, then the rest, staggered. Without script nothing is hidden.
if (!still && 'IntersectionObserver' in window) {
  const groups = [
    '.how-head h2, .how-head p, .how-steps li',
    '.proof-head h2, .proof-head p, .specimen, .try-intro, .try-form',
    '.tools h2, .tool-list > div',
    '.faq h2, .qa',
    '.closing, .closing-note',
    '.foot-top, .foot-line, .foot-meta',
  ];
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add('in');
        e.target.classList.remove('pre');
        io.unobserve(e.target);
      }
    },
    { rootMargin: '0px 0px -12% 0px' },
  );
  for (const sel of groups) {
    document.querySelectorAll<HTMLElement>(sel).forEach((el, i) => {
      el.classList.add('pre');
      el.style.setProperty('--d', `${(i % 6) * 80}ms`);
      io.observe(el);
    });
  }
  if (many && settle) {
    const mo = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        settle();
        mo.disconnect();
      },
      { threshold: 0.35 },
    );
    mo.observe(many);
  }
}
