---
'@memnox/core': patch
'memnox': patch
'@memnox/proxy': patch
'@memnox/interceptors': patch
'@memnox/guard': patch
---

Profiles are kept apart from connections. Every agent found here answers to a default profile until a person binds one with `memnox profile bind <profile> <agent>`, or the daemon's `profile-bind` and `profile-unbind`; the binding is kept in `~/.memnox/agents/connections.json` and the agent keeps its `agt_<kind>` ledger key. Each profile now lists the connections it works through, and a session of a bound agent is matched under the profile's role unless `--role` or `MEMNOX_AGENT_ROLE` names another. `memnox profile new` and `memnox profile show` write and read profiles from the terminal.
