import { createRoot } from 'react-dom/client';
import '@fontsource-variable/fredoka';
import '@fontsource-variable/figtree';
import './app.css';
import { App } from './App';

try {
  const t = localStorage.getItem('vubicle.theme');
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
} catch {
  /* private mode */
}

createRoot(document.getElementById('root')!).render(<App />);
