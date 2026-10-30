---
'@memnox/core': patch
'memnox': patch
'@memnox/proxy': patch
'@memnox/interceptors': patch
---

Profiles bundle Skills Hub skills, MCP Hub servers and a rule pack under one name, such as Backend Engineering, kept one file each under `~/.memnox/profiles/`. `profiles`, `profile-put` and `profile-remove` read, keep and forget them, and keeping one grants nothing. `profile-apply` gives a profile to one agent in one project: every server and skill the agent does not have yet and every rule of the pack is raised as the same signed proposal it raises on its own, and what the hubs no longer hold is said rather than guessed. `agent-launch` takes `profileName` and applies the profile to the agent in that folder before it opens.
