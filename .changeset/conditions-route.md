---
'@memnox/core': patch
'memnox': patch
'@memnox/proxy': patch
'@memnox/interceptors': patch
---

A machine declares and lifts a freeze on its own agents at `/v1/workspaces/:ws/conditions/machine-freezes`, the cloud's route for conditions, which was `/state/machine-freezes`.
