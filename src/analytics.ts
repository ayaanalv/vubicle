// Vercel Web Analytics: page views, no cookies. The script exists only on Vercel's hosting, so the dev server and
// tests skip it. It loads from this site's own origin, which the Content Security Policy already allows.
export function analytics() {
  if (!import.meta.env.PROD) return;
  const s = document.createElement('script');
  s.defer = true;
  s.src = '/_vercel/insights/script.js';
  document.head.append(s);
}
