import { defineConfig } from 'vitest/config';
import { loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { copyFileSync, mkdirSync } from 'node:fs';

/**
 * Serves /api in `npm run dev` with the same handlers Vercel runs. With keys in .env.local it calls the
 * real providers; without keys it answers from the mock, so the whole app works offline.
 */
function devApi(): Plugin {
  return {
    name: 'vubicle-dev-api',
    apply: 'serve',
    configureServer(server) {
      Object.assign(process.env, loadEnv('development', process.cwd(), ''));
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next();
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        const body = Buffer.concat(chunks).toString();
        const headers = new Headers(Object.entries(req.headers).flatMap(([k, v]) => (typeof v === 'string' ? [[k, v]] : [])) as [string, string][]);
        const request = new Request(`http://localhost${req.url}`, { method: req.method, headers, body: req.method === 'POST' ? body : undefined });
        const { defaultDeps, handleAi, handleEmbed, handleToken, refuseCaller } = await server.ssrLoadModule('/api/_lib/handler.ts');
        const { GET: status } = await server.ssrLoadModule('/api/status.ts');
        let response: Response;
        if (req.url.startsWith('/api/token')) response = await handleToken(request, defaultDeps());
        else if (!process.env.GEMINI_API_KEY && !process.env.GROQ_API_KEY && req.url !== '/api/status') {
          // The mock still checks origin and token, so the dev server refuses what production refuses.
          const refused = refuseCaller(request, defaultDeps().config);
          if (refused) response = refused;
          else {
            const { mockAi } = await server.ssrLoadModule('/tests/mock-ai.ts');
            const parsed = JSON.parse(body || '{}');
            await new Promise((r) => setTimeout(r, 400));
            response = req.url.startsWith('/api/embed') ? Response.json({ error: 'config' }, { status: 503 }) : Response.json({ result: mockAi(parsed), provider: 'mock' });
          }
        } else if (req.url.startsWith('/api/ai')) response = await handleAi(request, defaultDeps());
        else if (req.url.startsWith('/api/embed')) response = await handleEmbed(request, defaultDeps());
        else response = status();
        res.statusCode = response.status;
        response.headers.forEach((v, k) => res.setHeader(k, v));
        res.end(Buffer.from(await response.arrayBuffer()));
      });
    },
  };
}

/**
 * Copies the text recognition (OCR) files into public/ocr/ so the site serves them itself, for both the dev
 * server and the build. Only what the browser can ask for: the worker, the three LSTM-only engine builds
 * (it picks one by browser support), and the compact English model. public/ocr/ is not committed.
 */
function ocrFiles(): Plugin {
  const files: [string, string][] = [
    ['node_modules/tesseract.js/dist/worker.min.js', 'worker.min.js'],
    ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'],
    ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'],
    ['node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js'],
    ['node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'eng.traineddata.gz'],
  ];
  return {
    name: 'vubicle-ocr-files',
    buildStart() {
      const out = resolve(import.meta.dirname, 'public/ocr');
      mkdirSync(out, { recursive: true });
      for (const [from, to] of files) copyFileSync(resolve(import.meta.dirname, from), resolve(out, to));
    },
  };
}

export default defineConfig({
  plugins: [react(), devApi(), ocrFiles()],
  // Pre-bundle up front so the dev server never reloads the page mid-session (it would in e2e tests).
  optimizeDeps: { include: ['react', 'react-dom/client', 'react/jsx-dev-runtime', 'idb', 'lucide-react', 'fflate', 'pdfjs-dist/legacy/build/pdf.mjs', 'tesseract.js'] },
  // pdf.js starts its worker as a module worker, so ours (src/app/pdf.worker.ts) is built as one.
  worker: { format: 'es' },
  build: {
    rollupOptions: {
      input: {
        landing: resolve(import.meta.dirname, 'index.html'),
        app: resolve(import.meta.dirname, 'app/index.html'),
        privacy: resolve(import.meta.dirname, 'privacy/index.html'),
        // Vercel serves 404.html for any path with no file.
        notFound: resolve(import.meta.dirname, '404.html'),
      },
    },
  },
  test: {
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
});
