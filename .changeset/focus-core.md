---
'@memnox/core': minor
'memnox': minor
'@memnox/proxy': minor
'@memnox/interceptors': minor
'@memnox/guard': minor
---

Memnox focuses on what it promises: see what agents did, stop what is risky, keep them out of each other's way, and let go of more over time. The marketplace and community index, personal sync and backup, and job templates with their purpose, responsibilities and instructions are gone, along with the daemon methods that served them (`index-*`, `personal-sync-*`, `backup-*`, `templates`, `profile-from-template`), and `memnox sync pair`. `rule-pack-import` takes `rulePackProject`, an absolute folder, or `rulePackAgent`, an agent kind, so a starter pack can be proposed for one project or one agent only, each rule still signed on its own. The activity filter takes `project`, an absolute folder, and keeps the rows of every session that touched something inside it. The apps raise their minimum to this release, since an older daemon would read a scoped import as one for everything.
