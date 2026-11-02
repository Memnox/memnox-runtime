---
'@memnox/core': patch
'memnox': patch
'@memnox/proxy': patch
'@memnox/interceptors': patch
---

The `agents` method no longer shows Claude Desktop as unprotected forever. It has no hook, so it counted as protected only by a hook it can never have, and pressing Protect changed nothing; an agent with no hook but an MCP config, Claude Desktop, Cline and VS Code, is now protected once every server it starts goes through the proxy, which `memnox setup` does. Each card also carries `seam`, `hook` or `servers`, so an app can say that an agent held through its servers takes them up once it is quit and opened again.
