# memnox-guard (Python)

Memnox for a Python agent: before each tool call, allow, ask or deny, from your workspace's
rules. The same decisions as `@memnox/guard`, held to them by the shared vectors in
`vectors/guard-decisions.json`.

```python
from memnox_guard import create_guard, wrap_tool

guard = create_guard(agent="support-bot", profile_id="customer-support")  # reads MEMNOX_TOKEN and MEMNOX_WORKSPACE

decision = guard.authorize("issue_refund", {"order": "4417"}, session_id)
if not decision.allowed:
    return f"Not done: {decision.reason}"

refund = wrap_tool(guard, "issue_refund", issue_refund, session=lambda args: session_id)
```

For the OpenAI Agents SDK, `guard_agents_tool(guard, tool, session=lambda ctx: ...)` returns
the `FunctionTool` with a refusal as its output. For LangChain and LangGraph,
`guard_langchain_tool(guard, tool, session=...)` rebuilds the tool the same way. Neither
library is imported until its wrapper is called.

## The work a person gave the agent

```python
work = guard.my_work()  # [{"id": "agw_...", "status": "active", "issue": {...}}]
guard.report_progress(work[0]["id"], "drafted the reply", refs=[{"kind": "pr", "id": "17"}])
guard.report_progress(work[0]["id"], "sent for review", state="done_claimed")
guard.request_handoff(work[0]["id"], "needs a refund", to_profile="billing")
```

These call the workspace's MCP door, `POST /v1/workspaces/<ws>/mcp`, with the tools
`memnox_my_work`, `memnox_report_progress` and `memnox_request_handoff`. Nothing here starts,
assigns or closes work.

## What it does, and what it does not yet

- The bundle is fetched, its Ed25519 signature checked against the plane's keys, and its
  rules decided in process by a port of the TypeScript matcher. No model decides anything.
- An ask raises a held call and waits for a person; only a yes the control plane signed for
  this call, its answer and a digest of its arguments is believed.
- It fails closed. Without the `cryptography` package nothing signed is believed. A rule
  carrying a condition the port does not read still denies or asks, and an allow carrying one
  is left out. The TypeScript guard's recommended defaults, its taint steering and its circuit
  breaker are not ported yet, and tools are named as MCP tools or function tools only.

## Tests

```sh
cd packages/guard-py
PYTHONPATH=src python3 -m unittest discover -s tests
```

The vectors are written by `packages/guard/test/guard-vectors.test.ts`; rewrite them with
`MEMNOX_WRITE_VECTORS=1 pnpm exec vitest run packages/guard/test/guard-vectors.test.ts`.
