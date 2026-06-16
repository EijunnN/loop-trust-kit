# Loop Trust Kit

> Make a loop's "done" carry its proof.

When you stop prompting agents and start designing loops that prompt them, one
problem gets *sharper*, not easier: a loop running unattended is a loop making
mistakes unattended. `"done"` becomes a claim, not a proof — and your review
bandwidth is the ceiling on how many loops you can actually run.

Coding tools already ship the five loop primitives (automations, worktrees,
skills, connectors, sub-agents) and an in-session adversarial verifier. What
they **don't** ship is a *portable, persistent, human-facing* trust layer:

- The adversarial check is **tool-locked** (lives inside one product's workflow engine).
- It's **ephemeral** — it grades, returns a result, and forgets. Nothing lands on disk.
- It doesn't leave a record you can **review in 30 seconds** or **diff across runs**.

Loop Trust Kit is that missing layer. It's tool-agnostic (Claude Code **and**
Codex), it lives on disk (the loop's memory spine — *the agent forgets, the repo
doesn't*), and it's built around one artifact: the **Evidence Report**.

## The idea in one picture

```
maker agent  ──claims "done"──▶  loop-verifier (adversarial, different model)
                                        │  tries to REFUTE, gathers real evidence
                                        ▼
                          .loop/runs/<run>.md   ◀── Evidence Report (on disk)
                                        │
                                        ▼
                                  human triage  ──▶  read only what risk > low
```

The verifier's job is not to agree. It's to fail the work if it can, and write
down exactly what it ran, what it saw, and what it could **not** prove. "Done"
ships with its receipts attached.

## What's in the box

| Piece | Path | Status |
|---|---|---|
| **Evidence Report** format (the heart) | [`SPEC.md`](./SPEC.md) | ✅ v1 |
| Adversarial verifier — Claude Code · Codex | [`.claude/…/loop-verifier.md`](./.claude/agents/loop-verifier.md) · [`.codex/…/loop-verifier.toml`](./.codex/agents/loop-verifier.toml) | ✅ |
| Maker agent — Claude Code · Codex | [`.claude/…/loop-maker.md`](./.claude/agents/loop-maker.md) · [`.codex/…/loop-maker.toml`](./.codex/agents/loop-maker.toml) | ✅ |
| Report validator | [`scripts/validate-report.mjs`](./scripts/validate-report.mjs) | ✅ |
| Token-budget guard | [`scripts/loop-budget.mjs`](./scripts/loop-budget.mjs) · [`hooks/`](./hooks/README.md) | ✅ |
| Human-triage — skill + script | [`skills/loop-triage/`](./skills/loop-triage/SKILL.md) · [`scripts/triage.mjs`](./scripts/triage.mjs) | ✅ |
| End-to-end loop recipe | [`docs/loop-recipe.md`](./docs/loop-recipe.md) | ✅ |
| Worked examples (done · partial · refuted) | [`.loop/runs/`](./.loop/runs/) | ✅ |

## Quickstart

1. Drop the verifier into your tool: copy `.claude/agents/loop-verifier.md`
   (Claude Code) or `.codex/agents/loop-verifier.toml` (Codex) into your repo.
2. In your loop, after the maker claims done, hand the work to `loop-verifier`.
3. It writes an Evidence Report to `.loop/runs/`. Read the `risk` and
   `needs_human` fields first; that's your 30-second triage.

## Design tenets

1. **A claim is not evidence.** Every `done` claim maps to an executed command
   with an exit code and an output excerpt, or it's listed as `unverified`.
2. **Maker ≠ checker.** The agent that wrote the code never grades its own
   homework. Persist *who* made and *who* checked.
3. **On disk, not in context.** The model forgets between runs. The report
   doesn't. One file per iteration, diffable over time.
4. **Honesty about gaps beats optimism.** The `unverified` section is mandatory
   and is the most valuable part of the report.
5. **Tool-agnostic.** Nothing here assumes one vendor. Design for the *shape*.

## Why this is the gift, not the product

The fact that adversarial verification is being baked into the tools is the
*validation*, not the competition — because what ships is locked, ephemeral, and
author-dependent. This kit is the portable, persistent, reviewable layer on top.

Build the loop. Stay the engineer.
