---
'@memnox/core': patch
'memnox': patch
'@memnox/proxy': patch
'@memnox/interceptors': patch
---

A profile applied to an agent in a repository, or an agent launched there with one, now proposes its rule pack for that repository alone, kept in this Mac's own rule file and held only inside its folders so the checkout stays clean, while a profile applied with no repository stays the person's own as before.
