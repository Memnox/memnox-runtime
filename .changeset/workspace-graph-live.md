---
'@memnox/core': patch
'memnox': patch
'@memnox/proxy': patch
'@memnox/interceptors': patch
---

A new daemon method, `workspace-graph`, answers the workspace's memory graph as the console's memory page draws it: what arrived from each connected tool, who said it, how many times, and what the team settled out of it. It is read live off the control plane's graph route on this machine's own credential, at a machine's clearance, held in the daemon for a few seconds and never written to disk, and folded with the settled facts and candidates memory.json already keeps for agents offline. Where the machine is not joined, or the cloud cannot be reached or refuses, it answers those saved facts alone and says why. It is read under SEE from a phone.
