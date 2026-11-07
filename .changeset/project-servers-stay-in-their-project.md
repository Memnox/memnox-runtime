---
'@memnox/core': patch
'memnox': patch
'@memnox/proxy': patch
'@memnox/interceptors': patch
---

A project's MCP servers are now given to its agents in that repository alone: written into Claude Code's local scope for it, or into the repository's own Cursor, VS Code, Codex or Gemini config, and never into the agent's config that every project reads; an agent that keeps no per repository config is not given them.
