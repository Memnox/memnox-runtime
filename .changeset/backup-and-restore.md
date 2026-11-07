---
'@memnox/core': patch
'memnox': patch
'@memnox/proxy': patch
'@memnox/interceptors': patch
---

The daemon backs up and restores a machine's setup on the local socket only. `backup-create` seals the rules, both hubs, the skills, the projects and the memory, and the ledger when asked, with AES-256-GCM under a key scrypt draws from a passphrase; keys, devices, accounts and secrets are never in it. `backup-restore` opens an archive, stages it by its digest and proposes putting it back, which happens only once the person signs on the Mac, and never writes over a ledger already there.
