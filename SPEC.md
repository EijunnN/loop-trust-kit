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

These are exactly what `scripts/validate-report.mjs` enforces. Rules 1–3 are the
teeth of "a claim is not evidence" and only tighten `done` reports.

1. **No naked claims on a `done` report.** An `evidence` entry whose `method` is
   `none` is invalid on `done`. And a `method: command` entry must carry a
   non-empty `command` — "I ran something" with no command named is just as naked.
   If you can't run it, it goes in `unverified`, not `evidence`.
2. **`done` evidence is checker-attested.** On a `done` report, **every**
   `evidence` entry must be `verified_by: checker`. A maker- or self-attested
   claim is not proof — it belongs in `unverified` (and if it's load-bearing, the
   status is `partial`, not `done`). This is `maker != checker` applied to the
   evidence itself: the skeptic re-ran it, or it isn't evidence.
3. **`verified_by: checker` requires a command and an integer `exit_code`.** The
   checker must have actually run it. A consequence: a checker's *inspection-only*
   judgment (no command) is **not** admissible as `evidence` on a `done` report —
   put it in the body's prose or, if it's a gap, in `unverified`. Proof on a
   `done` report is a re-executed command with an exit code, full stop.
4. **`maker.agent != checker.agent`.** Enforce it. A report where they match is
   self-grading and is rejected by tooling. (Note: the validator checks the
   *label*, not who actually ran the command — that integrity comes from the loop
   running two distinct agents. The rule shapes honest reports; it can't catch a
   maker who lies in the `verified_by` field.)
5. **`unverified` is never empty by default.** "Nothing unverified" is itself a
   strong claim that needs justification. Honest loops almost always have gaps.
6. **`risk` is the checker's call, not the maker's.** The maker is optimistic by
   construction; the risk signal must come from the skeptic.
7. **Append-only.** Re-running the loop on the same task writes a *new* file with
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

Rules 1–3 were tightened within v1 (they were added after the first cut). They
constrain only `done` reports, and any honest report already complies — proof
lives in checker-run `evidence`, gaps live in `unverified` — so no version bump
was needed. A change that would invalidate a *previously honest* report (not just
a sloppy one) is what forces a `loop_trust_kit` bump; see `CONTRIBUTING.md`.
