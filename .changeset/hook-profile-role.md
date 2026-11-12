---
'@memnox/core': patch
'memnox': patch
'@memnox/proxy': patch
'@memnox/interceptors': patch
'@memnox/guard': patch
---

A hook session now matches rules under the role of the profile bound to its agent, as `memnox run` already did, so Claude Code, Codex and Cursor opened from their own icons are held to the same `roles:` rules. `--role` and `MEMNOX_AGENT_ROLE` still win.
