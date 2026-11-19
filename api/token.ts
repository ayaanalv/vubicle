import { defaultDeps, handleToken } from './_lib/handler.js';

export function POST(req: Request) {
  return handleToken(req, defaultDeps());
}
