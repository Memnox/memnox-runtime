---
'@memnox/core': patch
'memnox': patch
'@memnox/proxy': patch
'@memnox/interceptors': patch
'@memnox/guard': patch
---

A `git commit` that would take files another agent in the same checkout is still changing now asks first, and names that agent and those files. Leases already kept two agents off one file at once; this covers one agent's `commit -a` sweeping up the other's unfinished work. It asks and never refuses, because it is coordination rather than a rule.
