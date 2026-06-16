---
loop_trust_kit: 1
run_id: 2026-06-16-add-rate-limiting
task: "Add per-IP rate limiting to the public API"
status: partial
maker:
  agent: implementer
  model: claude-opus-4-8
checker:
  agent: loop-verifier
  model: claude-opus-4-8
  verdict: confirmed
changes:
  - path: src/middleware/rate-limit.ts
    summary: "New token-bucket limiter, 100 req/min per IP"
  - path: src/app.ts
    summary: "Wire limiter into the public router"
  - path: src/middleware/rate-limit.test.ts
    summary: "9 unit tests covering bucket refill, burst, and reset"
evidence:
  - claim: "rate-limit unit tests pass"
    method: command
    command: "pnpm test src/middleware/rate-limit.test.ts"
    exit_code: 0
    output_excerpt: |
      Test Files  1 passed (1)
      Tests       9 passed (9)
      Duration    1.42s
    verified_by: checker
  - claim: "lint and typecheck are clean on changed files"
    method: command
    command: "pnpm lint src/middleware/rate-limit.ts src/app.ts && pnpm tsc --noEmit"
    exit_code: 0
    output_excerpt: |
      ✓ no eslint problems
      ✓ tsc: 0 errors
    verified_by: checker
unverified:
  - "Behaviour under concurrent bursts above the bucket size — no load test exists, only single-threaded unit tests"
  - "The limiter emits no metric/log on a block, so a real abuse event would be invisible in production"
risk: medium
needs_human:
  - "Confirm 100 req/min is the intended public limit — the issue never specified a number, the maker guessed"
cost:
  input_tokens: 184320
  output_tokens: 12880
  usd_estimate: 0.94
---

## What changed
A token-bucket rate limiter (100 req/min per IP) now sits in front of the public
router. Nine unit tests cover refill, burst absorption, and window reset. Lint
and typecheck are clean.

## How I tried to break it
I re-ran the test suite myself (not the maker's pasted output) — green. I then
read `rate-limit.ts` looking for the usual holes: the bucket key is the raw
`x-forwarded-for`, which is **spoofable behind a proxy that doesn't strip it** —
but that matched the existing code's trust model, so I did not fail it on that.
I tried to find a concurrency test and could not; the limiter's correctness
under simultaneous requests is asserted only by single-threaded tests.

## What I could not prove
Two gaps, and the second is the one to read:
1. **No load/concurrency test.** "100 req/min" holds in the unit tests but those
   run sequentially. Under real concurrent bursts I have no evidence it holds.
2. **Silent on block.** When the limiter rejects a request it logs nothing and
   emits no metric. An actual abuse event would be invisible — you'd never know
   the limiter fired. I'd block merge on this until there's at least a counter.

Status is `partial`, not `done`: the code works as written and tested, but the
observability gap means "it protects the API in production" is **not** proven.
