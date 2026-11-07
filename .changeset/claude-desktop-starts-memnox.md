---
'@memnox/core': patch
'memnox': patch
'@memnox/proxy': patch
'@memnox/interceptors': patch
---

Claude Desktop loads the Memnox workspace server again. Its config takes only a command to start, so it skipped the address Memnox wrote as not a server at all; onboarding now gives it `memnox-mcp-remote`, a bridge that relays its messages to the workspace over https, with the credential in its environment rather than on its command line.
