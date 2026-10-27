# Onboarding: Memnox end to end

A map for somebody new to the product: what it is, how the repositories fit together, how
they talk, and the constraints and edge cases that shape every change.

## 1. What the product is

AI agents (Claude Code, Codex, Cursor, Gemini CLI, Windsurf, and harnesses like Hermes,
OpenClaw and Ruflo) already run on developer laptops with access to SSH keys, AWS
credentials, shells, git and MCP servers. Memnox sits between those agents and the
machine: every action gets a **deterministic** verdict of `allow`, `ask` or `deny`, every
verdict lands in an append-only ledger, and that ledger is used to answer *"what can I
safely let this agent do on its own next?"*

The strategy in `VISION.md` is to sell **the ability to safely increase agent autonomy**
rather than protection. The category is a *control plane for autonomous work*: not an
agent, not an orchestrator, not a SIEM.

## 2. The repositories

```text
Memnox-saas/                    (not version controlled itself)
├── memnox-runtime   OSS, Apache-2.0: CLI, daemon, seams, policy engine, ledger
├── memnox-cloud     private control plane: fleet, policies, approvals, leases, budgets, memory
├── memnox-client    web: marketing site, docs site, workspace console
├── memnox-macos     Swift voice app: orb, Touch ID approvals, talks to the local daemon
└── CLAUDE.md        conventions shared by all of them
```

`VISION.md` is copied verbatim into runtime, cloud and client; the runtime copy is the
original, and a change is copied across whole.

## 3. memnox-runtime

### Four packages, one dependency direction

| Package | npm | Role |
|---|---|---|
| `packages/core` | `@memnox/core` | domain: types, policy engine, verb tables, discovery, gate, ledger, recovery, coordination; imports no `@memnox` package |
| `packages/interceptors` | `@memnox/interceptors` | the **seams** an agent's actions pass through |
| `packages/proxy` | `@memnox/proxy` | MCP proxy (the "firewall") in front of MCP servers |
| `packages/cli` | `memnox` | every command and binary, plus daemon, keeper, sync and the voice operator |

```text
cli ──► proxy ──► core
 └────► interceptors ──► core
```

A package imports another only through its `index.ts`. A command holds no logic: it
declares flags and calls one `run*` function.

### The path every decision travels

1. **A seam catches it.** PATH wrappers in `~/.memnox/bin` (`memnox-intercept git push`),
   the governed shell (`memnox-shell`), the MCP proxy (`tools/call`), git hooks, the git
   credential helper, the egress HTTP proxy on loopback, and **agent tool hooks**
   (`memnox-edit-hook --policy` wired into Claude Code `PreToolUse`, Codex, Gemini
   `BeforeTool`, Cursor and Windsurf). Each builds an `ActionRequest`.
2. **It is classified** by the verb tables in `core/src/verbs/` (19 CLIs: aws, gh,
   kubectl, terraform, git and more) as read, write, destructive, communication or
   unknown. A table change is a change to what gets asked about, so it is reviewed as
   code and checksummed.
3. **`LocalGate.evaluate`** runs `PolicyEngine` over the rule files: deny beats ask beats
   allow, the most specific rule wins, and layers stack org, then user, then project,
   where a `locked` domain can only tighten.
4. **The seam applies the verdict.** Allow passes stdio and the exit code through. Ask
   writes a hold to `~/.memnox/pending/` and waits for a person. Deny prints the rule, its
   file and line, and an **alternative**.
5. **A row is appended** to `~/.memnox/memnox.db` (SQLite WAL, append-only by trigger).

**Modes.** `observe` is the default on a new machine: it records what enforce *would*
have done in `shadowEffect` and blocks nothing. `enforce` applies verdicts. `memnox stop`
writes `stopped.json` and leaves the mode alone, so `start` returns to exactly what
somebody chose.

### Other subsystems

| Area | Where | What it does |
|---|---|---|
| Discovery and scan | `core/discovery` | agents, MCP servers, credentials (21 kinds, names and structure only), authenticated CLIs, browser profiles, effective capability (AWS creds plus kubectl plus a prod kubeconfig means "can modify prod k8s") |
| Daemon and keeper | `cli/daemon`, `cli/keeper` | puts removed hooks and wrappers back, notices config drift, flags dormant agents, desktop notices |
| Breaker, budgets, autonomy | `core/session/breaker.ts`, `budget.ts`, `autonomy.ts` | error loops, action explosion, scope drift; `memnox next` for what to automate next |
| Leases | `core/coordination`, `memnox lock` | two agents on one directory: locks paths, never blocks reads, always expires, bounded waits |
| Recovery | `core/recovery` | milestones under `refs/memnox/milestones/*`, never a branch or the stash; `memnox rewind` is itself undoable |
| In-session MCP | `cli/session-tools` | `memnox-session` with eight tools (why, status, replay, decisions, memory, brief, fingerprint, rewind); **never approves, allows or edits a rule**, or an agent could approve itself |
| Code fingerprint | `.memnox/code-fingerprint.yaml` | how a repository's code is written; a write breaking an enforced line is refused |

### Where state lives

Under `~/.memnox` (`0700`, files `0600`): `memnox.db` (ledger), `config.toml` (mode,
retention), `account.json` (cloud enrolment), `policies.json` (which rule files load),
`machine.policies.toml`, `bin/` (wrappers), `pending/` (held calls), `overlays.json`
(freezes), `leases/`, and `memnox.sock` (daemon socket). Project rules are in
`memnox.policies.toml`, which is the person's file: an agent is refused when it tries to
change or commit it.

## 4. How everything communicates

```text
 Agent ──hook stdin/stdout JSON──► memnox-edit-hook ─┐
 Agent ──argv──► ~/.memnox/bin/git ──────────────────┤
 Agent ──stdio JSON-RPC──► MCP proxy ──► MCP server  ├─► LocalGate (in process or via daemon)
 Agent ──HTTP(S)──► egress proxy (loopback) ─────────┘
                                │
       Unix socket ~/.memnox/memnox.sock, line-delimited JSON
                                │
      daemon ◄─────────────────── macOS voice app (one connection per request)
        │
        │  HTTPS, outbound only, Bearer machine token, bounded timeouts
        ▼
   memnox-cloud (api.memnox.com on Railway) ◄── session cookie + CSRF ── memnox-client console
        ▲
   Cloudflare Worker (api-fallback) answers a branded 503 only when Railway is down
```

### Daemon socket

`core/src/daemon/protocol.ts`: `evaluate` (the hot path, with a latency budget), `hold`,
`record`, `status`, `ping`, `subscribe`, `waiting`, `confirm`, `register-key`, `ask`,
`cancel`, `locate`, `brief`, `warm`, `vocabulary`, `session-view`, `sessions-list` and
more. Interceptors fall back to the in-process engine when the daemon is absent. On
Windows the same protocol runs over a named pipe, named by `socketPathFor` in
`core/src/daemon/protocol.ts`; ADR 0003 says what that pipe does not protect against.

### Runtime to cloud

Always started by the machine, since the cloud never dials one, and always best effort
(`runControlPlaneRequest` returns `null` on any failure).

| Purpose | Route | Notes |
|---|---|---|
| Enrolment | `POST /v1/device/codes`, `/v1/device/tokens`, then `POST :ws/machines` | RFC 8628 device flow; ed25519 public key; only `sha256(ws + hostname)` is stored |
| Agents | `POST :ws/machines/:id/agents` | one approval per machine; revoking the machine revokes its agents |
| Heartbeat | `POST :ws/machines/:id/heartbeat` | 60s backing off to 15m; sends mode, version, applied bundle hash; reply carries workspace mode, held-call answers, fleet spend |
| Bundle | `GET :ws/bundle` | workspace policies, ETag and 304 |
| Events | `POST :ws/events` | machine-signed, deduplicated, 202; something new to report is a new event kind, never a new route |
| Leases, memory, context, traces | `:ws/leases*`, `:ws/memory`, `:ws/context`, `/v1/traces` | |

Wire shapes are pinned by `docs/sync-contract.json` and by the cloud's
`test/sdk-contract.test.ts`.

**Everything degrades rather than blocks.** With the cloud unreachable a fleet budget
becomes a machine budget, a shared lease becomes a local one, and a held call is still
answerable from a terminal. A 402 (lapsed plan) never makes a machine less governed,
because it keeps its last bundle.

### A held call has four answer routes, and the first answer wins

The terminal prompt, `memnox approve` from another terminal, the workspace console or DM
(carried up and back on heartbeats), and the Mac voice app.

## 5. memnox-cloud

- **Stack:** NestJS 11 on Fastify 5, TypeScript ESM, tsup; Postgres for durable state
  (ledger, cursors, tokens), Redis for rebuildable state (device codes, bundle cache,
  locks), BullMQ; Railway with a Dockerfile and **two replicas**, so "what happens on two
  instances" is the first question for any change.
- **Domains**, one folder each and the same shape: auth, session, machines, bundle,
  policies, event-log and projections, coordination, agents, usage, memory, mcp, tenancy,
  connectors and extraction, approvals, autonomy, billing (Lemon Squeezy), privacy and
  retention.
- **Auth:** people sign in with Google (or GitHub) and hold a session cookie plus a CSRF
  header, with roles viewer, reviewer or admin taken from the provisioned account and
  never from the identity provider. A machine token works only on `@MachineRoute` routes
  and is pinned to its own workspace and id. One organization has exactly one workspace.
- **The one place an LLM appears:** extracting decisions from sources (Anthropic SDK or
  OpenRouter), which **only suggests**. Publishing a rule set needs a second admin.
  "Memnox governs agents; it is not one."

## 6. memnox-client

Turborepo with pnpm, Next.js 16, React 19, Tailwind v4, shadcn, on Vercel.

| App | Port | What it is |
|---|---|---|
| `apps/web` | 3001 | marketing site; terminal readouts must match what the CLI really prints |
| `apps/docs` | 3002 | MDX docs for the open runtime only, never the cloud API |
| `apps/app` | 3003 | workspace console (fleet, machines, inbox, autonomy, leases, memory and more); TanStack Query, and `lib/api.ts` is the only fetcher |

`packages/ui` holds the design tokens. `workers/api-fallback` is the Cloudflare Worker.
`pnpm check-vision` checks every `/v1` path the console calls against the cloud's
`openapi.json`.

## 7. memnox-macos and the voice work

A Swift Package for macOS 14+: a Metal particle orb and caption pill, the ⌥Space hotkey or
a wake word, on-device speech recognition, and local Kokoro TTS. It talks only to the
daemon socket, and `DaemonProtocol.swift` is kept in lockstep with `protocol.ts`.

The voice brain is the **person's own Claude Code** (`cli/operator/claude-brain.ts`),
started with every built-in tool off and one MCP server, `memnox-operator`, so it can read
the machine and propose but never edit a file or run a command. The decisions it follows:
no keyword matching; voice is an extra approval route and never replaces the others;
**deny works by voice alone, allow needs Touch ID**, a Secure Enclave signature over
`memnox-confirm:v1:<id>:<answer>` that the daemon verifies byte for byte.

## 8. Technologies

| Layer | Tech |
|---|---|
| Runtime | TypeScript 5 strict (`noUncheckedIndexedAccess`), ESM, Node 22 or later, pnpm 11, tsup, vitest 4, prettier, knip, changesets |
| Runtime deps | only `commander`, `better-sqlite3`, `smol-toml`, `yaml`, `jsonc-parser`; no model SDK |
| OS guard | macOS `sandbox-exec` (Seatbelt), Linux Landlock |
| Cloud | NestJS, Fastify, Postgres, Redis, BullMQ, Railway, Docker |
| Web | Next.js 16, React 19, Tailwind 4, Vercel, Cloudflare Workers |
| Mac | Swift 6, AppKit, Metal, SpeechAnalyzer, Secure Enclave, Kokoro TTS |

## 9. Hard constraints

1. **No LLM on any enforcement path, ever.** A prompt cannot argue with a matcher.
2. **A secret value never leaves the process that read it.** Discovery reports path, kind
   and count; the ledger stores argument digests; `validateEvent` refuses a digest over
   128 characters. A secret in a report or screenshot is the highest severity bug.
3. **Counts, never scores,** and never estimate what only somebody else can report, which
   is why there is no spend line: this machine cannot price a model call.
4. **An unknown verb is `unknown`:** allowed and counted, never silently safe and never
   silently destructive.
5. **Every deny names an alternative** from the rule or verb table, never invented on the
   spot, and says whether retrying makes sense.
6. **Writes stay inside `~/.memnox` or `<project>/.memnox`**, with a backup for anything
   else. `memnox uninstall` leaves the machine as it was; `mcp unwrap` restores configs
   byte for byte; config rewrites edit spans of JSONC, TOML or YAML so no untouched line
   moves.
7. **A failed ledger write never stops the agent,** so the record can come up short.
8. **Code:** no `any`; explicit return types; named exports only; `UPPER_SNAKE as const`
   plus a derived union instead of enums; injected seams for home, clock and spawning;
   no module mocks; no wall-clock assertions in tests; one-line comments that say why.
9. **Copy:** no em dash, en dash or spaced hyphen in any prose, comment or commit; write
   the linking word the dash was hiding.
10. **Commits:** one line with a conventional prefix, no body, under your own name, with no co-author line. Commit
    only your own files, green on typecheck, format, tests and knip at every commit. A
    user-visible change carries a changeset with all four packages at `patch`. Release
    only through `pnpm ship`, and only when asked.

## 10. Edge cases and known gaps

From `docs/threat-model.md` and the architecture notes:

- **PATH is advisory.** `/usr/bin/git` by absolute path skips the wrappers; the OS guard,
  git hooks and MCP proxy each close part of that, and none closes all of it.
- **The rules are a file an agent can write** unless a path rule covers
  `memnox.policies.*`; `protect` proposes one and it is not on by default.
- **MCP tools are classified by name and annotation,** so a server that lies is
  classified by the lie.
- **A held call times out to deny** after about two minutes, so an unattended run cannot
  rely on `ask` rules unless the cloud route answers.
- **The egress proxy sees only what is pointed at it;** inside HTTPS only the destination
  is known, and the sending agent is whatever its proxy URL declares.
- **Linux Landlock holds less than macOS:** it needs a python3 helper, holds TCP only from
  ABI 4, and refuses cross-directory renames on ABI 1.
- **Hook limits per agent:** Codex, Gemini and Windsurf cannot surface `ask`, so it
  becomes a refusal; Cursor does not send the MCP server's name; Claude Code in
  `bypassPermissions` refuses an `ask` rather than asking.
- **Leases:** a write claims its directory; `src/billing` does not cover
  `src/billing-legacy`; a dead holder is reclaimable; a wait is bounded by a count as well
  as by the clock, so a frozen clock cannot hang an agent.
- **Rewind** refuses mid-merge, mid-rebase, mid-bisect or on a detached HEAD, and takes
  its own milestone first.
- **Enrolment:** `setup` checks which control plane it is enrolled against
  (`sameControlPlane`); moving planes asks, defaults to no, and hands agents back before
  minting anything; a record naming no plane belongs to whichever is asking.
- **Cloud:** a wrong, spent or expired device code all answer the same 404; a dependency
  cycle hangs boot rather than erroring (billing and meetings is the known one); every new
  table is registered for the data inventory and the retention sweep.

## 11. Where docs and code disagree

- The parent `CLAUDE.md` says the `I.NN` and `II.NN` citation scheme is dead and sections
  are cited by plain number (1 to 33), while the runtime `CLAUDE.md` still cites `I.3`,
  `I.8` and so on.
- The runtime `CLAUDE.md` says the help `SPINE` holds nineteen commands; `program.ts`
  holds eight (setup, status, rewind, doctor, stop, start, update, login).
- `docs/threat-model.md` names `memnox.policies.yaml`, while the runtime uses
  `memnox.policies.toml`.

## 12. Reading order

1. `VISION.md` sections 1 to 4, 13, 21, then 22 to 25.
2. `ARCHITECTURE.md`, whole.
3. `docs/threat-model.md`, `docs/policies.md`, `docs/event-schema.md`.
4. Code: `core/src/gate` and `core/src/policy`, then `interceptors/src/tool-hook.ts`,
   `tool-calls.ts`, `shell-seam.ts` and `record.ts`, then `core/src/daemon/protocol.ts`
   and `cli/src/program.ts`.
5. Run it: `memnox scan`, `memnox status`,
   `memnox policy test "git push --force origin main"`, `memnox why`, `memnox timeline`.
6. Cloud: `docs/runtime-enrolment-and-bundle.md` and `src/auth/cloud-auth.guard.ts`.
