---
'@memnox/core': patch
'memnox': patch
'@memnox/proxy': patch
'@memnox/interceptors': patch
'@memnox/guard': patch
---

Every connection, profile and agent card now says how sure Memnox is of each capability: context, instructions, tools, activity, coordination, approval, and enforcement per seam (shell, files, git, network, browser, MCP). A seam reads enforced only where `memnox doctor --prove` saw it refuse; held without a test is mediated, an MCP report is advisory, and anything else is observed or outside Memnox. A profile shows the weakest of its connections.
