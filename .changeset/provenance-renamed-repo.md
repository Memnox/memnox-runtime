---
'@memnox/core': patch
'memnox': patch
'@memnox/proxy': patch
'@memnox/interceptors': patch
'@memnox/guard': patch
---

`memnox update` now requires provenance from `github.com/Memnox/memnox-runtime`, the repository's name since it was renamed from `Memnox/memnox`, and every package names that repository, so a release published through trusted publishing verifies again. A copy installed before this release still trusts the old name and refuses this one, so it updates once with `memnox update --skip-verify`, which says so on screen and writes `verified: false` to `~/.memnox/updates.jsonl`, and verifies every release after it.
