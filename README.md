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

**What it is — and isn't.** A *trust layer*, **not a loop engine.** It doesn't
loop anything and doesn't intercept your prompts; it makes the output of the
loops you already run carry proof. The "loop" in the name is the *context* (you're
designing agentic loops); the kit's job is the *trust*. You bring the loop — or
wire one (see [How it runs](#how-it-runs)) — and the kit makes its "done" honest.

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

## Install

**Claude Code (plugin) — agents, skill, and commands in one install:**

```
/plugin marketplace add EijunnN/loop-trust-kit
/plugin install loop-trust-kit@loop-trust-kit
```

You get the `loop-maker` and `loop-verifier` subagents, the `loop-triage` skill,
and the `/loop-trust-kit:validate` · `:triage` · `:budget` commands.

**The CLI (npm) — the dependency-free scripts on their own:**

```
npm i -g loop-trust-kit       # provides loop-validate, loop-budget, loop-triage
```

**Codex / anything else — copy the files:** drop `.codex/agents/*.toml` (or
`.claude/agents/*.md`), `skills/loop-triage/`, and `scripts/` into your repo.
Everything is plain files; nothing is vendor-locked.

## How it runs

The plugin **does not intercept your prompts.** It gives you two agents, a report
format, and three scripts — they run when *you* invoke them, or when a loop you
wired calls them. Two ways to use it:

- **One pass (you drive):** invoke `loop-maker` for a task, then hand its work to
  `loop-verifier`. One maker → checker → report. (This is what most people start with.)
- **Wired loop (runs unattended):** a *driver* — `/goal`, `/loop`, or an
  automation — repeats that maker → checker step over many findings on its own.

The mental model that trips people up: **`loop-maker` and `loop-verifier` are two
*steps*; the loop is the *engine* (`/goal` / `/loop` / automation) that repeats
them.** The kit ships the steps and the Evidence Report; *you* choose the engine.
The maker never loops itself.

## Use it — the one-pass flow

1. Invoke **`loop-maker`** to implement a task; it finishes by naming the exact
   command that proves each claim, and never grades itself.
2. Hand its handoff to **`loop-verifier`** — a *different* agent. It re-runs the
   claims, attacks them, and writes an **Evidence Report** to `.loop/runs/`.
3. Run `node scripts/validate-report.mjs` (or `/loop-trust-kit:validate`), then
   read only `risk` and `needs_human`. That's your 30-second triage.

To run this unattended over many findings, wire a driver — see
[`docs/loop-recipe.md`](./docs/loop-recipe.md).

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
