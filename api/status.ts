import { config } from './_lib/config.js';

// A public setup check. It says only whether the AI service is set up, so it tells a stranger nothing about
// which models, limits or stores are behind it.
export function GET() {
  const c = config();
  return Response.json({ ok: Boolean((c.geminiKey || c.groqKey) && c.tokenSecret) }, { headers: { 'Cache-Control': 'no-store' } });
}
