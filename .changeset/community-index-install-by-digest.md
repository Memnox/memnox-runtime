---
'@memnox/core': patch
'memnox': patch
'@memnox/proxy': patch
'@memnox/interceptors': patch
---

The community index of skills and rule packs can be browsed and installed from. `index-list` reads Memnox Cloud's marketplace `index.json`, or a plain git repository's raw `index.json` named at the machine with `indexSource`, keeps what it read so browsing works offline, filters by words and kind, and shows every version marked unsafe. `index-install` fetches one version without the machine's credential, refuses it where it was marked unsafe in the index or since, and writes nothing until both the digest the index names and the one worked out here match what arrived. A skill then waits in the Skills Hub, held until it is accepted, and a pack's rules each wait on a signature. Every request goes through the one network module.
