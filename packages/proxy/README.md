# @memnox/proxy

A transparent proxy for MCP servers, started over stdio or reached over streamable
HTTP. Every `tools/call` is ruled on in this process before it reaches the server,
and `tools/list` responses are filtered so a denied tool is never advertised in the
first place.

Ships as the `memnox-mcp-proxy` binary. You do not normally run it by hand —
`memnox mcp wrap` points your agent's config at it, and `memnox mcp unwrap` puts
the config back, byte for byte.

```sh
memnox-mcp-proxy --name github -- npx -y @modelcontextprotocol/server-github
memnox-mcp-proxy --name github --url https://api.githubcopilot.com/mcp/ \
  --header "Authorization: Bearer memnox-secret:github"
```

A remote server gets the same filter, rules and ledger rows as a local one. A header
value may name a kept secret as `memnox-secret:<name>`; the proxy reads it from the
OS store when it starts, so the agent's config holds only the name, and no header
value is ever logged. Plain `http` is accepted only for a server on this machine.
One answer is bounded to 8 MiB and five minutes, and a credential never follows a
redirect. The MCP Hub writes every remote server it hands an agent this way.

## What it does, in order

1. `tools/list` from the server is filtered through `ToolFilter`. A tool the
   patterns deny is removed from the answer, so the model never learns it exists.
2. `tools/call` goes to a `CallAuthorizer` — the local gate, reading the same rule
   files everything else reads. Allow passes through untouched; ask and deny are
   answered to the client as an MCP error naming the rule and the alternative.
3. A result coming back is inspected for instruction-shaped content and **quoted**
   rather than removed. Silently editing a payload is a bug the agent cannot see;
   a quoted one is visible and carries no authority.

## What it cannot see

Declared in `firewall.constants.ts` rather than left to be discovered: the model's
reasoning, anything the agent does without a tool call, and whatever the wrapped
server does on its own once a call is allowed through. A governed agent with an
unwatched side channel is worse than an ungoverned one, so the blind spots are a
constant in the code.

**Every call reaches the ledger once**, when its outcome is known: a refusal as it is
refused, an allowed call when its result comes back carrying what came back. One call
is one row, so `memnox timeline`, `why` and `trace` answer about MCP calls the same way
they answer about the shell. The arguments never reach the row — a digest does.

Opening the ledger is the caller's job, like loading the gate: `cli.ts` does it, so a
test that forgets writes nothing to the developer's own history.

## Environment

| Variable             | Meaning                                       |
| -------------------- | --------------------------------------------- |
| `MEMNOX_POLICIES`    | rule files, comma-separated                   |
| `MEMNOX_TOOLS_ALLOW` | a regex: only matching tools are exposed      |
| `MEMNOX_TOOLS_DENY`  | a regex: matching tools are hidden and denied |

With no rule file configured the proxy still runs: the static tool filters become
the only gate, and it says so rather than pretending to govern.

Apache-2.0.
