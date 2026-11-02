---
'@memnox/core': minor
'memnox': minor
---

Memory in three layers any agent reads. `memory-layers` reports each project's MEMORY.md (lines, and lines that link to no file), every agent's router file (CLAUDE.md, AGENTS.md, GEMINI.md or Cursor's rules) with the departments it names, and the SKILL.md files that say where live data is. `memory-layers-plan` previews, writing nothing, a MEMORY.md index with one line per verified project memory linked to its own file and a router with one line per department plus a keep on compact list; `memory-layers-apply` writes exactly that plan inside Memnox's fenced blocks, and refuses a digest that no longer matches because a file changed since it was shown. The router block is never copied into another agent's file as the project's instructions.

Memory search now also reads a keyword index over every document's name and its passages' words, added beside `items_fts` with a migration that reads each document again once, so a search answers `memoryPassages` and the items those passages are evidence for. Each search's milliseconds are kept, the last fifty only, so `memory-layers` answers the median as `value.searchMedianMs`; tokens saved by `memnox_context` are not measured on this machine, so that field stays absent.

`session-cost` counts, over the last thirty days of Claude Code transcripts, the turns that loaded a cold cache again and what keeping each chat warm for four hours would have saved net of keeping it warm, at the API prices in a named table; a model the table lacks is listed in `unpricedModels` and the totals are left out rather than guessed. Nothing is pinged.

Skills improve with use: `skill-stats` counts each hub skill's uses, and the failures and refusals inside its turns, from the same transcripts; `skill-note` adds one line to the skill's fix backlog in `~/.memnox/skill-notes/<name>.md`, outside the skill's folder so nothing accepted changes; `skill-calibrate` builds, by rule and with no model, a suggested SKILL.md with a fenced "Known issues / fixes" section and its version moved on by one, which is accepted through `skill-put` like any other version.

A toolkit search answers `source` and `weight` on each toolkit, official first, then cli, api and community mcp, the catalogue's order kept within each.
