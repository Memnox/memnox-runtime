---
'@memnox/core': patch
'memnox': patch
'@memnox/proxy': patch
'@memnox/interceptors': patch
'@memnox/guard': patch
---

A held call carried up on the heartbeat now names the session that asked, so the workspace can put it under that session rather than guessing from the agent.
