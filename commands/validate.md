---
description: Validate every Evidence Report in .loop/runs against the SPEC
allowed-tools: Bash
---

Run the Loop Trust Kit validator over this repo's Evidence Reports:

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/validate-report.mjs"`

Report how many passed/failed. For any failure, name the file and the exact rule it broke. A non-zero exit means a report is malformed — do not treat the loop's output as done until it passes.
