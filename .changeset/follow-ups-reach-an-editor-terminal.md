---
'@memnox/core': patch
'memnox': patch
'@memnox/proxy': patch
'@memnox/interceptors': patch
---

A follow up said to a session in a VS Code or Cursor terminal reaches it again after `~/.memnox` was made afresh, since every editor window now watches the new folder rather than the one removed, and the window holding the terminal claims it well inside the wait. An older copy of the editor extension is no longer deleted while an editor that loaded it is still open, so restarting that editor's extensions brings Memnox back rather than leaving the window without it.
