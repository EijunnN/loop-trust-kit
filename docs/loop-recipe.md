# Loop recipe — wiring the whole kit into a real loop

This is the copy-pasteable end-to-end recipe: one automation, running unattended
on a cadence, that finds work, fixes it in isolation, and hands each "done" back
to you with its proof attached. It's shown for **both** Claude Code and Codex,
step by step, mapped to the actual primitive in each tool.

Read [`SPEC.md`](../SPEC.md) and [`README.md`](../README.md) first — this doc
assumes the Evidence Report and the maker/checker split, and only shows how to
wire them together.

## The loop, in one line per stage

```
cadence  ─▶ triage ─▶ per finding: worktree ─▶ loop-maker ─▶ loop-verifier ─▶ .loop/runs/<run>.md
                                                                                      │
                                                       loop-triage (risk > low) ──────┘──▶ you
                                                                budget guard caps total spend
```

Nothing here is novel plumbing. Both tools already ship every primitive. The kit
is the part that makes the last arrow — the handoff to you — carry receipts
instead of a vibe.

## The stages and the primitive that runs each one

| Stage | What it does | Claude Code | Codex |
|---|---|---|---|
| **1. Cadence** | Kick the loop off on a schedule, unattended | scheduled task (`/schedule`, cron) | **Automations** tab (cron) |
| **2. Triage in** | Find candidate work, emit a finding list | `/goal` run-until-condition | `/goal` |
| **3. Isolate** | One worktree per finding, no cross-contamination | isolation worktree | built-in worktrees |
| **4. Make** | Draft the fix, name a command per claim | `.claude/agents/loop-maker` subagent | `.codex/agents/loop-maker.toml` subagent |
| **5. Verify** | Re-run the claims, write the Evidence Report | `.claude/agents/loop-verifier` subagent | `.codex/agents/loop-verifier.toml` subagent |
| **6. Surface** | Show the human only `risk > low` | hook + `loop-triage` over `.loop/runs/` | Automation post-step over `.loop/runs/` |
| **7. Cap spend** | Refuse to keep burning budget | `Stop` hook → `loop-budget` | Automation guard → `loop-budget` |

The kit's contract — the Evidence Report at `.loop/runs/`, the maker/checker
agents, `scripts/validate-report.mjs`, `scripts/loop-budget.mjs` — is identical
across both. Only stages 1, 3, 6, and 7 differ, because that's where the tools
expose different machinery.

> **Primitives, disambiguated.** Three things drive the loop and people conflate
> them: **cadence** — `/schedule` (cron) or `/loop` (in-session interval) — fires
> the loop on a timer; **`/goal`** is the run-until-condition driver that keeps
> working until a *verifiable* stop holds (here: every finding has a passing
> Evidence Report); **subagents** (`.claude/agents`, `.codex/agents`) are invoked
> per finding (in Codex, by `@name`). These are the tools' own loop primitives,
> not the kit's — check your tool's current docs for exact syntax. The kit only
> adds the report the driver stops on.

---

## Stage 1 — Cadence: run it unattended

The loop should wake on its own. A nightly "fix what's red" pass is the canonical
shape: it runs at 02:00, does its work, and leaves you a triage queue for the
morning.

### Claude Code — scheduled task / cron

Use `/schedule` to register a cloud routine on a cron expression, or a local cron
entry that drives a headless run. The scheduled prompt is just the entry point
into stage 2.

```
/schedule create
  name: nightly-red-fixer
  cron: "0 2 * * *"
  prompt: "/goal Find every failing check on main and fix each one in its own worktree.
           Stop when all findings have an Evidence Report in .loop/runs/."
```

Local cron equivalent (headless), if you'd rather own the scheduler:

```cron
# m h dom mon dow   command
0 2 * * *   cd /repo && claude -p "/goal $(cat .loop/prompts/nightly.txt)" >> .loop/cron.log 2>&1
```

### Codex — Automations tab

Codex ships scheduled runs as first-class **Automations**. Create one, give it a
cron cadence, and point its prompt at the same `/goal`. Same shape, different
front door:

```
Automations ▸ New
  Name:     nightly-red-fixer
  Schedule: 0 2 * * *   (daily, 02:00)
  Prompt:   /goal Find every failing check on main and fix each one in its own
            worktree. Stop when all findings have an Evidence Report in .loop/runs/.
```

> The cadence is the *only* thing that makes this a loop and not a one-shot. It's
> also what makes verification non-negotiable: a thing that runs while you sleep
> has no human in the make step. The Evidence Report is the human in the *review*
> step, deferred to morning.

---

## Stage 2 — Triage in: turn a repo state into a finding list

This is the loop's own internal triage — distinct from the human triage in stage
6. It scans for work and emits a list of independent findings, each of which
becomes one iteration.

Both tools express "do work until a condition holds" the same way: `/goal`. The
condition is *every finding has a report*, not *the model feels done*.

### Both tools — `/goal` run-until-condition

```
/goal
  Enumerate failing checks (lint, typecheck, test, audit) on the default branch.
  For EACH failure, treat it as one finding with a stable slug (e.g. test-auth-revoke).
  Loop over findings one at a time using the per-finding procedure below.
  DONE when: for every finding I have run `node scripts/validate-report.mjs <report>`
             and shown its PASS / exit 0 in this conversation.
```

> **Claude Code `/goal` reads what you *say*, not what you run.** Its evaluator
> (Haiku, after every turn) judges your stop condition against output already
> surfaced in the conversation — it does not run commands or read files itself.
> So phrase the condition as something the loop *prints*: surface each validator
> `PASS` in-conversation; don't expect the evaluator to run the validator. Codex's
> `/goal` differs (it verifies against current repo state), but writing the
> condition as demonstrable output is the portable habit.

A finding is the unit of the loop. Keep them independent — one finding, one
worktree, one report. Don't let the maker batch five fixes into one diff; that
collapses your triage surface back into "read everything."

---

## Stage 3 — Isolate: one worktree per finding

Each finding gets its own git worktree. The maker can't trip over another
finding's half-finished edit, and a failed iteration is `rm -rf`'d without
touching anything else. This is the blast-radius control for an unattended loop.

### Claude Code — isolation worktree

```bash
# Per finding, inside the /goal loop:
git worktree add -b loop/test-auth-revoke ../wt-test-auth-revoke origin/main
# ... run stages 4 + 5 with cwd = ../wt-test-auth-revoke ...
git worktree remove ../wt-test-auth-revoke   # on success or abandonment
```

In a Claude Code session, the agent does this directly with `Bash`; the worktree
is the sandbox the `loop-maker` subagent operates in.

### Codex — built-in worktrees

Codex manages worktrees natively — each task can run in its own checkout without
you scripting `git worktree`. Point the per-finding step at a fresh worktree and
Codex handles creation and teardown:

```
For each finding: start in a fresh worktree off origin/main, branch loop/<slug>.
Run the maker and verifier there. Discard the worktree if the verdict is refuted.
```

> Why isolation matters for *trust*, not just hygiene: the Evidence Report's
> `evidence[].command` is only meaningful if it ran against exactly the diff the
> report describes. A shared working tree lets one finding's changes leak into
> another's test run — and now your exit code is lying. One worktree per report
> keeps the proof honest.

---

## Stage 4 — Make: draft the fix

Hand the finding to the **maker** subagent. It implements the smallest change
that does the task, runs its own commands first, and hands off a list of claims —
each in the form `claim — command that proves it`. It does **not** write the
Evidence Report and does **not** grade itself.

These agents already ship in the repo. Drop them in and invoke by name.

### Claude Code — `.claude/agents/loop-maker.md` subagent

```
> Use the loop-maker subagent to fix finding `test-auth-revoke` in this worktree.
  Restate the task, implement it, run every claim's command yourself, and hand off
  the claims. Do not write to .loop/runs/.
```

### Codex — `.codex/agents/loop-maker.toml` subagent

```
@loop-maker  Fix finding test-auth-revoke in this worktree. Implement the smallest
             change, run each claim's command yourself, hand off claims + commands.
             Do not author the Evidence Report.
```

The maker is optimistic by construction — that's the point. Its optimism is
*safe* only because a different agent is about to try to refute it. (See
[`.claude/agents/loop-maker.md`](../.claude/agents/loop-maker.md) and
[`.codex/agents/loop-maker.toml`](../.codex/agents/loop-maker.toml).)

---

## Stage 5 — Verify: re-run the claims, write the report

Hand the maker's claims to the **verifier** — a *different* agent (and ideally a
different/stronger model on high effort). It re-runs every command itself, hunts
for what isn't covered, sets `risk`, and writes the Evidence Report to
`.loop/runs/<date>-<slug>.md`. It is the only agent allowed to author that file.

### Claude Code — `.claude/agents/loop-verifier.md` subagent

```
> Use the loop-verifier subagent on the maker's handoff for `test-auth-revoke`.
  Re-run each claimed command yourself (do not trust pasted output), attack the
  change, set risk, and write the Evidence Report to .loop/runs/. Reply with the
  report path and a one-line verdict.
```

### Codex — `.codex/agents/loop-verifier.toml` subagent

```
@loop-verifier  Verify the maker's handoff for test-auth-revoke. Re-run every
                command, try to break it, own the risk field, and write
                .loop/runs/<date>-test-auth-revoke.md. Return path + verdict.
```

Then gate the report through the validator before it counts as a finished
iteration. A report that doesn't pass the schema isn't done:

```bash
node scripts/validate-report.mjs .loop/runs/2026-06-16-test-auth-revoke.md
# PASS  → finding closed; commit the worktree branch or open a PR
# FAIL  → the loop's own output is malformed; fix the report, don't merge
```

The validator enforces the rules that make the format mean something: no naked
claims on a `done` report, `verified_by: checker` requires a real command + exit
code, and `maker.agent != checker.agent` (no self-grading). See
[`scripts/validate-report.mjs`](../scripts/validate-report.mjs).

> This is the load-bearing stage. Everything before it is convenience; this is
> where "done" stops being a claim. If you cut one corner in this recipe, don't
> cut this one — an unattended maker with no skeptic is just a faster way to
> merge bugs. The worked examples show all three outcomes:
> [a clean low-risk pass](../.loop/runs/2026-06-16-fix-readme-typo.md),
> [a partial with a real gap](../.loop/runs/2026-06-16-add-rate-limiting.md), and
> [a refuted "done" that was an auth bypass](../.loop/runs/2026-06-15-refactor-auth-cache.md).

---

## Stage 6 — Surface: show the human only `risk > low`

By morning you have a stack of Evidence Reports. The whole point of the kit is
that you do **not** read all of them. The triage step reads the frontmatter and
surfaces only what earns your attention — `risk: medium` (read the diff),
`risk: high` (read carefully before merge), or any non-empty `needs_human`. The
`risk: low` reports you skip on purpose; they're mechanical and fully verified.

A dependency-free triage filter over the report frontmatter — the illustration
below. The packaged, robust forms ship in the kit: [`scripts/triage.mjs`](../scripts/triage.mjs)
(for hooks/automations) and the [`loop-triage`](../skills/loop-triage/SKILL.md)
skill (for an agent). They handle `needs_human` whitespace and version-skew that
the raw `grep` below does not:

```bash
# Surface findings that need a human; stay silent on the rest.
for f in .loop/runs/*.md; do
  risk=$(sed -n 's/^risk:[[:space:]]*//p' "$f" | head -1)
  case "$risk" in
    medium|high) echo "REVIEW [$risk]  $f" ;;
  esac
done
# anything with a non-empty needs_human also gets surfaced
grep -rL 'needs_human: \[\]' .loop/runs/*.md | sed 's/^/DECIDE        /'
```

### Claude Code — hook + `loop-triage`

Wire a `Stop` (or `SubagentStop`) hook that runs the triage filter when the loop
finishes and pings you with only the `> low` set. In `.claude/settings.json`:

```json
{
  "hooks": {
    "Stop": [
      { "matcher": "*", "hooks": [
        { "type": "command",
          "command": "node scripts/loop-budget.mjs; node scripts/triage.mjs" }
      ] }
    ]
  }
}
```

### Codex — Automation post-step

Add the same filter as a final step in the Automation (or a notification action
on completion). The Automation that started the loop closes it by handing you the
short list:

```
After the loop: run node scripts/triage.mjs over .loop/runs/ from this run and
notify me with only risk medium|high or non-empty needs_human. Stay silent otherwise.
```

> Review bandwidth is the ceiling on how many loops you can run. This stage is
> what raises the ceiling: it routes your scarce attention to the two reports
> that need it instead of the twenty that don't. The `risk` field is the
> checker's call, never the maker's — that's why you can trust it to filter.

---

## Stage 7 — Cap spend: the budget guard

An unattended loop with a bug can spend money in a tight circle. The budget guard
sums the `cost:` block of every report in `.loop/runs/` and exits non-zero when
cumulative spend crosses a cap you set in `.loop/budget.json` (per-machine,
gitignored).

```json
// .loop/budget.json  — not committed
{ "usd": 25.00, "output_tokens": 2000000 }
```

```bash
node scripts/loop-budget.mjs
# prints a per-run ledger + TOTAL, then:
#   exit 0  → within budget
#   exit 1  → BUDGET EXCEEDED   (stop the loop)
#   exit 2  → malformed budget.json
```

### Claude Code — `Stop` hook gate

Run `loop-budget` in the same `Stop` hook (or before each iteration). A non-zero
exit is your signal to halt the schedule rather than start another finding:

```bash
node scripts/loop-budget.mjs || { echo "budget cap hit — halting loop"; exit 1; }
```

### Codex — Automation guard

Make the budget check a precondition step in the Automation: if `loop-budget`
exits 1, the Automation aborts before spinning up the next worktree. Same script,
same `.loop/budget.json`, same exit-code contract.

> Spend varies wildly run to run — the `cost` block puts it on the record, and
> the guard turns the record into a brake. With no `budget.json`, spend is still
> logged; you just don't get an automatic stop. See
> [`scripts/loop-budget.mjs`](../scripts/loop-budget.mjs).

---

## The whole thing, as one per-finding procedure

Drop this into the `/goal` prompt as the body of the per-finding loop. It reads
identically in both tools; only stages 1/3/6/7 wire to different machinery
around it.

```
For finding <slug>:
  1. Create an isolated worktree off origin/main, branch loop/<slug>.
  2. Run loop-maker in that worktree. It implements the fix and hands off
     claims, each as `claim — command`. It does NOT write to .loop/runs/.
  3. Run loop-verifier on that handoff. It re-runs every command itself,
     attacks the change, sets risk, and writes .loop/runs/<date>-<slug>.md.
  4. Run `node scripts/validate-report.mjs .loop/runs/<date>-<slug>.md`.
     If it FAILs, the report is malformed — fix it; do not close the finding.
  5. Run `node scripts/loop-budget.mjs`. If it exits non-zero, stop the loop.
  6. If verdict is refuted/failed: leave the report, discard the branch, move on.
     If confirmed: keep the branch (PR it) and move on.
DONE when, for every finding, the validator's PASS output has been shown in this
conversation (Claude Code's /goal evaluator reads surfaced output, not files).
Surface to the human only reports with risk medium|high or non-empty needs_human.
```

---

## What this still does not do for you

The kit makes "done" carry its proof. It does not make the proof true *for* you,
and it does not absolve you of being the engineer. Three things it pointedly
leaves on your plate:

1. **Verification is still on you.** The `loop-verifier` re-runs commands and
   writes down what held and what didn't — but it can only check the claims a
   command can express. The `unverified` section exists *because* the verifier
   knows it didn't prove everything. A report that says `risk: low, needs_human: []`
   is the verifier's best honest read, not a guarantee. You still own the merge.

2. **Comprehension debt doesn't disappear — it gets *named*.** Every gap the loop
   couldn't close lands in `unverified`. That's the most valuable part of the
   report and the cheapest to ignore. Reading it is the work the kit can't do for
   you: it surfaces the debt, it doesn't pay it down. "Honesty about gaps beats
   optimism" only helps if someone reads the gaps.

3. **Stay the engineer.** Automations, worktrees, subagents, and a budget cap let
   you run more loops unattended — they don't make the loops *right*. The kit is
   the portable, persistent, reviewable layer on top of tooling that's otherwise
   locked, ephemeral, and author-dependent. It raises your review ceiling; it
   does not replace your judgment.

> Build the loop. Stay the engineer.
