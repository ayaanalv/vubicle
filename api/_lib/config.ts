const list = (v: string | undefined, fallback: string) =>
  (v || fallback).split(',').map((s) => s.trim()).filter(Boolean);

export function config(env: NodeJS.ProcessEnv = process.env) {
  return {
    geminiKey: env.GEMINI_API_KEY || '',
    groqKey: env.GROQ_API_KEY || '',
    geminiModels: list(env.GEMINI_MODELS, 'gemini-3.8-flash,gemini-3.5-flash-lite'),
    geminiEmbedModel: env.GEMINI_EMBED_MODEL || 'gemini-embedding-001',
    groqModel: env.GROQ_MODEL || 'openai/gpt-oss-120b',
    // Upstash via the Vercel Marketplace sets KV_REST_API_*; a direct Upstash database uses UPSTASH_REDIS_REST_*.
    redisUrl: env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL || '',
    redisToken: env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN || '',
    hourlyCap: Number(env.HOURLY_CAP) || 60,
    // Vercel preview deployments get their own URL; allow it so previews can be tested.
    allowedOrigins: [
      ...list(env.ALLOWED_ORIGINS, 'https://vubicle.com,https://www.vubicle.com'),
      ...[env.VERCEL_URL, env.VERCEL_BRANCH_URL, env.VERCEL_PROJECT_PRODUCTION_URL].filter(Boolean).map((h) => `https://${h}`),
    ],
    geminiThinking: env.GEMINI_THINKING ?? 'low',
    ipSalt: env.IP_SALT || '',
    production: env.VERCEL_ENV === 'production',
  };
}
