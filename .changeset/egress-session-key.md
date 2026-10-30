---
'@memnox/core': patch
'memnox': patch
'@memnox/proxy': patch
'@memnox/interceptors': patch
---

The egress proxy now uses a session's folder and project only for a client holding the key `memnox run` issued that session, so another local process naming the session's id gains none of that project's exceptions and is ruled on by the machine's rules alone.
