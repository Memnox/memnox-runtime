---
'@memnox/core': patch
'memnox': patch
'@memnox/proxy': patch
'@memnox/interceptors': patch
'@memnox/guard': patch
---

Held calls have one route family on the cloud. The guard raises one at `POST /v1/workspaces/:ws/held-calls` and polls `GET /v1/workspaces/:ws/held-calls/:id`, and a person's inbox reads `GET /v1/workspaces/:ws/me/held-calls` and answers at `POST /v1/workspaces/:ws/me/held-calls/:id/answer`.
