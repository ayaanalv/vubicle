import { defaultDeps, handleEmbed } from './_lib/handler.js';

export function POST(req: Request) {
  return handleEmbed(req, defaultDeps());
}
