---
'@memnox/core': patch
'memnox': patch
'@memnox/proxy': patch
'@memnox/interceptors': patch
---

Connecting an app or working in one through Memnox Cloud now needs a signed in Memnox Cloud account. `connections-sign-in` with nobody signed in answers `connectState: "sign-in-needed"` without asking the cloud, and so does a cloud refusing with `account_required`; `toolkits-search` still answers the catalogue signed out, with the same `connectState` beside it. Each toolkit may now carry the cloud's `description`, `categories`, `kind` and `support`, and each connection its `connectedAt`, all optional so an older cloud still works.
