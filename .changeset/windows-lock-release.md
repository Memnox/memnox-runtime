---
'memnox': patch
---

On Windows, two agents writing one store at once no longer fail with `EPERM`, because a lock still being released is now waited on rather than reported as a fault.
