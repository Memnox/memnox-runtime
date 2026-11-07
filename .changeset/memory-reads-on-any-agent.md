---
'@memnox/core': patch
'memnox': patch
'@memnox/proxy': patch
'@memnox/interceptors': patch
---

Memory extraction no longer needs Claude Code. It runs on whichever of the person's agents answers first, in the voice's preference order: Claude Code with every tool off, or Codex or Cursor over the Agent Client Protocol in their read-only mode, with no tools and every permission request refused. An agent that cannot be shut into reading, such as Hermes or OpenClaw, is never asked to read notes.
