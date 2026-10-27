# @memnox/guard

Memnox for an agent running in the cloud: before each tool call, allow, ask or deny, from
your workspace's rules.

```ts
import { query } from '@anthropic-ai/claude-agent-sdk';
import { createGuard, wrapClaudeAgentQuery } from '@memnox/guard';

const guard = createGuard({ agent: 'support-bot' }); // reads MEMNOX_TOKEN and MEMNOX_WORKSPACE
const governed = wrapClaudeAgentQuery(query, guard);

for await (const message of governed({
  prompt: 'refund the duplicate charge on order 4417',
})) {
  // ...
}
await guard.close(); // sends what is left of the record, for a function about to end
```

For any other framework, ask before the tool runs:

```ts
const decision = await guard.authorize('issue_refund', { order: '4417' }, { sessionId });
if (!decision.allowed) return `Not done: ${decision.reason}`;
```

For the OpenAI Agents SDK, wrap the function tools; a refusal comes back as the tool's
output, so the model reads why:

```ts
import { guardAgentsTools } from '@memnox/guard';

const tools = guardAgentsTools([issueRefund, lookUpOrder], guard, {
  session: (run) => run.context.ticketId,
});
```

For any other function a framework calls a tool, `wrapTool` asks first and throws
`ToolRefused` when the answer is no:

```ts
const refund = wrapTool(guard, 'issue_refund', issueRefund, { session: () => sessionId });
```

An agent that only speaks MCP needs no library: point its MCP client at the workspace's
gateway, `/v1/workspaces/<ws>/gateway/<server>`, with its token and an `x-memnox-agent`
header, and every `tools/call` is ruled on before it reaches the server.

## What it does

- **Allow and deny are decided in your process**, from rules already in memory, in
  microseconds. No network is on the way, so a control-plane outage never blocks a read.
- **An ask goes to the right person**: the agent's owner, then the rule's approvers, on their
  iPhone, Mac, Slack, Discord, Telegram, Teams or the console. The call waits up to
  `waitMs` (two minutes by default) and is refused if nobody answers.
- **Only a signed answer is believed**, and only for this call: the control plane signs the
  call's id, the answer and a digest of the arguments.
- **Only a device can vouch, if you ask for it.** Every answer says what signed it: an
  iPhone or Mac, a passkey, or a chat button. `requireDeviceProof: true` refuses a yes that
  only a chat account pressed.
- **The circuit breaker pauses a session** that fails the same way five times, so a loop
  stops spending tokens until a person resumes it from their phone or the console; the
  guard notices within ten seconds. Every wrapper reports outcomes for you; elsewhere call
  `guard.outcome()`.
- **The record leaves in the background**: what was tried, the verdict and who answered,
  with the arguments as a digest only.

It fails closed: an ask that cannot reach the control plane is refused. No model decides
anything here.
