import { defineConfig } from 'vitest/config';
import { loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

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
        const { defaultDeps, handleAi, handleEmbed } = await server.ssrLoadModule('/api/_lib/handler.ts');
        const { GET: status } = await server.ssrLoadModule('/api/status.ts');
        let response: Response;
        if (!process.env.GEMINI_API_KEY && !process.env.GROQ_API_KEY && req.url !== '/api/status') {
          const { mockAi } = await server.ssrLoadModule('/tests/mock-ai.ts');
          const parsed = JSON.parse(body || '{}');
          await new Promise((r) => setTimeout(r, 400));
          response = req.url.startsWith('/api/embed') ? Response.json({ error: 'config' }, { status: 503 }) : Response.json({ result: mockAi(parsed), provider: 'mock' });
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

export default defineConfig({
  plugins: [react(), devApi()],
  // Pre-bundle up front so the dev server never reloads the page mid-session (it would in e2e tests).
  optimizeDeps: { include: ['react', 'react-dom/client', 'react/jsx-dev-runtime', 'idb', 'lucide-react', 'fflate', 'pdfjs-dist'] },
  build: {
    rollupOptions: {
      input: {
        landing: resolve(import.meta.dirname, 'index.html'),
        app: resolve(import.meta.dirname, 'app/index.html'),
      },
    },
  },
  test: {
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
});
