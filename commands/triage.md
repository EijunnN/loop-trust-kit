---
description: Triage Evidence Reports into a 30-second briefing (risk + needs_human)
allowed-tools: Bash
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/triage.mjs"`

Present the briefing above. Lead with everything under "Act first" (needs_human) and the high-risk items, then state plainly which reports I can skip. This is a routing decision, not a recap.
