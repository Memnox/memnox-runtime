---
'@memnox/core': patch
'memnox': patch
'@memnox/proxy': patch
'@memnox/interceptors': patch
'@memnox/guard': patch
---

Agent work: a person points the agent under a profile at an issue in Linear, Jira, GitHub or Asana with `memnox work start <profile> <LIN-123|link>`, and stops or closes it with `memnox work stop|close`. Memnox keeps a reference to the issue and never a copy, under `~/.memnox/work/` or the project's `.memnox/work/`. A session of that agent on a branch named for the issue, or started with `memnox run --work <id>`, joins it and takes it as its task, so drift is still measured. An agent may ask to hand its work on, and only a person answers with `memnox handoff accept|decline <id>`. The daemon answers `agent-work`, `work-start`, `work-stop`, `work-close` and `handoff-answer`, and sends `work` events to a subscriber that asks with `subscribeWork`.
