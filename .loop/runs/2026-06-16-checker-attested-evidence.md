---
loop_trust_kit: 1

run_id: 2026-06-16-checker-attested-evidence
task: "Validator on a done report every evidence entry must be verified_by checker, else FAIL with an index-specific reason"

status: partial

maker:
  agent: implementer
  model: claude-opus-4-8

checker:
  agent: loop-verifier
  model: claude-opus-4-8
  verdict: confirmed

changes:
  - path: scripts/validate-report.mjs
    summary: "New rule C on status done, any evidence verified_by not equal to checker is an index-scoped FAIL. Placed before the existing verified_by==checker block; scoped to isDone; no other rule altered (+13 lines)."

evidence:
  - claim: "All 5 real reports still pass, exit 0 (claim 1)"
    method: command
    command: "node scripts/validate-report.mjs"
    exit_code: 0
    output_excerpt: |
      PASS  .loop/runs/2026-06-15-refactor-auth-cache.md
      PASS  .loop/runs/2026-06-16-add-rate-limiting.md
      PASS  .loop/runs/2026-06-16-build-loop-trust-kit.md
      PASS  .loop/runs/2026-06-16-fix-readme-typo.md
      PASS  .loop/runs/2026-06-16-harden-validator.md
      5/5 reports passed.
    verified_by: checker
  - claim: "done plus a maker-attested evidence entry at index 1 FAILS exit 1 with an index-1 message (claim 2)"
    method: command
    command: "node scripts/validate-report.mjs tmp-claim2-done-maker-idx1.md  built and deleted by checker"
    exit_code: 1
    output_excerpt: |
      FAIL  tmp-claim2-done-maker-idx1.md
        - evidence[1] is verified_by maker on a done report, only checker-verified evidence counts; move it to unverified
      0/1 reports passed, 1 failed.
    verified_by: checker
  - claim: "The same maker-attested entry on a status partial report PASSES exit 0, rule is scoped to done (claim 3)"
    method: command
    command: "node scripts/validate-report.mjs tmp-claim3-partial-maker.md  built and deleted by checker"
    exit_code: 0
    output_excerpt: |
      PASS  tmp-claim3-partial-maker.md
      1/1 reports passed.
    verified_by: checker
  - claim: "done plus an evidence entry with verified_by MISSING FAILS exit 1, verified_by null (claim 4)"
    method: command
    command: "node scripts/validate-report.mjs tmp-claim4-done-missing-vb.md  built and deleted by checker"
    exit_code: 1
    output_excerpt: |
      FAIL  tmp-claim4-done-missing-vb.md
        - evidence[0] is verified_by null on a done report, only checker-verified evidence counts; move it to unverified
      0/1 reports passed, 1 failed.
    verified_by: checker
  - claim: "SIBLING HOLE CLOSED, done method command, command present, NO exit_code, verified_by maker, PASSED under old validator now FAILS"
    method: command
    command: "git show HEAD:scripts/validate-report.mjs > old.mjs; node old.mjs hole.md gives PASS exit 0; node scripts/validate-report.mjs hole.md gives FAIL exit 1; built and deleted by checker"
    exit_code: 1
    output_excerpt: |
      OLD validator PASS hole.md exit 0  (the hole)
      NEW validator FAIL hole.md
        - evidence[0] is verified_by maker on a done report, move it to unverified
      exit 1  (hole closed)
    verified_by: checker
  - claim: "Prior rules untouched (claim 5), done command-needs-command still fires; verified_by checker command needs integer exit_code still fires"
    method: command
    command: "node scripts/validate-report.mjs tmp-prior-cmd-no-command.md FAIL 1; node scripts/validate-report.mjs tmp-prior-noninteger-exit.md FAIL 1; built and deleted by checker"
    exit_code: 1
    output_excerpt: |
      tmp-prior-cmd-no-command  evidence[0] has method command but no command, a naked claim
      tmp-prior-noninteger-exit evidence[0] is verified_by checker but exit_code is not an integer, got zero
    verified_by: checker
  - claim: "Diff is +13 lines to one file, the new block placed before the existing verified_by==checker block"
    method: command
    command: "git diff HEAD --stat -- scripts/validate-report.mjs"
    exit_code: 0
    output_excerpt: |
      scripts/validate-report.mjs | 13 +++++++++++++
      1 file changed, 13 insertions(+)
    verified_by: checker

unverified:
  - "SPOOF SURFACE residual, cannot be closed by a static validator. A report whose evidence entry is verified_by checker with a fabricated exit_code 0 on a command nobody actually ran still PASSES. Reproduced a done report with method command, command present, exit_code 0, verified_by checker passes exit 0. The validator checks the literal label, not who ran it. The maker-not-checker integrity guarantee therefore lives in the loop agent separation, NOT in this rule."
  - "INSPECTION-ON-DONE CONSTRAINT, pre-existing, not introduced here. A legitimate checker code-inspection entry, method inspection, verified_by checker, no command or exit_code, is REJECTED on a done report. Confirmed it fails identically under BOTH old and new validators, so it is not a regression from this change, but the upshot is that on a done report there is no way to log a checker inspection as evidence; it must be method command or moved to unverified. Whether that is intended is a SPEC question, not a bug in this diff."
  - "Only single- and double-entry evidence lists were exercised for the index-specific message; not stress-tested with 3 or more entries or mixed valid/invalid ordering beyond index 0 and index 1."
  - "Whole-repo behaviour over the default .loop/runs glob with the new rule was confirmed 5/5, but no test asserts the rule against a real future report that legitimately needs a maker-attested entry on a done status, none such exists today."

risk: low

needs_human:
  - "Decide whether a checker code-inspection, method inspection, should ever be admissible as evidence on a done report. Today it is rejected by the pre-existing verified_by checker needs-command rule; this change does not alter that, but it makes done strictly require checker-run commands."

cost:
  input_tokens: 61000
  output_tokens: 7200
  usd_estimate: 0.42
---

## What changed
The maker added one rule, rule C, +13 lines, to scripts/validate-report.mjs. On a status
done report, any evidence entry whose verified_by is not exactly the string checker is an
index-scoped FAIL telling the author to move it to unverified. It is placed immediately
before the existing verified_by==checker block, which still demands a command and an
integer exit_code, and the whole rule is gated on isDone, so non-done statuses are
unaffected. The diff touches nothing else. I confirmed the placement and the +13 one-file
shape via git diff.

## How I tried to break it
I re-ran the real suite, 5/5 PASS, exit 0. I then built five throwaway fixtures at
tmp-*.md outside .loop/runs/ and deleted them after, a done report with a maker-attested
entry at index 1, FAIL exit 1 with the evidence[1] message, index-specific confirmed; the
same entry flipped to status partial, PASS exit 0, scoping confirmed; a done report with
verified_by absent, FAIL with verified_by null; and the two prior-rule fixtures,
naked-command and non-integer exit_code, which both still FAIL, so claim 5 holds. The
load-bearing test, I checked out the committed validator with git show HEAD and ran the
sibling-hole fixture, done, method command, command present, NO exit_code, verified_by
maker, through it, it PASSED exit 0, the literal hole. The new validator FAILs the
identical file, exit 1. Hole proven closed, not asserted. What did NOT hold the way one
might hope, a maker who simply types verified_by checker next to a fabricated exit_code 0
on an unrun command still PASSES, I reproduced that PASS. And a legitimate checker
inspection entry on a done report is rejected, but I verified that rejection is identical
under the old validator, so it is pre-existing, not a regression.

## What I could not prove
The validator cannot tell a real checker run from a maker writing the word checker. The
spoof PASS above is the residual gap, and it means the maker and checker integrity
guarantee must come from the loop running two distinct agents, not from this rule,
unverified[0]. Separately, on a done report there is now no admissible slot for a checker
code-inspection that has no command; that is a SPEC-level decision flagged for a human,
unverified[1] and needs_human[0]. I exercised index 0 and index 1 but not deep or
mixed-ordering evidence lists, unverified[2], and no real report exists that would
legitimately want a maker-attested entry on a done status, so that interaction is
untested in the wild, unverified[3].
