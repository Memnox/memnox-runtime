---
'@memnox/core': patch
'memnox': patch
'@memnox/proxy': patch
'@memnox/interceptors': patch
---

A project's MCP servers no longer dirty its repository: a config file the repository tracks is left alone and the outcome says which agent was skipped, and a file Memnox writes is named in a marked block in `.git/info/exclude`, never `.gitignore`, which it leaves again once the file is gone.
