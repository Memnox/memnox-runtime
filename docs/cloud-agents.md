# Governing agents that run in the cloud

How Memnox governs an agent that runs where nobody can install the runtime: a support bot on a server, a fix agent in CI, an incident bot with production credentials, a long running Hermes or OpenClaw box. This document explains what was built, across all five repositories, why each piece is shaped the way it is, and what is still unverified.

It answers to `VISION.md` sections 10 (the agent workforce), 13 (progressive autonomy), 15 (the circuit breaker), 18 (the black box), 24 (one unified agent layer) and 25 (Memnox Cloud).

---

## 1. The gap this closes

Before this work, Memnox governed agents on machines a person controls. The runtime sits in front of every command, tool call and edit, and a held call reaches a person on the Mac, the iPhone, Slack, Discord or the console.

An agent in somebody's cloud had only the advisory path: an MCP principal that could call `memnox_request_approval` and poll `memnox_check_approval`. Three things were wrong with that:

1. **Nothing stopped it skipping the question.** The agent decided whether to ask. An agent that never asked was never governed.
2. **The cloud never decided anything and signed nothing.** An answer travelling back was plain JSON, so anything between the cloud and the agent could turn a no into a yes.
3. **The agent chose the rule it asked under.** The rule decides who must answer and how many people. An agent that named a lighter rule, or none, picked its own approvers.

The outcome wanted: a cloud agent that cannot run a consequential action without a rule allowing it or a real person saying yes, answered from the doors Memnox already has, with no model on the decision path, and every decision well under a second.

## 2. The use cases it is built for

| Agent                                            | Runs freely                     | Waits for a person                                                                          |
| ------------------------------------------------ | ------------------------------- | ------------------------------------------------------------------------------------------- |
| Support agent (Claude Agent SDK) issuing refunds | reads, replies, order lookups   | `stripe.create_refund`, held for the support lead on her iPhone                             |
| Nightly dependency agent in CI                   | `gh pr create`                  | `gh pr merge`, a force push, anything touching `.github/workflows`                          |
| On call agent with production credentials        | `kubectl get`, logs, dashboards | `kubectl delete`, `terraform apply`, scaling production                                     |
| Data agent with a database URL                   | `SELECT`                        | a `DELETE` or `UPDATE` with no `WHERE`, `DROP`, production migrations                       |
| Ops or sales agent that talks to customers       | drafting                        | sending to an external domain, posting in a customer channel                                |
| Long running autonomous agent on a hosted box    | everything its rules allow      | nothing new, but a loop failing the same way five times is paused until a person resumes it |

The common shape: the agent is useful because nobody watches it, and a team will only let it run unwatched if the few consequential actions wait for the right person.

## 3. The shape of the system

There are three ways a cloud agent comes under Memnox, from strongest to weakest:

```
                         ┌──────────────────────────────────────────┐
  agent process          │  Memnox Cloud                             │
  ┌───────────────────┐  │                                           │
  │ @memnox/guard     │──┼─▶ GET  /v1/workspaces/:ws/bundle (signed) │
  │  engine in memory │  │   POST /v1/workspaces/:ws/held             │
  │  allow/deny local │◀─┼── GET  /v1/workspaces/:ws/held/:id?wait=25 │
  │  ask goes up      │──┼─▶ POST /v1/workspaces/:ws/events           │
  └───────────────────┘  │   GET  /v1/keys (public)                   │
                         │                                           │
  MCP only agent         │                                           │
  ┌───────────────────┐  │   POST /v1/workspaces/:ws/gateway/:server  │──▶ the real MCP server
  │ any MCP client    │──┼─▶   rules every tools/call first           │
  └───────────────────┘  │                                           │
                         │   held call post box ──▶ iPhone, Mac,      │
  advisory agent         │   (the same one every    Slack, Discord,   │
  ┌───────────────────┐  │    other door uses)      Teams, Telegram,  │
  │ MCP door tools    │──┼─▶ POST /v1/workspaces/:ws/mcp              console │
  └───────────────────┘  └──────────────────────────────────────────┘
```

1. **The guard library**, `@memnox/guard`, inside the agent's own process. Interposed: the agent's tools cannot run without passing through it.
2. **The hosted MCP gateway.** Interposed too: the agent's MCP client points at the gateway instead of the server, so it never reaches the server without a ruling.
3. **The MCP door**, which already existed. Advisory: the agent reports and asks if it chooses to. It is shown as "reports only" on every screen so nobody mistakes it for the other two.

All three raise questions into the **same held call post box** every machine uses, so a cloud agent's question reaches the agent's owner and the rule's approvers on whatever they carry, with the routing, escalation and quorum that already existed. Nothing about answering had to be rebuilt.

## 4. The runtime half

### 4.1 A pure engine entry: `@memnox/core/engine`

The policy engine was already pure once rules were loaded, but `@memnox/core` as a whole pulls in `better-sqlite3`, the file system and the stores. An agent in a serverless function cannot load that.

`packages/core/src/engine.ts` is a second build entry, exported as `@memnox/core/engine`. It exports only what deciding needs:

- the domain types, redaction and digests
- the action and decision constants
- the policy engine, its validator, the default rule domains and modes
- the verb tables and the tool classifier
- the SQL and shell command resolvers
- the circuit breaker and budgets
- `policiesFromBundle`, described below

Its import graph is fifty files and none of them reaches a disk or a database. `packages/core/test/engine-entry.test.ts` walks that graph and fails if anything impure becomes reachable, so this cannot quietly regress.

Two splits made it possible:

- **`intercept/sql-file.ts`.** The `psql -f file.sql` reader moved out of `sql.ts`, so the SQL check itself stays pure.
- **`intercept/command-action.ts`.** `resolveCommand(binary, args, env, options)` resolves a shell command through the SQL check, the verb table, the reader and writer tables and the generic classifier, with no I/O. `resolve.ts` on a laptop still reads files by passing `statementFile` in.

**Speed.** Measured on the compiled build: median 3.1 µs per evaluation, p99 11 µs, building the engine 0.4 ms. The engine test asserts an average under 0.1 ms over 20,000 evaluations. Allow and deny never touch a network.

### 4.2 Rules from a bundle: `policiesFromBundle`

`packages/core/src/policy/bundle-rules.ts` turns the cloud's published bundle into engine policies. It differs from the CLI's older conversion in one way that matters: **it keeps an ask as an ask**, with its approvers and quorum, because a cloud agent routes asks to the cloud. The CLI's version turns an unanswerable ask into a deny, which is right on a laptop with nobody to ask and wrong here. Only the conditions the engine can honour are kept, and every converted policy goes through the validator.

### 4.3 The guard library: `packages/guard`

A new package, `@memnox/guard`, depending only on `@memnox/core/engine` and Node built ins. No model SDK: the adapters are typed by shape.

**Setup is one line:**

```ts
const guard = createGuard({ agent: 'support-bot' }); // reads MEMNOX_TOKEN and MEMNOX_WORKSPACE
```

**What `authorize(tool, input, { sessionId })` does:**

1. Waits up to three seconds for the first rules, then decides with whatever it has. Until the workspace's rules arrive it uses the recommended defaults, so a first call is never ruled on by nothing.
2. Turns the tool call into the actions a rule is written against (`actions.ts`):
   - `mcp__stripe__create_refund` becomes `mcp.stripe.create_refund` and `mcp.create_refund`, the two names the runtime's proxy uses
   - `Bash` goes through the shell normalizer and `resolveCommand`, so `gh pr merge` is `gh.*` by its verb table and `psql -c "DELETE FROM orders"` is `psql.delete-unbounded`
   - file tools become `filesystem.read` or `filesystem.write` with the full path under the working directory
   - `WebFetch` becomes `http.request`
   - anything else becomes `tool.<name>`
3. Evaluates every action and keeps the strictest verdict.
4. **Allow or deny is returned at once**, with the rule, the reason and the alternative the agent should try instead.
5. **Ask** raises a held call and long polls for the answer (up to 25 seconds per poll) until it is answered, it expires, or the guard's own wait runs out (two minutes by default). Then it fails closed.
6. Records the decision for the ledger.

**Trust:**

- **Signed rules only.** A bundle whose `x-memnox-signature` does not verify against the published keys is ignored, and the guard keeps the rules it already trusts. A test feeds it a forged "allow everything" bundle and checks that a refund is still asked about.
- **Signed answers only.** An answer is believed only if the cloud signed it, and only for this call: the signed payload must name this call id, this answer, and **the digest of these exact arguments**. A yes signed for a 4 dollar refund is not a yes for a 4,200 dollar one.
- **Proof of who answered.** Every signed answer carries `proof`: `device` (an iPhone or Mac signed it), `passkey`, or `none` (a chat button, which only vouches for the chat account). With `requireDeviceProof: true` the guard refuses a yes that no device or passkey signed.
- **Arguments never leave the process.** Questions and records carry `argsDigest`, a SHA-256 of the sorted arguments, and nothing else. Reasons and targets pass through secret redaction first.

**Fail closed.** An ask that cannot reach the cloud is refused, with a reason saying so. Allow and deny keep working through a cloud outage, because they never needed the cloud.

**Session grants.** "Allow for this session" is remembered for the same action and target in the same session, so the agent is not asked twice.

**Circuit breaker.** `outcome()` feeds the same `CircuitBreaker` the laptop uses. Five identical failures pause the session: every later call is refused with "Memnox paused this session". The pause is recorded as an `agent.session.paused` event. While paused, the guard asks the cloud at most once every ten seconds whether a person resumed it, so a stuck loop costs one small request per ten seconds instead of tokens. An unreachable cloud is not a resume: the pause stays.

**Recording.** Decisions are batched every two seconds (100 per post) to `POST /v1/workspaces/:ws/events`, off the call's path. `close()` sends what is left, for a function about to end. A lost record never stops the agent.

**Adapters:**

| Framework         | How                                                                                                                                                                                                                                                                                                                                                                                      | Refusal looks like                                                        |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Claude Agent SDK  | `wrapClaudeAgentQuery(query, guard)` adds a PreToolUse hook beside the caller's own hooks, and a PostToolUse hook for the breaker. A hook runs whatever permission mode the agent was started in, which is why it is a hook and not the permission callback. An allow returns `{}` so the SDK's own settings still apply: Memnox never permits more than the agent was configured to do. | `permissionDecision: 'deny'` with the reason and alternative              |
| OpenAI Agents SDK | `guardAgentsTools(tools, guard, { session })` wraps each function tool's `invoke(runContext, input, details)`, which the runner calls whatever approval settings the tool carries. The signature was checked against the SDK's source.                                                                                                                                                   | the refusal text is returned as the tool's output, so the model reads why |
| Anything else     | `wrapTool(guard, name, fn, { session })`                                                                                                                                                                                                                                                                                                                                                 | throws `ToolRefused`, carrying the decision                               |

### 4.4 A rule offered to the team from the Mac

A rule said aloud on the Mac (holding the rule keys) is proposed with the places it could hold, and the place picked is what Touch ID signs. There were two places: the whole Mac, or one repository.

There is now a third, **The team**, offered only on a Mac connected to a workspace and never suggested by default, because it reaches every agent the workspace runs.

- `RULE_SCOPE.TEAM` in `core/src/daemon/voice-cards.ts`, and `teamScope()` in `cli/src/protect/rule-scope.ts`.
- `proposeRuleTool` offers it through a small `placesFor` helper.
- When confirmed, `confirm.ts` writes **no rule file**. It records the rule as a local decision (`recordLocalDecisions`), which the next sync posts upward signed by the machine. The cloud proposes it with the machine's owner as the decider, and a second admin approves it. Only then does it hold, for laptops and cloud agents alike.
- On a Mac with no team it is refused with "this Mac is not connected to a team, so there is nobody to offer it to".

### 4.5 The voice can say what a cloud agent is doing

A new read tool for the voice's brain, `cloud_agents`, in `operator-tools.ts`. The brain chooses it from the tool description, with no keyword matching, when the person asks about an agent that is not one of this machine's sessions. The network call lives in `cli/src/sync/cloud-agents.ts`, because the repository's test allows network access only inside `sync/`. It reads `GET /v1/workspaces/:ws/cloud-agents` with the machine's own credential, and says plainly why it cannot answer when the Mac is not connected or the cloud is unreachable.

The iPhone's voice goes through the Mac's brain, so it gains this too.

## 5. The cloud half

### 5.1 One signing key, derived, shared by every instance

`src/crypto/answer-signing.ts`. An Ed25519 key derived with HKDF from the encryption keyring every instance already shares (`info = memnox-answer-signing-v1`, so the keyring's secret signs nothing else). Consequences:

- two instances sign identically with nothing new to store or distribute
- rotating the keyring rotates the signing key
- retired keys stay published, so what they signed still verifies
- with no keyring configured nothing is signed, and a guard that requires signatures refuses what arrives unsigned rather than trusting it

`GET /v1/keys` publishes the public halves (base64 SPKI DER). It is unauthenticated on purpose and is classified as public in both route sweeps (`unscoped-routes.test.ts`, `openapi.test.ts`).

### 5.2 Signed bundles

The bundle route now sends the exact bytes it signed, with `x-memnox-signature: <keyId>:<signature>`. It sends a string rather than an object so no serializer can change a byte between signing and sending. The 304 path is unchanged.

### 5.3 The ask API

`src/machines/held-ask.service.ts` (logic) and `held-ask.controller.ts` (shape checking only).

**`POST /v1/workspaces/:ws/held`** takes `operation, argsDigest, agent, sessionId, reason, operationId, waitMinutes`, and optionally `target`, `ruleId` and `callbackUrl`.

- Machine credentials only: the question is kept under the caller's own machine, so it sees its own questions and nobody else's.
- Gated on the `REMOTE_AGENTS` plan feature with the existing 402 refusal. Gated when asking, not when polling, so an agent already waiting when a plan lapses still hears how its question ended.
- **Idempotent.** The id is a hash of workspace, machine and `operationId`, so a retried or resumed call finds the question already raised instead of raising a second.
- **The rule is derived, not believed** (section 5.4).
- Raised through `HeldCallService.raise`, so it is routed to owners and approvers exactly as a heartbeat routes, and announced on `HELD_CALLS_RAISED` so every door hears it.
- The wait is clamped between 1 and 60 minutes. Field lengths are capped so a hostile caller cannot fill the store.

**`GET /v1/workspaces/:ws/held/:id?wait=N`** answers `pending`, `answered` or `expired`, holding the request open up to 25 seconds and checking the store about once a second. That is long enough that a person answering on a phone usually lands inside one poll, and it works on any instance because the store is shared.

**The signed answer payload:**

```json
{
  "callId": "apr_…",
  "answer": "once",
  "by": "Maya",
  "door": "iphone",
  "proof": "device",
  "deviceId": "pdv_…",
  "passkeyId": null,
  "signedAt": "…",
  "argsDigest": "…",
  "expiresAt": "…",
  "ruleId": "refunds-ask-lead",
  "settledAt": "…"
}
```

**Callback for workers that cannot hold a request open.** With `callbackUrl`, the settled state is posted there once, signed in the same header as bundles. The address is checked twice: its syntax and literal address when the question is raised (private and metadata addresses refused), and resolved again when the answer is sent, because a name can point somewhere new by then. Redirects are not followed and the post times out after five seconds. It is best effort and not awaited, so a slow endpoint is never what a person waits on. The agent can always poll the same signed state.

### 5.4 The rule is the cloud's to name

`src/bundle/asking-rule.ts` holds `askingRuleIn(bundle, call)` and the hand walked `globMatches` (moved here from the MCP providers so both doors share one). A rule the agent names is honoured only if it is an **enforced ask rule that matches the operation** for this agent. Otherwise it is the most specific matching ask rule, the one a machine evaluating the same bundle would cite. A rule in observe mode is never named as the asker.

This fixes the MCP door too: `memnox_request_approval` now derives its rule the same way before routing, so an agent cannot dodge a quorum by omitting the rule or naming a lighter one.

### 5.5 Other Phase 0 fixes on the MCP door

- **Expiry.** `memnox_check_approval` reports `expired` once the window has passed. It used to say `pending` forever, and an agent told pending forever polls forever.
- **Pruning.** Calls raised over MCP or the ask route are marked `remote: true`. No machine ever heartbeats for them, so nothing used to clear them. `HeldCallService.prune` forgets them an hour after expiry (the hour lets a late poller still read how it ended), at most 500 per pass. It runs inside the existing escalation sweep, and both stores gained `remove`.
- **Dedup on `memnox_report_action`.** An optional `dedupKey`, scoped to the credential and agent so one agent cannot swallow another's report. Without one, each report is its own row, as before.

### 5.6 The hosted MCP gateway

`src/gateway/`. For an agent that only speaks MCP and needs no library at all.

**`POST /v1/workspaces/:ws/gateway/:server`**, Streamable HTTP with JSON answers. Machine credentials only, gated on `REMOTE_AGENTS`, and the agent names itself in `x-memnox-agent`.

- Every message is forwarded to the server untouched, with the `mcp-session-id` and `mcp-protocol-version` headers passed through both ways, **except `tools/call`**.
- A tool call is ruled on first by `gatewayVerdict` (pure, in `gateway.ts`):
  - rules match `mcp.<server>.<tool>` and `mcp.<tool>`, the two names the runtime's proxy uses, so one rule covers a laptop and the gateway alike
  - deny beats ask beats allow, and within one effect the most specific rule wins, which is the engine's order
  - where no rule speaks: a tool the server marks read only runs; a tool marked destructive, or whose name contains `delete`, `remove`, `drop`, `destroy`, `force`, `refund`, `purge`, `revoke` or `wipe`, is asked about; anything else runs and is recorded. A server added on a Friday is not silently trusted with deletes.
- **Deny** comes back as a tool error the model reads: `Memnox did not run create_refund: refunds go through finance. Instead: open a ticket.` The server is never reached.
- **Ask** raises a held call through the same ask service and holds the request up to 50 seconds. If nobody has answered by then, the agent is told a person has been asked and to call again with the same arguments. The retry finds **the same question**, because its operation id is the server, the MCP session, the tool and the argument digest. A "yes, once" is marked used when it is spent, so the next identical call asks again; a "yes, for the session" is never spent.
- Answers from the server are read whether they come as JSON or as a server sent event stream (the message carrying the request's id is picked out), capped at 5 MB, with a 60 second timeout.
- The server's address is checked against private and metadata addresses on every call, not only when it was registered.
- Every ruling is appended to the event log with surface `gateway` and announced on `ACTIONS_RECORDED`, so incidents, reads and SIEM sinks see it like any other decision.

**Admin routes** (admin role): `GET`, `PUT` and `DELETE /v1/workspaces/:ws/gateway-upstreams/:name`. A name is lower case letters, digits and hyphens; at most 25 servers per workspace. The server's credential is sent in the header it names (`authorization` by default), stored encrypted in the `gateway_upstreams` table (added to the schema and the data inventory), and **never returned by any route**: a listing says only `hasCredential`. A put that names no credential keeps the one already held, so changing a URL needs no secret.

### 5.7 What the cloud agents are doing

`src/cloud-agents/`.

**`GET /v1/workspaces/:ws/cloud-agents`** (viewer role; machines may read it too, which is how the Mac's voice answers). For each agent seen through the guard (`cloud`), the gateway or the MCP door (`mcp`):

- its surfaces, and when it was last heard from
- counts of allowed, asked and refused, over the newest thousand actions, **and the screen says so**: counts, never estimates past what was read
- its last ten decisions
- the questions it is still waiting on
- any session the breaker paused that no person has resumed since

It is one bounded read of the event log plus the held call store, through `ofKindSince` for the rare pause and resume kinds.

**`POST /v1/workspaces/:ws/cloud-agents/sessions/:session/resume`** (reviewer role, a person only). Appends `agent.session.resumed` with the person as the actor. That kind is now in the events route's `INTERNAL_KINDS`, so **an agent cannot post its own resume**: an agent lifting its own breaker is the loop the breaker exists to stop.

**`GET …/sessions/:session/resumed?since=`** is the machine route the guard polls.

### 5.8 A rule a person states, from any device

**`POST /v1/workspaces/:ws/policies/proposals/from-statement`** (admin role) takes `effect, operation, ref, door` (`iphone`, `mac` or `console`) and optionally `agent`. It is proposed through the same `proposeSourced` path as every other source, under a new source kind `stated`. The decider is the signed-in caller, never a name in the body. A second admin approves it, and from then on every agent that reads the bundle follows it, the cloud ones included, on the guard's next bundle fetch.

### 5.9 SIEM sinks are connected

`SinkService.ship` existed and nothing called it. It is now subscribed to `ACTIONS_RECORDED`, not awaited, so every recorded decision from a machine, the gateway or the guard reaches a team's Splunk, Datadog, S3 or Kafka sink, and a slow SIEM never holds up an ingest or an agent.

## 6. The doors a person uses

### 6.1 Questions

Unchanged, on purpose. A cloud agent's question is an ordinary held call, so it already reaches the iPhone (Live Activity), the Mac island, Slack, Discord, Telegram, Teams and the console, with owner routing, escalation after the window, and quorum.

### 6.2 Mac

`memnox-macos`: the rule card lists the team as a place with a `person.3` symbol and the line "Every agent the team runs, cloud ones too, once an admin approves". The button reads **Propose for the team** rather than Enforce, because a second admin decides. After signing, the voice says "I have offered that rule to the team. It holds everywhere once a second admin approves it." `RuleScopeKind` gained `team` in both the Mac and iPhone protocol copies.

### 6.3 iPhone

`memnox-ios`:

- `Domain/Team/CloudAgents.swift`: the wire types.
- `WorkspaceInbox` gained `cloudAgents` and `resume`, implemented in `HttpWorkspaceInbox` with the person token the phone already holds.
- `Application/CloudAgentsReading.swift`: reads, and maps a 401 to signed out and anything else to unreachable.
- `App/Presentation/Home/CloudAgentsPage.swift`: one card per agent with its counts, any pause with a **Resume** button, open questions and its last decisions. Resume needs no Face ID, because it only lets an agent try again and the guard still rules on every call after it.
- A cloud button in Home's dock opens it, shown only when the phone is signed in to a team.

### 6.4 Console

`memnox-client/apps/app`: a **Cloud agents** page under Fleet (`/cloud-agents`), from `lib/cloud-agents.ts` and `components/cloud-agents/cloud-agents-view.tsx`. It has the same content as the phone, with Resume shown to reviewers and above.

### 6.5 Website

- Pricing: the remote agents line, shared with the console through `packages/ui/src/lib/plan-lines.ts`, now names the mechanism: "Agents on servers and in CI, governed by the guard library or the MCP gateway".
- Home: "Claude Code, Cursor and agents on your servers meet the same rules."

Both were changed only once the code behind them existed, per the rule in `pricing-data.ts` that every line has a mechanism.

## 7. Security properties, in one place

| Property                                          | How it holds                                                                                                                  |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| No model on the decision path                     | the engine, the gateway verdict and the asking rule are deterministic code                                                    |
| A cloud agent cannot skip the question            | the guard and the gateway are interposed; only the MCP door is advisory, and is labelled "reports only"                       |
| An agent cannot pick its own approvers            | the asking rule is derived from the bundle on both doors                                                                      |
| A forged rule set changes nothing                 | bundles are verified against published keys; a bad signature keeps the old rules                                              |
| A forged or replayed yes changes nothing          | answers are signed over the call id, the answer and the argument digest                                                       |
| A chat button is not mistaken for a device        | every answer says its proof; `requireDeviceProof` refuses `none`                                                              |
| An agent cannot lift its own pause                | `agent.session.resumed` is an internal kind, written only by a person through the route                                       |
| Arguments and secrets stay in the agent's process | only `argsDigest` crosses the wire; reasons and targets are redacted                                                          |
| One tenant cannot reach another                   | every route is scoped by `:ws`; a machine sees only its own questions; `/v1/keys` is the one deliberate public route          |
| Outbound requests cannot reach private networks   | gateway servers and callbacks are checked against private and metadata addresses, again at connection time, with no redirects |
| An outage never blocks a safe action              | allow and deny are local; only an ask needs the cloud, and it fails closed                                                    |

## 8. Speed

| Step                              | Cost                                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------------------- |
| A local verdict in the guard      | median 3.1 µs, p99 11 µs; the guard test asserts under 1 ms per authorize                         |
| Building the engine from a bundle | about 0.4 ms                                                                                      |
| A gateway verdict                 | one cached bundle read plus a pure evaluation; the forward to the server is the server's own time |
| An ask                            | as fast as a person answers; the long poll returns within about a second of the answer landing    |

## 9. Wire contract reference

| Route                                                            | Who                                | Purpose                         |
| ---------------------------------------------------------------- | ---------------------------------- | ------------------------------- |
| `GET /v1/keys`                                                   | anyone                             | Ed25519 public keys             |
| `GET /v1/workspaces/:ws/bundle`                                  | machine, viewer                    | signed rules, ETag aware        |
| `POST /v1/workspaces/:ws/held`                                   | machine, reviewer, `REMOTE_AGENTS` | raise a question                |
| `GET /v1/workspaces/:ws/held/:id?wait=`                          | machine, reviewer                  | long poll for the signed answer |
| `POST /v1/workspaces/:ws/events`                                 | machine, reviewer                  | the guard's records and pauses  |
| `POST /v1/workspaces/:ws/gateway/:server`                        | machine, reviewer, `REMOTE_AGENTS` | the MCP gateway                 |
| `GET, PUT, DELETE /v1/workspaces/:ws/gateway-upstreams/:name`    | admin                              | servers behind the gateway      |
| `GET /v1/workspaces/:ws/cloud-agents`                            | person or machine, viewer          | what cloud agents are doing     |
| `POST /v1/workspaces/:ws/cloud-agents/sessions/:s/resume`        | person, reviewer                   | lift a pause                    |
| `GET /v1/workspaces/:ws/cloud-agents/sessions/:s/resumed?since=` | machine, reviewer                  | the guard's resume check        |
| `POST /v1/workspaces/:ws/policies/proposals/from-statement`      | admin                              | a rule a person stated          |

Event kinds a cloud agent produces: `agent.session.started`, `agent.action.recorded` (surface `cloud`, `gateway` or `mcp`), `agent.session.paused`. Written only from inside: `agent.session.resumed`.

## 10. How it was verified

| Repository     | Result                                                                                                                                                                                                                                                                                                                                                          |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| memnox-runtime | typecheck clean; guard 22 tests and the voice rule tests pass. 66 other failures in the full suite are the sandbox (40 are `listen EPERM` on local sockets; the brain tests' fake agents cannot start) or files from another session (two doc comment checks, `daemon.command.ts`, a recall test). knip shows only four unused exports that were already there. |
| memnox-cloud   | typecheck, prettier and knip clean; 4105 tests pass. Of three failures, two pass when run alone (flaky under load) and the third is the document parser, whose build step cannot run in the sandbox. New tests cover the ask service, the gateway, cloud agents, pruning, callbacks, proof and the stated rule route.                                           |
| memnox-macos   | the core module type checks cleanly; the app module could not be fully compiled, because the sandbox blocks SwiftUI's macro plugin, and no errors were found in the files changed                                                                                                                                                                               |
| memnox-ios     | the core module and its tests type check, including `CloudAgentsReadingTests`; the tests were not run (no simulator in the sandbox); the app screen could not be fully compiled for the same macro reason                                                                                                                                                       |
| memnox-client  | console and website type check with no errors                                                                                                                                                                                                                                                                                                                   |

**Still to do by hand:** build the Mac app and the iPhone app in Xcode; run the iPhone tests on a simulator; run `xcodegen` if the checked in `.xcodeproj` does not pick up the new files; and an end to end run: a Claude Agent SDK script with `@memnox/guard` against a local cloud, a refund answered from the iPhone and from the console, the agent continuing or stopping, and the decision visible in the console and in `memnox timeline`.

## 11. What is not done

- **A Python guard.** The plan is a cloud decision endpoint rather than a port of the engine.
- **The CLI should adopt `policiesFromBundle`.** Its own `documentFrom` duplicates the conversion; it was not touched because that file has another session's edits.
- **The MCP door does not announce `ACTIONS_RECORDED`**, so actions reported over it reach the ledger but not SIEM sinks. The gateway and the guard do.
- **A "for this session" yes at the gateway covers identical arguments only**, because the gateway keeps no state between requests that another instance could not read.
- **No cloud principal kind yet.** Guard and gateway agents use ordinary machine credentials, which already count toward a plan's agent limit; a dedicated `cloud` principal with its own keypair was in the plan and is not built.
- **Nothing is committed.** Every change sits in the working trees beside other sessions' uncommitted work.

## 12. File index

**memnox-runtime**

- `packages/core/src/engine.ts`, `intercept/command-action.ts`, `intercept/sql-file.ts`, `policy/bundle-rules.ts`, `daemon/voice-cards.ts` (team scope), `test/engine-entry.test.ts`
- `packages/guard/src/` `guard.ts`, `cloud.ts`, `actions.ts`, `claude-agent-sdk.ts`, `openai-agents.ts`, `wrap.ts`, `guard.constants.ts`, `index.ts`; tests in `packages/guard/test/`
- `packages/cli/src/protect/rule-scope.ts`, `session-tools/propose-tools.ts`, `daemon/confirm.ts`, `session-tools/operator-tools.ts`, `sync/cloud-agents.ts`; test in `packages/cli/test/voice-rules.test.ts`
- `.changeset/engine-entry-for-cloud-agents.md`

**memnox-cloud**

- `src/crypto/answer-signing.ts`, `keys.controller.ts`, `crypto.providers.ts`
- `src/bundle/asking-rule.ts`, `bundle.controller.ts`, `bundle.providers.ts`
- `src/machines/held-ask.service.ts`, `held-ask.controller.ts`, `held-call.ts`, `held-call-store.ts`, `postgres-held-call-store.ts`, `held-call.service.ts`, `held-escalation.service.ts`, `machines.providers.ts`
- `src/mcp/mcp.providers.ts`, `mcp.service.ts`, `mcp.ts`
- `src/gateway/` (all new), `src/cloud-agents/` (all new)
- `src/policies/policies.controller.ts`, `rule-capture.service.ts`, `policy-source.ts`
- `src/sinks/sink.providers.ts`, `src/event-log/events.controller.ts`, `src/storage/cloud-schema.ts`, `src/privacy/data-inventory.ts`, `src/notifications/held-answer-text.ts`, `src/tokens.ts`, `src/app.module.ts`
- tests: `held-ask`, `gateway`, `cloud-agents`, and additions to `policy-source-endpoints`, `bundle-cache`, `rule-glob`, `unscoped-routes`, `openapi`, `vision-coverage`

**memnox-macos**: `DaemonProtocol.swift`, `Conversation.swift`, `IslandRule.swift`, `IslandPreview.swift`

**memnox-ios**: `DaemonProtocol.swift`, `CloudAgents.swift`, `CloudAgentsReading.swift`, `WorkspaceInbox.swift`, `HttpWorkspaceInbox.swift`, `CloudAgentsPage.swift`, `HomeRoute.swift`, `HomeView.swift`, `CloudAgentsReadingTests.swift`

**memnox-client**: `apps/app/lib/cloud-agents.ts`, `apps/app/components/cloud-agents/cloud-agents-view.tsx`, `apps/app/app/(workspace)/cloud-agents/page.tsx`, `apps/app/components/app-nav.ts`, `packages/ui/src/lib/plan-lines.ts`, `apps/web/components/landing/home/home-data.ts`
