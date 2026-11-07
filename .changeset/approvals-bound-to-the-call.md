---
'@memnox/core': patch
'memnox': patch
'@memnox/proxy': patch
'@memnox/interceptors': patch
---

A yes to a held call can now be bound to the exact call. Every held event and the waiting list carry `actionDigest`, the SHA-256 of the call's operation, target, arguments, folder and agent, and a screen signs `memnox-confirm:v4:<subject>:<answer>:<actionDigest>`. The daemon works the digest out again from the call it holds, so a call changed after the person saw it is refused; v1 to v3 signatures still answer while the apps move.
