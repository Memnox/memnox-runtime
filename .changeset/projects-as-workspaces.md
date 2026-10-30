---
'@memnox/core': patch
'memnox': patch
'@memnox/proxy': patch
'@memnox/interceptors': patch
---

Projects are first class on the daemon. A repository is found from its sessions, from the projects opened on this machine, and from any known repository that commits `.memnox/project.toml`, which names its instruction files, MCP servers, skills, agents, rule file and memory scope. The new `projects`, `project-open`, `project-put` and `project-apply` methods read and apply one: its instructions from `CLAUDE.md`, `AGENTS.md`, `GEMINI.md` and `.cursor/rules` are written into each of its agents' own files inside a marked block that never touches the person's words, while its servers, skills and rule file wait on one signed proposal.
