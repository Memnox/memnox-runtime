---
'@memnox/core': patch
'memnox': patch
'@memnox/proxy': patch
'@memnox/interceptors': patch
'@memnox/guard': patch
---

Every change to a rule file, and every grant or revoke the autopilot makes, now keeps a copy of what stood before it. `memnox policy history` lists the changes newest first and names the rules each one added, removed or changed (`--allowances` for what the autopilot granted). `memnox policy revert <n>` puts a file back as it was before change n, and keeps what stood first, so the revert can itself be undone. An agent can read the history and can never revert.
