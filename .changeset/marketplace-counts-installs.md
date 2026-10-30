---
'@memnox/core': patch
'memnox': patch
'@memnox/proxy': patch
'@memnox/interceptors': patch
---

An install from this workspace's Memnox Cloud marketplace is now counted through its installs route once the download matched its digest, with the machine's credential and only to its own control plane, and a count that does not arrive is logged without failing the install; an install from a git index is never counted.
