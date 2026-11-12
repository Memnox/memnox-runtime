---
'@memnox/core': patch
'memnox': patch
'@memnox/proxy': patch
'@memnox/interceptors': patch
'@memnox/guard': patch
---

A capability reads `enforced` only while the enforcement path installed now is the one the last `memnox doctor --prove` ran against. Rewire a hook, wrap a config or move PATH and the proof stops counting, so the level drops to what the connection itself holds, `mediated` or `observed`, until the proof is run again.
