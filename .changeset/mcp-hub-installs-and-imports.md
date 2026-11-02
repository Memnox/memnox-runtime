---
'@memnox/core': patch
'memnox': patch
---

The MCP Hub starts a server typed as a package install, such as `pip install comfy-mcp` or `npm i -g server-x`, with the runner that installs it as it starts (`uvx comfy-mcp`, `npx -y server-x`), says so in the proposal and in the answer's `outcome`, and no longer writes an install where a start should be. Bringing in a found line that is already the hub's own line for that agent now takes it in rather than refusing it because the hub holds the name, and a sync takes such a line as the hub's own rather than leaving it as configured by the person. Memnox's own `memnox` and `memnox-session` lines are no longer offered under Found, and importing one is refused, since onboarding's line carries this machine's credential.
