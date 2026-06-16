---
description: Tally loop token/$ spend across Evidence Reports; warn if over the cap
allowed-tools: Bash
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/loop-budget.mjs"`

Report the cumulative spend and whether a cap in .loop/budget.json was exceeded. A non-zero exit means the loop is over budget and should stop.
