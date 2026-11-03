---
'@memnox/core': patch
'memnox': patch
'@memnox/proxy': patch
'@memnox/interceptors': patch
---

An approved exception that carries `expiresAt` in the bundle stops applying at that moment, offline included, and one whose date cannot be read counts as ended. A freeze or incident the organization declared with no end now holds until a bundle lifts it, rather than lapsing 24 hours after the last sync. The runtime tells the cloud it understands both by sending `x-memnox-capabilities: exception-expiry` on every sync, and a cloud leaves time limited exceptions out of the bundle for a runtime that does not send it.
