# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Vubicle (vubicle.com): a per-course AI study workspace. Students' files are parsed and stored in their own browser; only matching passages go to the AI. Live on Vercel Hobby; every push to `main` deploys. README.md has the full write-up.

## Commands

```bash
npm run dev                      # localhost:5173; /api runs the real handlers, answered by tests/mock-ai.ts when no keys are set
npm test                         # Vitest unit tests (tests/unit, .ts and .tsx)
npx vitest run tests/unit/search.test.ts -t "bm25"   # one file / one test
npm run e2e                      # Playwright on its own dev server (port 5174); /api is mocked, no keys needed
npx playwright test -g "focus timer" --project=desktop   # one test; @phone-tagged tests run in --project=phone
npx tsc --noEmit                 # typecheck (npm run build = typecheck + vite build)
npm run art                      # regenerate public/art AVIF/WebP sizes from art/*.jpg
```

Opt-in browser suites skip unless set: `SHOTS=1` (design screenshots), `README_SHOTS=1` (README images, uses the live site and real AI), `SITE_URL=https://vubicle.com` (run the image test against a deploy). CI (.github/workflows/ci.yml) runs typecheck, unit tests, build, then Playwright in the `mcr.microsoft.com/playwright:v1.64.1-noble` image.

## Architecture

- `index.html` + `src/landing/`: static landing page (no framework). `app/index.html` + `src/app/`: React 19 workspace. `src/lib/`: pure, tested logic (parsing, chunking, BM25 + RRF search, SM-2, iCalendar, map layout). `api/`: Vercel functions; `api/_lib/` holds prompts and output checks (`tasks.ts`), providers, failover, rate limiting, request handling.
- Browser: parse (pdf.js/fflate) → passages that never cross a page or slide → IndexedDB → hybrid search (BM25 always; Gemini embeddings added in the background when available) → `/api/ai` with a task name and passages.
- Server: owns every prompt and validates every model output. Failover tries Gemini Flash-Lite, Gemini Flash, then Groq; every provider once before any retry, and failing providers are benched. Per-person hourly cap in Upstash Redis.
- Busy providers → 429 + Retry-After; the browser waits in line with a real countdown (`src/app/api.ts`), never an error.

## Decisions to keep

- Cloud AI only, free tiers only, keys only on the server; the browser never sends a prompt.
- Grounding applies to facts, not judgment ("hardest idea", "what to focus on" get answered from the material).
- Chat declines to write graded work (assignments, labs, essays) and offers a plan, concepts, code review or Tutor instead. Questions about understanding the work are answered normally. Keep this; it was tested against the real model.
- Model text is rendered only through `src/app/rich.tsx` (never `innerHTML`; a unit test enforces it). Use `inline` mode inside buttons and labels.
- Bump `CACHE_VERSION` in `src/app/api.ts` when a prompt change should stop old cached answers from being reused.
- Default model order is Flash-Lite first: 3.8 Flash hung and returned 503 for minutes in production. Model names are env vars.
- Upstash vars may be `UPSTASH_REDIS_REST_*` or the Vercel Marketplace's `KV_REST_API_*`; both are read.
- Copy style (UI and docs): short sentences, sentence-case headings, no em dashes, no hype words.

## Gotchas

- pdf.js: use the legacy build plus `src/app/polyfills.ts` and our worker entry `src/app/pdf.worker.ts`. The default build and the legacy build's missing `Promise.withResolvers` broke PDFs on browsers older than Chrome 147 / Safari 26.2. `tests/e2e/compat.spec.ts` covers it.
- `@playwright/test` is pinned to an exact version that must match the CI Docker image tag.
- `.vercelignore` rules must be root-anchored (`/art`); a bare `art` also dropped `public/art` and every image 404'd.
- `useNow` (`src/app/ui.tsx`) must return `Date.now()` each render; a stored value made the timer jump on Start.
- Effects must not return expressions: Chrome's `scrollIntoView` returns a Promise, which crashed React.
- Vite `optimizeDeps.include` exists so the dev server never reloads mid-test.
- Vercel Hobby keeps only 30 minutes of runtime logs; failures log every provider attempt on one line.

## Known issues

- Phones download the hero image twice (1280 and 2000 widths), likely the preload being sized before the viewport meta is read.
- Provider benching is per function instance, so a cold instance may try a benched model once.
