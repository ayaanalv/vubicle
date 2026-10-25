import { defaultDeps, handleAi } from './_lib/handler.js';

export function POST(req: Request) {
  return handleAi(req, defaultDeps());
}
