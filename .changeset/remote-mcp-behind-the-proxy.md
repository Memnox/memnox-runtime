---
'@memnox/core': patch
'memnox': patch
'@memnox/proxy': patch
'@memnox/interceptors': patch
---

A remote MCP server is governed like a local one. `memnox-mcp-proxy --url <https url>` reaches a streamable HTTP server with the same tool filter, rules and ledger rows as a stdio one, and a `--header` value may name a kept secret as `memnox-secret:<name>`, read from the OS store when the proxy starts and never logged. The MCP Hub now writes every remote server behind the proxy, so every agent that starts a command gets it, reports it as governed with its header names, and its connection test lists the server's tools.
