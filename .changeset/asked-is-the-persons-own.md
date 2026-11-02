---
'@memnox/core': patch
'memnox': patch
---

A session's ask is only ever what the person typed. A subagent's hand-back, another session's message, a task notification, a slash command's wrapper or output, an interruption marker and a note Memnox added all arrive as user turns, and the prompt hook and the transcript reader took the newest of them for the person's ask, so a card read `[Subagent hand-back] ...` under Asked. Both now skip them with `isInjectedPrompt` and `isInjectedOrigin`, a task one had set is replaced by the next real prompt, and `typedAsks` leaves one already kept off every card and event.
