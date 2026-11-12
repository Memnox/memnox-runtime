---
'@memnox/core': patch
'memnox': patch
'@memnox/proxy': patch
'@memnox/interceptors': patch
'@memnox/guard': patch
---

`@memnox/guard` and `memnox_guard` take `workRefs` on the guard or per call and say once per session which issues it is for, by key, number or link.
