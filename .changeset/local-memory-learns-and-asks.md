---
'@memnox/core': patch
'memnox': patch
'@memnox/proxy': patch
'@memnox/interceptors': patch
---

Memnox now keeps a local memory in `~/.memnox/memory.db`, read from the places a person points it at: an Obsidian vault, a Markdown folder, a repository's agent instruction files, a Notion export, Supermemory with its key in the OS store, or an MCP memory server in the hub. Files are read again when they change and never on a timer, and the person's own agent CLI reads them with no tools into a Learn queue of facts, conventions and rule candidates, each with the passages it was read from. The new `memory-*` daemon methods list sources, read them, show the queue, confirm, reject, edit, search and forget. Confirming a fact makes it verified; confirming a rule raises the same signed proposal as any rule, and once signed the rule names the note it was learned from whenever it stops an agent. A rejection is remembered, a changed or removed source leaves what it taught outdated, and two confirmed facts that disagree are both flagged.
