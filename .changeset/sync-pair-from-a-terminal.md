---
'@memnox/core': patch
'memnox': patch
'@memnox/proxy': patch
'@memnox/interceptors': patch
---

`memnox sync pair` moves the personal sync key between a person's own machines from a terminal. It lists the machines waiting for the key with the fingerprint each pairs under, shows the fingerprint of a key that arrived, and once the person typed the fingerprint both machines show it raises the same proposal `personal-sync-key-offer` or `personal-sync-key-accept` raises, which is signed in the Memnox app before the key moves.
