---
loop_trust_kit: 1

run_id: 2026-06-16-harden-validator
task: "Harden validate-report.mjs: on a done report, every method:command evidence entry must carry a non-empty command, else FAIL with an index-specific reason (scoped to done only)."

status: done

maker:
  agent: implementer
  model: claude-opus-4-8

checker:
  agent: loop-verifier
  model: claude-opus-4-8[1m]
  verdict: confirmed

changes:
  - path: scripts/validate-report.mjs
    summary: "New rule in validate: isDone AND method is command AND empty command yields an index-specific FAIL. 7 added lines, after the method none naked-claim check."
  - path: docs/loop-recipe.md
    summary: "Doc touch accompanying the rule (not validator behaviour; reviewed, not re-executed)."
  - path: .loop/runs/2026-06-16-build-loop-trust-kit.md
    summary: "Prior report edited by maker (12 lines); orthogonal to this rule, but one of the 4 reports the validator must still pass."

evidence:
  - claim: "All four existing reports still pass; validator exits 0 (claim 1). Re-run by checker."
    method: command
    command: "node scripts/validate-report.mjs"
    exit_code: 0
    output_excerpt: |
      PASS  .loop/runs/2026-06-15-refactor-auth-cache.md
      PASS  .loop/runs/2026-06-16-add-rate-limiting.md
      PASS  .loop/runs/2026-06-16-build-loop-trust-kit.md
      PASS  .loop/runs/2026-06-16-fix-readme-typo.md
      4/4 reports passed.
    verified_by: checker

  - claim: "Gap closes (claim 2): done + method:command + no command + verified_by:maker FAILS exit 1 with an evidence index 0 specific reason. Reproduced on checker fixture ./tmp-c2-naked-done.md (since deleted)."
    method: command
    command: "node scripts/validate-report.mjs ./tmp-c2-naked-done.md"
    exit_code: 1
    output_excerpt: |
      FAIL  tmp-c2-naked-done.md
        evidence index 0 has method command on a done report but no command (a naked claim)
      0/1 reports passed, 1 failed.
    verified_by: checker

  - claim: "Scoped to done (claim 3): the same naked method:command entry on a status:partial report PASSES exit 0. Reproduced on ./tmp-c3-naked-partial.md (since deleted)."
    method: command
    command: "node scripts/validate-report.mjs ./tmp-c3-naked-partial.md"
    exit_code: 0
    output_excerpt: |
      PASS  tmp-c3-naked-partial.md
      1/1 reports passed.
    verified_by: checker

  - claim: "No over-firing (claim 4): a done method:command entry WITH a non-empty command PASSES exit 0. Reproduced on ./tmp-c4-good-done.md (since deleted)."
    method: command
    command: "node scripts/validate-report.mjs ./tmp-c4-good-done.md"
    exit_code: 0
    output_excerpt: |
      PASS  tmp-c4-good-done.md
      1/1 reports passed.
    verified_by: checker

  - claim: "Empty-string command caught (claim 5): an empty command on a done report FAILS exit 1 with the same index-specific reason. Reproduced on ./tmp-c5-empty-done.md (since deleted)."
    method: command
    command: "node scripts/validate-report.mjs ./tmp-c5-empty-done.md"
    exit_code: 1
    output_excerpt: |
      FAIL  tmp-c5-empty-done.md
        evidence index 0 has method command on a done report but no command (a naked claim)
      0/1 reports passed, 1 failed.
    verified_by: checker

  - claim: "Robustness: a whitespace-only command on a done report also FAILS, trim catches it. Reproduced on ./tmp-ws.md (since deleted)."
    method: command
    command: "node scripts/validate-report.mjs ./tmp-ws.md"
    exit_code: 1
    output_excerpt: |
      FAIL  tmp-ws.md
        evidence index 0 has method command on a done report but no command (a naked claim)
    verified_by: checker

  - claim: "Index correctness: a bad entry at position 1 reports evidence index 1, not index 0. Reproduced on ./tmp-idx.md (since deleted)."
    method: command
    command: "node scripts/validate-report.mjs ./tmp-idx.md"
    exit_code: 1
    output_excerpt: |
      FAIL  tmp-idx.md
        evidence index 1 has method command on a done report but no command (a naked claim)
    verified_by: checker

  - claim: "No misfire on inspection: done + method:inspection + no command + verified_by:maker PASSES (rule scoped to method:command). Reproduced on ./tmp-insp2.md (since deleted)."
    method: command
    command: "node scripts/validate-report.mjs ./tmp-insp2.md"
    exit_code: 0
    output_excerpt: |
      PASS  tmp-insp2.md
      1/1 reports passed.
    verified_by: checker

  - claim: "The new guard line is present in the diff exactly as the handoff describes: grep for the guard message in git diff HEAD matches one added (+) line. Re-run by checker."
    method: command
    command: "git diff HEAD -- scripts/validate-report.mjs | grep \"method 'command' on a 'done' report but no command\""
    exit_code: 0
    output_excerpt: |
      +          E(`evidence[${k}] has method 'command' on a 'done' report but no command - a naked claim; name the exact command`);
    verified_by: checker

unverified:
  - "SIBLING HOLE (still open): a done report with method:command, a command PRESENT, but NO exit_code and verified_by:maker still PASSES. Reproduced on ./tmp-sib-noexit.md (PASS, exit 0). A maker can paste a command with zero proof it ran and no exit code; the exit_code requirement only fires when verified_by:checker. The new rule plugged no-command-at-all but not command-named-yet-unproven-and-self-attested. Why it matters: this is exactly the done-is-a-claim-not-a-proof failure the format exists to stop, and it stays exploitable on maker-attested entries."
  - "Body-section completeness is not machine-checked: the validator never inspects the markdown body, so a done report with empty or missing What-changed / How-I-tried-to-break-it / What-I-could-not-prove sections still passes. The 3-section body is convention, not enforced."
  - "output_excerpt is never validated: a maker could paste a fabricated PASS excerpt under verified_by:checker as long as a command string and integer exit_code exist. The validator checks shape, not that the excerpt matches the exit_code."
  - "Cross-platform encoding edge cases not exercised: fixtures were ASCII written via heredoc; behaviour on CRLF-only or BOM-containing reports beyond the single BOM strip was not stress-tested."
  - "docs/loop-recipe.md changes were read but not independently re-executed (docs have no executable check); treated as inspection-grade only."

risk: medium

needs_human:
  - "Decide whether to also require an integer exit_code on done + method:command + verified_by:maker entries (closes the sibling hole), or forbid verified_by:maker on method:command entries of a done report entirely. The current change leaves maker-attested commands provable-by-assertion."

cost:
  input_tokens: 0
  output_tokens: 67634
  usd_estimate: 0.70
---

## What changed
The maker added a 7-line rule to validate() in scripts/validate-report.mjs: on a
status:done report, any evidence entry with method:command whose command is
missing, null, or whitespace-only now produces an index-specific FAIL. The rule
sits right after the existing method:none naked-claim check and is gated on
isDone, so partial / failed / needs-human reports are untouched. The diff matches
the handoff exactly, no other validator behaviour changed. Two accompanying
edits (a doc and a prior report) are orthogonal to the rule.

## How I tried to break it
I re-ran the validator on the four shipped reports (exit 0, 4/4 PASS) and built
my own throwaway fixtures at ./tmp-*.md (all deleted afterward) rather than
trusting any pasted output. Claims 2-5 all reproduced: naked-command-on-done
FAILs exit 1, the same entry on partial PASSes, a good command PASSes, and an
empty-string command FAILs. I then pushed past the handoff: a whitespace-only
command is also caught (trim holds); a bad entry at index 1 is correctly cited
as evidence index 1; and the rule does NOT misfire on method:inspection. The
rule is correctly scoped and the message is index-accurate. What did NOT hold:
the sibling hole. A done entry with method:command, a command string present,
but no exit_code and verified_by:maker sails through (PASS, exit 0). The
hardening closed no-command-named but left command-named-yet-never-proven open.

## What I could not prove
The headline gap is the sibling hole above: maker-attested command entries on a
done report still need no exit code, so I-ran-it-trust-me remains a valid shape,
the exact loophole the Evidence Report format is meant to deny. Beyond that, the
validator never reads the markdown body (the 3-section scan is unenforced),
never checks that an output_excerpt is present or that it matches the claimed
exit_code (excerpts are spoofable under verified_by:checker), and I did not
stress CRLF/BOM encoding paths. The doc change is inspection-grade only. None of
these were introduced by this change, but the hardening is narrower than
every-command-claim-on-a-done-report-is-backed-by-proof.
