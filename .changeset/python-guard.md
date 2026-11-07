---
'@memnox/core': patch
'memnox': patch
'@memnox/proxy': patch
'@memnox/interceptors': patch
'@memnox/guard': patch
---

A Python guard, `packages/guard-py`, decides allow, ask or deny for a Python agent from the signed bundle, with wrappers for OpenAI Agents SDK function tools and LangGraph tools, and reads and reports the agent's work. `vectors/guard-decisions.json`, written by the TypeScript guard's tests, holds both guards to the same decisions.
