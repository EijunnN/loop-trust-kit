# Contributing to Loop Trust Kit

This kit is small on purpose. The whole thing is one artifact — the **Evidence
Report** (`SPEC.md`) — plus the adapters and tooling that produce and check it.
Contributions that keep that surface small and sharp are the ones that land.

Before you open a PR, read [`SPEC.md`](./SPEC.md) and the [`README.md`](./README.md).
The format is the contract; everything else serves it.

## Design tenets (don't break these)

Every change is judged against the five tenets from the README. If a PR fights
one of them, it's the PR that's wrong:

1. **A claim is not evidence.** Every `done` claim maps to an executed command
   with an exit code and an output excerpt, or it's listed as `unverified`.
2. **Maker ≠ checker.** The agent that wrote the code never grades its own
   homework. Persist *who* made and *who* checked.
3. **On disk, not in context.** The model forgets between runs. The report
   doesn't. One file per iteration, diffable over time.
4. **Honesty about gaps beats optimism.** The `unverified` section is mandatory
   and is the most valuable part of the report.
5. **Tool-agnostic.** Nothing here assumes one vendor. Design for the *shape*.

## Adding a new tool adapter

An adapter teaches one coding tool how to run the `loop-verifier` and write an
Evidence Report. We ship two: `.claude/agents/loop-verifier.md` (Claude Code)
and `.codex/agents/loop-verifier.toml` (Codex). A new one (a different tool, a
different agent runtime) is welcome.

1. Put it where that tool expects to find agents — mirror the existing layout
   (`.<tool>/agents/loop-verifier.<ext>`).
2. **Port the contract, not the prose.** Reuse the operating principles and the
   procedure from the existing verifiers verbatim in meaning. The verifier must:
   default to skeptical, re-run instead of trust, treat any uncheckable claim as
   `unverified`, attack before it reports, own the `risk` field, and stay a
   distinct agent from the maker.
3. Point it at `SPEC.md` for the format. The adapter does not redefine the
   format — it produces it.
4. The adapter's final output is the path to the report on disk plus a one-line
   verdict. The report is the source of truth, not the chat.
5. Add a row to the "What's in the box" table in the README.

Keep adapters thin. If an adapter starts encoding format rules, those rules
belong in `SPEC.md` instead, where every tool inherits them.

## Adding a new agent format

Same shape as an adapter, narrower scope: a new on-disk agent definition format
(e.g. a new tool's config syntax). Match the conventions of the closest existing
file, keep the instructions semantically identical to the others, and verify a
real run produces a spec-conformant report before you submit. Two adapters that
disagree about what `done` means is the failure mode we're avoiding.

## Tooling and scripts

Validation and budget tooling lives in `scripts/` and is wired through
`package.json`:

- `npm run validate` — check an Evidence Report against the `SPEC.md` schema.
- `npm run budget` — inspect the local token/cost ledger.
- `npm test` — runs `validate` (the report format is what we test).

No runtime dependencies. This is a zero-install gift — keep `dependencies` empty
and stay on the Node standard library (`engines: node >= 18`). A PR that adds a
dependency needs to justify why the stdlib can't do it.

## Proposing a SPEC change

The format version is `loop_trust_kit: 1`. Tooling refuses a report whose
version it doesn't understand rather than guess, so changing the format is a
deliberate, versioned act.

1. **Open an issue first.** Describe the unsolved problem the change attacks —
   the same bar as the "Why these fields" table in `SPEC.md`. New fields earn
   their place by naming a problem, not by being nice to have.
2. **Decide if it breaks readers.** Adding an *optional* field that old tooling
   can ignore is backwards-compatible. Renaming, removing, or repurposing a
   field, or changing what a value means, is breaking.
3. **Bump the version on any breaking change.** Increment `loop_trust_kit`
   (`1` → `2`) in `SPEC.md`, and update the validator so it accepts the new
   version and still rejects what it cannot understand.
4. **Update the worked example** in `.loop/runs/` so it stays a valid report
   under the new version. The example is documentation; it must always pass
   `npm run validate`.
5. **Keep the body human-facing.** The frontmatter is the contract; the markdown
   body is the 30-second human scan. Don't grow the body into a form.

## Style

Match the existing voice: terse, concrete, senior-engineer. No marketing, no
hedging. Say what it does and what it doesn't prove.
