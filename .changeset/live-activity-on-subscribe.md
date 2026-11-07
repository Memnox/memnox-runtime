---
'@memnox/core': patch
'memnox': patch
'@memnox/proxy': patch
'@memnox/interceptors': patch
---

A screen's activity timeline is live. Every subscriber now hears an `activity` event when the ledger gains rows the activity view shows, names only: the id, the time, the agent, the operation, the effect and the target's name, never arguments or output. A burst arrives as one event at most once a second carrying its newest 20 rows and a count of the rest, nothing is read while the ledger is idle or nobody listens, and a paired phone hears it only while it holds the see capability.
