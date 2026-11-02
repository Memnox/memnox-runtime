---
'@memnox/core': patch
'memnox': patch
'@memnox/proxy': patch
'@memnox/interceptors': patch
---

A new `mode-enforce` daemon method moves this machine from observe to enforce, unsigned because it only narrows, and answers `modeSet` with the mode it was in and the one it is in now. Going back to observe widens, so it stays `memnox protect --observe` at the terminal, and the method is never reached from a paired phone.
