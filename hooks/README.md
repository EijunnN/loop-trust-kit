# Token-budget guard

`scripts/loop-budget.mjs` tallies the `cost:` block of every Evidence Report in
`.loop/runs/` and prints a ledger. If `.loop/budget.json` exists, it exits
non-zero once cumulative spend crosses the cap. This page wires that script in as
a guard in both tools.

The point is the token-rich vs token-poor problem. A loop running unattended
spends real money, and the spend is invisible until the bill arrives. Every
Evidence Report already records its own `cost:` (see `SPEC.md`); this guard sums
those records so the *cumulative* spend lands on the record too. A hard cap is
optional — you can run the guard purely to surface the number and never fail on
it.

```
# the number, no cap (always exit 0):
node scripts/loop-budget.mjs

# with a cap, exits 1 when exceeded:
echo '{"usd": 5.00}'           > .loop/budget.json
echo '{"output_tokens": 2000000}' > .loop/budget.json   # or this shape
echo '{"usd": 5.00, "output_tokens": 2000000}' > .loop/budget.json  # or both
```

Exit codes: `0` within budget (or no `budget.json`), `1` budget exceeded, `2`
the script or `budget.json` is malformed.

## Claude Code

### As a hook

Claude Code fires hooks at lifecycle points. The honest fit for a *cumulative*
budget is `Stop` (or `SubagentStop`) — it runs after a turn completes, which is
exactly when a fresh Evidence Report has just landed in `.loop/runs/`, so the
tally includes the run that just finished.

Add to `.claude/settings.json`:

```json
{
  "hooks": {
    "Stop": [
      {
        "matcher": "*",
        "hooks": [
          { "type": "command", "command": "node scripts/loop-budget.mjs" }
        ]
      }
    ]
  }
}
```

A non-zero exit surfaces the guard's stderr (the `BUDGET EXCEEDED` lines) as
feedback. One Claude Code nuance to be honest about: a `Stop`/`SubagentStop` hook
*blocks and feeds the model back* only on **exit code 2**; other non-zero codes
are shown but don't by themselves halt continuation. So the reliable gate is to
check the guard's exit code in the looped command itself (as the Codex section
does) — or have the guard exit `2` on breach if you want the `Stop` hook alone to
stop the next iteration.

`PreToolUse` is the wrong point: it fires before the work and before the report
exists, so the tally would always be one run stale and would block tool calls on
last turn's spend. Use `Stop`/`SubagentStop` so the guard reads a current ledger.

### How `/loop` cadence relates

`/loop` runs a prompt or slash command on a recurring interval (e.g.
`/loop 5m /verify`). The guard and the cadence are two different clocks and
should not be confused:

- **`/loop` sets how *often* iterations fire** — the throttle on wall-clock pace.
- **The budget guard sets how *much* total they may spend** — the throttle on
  cumulative cost.

A tight `/loop` interval still runs forever; only the budget guard stops it on
spend. Wire the guard into the looped command itself (e.g. `/loop 10m
'node scripts/loop-budget.mjs && /next-iteration'`) so a breach short-circuits
the iteration, or rely on the `Stop` hook above to fire it after every turn the
loop produces. The cadence decides *when* you check; the guard decides *whether
you may continue*.

## Codex

Codex has no settings-level hook table. Run the guard from an **Automation** —
a step in the same workflow that drives the loop — right after the
`loop-verifier` writes its report:

```bash
# automation step, after the verifier has written .loop/runs/<run>.md
node scripts/loop-budget.mjs || { echo "loop halted: over budget"; exit 1; }
```

Because the verifier authors the Evidence Report before this step runs, the
tally already includes the iteration that just finished — same property the
Claude Code `Stop` hook relies on. A non-zero exit fails the automation step;
gate the "continue the loop" step on its success so a breach stops the run
instead of just logging.

If your automation runs the loop as a single long step rather than a
re-triggered one, call the guard at the top of each iteration instead. It will
be one report stale (it cannot see the report the current iteration has not
written yet), which is an acceptable trade for a step you cannot re-enter.

## What a hook can and cannot enforce

Be honest about the ceiling here.

**It can:**

- Make cumulative spend *visible* every iteration — the ledger is the real win,
  cap or no cap.
- Stop the *next* iteration of a cooperating loop once spend crosses the line
  (non-zero exit → the loop's continue step fails).
- Catch a runaway loop *between* turns, before it compounds further.

**It cannot:**

- Stop the iteration that *causes* the overrun. The guard reads reports that
  already exist; the run that blew the budget has already been paid for by the
  time the report lands. The cap is a tripwire, not a circuit breaker — it
  bounds the *overshoot*, it does not prevent it.
- Enforce anything an agent chooses to bypass. A hook is a cooperating
  checkpoint, not a sandbox. An agent that ignores the non-zero exit, deletes
  `budget.json`, or never calls the guard is not stopped by it. Treat it as a
  guardrail for honest loops, not a security boundary against adversarial ones.
- Account for spend that never produced an Evidence Report. The tally is only as
  complete as `.loop/runs/`. Work that skipped the verifier is invisible to it
  (the guard prints which reports carried no `cost:` block so the gap is at least
  named, not hidden).
- Bill in real time. `usd_estimate` is the report author's estimate, not a
  metered charge; the cap is enforced against the recorded estimates, which is
  the best a portable, dependency-free, on-disk layer can do.

The guard's job is the same as the rest of this kit: put the number on the
record and route a human's attention. The hard cap is a convenience on top, not
the guarantee.
