# Evidence Report — format v1

An **Evidence Report** is the on-disk record a loop produces every time it claims
to have finished a unit of work. It is the loop's memory spine and the human's
30-second triage surface. One file per loop iteration.

- **Location:** `.loop/runs/<date>-<slug>.md` (append a new file per run; never overwrite).
- **Shape:** YAML frontmatter (machine-readable, for triage tooling) + a short
  markdown body (human-readable, the 30-second scan).
- **Author:** written by the *checker* (the `loop-verifier`), never by the maker.

The frontmatter is the contract. The body is courtesy.

## Frontmatter schema

```yaml
---
loop_trust_kit: 1            # format version — bump on breaking changes

run_id: 2026-06-16-add-rate-limiting   # unique, stable, sortable
task: "Add per-IP rate limiting to the public API"   # one line: what the loop set out to do

status: done                 # done | partial | failed | needs-human
                             #   done       → fully implemented AND verified
                             #   partial    → implemented, some claims unverified
                             #   failed     → did not achieve the task
                             #   needs-human→ blocked on a human decision

maker:                       # who produced the work
  agent: implementer
  model: claude-opus-4-8

checker:                     # who verified it — MUST be a different agent than maker
  agent: loop-verifier
  model: claude-opus-4-8     # ideally a different/strong model on high effort
  verdict: confirmed         # confirmed | refuted | unverifiable
                             #   confirmed   → checker reproduced the evidence
                             #   refuted     → checker found the claim false
                             #   unverifiable→ no way to prove either way

changes:                     # what actually changed on disk
  - path: src/middleware/rate-limit.ts
    summary: "New token-bucket limiter, 100 req/min per IP"
  - path: src/app.ts
    summary: "Wire limiter into the public router"

evidence:                    # the proof — every 'done' claim maps to one entry
  - claim: "rate-limit unit tests pass"
    method: command          # command | inspection | none
    command: "pnpm test src/middleware/rate-limit.test.ts"
    exit_code: 0
    output_excerpt: |
      Test Files  1 passed (1)
      Tests       9 passed (9)
    verified_by: checker     # checker actually re-ran this, not just trusted the maker

unverified:                  # MANDATORY honesty section — what was NOT proven
  - "Behaviour under concurrent bursts above the bucket size (no load test exists)"
  - "Interaction with the existing CDN cache layer"

risk: medium                 # low | medium | high — drives human triage order
                             #   low    → mechanical, fully verified, skip the read
                             #   medium → read the diff
                             #   high   → read carefully before merge

needs_human:                 # explicit asks; empty list means walk away
  - "Confirm 100 req/min is the intended public limit (not specified in the issue)"

cost:                        # the token-rich/token-poor reality, on the record
  input_tokens: 184320
  output_tokens: 12880
  usd_estimate: 0.94
---
```

## Body (markdown, after the frontmatter)

Three short sections, optimised for a 30-second human scan:

```markdown
## What changed
One paragraph a tired reviewer can read at 5pm. No marketing.

## How I tried to break it
The adversarial part. What the checker attacked, what held, what didn't.
"I sent 500 req in 1s; the limiter held but logged no metric — see unverified[0]."

## What I could not prove
Restate `unverified` in prose, with *why* it matters. This is the section the
human reads first.
```

## Rules that make the format mean something

1. **No naked claims.** A `done` status with an `evidence` entry whose `method`
   is `none` is invalid. If you can't run it, it goes in `unverified`, not `evidence`.
2. **`verified_by: checker` requires re-execution.** The checker must run the
   command itself. Trusting the maker's pasted output defeats the purpose.
3. **`maker.agent != checker.agent`.** Enforce it. A report where they match is
   self-grading and should be rejected by tooling.
4. **`unverified` is never empty by default.** "Nothing unverified" is itself a
   strong claim that needs justification. Honest loops almost always have gaps.
5. **`risk` is the checker's call, not the maker's.** The maker is optimistic by
   construction; the risk signal must come from the skeptic.
6. **Append-only.** Re-running the loop on the same task writes a *new* file with
   a new `run_id`. History is the point — you diff yesterday against today.

## Why these fields (and not others)

| Field | The unsolved problem it attacks |
|---|---|
| `evidence[].command` + `exit_code` + `output_excerpt` | "done is a claim, not a proof" |
| `unverified` | comprehension debt — names the gap instead of hiding it |
| `risk` + `needs_human` | review bandwidth is the ceiling — routes your attention |
| `maker` / `checker` | maker grading own work; persists the adversarial split |
| `cost` | token spend varies wildly; put it on the record |
| on-disk, append-only | the model forgets; the repo doesn't |

## Versioning

`loop_trust_kit: 1` is the format version. Tooling MUST refuse a report whose
version it does not understand rather than guess.
