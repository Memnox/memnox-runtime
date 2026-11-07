---
'@memnox/core': patch
'memnox': patch
'@memnox/proxy': patch
'@memnox/interceptors': patch
'@memnox/guard': patch
---

`@memnox/guard` names the agent's profile on every record: `profileId` on `createGuard` (or `MEMNOX_PROFILE`) and on `wrapTool`. `guard.myWork()`, `guard.reportProgress({ workId, note, state, refs })` and `guard.requestHandoff(...)` read and report the work a person pointed the agent at, over the cloud's MCP tools `memnox_my_work`, `memnox_report_progress` and `memnox_request_handoff`.
