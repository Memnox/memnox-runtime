---
'@memnox/core': patch
'memnox': patch
'@memnox/proxy': patch
'@memnox/interceptors': patch
---

A person's own MCP Hub servers, personal skills, projects opened, the rules they set on this machine and the personal memory facts they verified now follow them across their own machines through Memnox Cloud, which only ever holds ciphertext. The first machine makes a sync key and keeps it in the OS secret store; each item travels under an id that is an HMAC of its kind and name, sealed with AES-256-GCM bound to its kind, id and key. Another machine gets the key only through `personal-sync-key-offer` and `personal-sync-key-accept`, each a proposal the Mac signs after the person compared the fingerprint both machines show, and never from a phone. `personal-sync-status`, `personal-sync-now`, `personal-sync-conflicts` and `personal-sync-resolve` read, run and settle it. It runs when asked and after a local change, never on a timer. What arrives is never wider than it would be by hand: a server lands given to no agent, a skill waits in the Skills Hub, and an allow waits on a signature. A plan without personal sync is said in the cloud's own words.
