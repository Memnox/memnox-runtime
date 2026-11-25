---
'@memnox/core': minor
'memnox': minor
'@memnox/proxy': minor
'@memnox/interceptors': minor
'@memnox/guard': minor
---

Memnox focuses on what it promises: see what agents did, stop what is risky, keep them out of each other's way, and let go of more over time. The marketplace and community index, personal sync and backup, and job templates with their purpose, responsibilities and instructions are gone, along with the daemon methods that served them (`index-*`, `personal-sync-*`, `backup-*`, `templates`, `profile-from-template`), and `memnox sync pair`. `rule-pack-import` takes `rulePackProject`, an absolute folder, or `rulePackAgent`, an agent kind, so a starter pack can be proposed for one project or one agent only, each rule still signed on its own. The activity filter takes `project`, an absolute folder, and keeps the rows of every session that touched something inside it. The apps raise their minimum to this release, since an older daemon would read a scoped import as one for everything. `memory-remember` keeps what a person typed for one project's agents to always know, as facts that person already confirmed. `agent-overlaps` says where agents meet: the files each holds, the files two are in at once, and the writes held lately, so an agent's card can show it. A held call kept for later carries `parkedAt`, so the apps list it apart from one an agent is blocked on. `rule-history` reads the rule changes a person answered on this machine, newest first.
