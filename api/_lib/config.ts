const list = (v: string | undefined, fallback: string) =>
  (v || fallback).split(',').map((s) => s.trim()).filter(Boolean);

export function config(env: NodeJS.ProcessEnv = process.env) {
  return {
    geminiKey: env.GEMINI_API_KEY || '',
    groqKey: env.GROQ_API_KEY || '',
    geminiModels: list(env.GEMINI_MODELS, 'gemini-3.8-flash,gemini-3.5-flash-lite'),
    geminiEmbedModel: env.GEMINI_EMBED_MODEL || 'gemini-embedding-001',
    groqModel: env.GROQ_MODEL || 'openai/gpt-oss-120b',
    redisUrl: env.UPSTASH_REDIS_REST_URL || '',
    redisToken: env.UPSTASH_REDIS_REST_TOKEN || '',
    hourlyCap: Number(env.HOURLY_CAP) || 60,
    allowedOrigins: list(env.ALLOWED_ORIGINS, 'https://vubicle.com,https://www.vubicle.com'),
    production: env.VERCEL_ENV === 'production',
  };
}
