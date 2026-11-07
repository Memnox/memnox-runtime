---
'@memnox/core': patch
'memnox': patch
'@memnox/proxy': patch
'@memnox/interceptors': patch
---

A rule scoped to a project now decides the actions taken in it. Every seam that builds a request names the project of the folder the action runs in: the shell seam, the wrapped binaries on both the Node and the native path, the hooks of Claude Code, Cursor, Codex and the rest, and the MCP proxy from the folder its agent started it in. A clone of a project the organization shares carries that project's rule pack, and an opened project carries the `project` its own rule file declares, so a pack the organization publishes for one repository holds there and nowhere else.
