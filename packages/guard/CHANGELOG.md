# @memnox/guard

## 0.15.3

### Patch Changes

- 9f4df5b: The config watcher no longer watches your home folder or `~/.config` whole, which on Linux ran out of file watchers and stopped the daemon within minutes; it now wakes only for the agent configs named in them.
- Updated dependencies [9f4df5b]
  - @memnox/core@0.15.3

## 0.15.2

### Patch Changes

- @memnox/core@0.15.2

## 0.15.1

### Patch Changes

- e94bf1b: Profiles are kept apart from connections. Every agent found here answers to a default profile until a person binds one with `memnox profile bind <profile> <agent>`, or the daemon's `profile-bind` and `profile-unbind`; the binding is kept in `~/.memnox/agents/connections.json` and the agent keeps its `agt_<kind>` ledger key. Each profile now lists the connections it works through, and a session of a bound agent is matched under the profile's role unless `--role` or `MEMNOX_AGENT_ROLE` names another. `memnox profile new` and `memnox profile show` write and read profiles from the terminal.
- e94bf1b: A profile names one responsible person in place of owners: the account signed in on this machine, else the person at it. Asks for that agent go to them, and the agent never holds their authority.
- e94bf1b: A profile is now the agent's job as well as its bundle: purpose, role, responsibilities, instructions, owners, projects and the template it came from, all optional. Profiles kept as version 1 load unchanged and are written back as version 2.
- e94bf1b: An agent reads and reports on the work its person pointed it at through `memnox-session`: `my_work`, `report_progress`, `mark_blocked` and `request_handoff`. None of them starts, assigns, stops or closes work, and an agent can claim done but never close. The voice gains `start_agent_work`, which waits for a yes read back, `show_agent_work` and `answer_handoff`, each acting only for the person it speaks for.
- e94bf1b: Agent work: a person points the agent under a profile at an issue in Linear, Jira, GitHub or Asana with `memnox work start <profile> <LIN-123|link>`, and stops or closes it with `memnox work stop|close`. Memnox keeps a reference to the issue and never a copy, under `~/.memnox/work/` or the project's `.memnox/work/`. A session of that agent on a branch named for the issue, or started with `memnox run --work <id>`, joins it and takes it as its task, so drift is still measured. An agent may ask to hand its work on, and only a person answers with `memnox handoff accept|decline <id>`. The daemon answers `agent-work`, `work-start`, `work-stop`, `work-close` and `handoff-answer`, and sends `work` events to a subscriber that asks with `subscribeWork`.
- e94bf1b: A bare issue key such as `LIN-123` no longer assumes Linear: `memnox work start` asks which tracker with `--tracker`, or takes the issue link.
- e94bf1b: A budget can carry a warning line. `memnox budget set <name> --warn-at <n>` tells the person once, through the waiting feed, when a budget passes that line and again when it runs out, so a stop is never the first they hear of it. The warning never holds anything, and `memnox budget` prints the line beside the spend.
- e94bf1b: Every connection, profile and agent card now says how sure Memnox is of each capability: context, instructions, tools, activity, coordination, approval, and enforcement per seam (shell, files, git, network, browser, MCP). A seam reads enforced only where `memnox doctor --prove` saw it refuse; held without a test is mediated, an MCP report is advisory, and anything else is observed or outside Memnox. A profile shows the weakest of its connections.
- e94bf1b: `@memnox/guard` names the agent's profile on every record: `profileId` on `createGuard` (or `MEMNOX_PROFILE`) and on `wrapTool`. `guard.myWork()`, `guard.reportProgress({ workId, note, state, refs })` and `guard.requestHandoff(...)` read and report the work a person pointed the agent at, over the cloud's MCP tools `memnox_my_work`, `memnox_report_progress` and `memnox_request_handoff`.
- e94bf1b: The Python guard now does what the TypeScript one does after a call: a tool answer written to steer the model taints the session so its sends and losses ask a person, the same call failing the same way five times or eight failures in a row pauses the session until a person resumes it, and progress notes, handoff reasons and questions leave with credentials masked.
- e94bf1b: `@memnox/guard` and `memnox_guard` take `workRefs` on the guard or per call and say once per session which issues it is for, by key, number or link.
- e94bf1b: A held call carried up on the heartbeat now names the session that asked, so the workspace can put it under that session rather than guessing from the agent.
- e94bf1b: A hook session now matches rules under the role of the profile bound to its agent, as `memnox run` already did, so Claude Code, Codex and Cursor opened from their own icons are held to the same `roles:` rules. `--role` and `MEMNOX_AGENT_ROLE` still win.
- 11709b6: A remote MCP server that asks for a sign in no longer ends up disconnected behind the proxy, and nothing in Memnox signs a person out of a tool. `memnox mcp signin <server>` signs in through Memnox in the browser and keeps the sign in in the OS store, which the proxy sends and renews, so the server connects and its calls stay ruled on. Taking a remote server into the hub now asks it first and moves it behind the proxy only once it has answered there; one that wants a sign in, or did not answer, is left exactly as the person set it up. `memnox mcp repair` finds the servers already broken and hands them back to the agent as their own address, asking before it changes anything. `mcp unwrap` and `uninstall` now put remote servers back as well as local ones. A server that will not connect behind Memnox is told to the person once, on the waiting feed, on its hub card and in `memnox doctor --servers`, and the agent's own server list says why and what to run in place of a bare status code. A refused credential, a missing secret and a local server whose command did not start are each said as what they are. `memnox mcp repair` offers the sign in through Memnox first and hands back only what that did not mend. `memnox mcp signin` takes `--client-id` and `--port` for a server that registers no new app. The daemon answers `mcp-sign-in`, which opens the browser and writes what the sign in came to onto the server's card, and `mcp-hand-back`, which is a signed proposal; the hub view carries `trouble` so a screen offers both only where they apply. A sign in no longer hangs after the browser comes back: the loopback page closes the connections a browser leaves open, every sign in request is bounded, and the sign in is sealed in a file under the Memnox home with only its key in the OS store, so a long token never meets an OS store's limit. The browser shows a Memnox page with the outcome, and `repair` takes servers one at a time with Enter to skip.
- e94bf1b: `memnox --help` now lists sessions, approvals, next, mission and budget beside setup and status. `memnox next` fits one screen: where you are, what is ready to hand over, and one command, with the week by week history behind `--detail`. `memnox setup` ends with one next step, which once everything is wired is a prompt to paste into an agent so the first ask arrives in minutes.
- e94bf1b: The terminal card answers a held call with the same words, in the same order, as the console, the Mac app and the phone: Allow once, Allow for this session, Edit the command first, Deny. A decided call reads "denied" rather than "refused". Session statuses and their reasons have one vocabulary, kept in `docs/ux/contract.json`, which every surface checks itself against.
- e94bf1b: A catalog of seven job descriptions ships with the runtime: Software Development, Code Review, Testing, Documentation, Research, Customer Support and Operations Assistant. `memnox profile templates` lists them and `memnox profile from-template <template>` copies one into a new profile, taking only the suggested skills named with `--skills`; suggested rules are shown as sentences and nothing applies on its own. The daemon answers `templates` and `profile-from-template`.
- e94bf1b: A project's `agents` list in `.memnox/project.toml` takes profile ids beside agent kinds. A profile stands for every agent bound to it, so a project's instructions and skills reach only those agents; an empty list still means every agent seen working in the project.
- e94bf1b: A capability reads `enforced` only while the enforcement path installed now is the one the last `memnox doctor --prove` ran against. Rewire a hook, wrap a config or move PATH and the proof stops counting, so the level drops to what the connection itself holds, `mediated` or `observed`, until the proof is run again.
- d8793cb: `memnox update` now requires provenance from `github.com/Memnox/memnox-runtime`, the repository's name since it was renamed from `Memnox/memnox`, and every package names that repository, so a release published through trusted publishing verifies again. The Noise addons are published again with it, since `memnox update` holds every `@memnox/*` package it installs to provenance and the 0.1.1 ones carry none. A copy installed before this release still trusts the old name and refuses this one, so it updates once with `memnox update --skip-verify`, which says so on screen and writes `verified: false` to `~/.memnox/updates.jsonl`, and verifies every release after it.
- e94bf1b: A Python guard, `packages/guard-py`, decides allow, ask or deny for a Python agent from the signed bundle, with wrappers for OpenAI Agents SDK function tools and LangGraph tools, and reads and reports the agent's work. `vectors/guard-decisions.json`, written by the TypeScript guard's tests, holds both guards to the same decisions.
- e94bf1b: A run that a crash, a reboot or a closed laptop cut off now shows in `memnox sessions` as Stopped, Interrupted, resumable. `memnox resume <session>` asks first and then starts it again in the same folder, with the same task, role, person and mission. Claude Code and Codex pick their own conversation back up; any other agent starts fresh, and the screen says so.
- e94bf1b: Every change to a rule file, and every grant or revoke the autopilot makes, now keeps a copy of what stood before it. `memnox policy history` lists the changes newest first and names the rules each one added, removed or changed (`--allowances` for what the autopilot granted). `memnox policy revert <n>` puts a file back as it was before change n, and keeps what stood first, so the revert can itself be undone. An agent can read the history and can never revert.
- e94bf1b: `memnox sessions` lists every session from the last day in groups by what it needs from the person: Needs you, Stopped, Working, Finished and Idle, with what needs a person first and a count beside each group. These are the same statuses and reasons the apps show.

  `memnox approvals` now lists everything waiting on the person, both here and what the workspace routed to them, and `memnox inbox` is another name for it rather than a second command.

- e94bf1b: A `git commit` that would take files another agent in the same checkout is still changing now asks first, and names that agent and those files. Leases already kept two agents off one file at once; this covers one agent's `commit -a` sweeping up the other's unfinished work. It asks and never refuses, because it is coordination rather than a rule.
- e94bf1b: A held call's card on the terminal now closes the moment the call is answered from the phone, the console or `memnox approve`, and says who answered. It used to keep counting down and leave "nobody answered, so refused" in the scrollback for a call that had been allowed.
- 11709b6: On Windows, a rule naming a path with `/` now matches the `\` path Windows hands over, so a deny on `.ssh` or a credential file holds there as it does on macOS and Linux, and a task's declared paths no longer ask about every write inside them. Credential files are classed as credentials on Windows, a binary in Downloads or in the project is reported as unusual, a shell write takes its lease, a session's recorded paths and the code fingerprint name repository files with `/`, a repository root git reports as `C:/...` is used as `C:\...`, and `memnox lock` accepts a folder Windows names by its short form. A config backup on Windows is a plain file again rather than a hidden stream of a file named after the drive, and a write Windows briefly refuses because another program has the file open is tried again.
- e94bf1b: Leases send the branch and the issue keys its branch name and head commit claim, so the workspace can match them exactly against its trackers. With `MEMNOX_PROMPT_CLAIMS=1` the issue a prompt names as the task is claimed too; the prompt itself never leaves the machine.
- Updated dependencies [e94bf1b]
- Updated dependencies [e94bf1b]
- Updated dependencies [e94bf1b]
- Updated dependencies [e94bf1b]
- Updated dependencies [e94bf1b]
- Updated dependencies [e94bf1b]
- Updated dependencies [e94bf1b]
- Updated dependencies [e94bf1b]
- Updated dependencies [e94bf1b]
- Updated dependencies [e94bf1b]
- Updated dependencies [e94bf1b]
- Updated dependencies [e94bf1b]
- Updated dependencies [e94bf1b]
- Updated dependencies [11709b6]
- Updated dependencies [e94bf1b]
- Updated dependencies [e94bf1b]
- Updated dependencies [e94bf1b]
- Updated dependencies [e94bf1b]
- Updated dependencies [e94bf1b]
- Updated dependencies [d8793cb]
- Updated dependencies [e94bf1b]
- Updated dependencies [e94bf1b]
- Updated dependencies [e94bf1b]
- Updated dependencies [e94bf1b]
- Updated dependencies [e94bf1b]
- Updated dependencies [e94bf1b]
- Updated dependencies [11709b6]
- Updated dependencies [e94bf1b]
  - @memnox/core@0.15.1

## 0.15.0

### Patch Changes

- 36f36a4: Held calls have one route family on the cloud. The guard raises one at `POST /v1/workspaces/:ws/held-calls` and polls `GET /v1/workspaces/:ws/held-calls/:id`, and a person's inbox reads `GET /v1/workspaces/:ws/me/held-calls` and answers at `POST /v1/workspaces/:ws/me/held-calls/:id/answer`.
- Updated dependencies [f3b4e17]
- Updated dependencies [f4a76c5]
- Updated dependencies [c20d426]
- Updated dependencies [418538a]
- Updated dependencies [647d9f9]
- Updated dependencies [cc3de50]
- Updated dependencies [691e9e4]
- Updated dependencies [00db4ab]
- Updated dependencies [316018d]
- Updated dependencies [8e58b37]
- Updated dependencies [b796f63]
- Updated dependencies [632e3bf]
- Updated dependencies [385cc31]
- Updated dependencies [ec51144]
- Updated dependencies [f836045]
- Updated dependencies [b2dd357]
- Updated dependencies [fd5f134]
- Updated dependencies [09aee9e]
- Updated dependencies [6e60b9e]
- Updated dependencies [24b5da6]
- Updated dependencies [dcf5f07]
- Updated dependencies [36f36a4]
- Updated dependencies [8d83c22]
- Updated dependencies [f28f9c8]
- Updated dependencies [076ff61]
- Updated dependencies [cde998e]
- Updated dependencies [2e269bb]
- Updated dependencies [2b22c4c]
- Updated dependencies [f510480]
- Updated dependencies [0b72188]
- Updated dependencies [b8a7605]
- Updated dependencies [1fbcc6e]
- Updated dependencies [50c8d97]
- Updated dependencies [ccbeaa7]
- Updated dependencies [dd16bbf]
- Updated dependencies [838e06e]
- Updated dependencies [b574424]
- Updated dependencies [dc469db]
- Updated dependencies [c8d5f95]
- Updated dependencies [6589082]
- Updated dependencies [67955f5]
- Updated dependencies [50658c2]
- Updated dependencies [4ea07a3]
- Updated dependencies [c679b09]
- Updated dependencies [200bc43]
- Updated dependencies [dd1b738]
- Updated dependencies [8efc821]
- Updated dependencies [13eac8c]
- Updated dependencies [be2b84c]
- Updated dependencies [53474ba]
- Updated dependencies [50ca820]
- Updated dependencies [e18709b]
- Updated dependencies [2c56e73]
- Updated dependencies [a48b3fc]
- Updated dependencies [0156ae5]
- Updated dependencies [e79d977]
- Updated dependencies [f373a54]
- Updated dependencies [f80220b]
- Updated dependencies [eee1c04]
- Updated dependencies [524d756]
- Updated dependencies [b945899]
- Updated dependencies [ca5a212]
- Updated dependencies [ca5a212]
  - @memnox/core@0.15.0

## 0.14.2

### Patch Changes

- bf73f4e: A rule can now say sensitive data never leaves for a destination nobody approved. What a call sends is read by shape at every seam that sees it, the MCP proxy, agent hooks, `curl` and `wget` bodies, plain HTTP through the egress proxy and `@memnox/guard`, and named `secret`, `financial`, `health`, `government-id`, `personal-data`, `customer-record`, `confidential`, `source-code` or `bulk-records`, each also `sensitive`, which `dataClassifications` matches, with the recipient's domain or the URL's host as the target. A policy file or the workspace's bundle can add its own patterns under a named classification. `memnox protect` offers the rule as a question. A cloud agent wrapped by `@memnox/guard` that reads a tool answer written to steer it now asks a person before its next send, post or loss, as the gateway does.
- Updated dependencies [011467d]
- Updated dependencies [754e395]
- Updated dependencies [4abbc02]
- Updated dependencies [bf73f4e]
- Updated dependencies [8cd90e9]
- Updated dependencies [feabcfa]
- Updated dependencies [e6009a1]
- Updated dependencies [1bed4a4]
- Updated dependencies [87e88a5]
- Updated dependencies [981a89a]
- Updated dependencies [dfdfe98]
- Updated dependencies [963416d]
- Updated dependencies [f83fe63]
- Updated dependencies [10490c2]
- Updated dependencies [bf73f4e]
- Updated dependencies [cbc69a3]
- Updated dependencies [ceda286]
- Updated dependencies [fa0c28f]
  - @memnox/core@0.14.2

## 0.14.1

### Patch Changes

- Updated dependencies [97039ac]
- Updated dependencies [7b2621d]
  - @memnox/core@0.14.1

## 0.14.0

### Patch Changes

- Updated dependencies [9a7a649]
- Updated dependencies [099b03f]
- Updated dependencies [4c51627]
- Updated dependencies [819f22d]
- Updated dependencies [d706518]
- Updated dependencies [f46a903]
- Updated dependencies [b1c309b]
- Updated dependencies [cbfd421]
- Updated dependencies [f46a903]
- Updated dependencies [3b2790a]
- Updated dependencies [f2eb66a]
- Updated dependencies [5427677]
- Updated dependencies [2081eb8]
- Updated dependencies [e12626a]
- Updated dependencies [2081eb8]
- Updated dependencies [11dc443]
- Updated dependencies [11dc443]
  - @memnox/core@0.14.0

## 0.13.15

### Patch Changes

- d84d991: `@memnox/core/engine` is the rule engine with nothing that reads a disk or opens a database: the policy engine, the default rules, the verb tables, the tool and SQL classifiers, the circuit breaker and budgets. An agent running in somebody's cloud can load it and decide allow, ask or deny in its own process, in microseconds. The SQL check's `psql -f` file reader moved to its own module so the check itself stays pure.

  `@memnox/guard` governs an agent running in the cloud, built with the Claude Agent SDK or any framework that calls tools: allow and deny are decided in its own process from the workspace's signed rules, an ask is put to the right person on their phone, Mac, Slack, Discord or the console and waits a bounded time, only a signed answer is believed, and the circuit breaker pauses a session that fails the same way five times.

  The guard also wraps OpenAI Agents SDK function tools and any plain function (`wrapTool`), can refuse a yes no device or passkey signed (`requireDeviceProof`), records a circuit breaker pause, and lifts it once a person resumes the session from their phone or the console. On a Mac connected to a team, a rule said aloud can now be offered to the team as a third place beside the whole Mac and a repository, and the voice can say what an agent running in the cloud is doing.

- d84d991: Memnox asks less as it learns, and says so. An allow rule can now name the ask rules it stands in for (`relaxes`), because an allow beside an ask was always still asked about: `memnox next --hand-over` writes allows that actually stop the asking, never over a deny and never over a rule the workspace published. A held call takes a fourth answer, "From now on", on the Mac and the iPhone: the call runs once and a narrow rule for that agent, action and target goes on a card the person places and signs. A new agent on probation no longer asks before writing inside its repository, because the milestone kept before its first write puts that back; writes outside the repository, deletes and outward actions still ask. A finished turn now says what it came to, "It ran 47 actions and asked you 1 time", and `memnox next` shows questions per week against work per week, with the sessions that asked nothing.
- Updated dependencies [12b056a]
- Updated dependencies [66ac35a]
- Updated dependencies [559ff78]
- Updated dependencies [af96f45]
- Updated dependencies [c21e7b6]
- Updated dependencies [a7aa583]
- Updated dependencies [d3dfad9]
- Updated dependencies [397c68a]
- Updated dependencies [9cfa5d2]
- Updated dependencies [29c4b55]
- Updated dependencies [dc22c3e]
- Updated dependencies [c8fd0b2]
- Updated dependencies [698eeaf]
- Updated dependencies [cce3e4b]
- Updated dependencies [d9cb171]
- Updated dependencies [a7501ce]
- Updated dependencies [ef431cb]
- Updated dependencies [82c2667]
- Updated dependencies [0037d4a]
- Updated dependencies [5d259cf]
- Updated dependencies [3577504]
- Updated dependencies [bb540ad]
- Updated dependencies [3525cc5]
- Updated dependencies [b5e4ad0]
- Updated dependencies [9389d60]
- Updated dependencies [831b86c]
- Updated dependencies [376a05c]
- Updated dependencies [826250d]
- Updated dependencies [06593e2]
- Updated dependencies [539521b]
- Updated dependencies [c7932f4]
- Updated dependencies [44df5d6]
- Updated dependencies [1bde963]
- Updated dependencies [d84d991]
- Updated dependencies [7676585]
- Updated dependencies [37c2318]
- Updated dependencies [c2fc346]
- Updated dependencies [be99ac9]
- Updated dependencies [ad69765]
- Updated dependencies [1d19498]
- Updated dependencies [d84d991]
- Updated dependencies [9059b09]
- Updated dependencies [5f19368]
- Updated dependencies [de574df]
- Updated dependencies [596c058]
- Updated dependencies [f1eecb2]
- Updated dependencies [15a5436]
- Updated dependencies [d5f7cad]
- Updated dependencies [083a43d]
- Updated dependencies [67ebfa7]
- Updated dependencies [59ab0be]
- Updated dependencies [6ce7a00]
- Updated dependencies [2033ead]
- Updated dependencies [9b35113]
- Updated dependencies [559ff78]
- Updated dependencies [3eb0e20]
- Updated dependencies [af30a19]
- Updated dependencies [3a548d2]
- Updated dependencies [ca6b0ea]
- Updated dependencies [fe39d75]
- Updated dependencies [dc963af]
- Updated dependencies [dc963af]
- Updated dependencies [d277e9c]
- Updated dependencies [8009857]
- Updated dependencies [7e17bf5]
- Updated dependencies [373f283]
- Updated dependencies [85a36b4]
- Updated dependencies [ece8053]
- Updated dependencies [3f63367]
- Updated dependencies [881b60b]
- Updated dependencies [17e0a33]
- Updated dependencies [4ed9ef8]
- Updated dependencies [8995046]
- Updated dependencies [111655e]
- Updated dependencies [6bbbf39]
- Updated dependencies [a0a9c2a]
- Updated dependencies [d3dfad9]
- Updated dependencies [8fed8fb]
- Updated dependencies [30d83eb]
- Updated dependencies [6763839]
- Updated dependencies [163ca31]
- Updated dependencies [c7baa06]
- Updated dependencies [4db992c]
- Updated dependencies [ce600c3]
- Updated dependencies [ea20a9a]
- Updated dependencies [232f5d6]
- Updated dependencies [bb7721d]
- Updated dependencies [ddfacba]
- Updated dependencies [5ff2702]
- Updated dependencies [c32f588]
- Updated dependencies [843776b]
- Updated dependencies [5abda70]
- Updated dependencies [f6bb56a]
- Updated dependencies [0ec7df2]
- Updated dependencies [21394c4]
- Updated dependencies [f875d2e]
- Updated dependencies [780cf49]
- Updated dependencies [376a05c]
- Updated dependencies [a2ad9a4]
- Updated dependencies [0d736d9]
- Updated dependencies [9eb85b9]
- Updated dependencies [0bcabac]
- Updated dependencies [b8ecc00]
- Updated dependencies [394f680]
- Updated dependencies [4e05c30]
- Updated dependencies [f117ec2]
- Updated dependencies [7edb332]
- Updated dependencies [653511b]
- Updated dependencies [e146987]
- Updated dependencies [9af703d]
- Updated dependencies [b7cb71d]
- Updated dependencies [694f7ee]
- Updated dependencies [bd66de6]
- Updated dependencies [fb0dc89]
- Updated dependencies [cecf039]
- Updated dependencies [82a8a7a]
- Updated dependencies [dc963af]
- Updated dependencies [805f065]
- Updated dependencies [e1f5ac1]
- Updated dependencies [3abaaed]
- Updated dependencies [28af148]
- Updated dependencies [f77eee9]
- Updated dependencies [07729db]
- Updated dependencies [6771935]
- Updated dependencies [7ea12c4]
- Updated dependencies [8672e7b]
- Updated dependencies [edfffcf]
- Updated dependencies [8c1a7eb]
- Updated dependencies [70f81f4]
- Updated dependencies [dc963af]
- Updated dependencies [5985f66]
- Updated dependencies [5985f66]
- Updated dependencies [1087a50]
- Updated dependencies [5985f66]
- Updated dependencies [5985f66]
- Updated dependencies [5985f66]
- Updated dependencies [2ca7fee]
- Updated dependencies [dc963af]
- Updated dependencies [22cfa8f]
- Updated dependencies [5985f66]
- Updated dependencies [44556b5]
- Updated dependencies [162c06d]
- Updated dependencies [5985f66]
- Updated dependencies [162c06d]
- Updated dependencies [5985f66]
- Updated dependencies [9098294]
- Updated dependencies [c8fd0b2]
- Updated dependencies [5985f66]
- Updated dependencies [6be3864]
- Updated dependencies [8b44f9e]
- Updated dependencies [38c9bac]
- Updated dependencies [5985f66]
- Updated dependencies [596c058]
- Updated dependencies [5985f66]
- Updated dependencies [dc963af]
- Updated dependencies [5985f66]
- Updated dependencies [5985f66]
- Updated dependencies [5985f66]
- Updated dependencies [3911ff3]
- Updated dependencies [dc963af]
- Updated dependencies [dc963af]
- Updated dependencies [5985f66]
- Updated dependencies [5985f66]
- Updated dependencies [9444d66]
- Updated dependencies [30e48bd]
- Updated dependencies [dc963af]
- Updated dependencies [4060ede]
- Updated dependencies [dc963af]
- Updated dependencies [8c9ea42]
- Updated dependencies [dc963af]
- Updated dependencies [160b382]
- Updated dependencies [5985f66]
- Updated dependencies [596c058]
- Updated dependencies [c8fd0b2]
- Updated dependencies [5985f66]
- Updated dependencies [dc963af]
- Updated dependencies [14acc2b]
- Updated dependencies [677ad4e]
- Updated dependencies [dc963af]
- Updated dependencies [596c058]
- Updated dependencies [5985f66]
- Updated dependencies [2ca7fee]
- Updated dependencies [dc963af]
- Updated dependencies [94e88ba]
- Updated dependencies [6c797fb]
- Updated dependencies [3fd9343]
- Updated dependencies [558b2a3]
  - @memnox/core@0.13.15
