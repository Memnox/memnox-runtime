---
'@memnox/core': patch
'memnox': patch
'@memnox/proxy': patch
'@memnox/interceptors': patch
'@memnox/guard': patch
---

A project's `agents` list in `.memnox/project.toml` takes profile ids beside agent kinds. A profile stands for every agent bound to it, so a project's instructions and skills reach only those agents; an empty list still means every agent seen working in the project.
