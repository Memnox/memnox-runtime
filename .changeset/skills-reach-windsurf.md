---
'@memnox/core': patch
'memnox': patch
'@memnox/proxy': patch
'@memnox/interceptors': patch
---

The Skills Hub writes a skill into Windsurf. Windsurf has no skills, so a skill becomes a Cascade workflow, `.windsurf/workflows/<name>.md` in a repository or `~/.codeium/windsurf/global_workflows/<name>.md` for every project, written with the Memnox marker so only Memnox ever removes it. It says what it loses: the workflow runs only when typed as `/<name>`, the files beside the instructions and the tool grant are not carried, and instructions past the 12000 characters Windsurf reads are left out. Windsurf counts as installed where its own settings folder is, the one its detector reads.
