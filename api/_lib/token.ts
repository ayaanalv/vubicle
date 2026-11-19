// Short-lived signed tokens for /api/ai and /api/embed. A page gets one from /api/token, then sends it with
// each request. The token names the caller's hashed IP and an expiry, signed with TOKEN_SECRET (HMAC-SHA256),
// so it cannot be made up, changed, reused after it expires, or moved to another IP.
// It does not stop a script that asks for its own token; the rate limits are what cap cost.
import { createHmac, timingSafeEqual } from 'node:crypto';

/** How long a token lasts. The browser fetches a new one a minute before this runs out. */
export const TOKEN_TTL_SEC = 15 * 60;

/** Used only when running outside Vercel with no TOKEN_SECRET (npm run dev, tests). Never in a deployment. */
const DEV_SECRET = 'vubicle-local-development-only';

export type TokenCheck = 'ok' | 'missing' | 'malformed' | 'bad-signature' | 'expired' | 'wrong-ip';

const sign = (payload: string, secret: string) => createHmac('sha256', secret).update(payload).digest('base64url');

export function issueToken(person: string, secret: string, now = Date.now()): { token: string; expiresIn: number } {
  const payload = Buffer.from(JSON.stringify({ p: person, e: Math.floor(now / 1000) + TOKEN_TTL_SEC })).toString('base64url');
  return { token: `${payload}.${sign(payload, secret)}`, expiresIn: TOKEN_TTL_SEC };
}

export function checkToken(token: string | null, person: string, secret: string, now = Date.now()): TokenCheck {
  if (!token) return 'missing';
  if (token.length > 512) return 'malformed';
  const [payload, sig, extra] = token.split('.');
  if (!payload || !sig || extra !== undefined) return 'malformed';
  const want = Buffer.from(sign(payload, secret));
  const got = Buffer.from(sig);
  // Constant-time comparison, so response timing does not reveal how much of a forged signature was right.
  if (got.length !== want.length || !timingSafeEqual(got, want)) return 'bad-signature';
  let body: { p?: unknown; e?: unknown };
  try {
    body = JSON.parse(Buffer.from(payload, 'base64url').toString());
  } catch {
    return 'malformed';
  }
  if (typeof body?.e !== 'number' || typeof body.p !== 'string') return 'malformed';
  if (body.e * 1000 <= now) return 'expired';
  if (body.p !== person) return 'wrong-ip';
  return 'ok';
}

let warned = false;
/**
 * The signing secret, or null when there is none and this is a deployment: the AI endpoints then refuse
 * every request (fail closed). Only local development falls back to a fixed secret.
 */
export function tokenSecret(c: { tokenSecret: string; localDev: boolean }, log: (e: Record<string, unknown>) => void = console.log): string | null {
  if (c.tokenSecret) return c.tokenSecret;
  if (c.localDev) {
    if (!warned) console.warn('TOKEN_SECRET is not set. Using a development-only secret; set TOKEN_SECRET in every deployment.');
    warned = true;
    return DEV_SECRET;
  }
  log({ error: 'TOKEN_SECRET is not set, so /api/ai, /api/embed and /api/token refuse every request. Set it in Vercel and redeploy.' });
  return null;
}
