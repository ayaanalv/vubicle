import { config } from './_lib/config.js';

// Lets Ayaan confirm the deployment is configured. Reports presence only, never values.
export function GET() {
  const c = config();
  return Response.json(
    {
      ok: Boolean(c.geminiKey || c.groqKey),
      gemini: { configured: Boolean(c.geminiKey), models: c.geminiModels, embedModel: c.geminiEmbedModel },
      groq: { configured: Boolean(c.groqKey), model: c.groqModel },
      rateLimitStore: c.redisUrl && c.redisToken ? 'upstash' : 'memory',
      hourlyCap: c.hourlyCap,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
