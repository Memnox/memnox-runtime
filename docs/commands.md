# Commands

Every command works with no account and no network.

Anywhere a flag names a stretch of time (`--since`, `--for`, `--usage`,
`--from-usage`, `--days`) it takes the same shapes: `30m`, `2h`, `7d`. A bare
number is read in whatever that flag is about, so `--for 30` is half an hour and
`--days 30` is a month. `--since` also takes an ISO timestamp.

## At the terminal

`memnox --help` lists only what a person types at a terminal: `setup`, `status`,
`rewind`, `doctor`, `stop`, `start`, `update`, and `login` for the team. Everything
else happens in your agent session, and every command below is still there:
`memnox help --all` lists them all, and `memnox help <command>` describes one.

### `memnox stop`
Turns protection off on this machine, on purpose and on the record. Every seam and
hook lets everything through without ruling, and the daemon stops putting hooks back
and adopting new agents, so nothing turns protection on again behind your back.

| Flag | What it does |
|---|---|
| `--for <duration>` | come back on by itself after this long, e.g. `30m` or `2h` |
| `--reason <text>` | why, in the words your team will read |

The mode in `config.toml` is left as it was, and `~/.memnox/stopped.json` says who
stopped it, why, until when, and in which mode. A seam reads that file before it
rules, and reads the expiry itself, so a timed stop ends on time whether or not the
daemon is running; the daemon then records the end and raises a desktop notice. The
stop and the start are both ledger rows naming who, so `timeline` and `why` show
them. On an enrolled machine the next sync reports each as
`machine.protection.stopped` or `machine.protection.started`, and the heartbeat
reports the machine as running `off`, because a machine turning its own protection
off is something its team has to see. `memnox status` shows the stop first.

### `memnox start`
Turns protection back on, in exactly the mode it was stopped in. Where a timed stop
already ran out, it says so rather than recording a start of its own.

### `memnox update`
Prints the installed version and the latest published one, and upgrades only after
you say yes, with the command for how this copy was installed: `npm install -g
memnox@latest` for an npm global install, `pnpm add -g memnox@latest` for pnpm.
From the npx cache, or anywhere the path does not say, it prints the command
instead of guessing. After the upgrade the new copy runs the same wiring setup
draws, which is idempotent, so the hooks and the service point at it; the rules are
left alone. The version is asked of `npm view` only when you run this, and offline
it says so and changes nothing.

Before anything is installed it checks who built the release. npm installs exactly
that version into a scratch directory with no scripts run, `npm audit signatures`
checks every registry signature and provenance attestation in it, and every `memnox`
and `@memnox/*` package must carry provenance from `github.com/Memnox/memnox`'s
`release.yml` at a version tag. Anything else refuses the update and names the
package and what failed, and the install that follows is pinned to the version that
was checked. Each update is a line in `~/.memnox/updates.jsonl`.

| Flag | What it does |
|---|---|
| `-y, --yes` | update without asking |
| `--skip-verify` | install without the check; said on screen and recorded as unverified |

## What can act here

### `memnox scan`
The default command, so `npx memnox` runs it.

| Flag | What it does |
|---|---|
| `--tools` | every tool by class, server by server |
| `--mcp <server>` | one server: what it declares, asks for and reaches |
| `--usage <window>` | granted against used, e.g. `--usage 7d` |
| `--save` | keep this scan as a baseline for a later `--since` |
| `--since <when>` | what changed since the last scan at or before then |
| `--fail-on <gate>` | `any`, `write-capable` or `credential`; non-zero exit for CI |
| `--sarif` | a comparison as SARIF 2.1.0 for code scanning; needs `--fail-on`, `--since` or `--from` |
| `--no-probe` | do not start MCP servers; tools go uncounted |
| `--json` | the capability inventory (version 4) |

Agents are found by config file, never by a process list — JSON for the editors, TOML
for Codex, YAML for Hermes. Claude Code, Claude Desktop, Cursor, Codex, Cline and VS
Code are one row each. Hermes, OpenClaw and Ruflo run other
agents, so they get a `HARNESSES` block that counts the principals behind the row, and a
`COMBINED CAPABILITY` block for paths a set of permitted tools opens together.
[Harnesses](harnesses.md) explains both, and what Memnox deliberately leaves to them.

Each agent is also read for how it decides. `no prompt` names an agent that approves its
own actions, with the setting that says so (Claude Code's `defaultMode = "bypassPermissions"`
or an unscoped `Bash` allow, Codex's `approval_policy = "never"`); paired with a sensitive
path it can read, that is the critical `auto-approve` rule. `binary` names an agent whose
command resolves from temp, Downloads or inside the work, which nothing installs to.
`removed` names an agent an earlier kept scan held and this one does not. A product with
no reader here is reported as unknown, never as asking.

`hooks` counts the commands the agents here run on their own events: Claude Code's
settings and the plugins they enable, Codex's `hooks.json`, Gemini CLI's settings,
Cursor and Windsurf. A hook runs as you and no permission prompt sees it, so the row
says how many can stop a tool call, how many write into what the model reads, and which
plugin brought them. The program is named and the command line is not, since a line is
where a token sits. Memnox's own hooks are the seam and are left out. A hook that arrives
between two kept scans is drift, so `--since` lists it, `--fail-on any` fails on it, and
the daemon sends a notice.

Under `mcp servers`, a server launched through `npx`, `bunx`, `pnpm dlx`, `uvx` or
`pipx run` without an exact version is named as downloading whatever was last published
each time it starts, because the tools counted today are only what that publish held.
`--mcp <server>` shows the package and whether it is pinned.

In a pipeline, `memnox scan --fail-on write-capable --sarif > memnox.sarif` writes what
widened as SARIF: the gate's matches are errors, other widenings are warnings, a removal is
never a result, and a file inside the checkout is named relative to it so code scanning
can open it. A first run with no kept scan writes an empty run rather than failing.

### `memnox setup`
The whole first run, in one command: log in, find the agents on this machine,
and go through them one at a time.

Named `setup` rather than `onboard` because `agents onboard <agent>` already
does the precise version of its last step, and two commands one word apart is a
pair somebody has to read twice to tell apart. Bare `memnox` still runs `scan`:
the first thing this shows you is your own machine, not a sign-in page.

| Flag | What it does |
|---|---|
| `--url <base>` | the control plane, when it is not the default |
| `--enforce` | start in enforce rather than observe |
| `--no-open` | print the code and the approval URL instead of opening a browser |
| `--no-probe` | do not start MCP servers to ask what they hold |

**One approval, and it is for the machine.** You answer a browser once, when
this laptop enrols. Every agent on it is then enrolled on the credential that
approval produced, with no second browser and no second code: `POST
:ws/machines/:id/agents` is the one door a machine credential opens, and the
control plane pins that credential to its own machine id, so what it can enrol
is the agents on the box that was approved and nothing anywhere else. Asking per
agent was the same decision put five times, and the fifth answer is the one
nobody gives: a run that opens five tabs is a run that ends half finished, with
two agents governed and three believed to be.

Each agent still gets its own credential, so revoking one does not silence the
others, and each remembers which machine vouched for it, so revoking the laptop
takes them all. Against a control plane too old for that door the device flow
still runs per agent, and the screen says why a browser opened rather than
leaving it to explain itself.

For each agent it prints what that agent is and what it can already reach, asks
what the workspace should call it, and asks whether to put it under Memnox:

```
◇ Claude Code ╭──────────────────────────────────────────────
│   claude-code 1.2.3
│   id          agt_claude-code
│   config      ~/.claude.json
│   mcp         github (12), next-devtools (4)
│   can use     shell, filesystem, git, network, mcp
│   can reach   ~/.aws/credentials, /var/run/docker.sock, network
│ ╰────────────────────────────────────────────────────────────
```

Everything in that block was proved by the scan and none of it is a claim about
what Memnox will do. The id is what a ledger row will say, the config is the one
file that would be rewritten (not every file the detector read), and the servers
are the ones already in it.

In that order, because each answer needs the one above it: whether to onboard an
agent that can read `~/.aws/credentials` is a different decision from one that
can only read this checkout, and a name chosen before seeing either is a name
that says nothing. It asks per agent rather than once at the bottom, because a
list of five names with one prompt under it is a screen people say yes to
without reading.

**An agent that cannot be managed is found out before anybody is asked**, not
after. Its block carries `cannot manage:` and the reason, and the run moves on.
Answering two questions about an agent and then being told the third step was
never going to work is the worst version of this screen. The check is a dry run
of the real rewrite rather than a guess at whether one would work.

**Three config formats are onboardable**, because three of the six agent kinds
on an ordinary laptop are not JSON: Claude Code, Claude Desktop, Cursor, Cline,
VS Code and OpenClaw keep JSON, Codex keeps TOML, and Hermes keeps YAML.

**None of them reformats a line it did not change**, and all three keep the
comments. TOML gets a table appended as text, so every original byte survives
and a `[header]` closes whatever came before it. YAML goes through a document
that preserves comments, because a Hermes config is edited by hand. JSON is
edited by span through `jsonc-parser`, which also means a config with `//` in it
is onboardable: VS Code and Cline both allow comments in theirs, and a plain
`JSON.parse` refused the whole file over one.

**Every rewrite is read back before it is written.** The result is parsed with
the same parser the detectors use, and it has to still hold every server it held
plus the managed one, or the file is left alone. A rewrite that would drop a
server, or produce something that no longer parses, is refused and said out
loud.

**A `y` typed at the name prompt is read as an answer to the next question.**
Nobody names an agent "y", and taking it would name one "y" and then never ask
the question the person thought they were answering.

**Every line of the run is on one rail, prompts and enrolment included.**
Enrolment used to print its own block to stdout while the rest drew a rail on
stderr, so the one step that can block on a person looked like a different
command interrupting this one, and anything piping the command received it.
Paths are printed under `~`, because a column where the first twenty characters
of every row are identical is a column that wraps for nothing.

Each agent that is onboarded says how it was enrolled:

```
◇ Claude Code is under Memnox ╭─────────────────────────────
│   known as    Backend Coder in acme
│   enrolled    on this machine's own credential, no browser
│   config      ~/.claude.json
│   backup      ~/.memnox/agents/backups/agt_claude-code/20260911T200237032Z-eb8595dc-.claude.json
│ ╰────────────────────────────────────────────────────────────
```

It ends with a row per agent it offered, including the ones nothing happened to:

```
  Agent          Status     Reason
  Backend Coder  onboarded
  Cursor         skipped    you said no
  Codex CLI      cannot     Codex CLI keeps its config in a format this cannot rewrite safely
```

A summary of only the successes would let an agent somebody answered a question
about vanish from the screen, which is how a run ends with a person believing
more is governed than is.

An already enrolled machine skips the login step rather than enrolling twice,
and an already onboarded agent is left alone rather than asked about again.
With nothing attached to the terminal it stops and names the one-at-a-time
command instead, because every question below waits on a person and asking them
with no stdin is a command that hangs.

**Where the run is pointed is part of that question.** A machine enrolled against
a control plane on `localhost` and then run against the default one is not
already connected: it holds a credential for a different deployment. The run says
so, names both addresses, and offers the move. This is the one question here that
defaults to **no**, because Enter must not take a laptop off the control plane
that governs it, and with nobody to ask it keeps the enrolment it has and names
`memnox login --url <base>` instead.

```
◇ Connected to a different control plane
│ 789fdf81-0ecc-4d17-a234-464bc0a8ecf4 at http://localhost:3000
│
│   This run was pointed at https://api.memnox.com.
│   Move this machine to https://api.memnox.com?  [y/N]
```

**A move hands the agents back before it mints anything new.** Revoking an
agent's credential takes the account that sponsored it, so enrolling first would
replace the only credential that could do it and leave live principals in the
workspace somebody thought they had left. Each config goes back to what it said
before Memnox touched it, and the agents are then offered again for the new
workspace: a record written against one control plane is not proof the next one
has that agent. A revocation the old plane did not answer is named with the
machine id to revoke by hand rather than counted as done.

An agent whose record names another workspace and which was *not* handed back,
which is the state `memnox login --url` on its own leaves, is reported as
`elsewhere` rather than onboarded over. Rewriting it would back up a config that
already points at the other plane, which turns `offboard` into a second way to
end up there, so the run names `memnox agents offboard <name>` and moves on.

`login`, `agents discover`, `agents name` and `agents onboard` are the same
steps separately, for when you want one of them.

### `memnox agents`
The agents on this machine: find them, name them, put them to work. `discover` is
the default.

| Command | What it does |
|---|---|
| `agents discover` | scan this machine, ask what to call what it found, keep the scan, and report it if this machine is enrolled |
| `agents list` | what the last scan found, without taking a new one, and whether each is onboarded |
| `agents name <agent> [name]` | call one whatever you call it; `--clear` puts the detected name back |
| `agents status <agent>` | one agent, and the file that proved each surface it has |
| `agents onboard [agent]` | back its config up and route it through Memnox; with no agent, lists what could be. `--name` says what the workspace should call it |
| `agents offboard <agent>` | put the config back and revoke the credential |
| `agents control [agent]` | collect what an operator has said, and acknowledge it |

**Names are yours, and ids stay the identity.** `agt_claude-code` is what every
ledger row is keyed on and it never moves. The name is a second field over the
top: it is what every screen prints, and every command answers to it, to the id,
to the id without its prefix and to the product. `discover` asks for one per agent
and Enter keeps the detected one, so naming costs a keystroke to skip. It never
asks under `--json`, never asks when nothing is attached to the terminal, and
`--no-ask` turns it off outright. `--name claude-code="Backend Coder"` is the flag
for a setup script, and it is repeatable.

Names are local. A machine that renamed its own agents and reported the rename
would be asking the control plane to hold one person's vocabulary for a fleet, and
the next machine calling a different agent "Backend" would win. They live in
`~/.memnox/agents/names.json`, owner-only.

**The name is the agent's identity in the workspace.** Onboarding asks for one,
because the control plane hashes the hostname and never stores it: whatever is
chosen is sent as the enrolment label and is the only human thing on the fleet
row. `--name` answers it for a setup script, and a machine with nobody at it
keeps whatever the agent is already called rather than hanging on a prompt. The
answer is written locally too, so the name on this laptop and the name in the
console are one name rather than two that drift.

**Onboarding says what it will do before it does any of it.** The device code
arrives seconds later and is the first thing most people see, which makes "why is
this asking me to approve something" the question the screen has to answer before
it asks. So it names the three steps in order, says that authority does not change,
and prints the undo beside the result. Nothing on disk is touched until the
approval comes back, and the screen says that too.

All of it is about *this machine*. The console answers what the whole fleet runs,
because only something holding every machine's reports can, and answering that from
here would mean widening what a machine credential reaches.

`list` reads the kept scan rather than taking a fresh one, because a scan starts every
MCP server it finds: listing is the thing somebody runs twice in a row, and making it
the expensive one is how it stops being run. `discover` is the one that scans.

`control` is the only one that reaches the network, and it reaches it the way
everything else here does, which is by asking. Nothing dials this machine. What comes
back is a person's own words for whoever is at the agent, and it is never permission:
what the agent does next is decided here, against the rules already on disk.

### `memnox doctor`
What is reachable that should not be, ranked, each with the one change that closes it.
`--by-agent` decomposes per agent. Counts by severity, never a total.

`--wiring` answers a different question: is Memnox actually gating anything, or only
installed? It checks the config mode, the rules, the interceptors, whether they are
ahead of the real binaries on `PATH`, whether your MCP servers are routed through the
proxy, the daemon and the ledger, and where Claude Code's hook lives: in managed
settings, in your own (which a local edit can remove), or in both (every call ruled on
twice). Every line that is not `ok` names the command that fixes it.

### `memnox explain <subject>`
A tool name gives its provenance: which server, which config, which agents reach it,
how long it has been there.

An agent kind — `cursor`, `codex-cli`, `hermes` — gives what that product holds here:
the files that declared it, its surfaces, the MCP servers its own config names, whether
it holds a shell, and any path its tools open together.

It ends with **Governed by**: which seams are in front of *that* agent right now, and
the command that closes each one that is not. `doctor --wiring` answers the same
question for the machine, which is the wrong grain once there is more than one agent on
it — a wrapped Claude Code and an unwrapped Cursor average out to a number nobody can
act on.

```
  Governed by  3 of 4 seam(s)
    ✓  mcp         all 1 server(s) routed through the proxy
    ✓  shell       interceptors are ahead of the real binaries on PATH
    ✓  git         hooks in this repository stop a push even off PATH
    !  filesystem  covered by the shell wrapper only, so a raw binary is not stopped
                   → memnox protect --os-guard
```

A harness name — `hermes`, `openclaw`, `ruflo` — adds what it runs: the
runtimes it drives, the roles it defines, the hooks it installed into another product,
whether it works with agents on other machines, and any path its tools open together.
It never starts an MCP server, so the chain comes from the last scan that did; with no
such scan it says so rather than reporting an empty one. See
[Harnesses](harnesses.md).

An authenticated CLI name — `aws`, `gh`, `vercel` — gives the credential it uses and
the verb table enforcement reads.

A sentence asks a question:

```sh
memnox explain "can claude read ~/.aws"
```

Answered from this disk in three rows: technically, runtime, policy. What the
organization intended is not on this disk, so it is not answered here.

## What changed

### `memnox scan --since <when>`
The same scan, compared against the last one this machine kept. Part of `scan`
rather than a command of its own, because a person who has just seen what can act
here asks what changed next, and two commands for one question is one of them
going unrun.

| Flag | What it does |
|---|---|
| `--since <when>` | compare against the last scan at or before then |
| `--from` / `--to` | compare two kept scans |
| `--fail-on <gate>` | `any`, `write-capable` or `credential`; non-zero exit for CI |

A narrowing never trips `--fail-on`. It needs no account, no network and no
baseline anybody had to remember to take, because every saved scan records one.

### `memnox watch`
Reports what arrived: new servers, new write tools, credentials that became
reachable, agents that updated themselves, and a harness that gained a role, a hook
file or a federation link — which arrives without any config a client reads changing. It wakes when an agent's
configuration changes, so a server added mid-watch shows up in seconds; the
`--interval` is the backstop, not the mechanism.

## Rules

### `memnox protect`
Proposes reversible steps by default and prints the undo before it runs anything.

| Flag | What it does |
|---|---|
| `--apply` | write the proposed steps |
| `--revert [id]` | undo one, or all of them |
| `--observe` / `--enforce` | set the mode |
| `--apply-native` | also write the rules into Claude Code's own permissions |
| `--revert-native` | take ours back out, leaving theirs |
| `--for <name>` | write rules for one CLI or MCP server only |
| `--from-usage <window>` | draft ask rules for what was granted and never used |
| `--ask <action...>` / `--deny <action...>` | write a rule you decided here; on an enrolled machine the next sync offers it to your team as a proposal a second admin approves |
| `--interceptors` | install the PATH wrappers for every CLI this machine has |
| `--hooks` | install `pre-push` and `pre-commit` in this repository |
| `--claude-hook` | make Claude Code take a lease before it writes a file |
| `--revert-claude-hook` | take that hook back out of Claude Code |
| `--project-hook` | put that hook in this repository's own `.claude/settings.local.json` too, which a Claude Code started by a harness with project setting sources only still reads |
| `--revert-project-hook` | take the hook back out of this repository |
| `--managed` | move Claude Code's hook into its managed settings, where no local config can remove it |
| `--revert-managed` | move it back into your own settings |
| `--exclusive` | with `--managed`, run only managed hooks, so none a repository ships can |
| `--vscode` | install the extension that lets the voice show the exact VS Code, Cursor or Windsurf terminal a session runs in |
| `--revert-vscode` | take that extension back out of those editors |
| `--os-guard` | write the kernel sandbox profile from your filesystem rules |
| `--interactive` / `--yes` | walk the domains, or take the recommendation |

`--interceptors` wraps only binaries that are actually installed: a shim for an
absent `aws` would answer `command -v aws` and send every script that checks for
it down the wrong branch. `--os-guard` is a second line under them, so a denied
path stays unreadable even to a binary that never saw a wrapper — and any pattern
the kernel cannot express as a literal subpath is printed rather than dropped.

### `memnox check "<intent>"`
Decides before the loop starts rather than interrupting it half an hour in. The same
engine, the same rules and the same state, run against the actions an intent resolves
to, with nothing executed. Exits non-zero when something would stop.

A command line is resolved exactly. A phrase resolves to every action it could mean —
"deploy payments" is railway, vercel and kubectl until somebody says which — and what
it was read as is printed, so a wrong reading is visible rather than mysterious.

### `memnox policy check [file]`
Reads every rule file this machine would load and says what is in force, what
moved and what will not parse. Without a file it checks the whole registry.

| Flag | What it does |
|---|---|
| `--prune` | forget registered paths that are no longer on the disk |

Exits non-zero when a file is broken, so a CI step can run it.

### `memnox why`
Prints the rule, where it is declared, the reason and the alternative — and, for a git
action, what this repository already says about itself: branch protection, CODEOWNERS,
and whether the open pull request is approved and its checks are passing. All of it is
read-only through a CLI you are already logged into, and anything the forge did not
report is said as unknown rather than guessed at.

What Slack, the ticket tracker and the calendar say is not here and is not coming: that
needs a token on every laptop. It is the cloud's half of the same question.

### When a session is paused
An agent that retries the same failing command is stopped by the circuit breaker, and
the seam does it in process — there is no daemon to install and no counter to keep:

```
Paused by Memnox: npm.run has failed the same way 5 times; retrying it again will
fail the same way. Nothing further will run until a person looks at it.
A person can lift it with: memnox resume ses_overnight --by <them>
```

The **session** stops, not the command: the next thing that session tries is refused
too, because an agent that keeps working around a stopped loop is the thing being
stopped. `memnox resume <session> --by <you>` lifts it and the work continues.

The trip is reported after the action that caused it and enforced on the next one. The
action that tripped it has already run; holding it at that point would be a receipt
rather than a control.

### `memnox next --role <name>` / `--roles`
A rule about a product is wrong the moment the team adopts a second one; a rule about
the job survives the tool being swapped underneath it. `--role` evaluates the boundary
as that job, so a `roles:` rule fires:

```
DEPLOYER — WHAT THIS JOB MAY DO
  a job, not a product — whichever agent is enrolled under it
```

`--roles` lists every job the rules name and what each may do, which is the question a
workforce raises — not "what may this binary do" but "who is allowed to do what":

```
  coder       5 on its own    0 asked    2 never
  deployer    3 on its own    0 asked    2 never
  tester      4 on its own    0 asked    2 never
```

Both are produced by asking the engine action by action, so what is on screen is what
will happen rather than a summary of what the rules intend. Enrol an agent with
`memnox run --role deployer -- <agent>`, and state the mission with `--task`.

A role is read from the rules, never from a roster: a job nothing has a rule about is a
name somebody typed once, and listing it would suggest it governs something.

### `memnox doctor --prove`
Asks every seam to refuse something, and reports what came back. It plants a rule in a
scratch directory, attempts the thing the rule forbids through the MCP proxy and the
shell interceptor, and says whether the action was actually stopped.

```
  mcp         enforced      a forbidden tools/call was refused
  shell       enforced      a forbidden command was refused
  git         unproven      a hook is installed; proving it needs a real push
  filesystem  absent        no kernel profile, so a raw binary is not stopped
```

`--wiring` reads the configuration; `--prove` runs the action. The two answer
different questions, and the gap between them is where this product fails worst: a
proxy that is installed, routed, and loading no rules reports perfectly on the first
and fails the second.

The probe runs with **no `MEMNOX_POLICIES` set and its own `HOME`**, because that is
what an agent has: an editor opened from a dock icon carries no environment. A probe
that exported the variable would prove a seam *can* refuse rather than that it *will*.

**Absent never fails the command.** A machine with no egress proxy has declined the
test, not failed it, and going red for that teaches people to stop running the check.
Only a seam that was in place and let the action through exits non-zero.

### `memnox policy use [file]`
Registers a rule file, so every seam loads it. Writing `memnox.policies.toml` makes it
testable; registering it makes it enforced. `protect --apply` registers what it writes,
so this is for a file you wrote by hand.

`doctor --wiring` reports a readable rule file that nothing has registered as **broken**,
not ok: `policy test` answering DENY while every seam allows the same action is the one
state a health check must never print a clean number about.

### `memnox policy test "<action>"`
Dry run. Prints the effect, the reason, the rule and the alternative. Exits non-zero
on anything that is not an allow, so it works in a hook.

### `memnox freeze [subject]`
Stops external-state actions for a while. Every freeze carries an expiry: one
that outlives its incident is worse than none, because the next one gets
ignored.

| Flag | What it does |
|---|---|
| `--for <window>` | how long, e.g. `2h` or `3d`. Defaults to two hours |
| `--reason <text>` | what the refusal will say |
| `--lift` | end it early; it stays in the record rather than vanishing |

### `memnox config`
`get`, `set` and `list`. Settings: `mode`, `retentionDays`, `failOpen`, `telemetry`.

## Calls waiting for a person

### `memnox approvals`
Calls held for somebody to answer. A hold written to disk is what lets a second
terminal — and later a platform lead in Slack — release something the first
terminal is still waiting on.

### `memnox approve <id>` / `memnox deny <id>`
Answers one, or `--group` to answer for every waiting call of the same kind.

**An `ask` rule now holds rather than denies.** The seam writes the question to
`~/.memnox/pending` and waits for whoever is actually there: the terminal, if
there is one; a second terminal running `memnox approve`; or the workspace,
whose answer arrives on the machine's next heartbeat. Nobody answering is a
timeout, said differently from a refusal, because a walk-away must not become a
yes — and the wait is bounded, so it cannot hang the agent either.

That last route is what makes an agent on somebody else's hardware answerable.
A question raised on a VPS at three in the morning is carried up on the
heartbeat, appears in the workspace's queue, and the answer comes back on the
next beat. Names only cross the wire: the operation and what it is about, never
the arguments.
Answers one. First answer wins; a second is told what already happened rather
than shown a failure.

### Answering from chat

After setup, the answer to a waiting call does not need a terminal or the
console. The question is posted in the team's Slack or Discord channel with
**Allow once**, **Allow for this session** and **Deny**, and the first answer
from any of those places wins. The same channel carries the other decisions a
person is asked for: freeing lines another agent holds, acknowledging or
resolving an incident, approving a decision, verifying a fact, approving a
policy change. What a person decides without being asked is typed there too:

| Command | What it does |
|---|---|
| `/memnox waiting` | how many agents are waiting on a person |
| `/memnox tell <agent> <message>` | a note the agent reads at its next step |
| `/memnox freeze 2h [why]` / `/memnox unfreeze` | stop agents shipping until then, or lift it |
| `/memnox approve-agent <agent>` | let a new agent out of shadow |
| `/memnox mode <machine> observe` | change how a machine is governed |
| `/memnox revoke <machine>` | cut a machine off |

A press or a command counts only from a chat account linked to a person with
the role the action needs. Slack accounts are linked from Slack's member
directory when Slack is connected; the console's chat settings say how many
members can act from chat, and where the Slack and Discord apps should point.

## Running an agent

### `memnox mcp wrap` / `unwrap`
Repoints every MCP server at the proxy, backing up each config first. `unwrap`
restores byte for byte. `--dry-run` changes nothing.

It reads the Claude Code, Claude Desktop, Cursor, Cline, VS Code and OpenClaw configs
in your home directory, plus `.mcp.json` in the directory you are standing in — which
is where Ruflo registers its own server.

It reads Codex's TOML and Hermes' YAML too. Those two are **edited a line at a time**
rather than reserialised: only `command` and `args` change, and every other byte —
comments, key order, quoting style, block lists — is copied through, so `unwrap`
returns the file byte for byte as its author left it.

A server declared by URL has no launch line to repoint, so it is named and left alone
rather than turned into a command that would not start.

`--managed` writes `/Library/Application Support/ClaudeCode/managed-settings.json` on
macOS or `/etc/claude-code/managed-settings.json` on Linux. Memnox never runs as root:
where the file needs it, the merged file is staged under `~/.memnox/managed` and the
`sudo install` line is printed. Run `--managed` again once it is installed, which is when
the copy in `~/.claude/settings.json` comes out, so no moment passes with neither in
place. Codex has no managed hook file Memnox knows of, so its hook stays user level.

### `memnox run -- <command>`
Starts an agent with the interceptor directory first on `PATH`, `SHELL` pointed at the
governed shell, and a session id. Hands back the agent's own exit code. When
`protect --os-guard` has written a profile, the agent starts inside it.

| Flag | What it does |
|---|---|
| `--shell <path>` | the shell the agent should use |
| `--transcript` | keep a local copy of what the agent printed |
| `--no-guard` | start outside the kernel sandbox even when a profile exists |
| `--untrusted` | a repository nobody here vouched for: see below |
| `--hold-credentials` | keep tokens out of the agent's environment and hand each only to the CLI that uses it |
| `--brief <id>` | hand the agent a workspace brief the voice gathered before its first turn: the ticket, what was said about it and the decisions it must keep to |

**`--hold-credentials`** starts the agent without any variable that looks like a
credential, except its own model key, and keeps them in the `memnox run` process, in
memory only. When a fronted CLI is allowed to run, its interceptor asks that process
for the variables the CLI's verb table names (`gh` gets `GH_TOKEN`, `aws` its `AWS_*`
pair) and nothing else; `curl` and anything unmapped get nothing. So `env` and a
prompt-injected `curl -d "$(env)"` find no token. It takes the token out of the
environment and is not a vault: a process of the same user that speaks the broker's
socket on purpose can still ask. A tool nothing fronts, such as a script calling an SDK,
starts without the token too.

**`--brief <id>`** is what the voice adds when you ask it to start an agent on a ticket. It
puts the id in the agent's environment, and the agent's own session start hook reads the
brief from this machine and adds it to the agent's context, so the agent begins knowing the
ticket read whole, every message and document that names it by its title, its key or its
link, with the documents and any cut message read whole too, and the settled decisions that
bind it. It is told to stop and ask where they disagree, to write the change the way the
repository already writes code, and to check the work against every point the ticket asked
for before it says it is done. Full text comes through the workspace's `memnox_source`, at
the same clearance as everything else a machine reads. Only an
id the voice made is accepted. The same brief stays readable through the `work` session tool.

The governed shell obeys the shell contract: `$SHELL -c "<line>"` is what an
agent's Bash tool calls, and every command in that line is ruled on separately,
so `gh pr merge && vercel deploy` is two rulings rather than one opaque string.


Declare what you asked for and it becomes enforceable: `--task "<statement>"`
with `--paths`, `--repos`, `--services`, `--envs` (comma separated) lets a rule
match on `scope`, and `--expect <count>` is what an action explosion is measured
against. `--role <name>` is the job the agent is enrolled under, matched by a
rule's `roles:`, and `--for <person>` is the person it works for, matched by a rule's
`principals:`, so an agent on a shared credential never does what its person may not. A session that declares nothing is *undeclared* throughout,
never in violation — nothing is inferred.

**Writes stay in the repository.** A write or delete outside the repository the session
started in asks first, whatever the rules allow, and so does one outside the paths
`--paths` declared. Temp is exempt. Reads outside are governed by your rules as before.
The same boundary holds for an agent that was only hooked: the edit hook asks in Claude
Code, where its person sees the prompt, and refuses with the reason in Cursor, Codex,
Gemini CLI and Windsurf, which cannot ask. Claude Code in `auto`, `dontAsk` or
`bypassPermissions` shows no prompt a hook can rely on, so there it refuses too. A
refusal tells the agent that a yes in the conversation allows nothing, since Memnox never
sees it, and that the same write made another way is the same write; the person allows
it from a mode that shows prompts, or makes the change themselves. A hooked agent's shell
commands meet the boundary only where the command names what it writes. A redirect,
`sed -i` or a script run through an interpreter writes a file the shell seam cannot see,
so a hook alone does not hold those writes today.

**The network goes through the egress proxy.** The agent is started with `HTTP_PROXY`,
`HTTPS_PROXY` and `ALL_PROXY` pointing at the daemon's proxy (its own when no daemon is
running), `NO_PROXY` for loopback, and `NODE_USE_ENV_PROXY=1` so Node's own `fetch`
obeys too. Every request is ruled on by host, written to the ledger with the host only,
and entered in the agent's destination record. What the proxy does not see:

- anything that ignores the proxy variables, since outside `--untrusted` nothing forces it;
- an agent started from the desktop or a dock icon, which inherits no environment from
  `memnox run`. It goes through the proxy only if its own settings name one;
- the body of an HTTPS request, where only the destination is known;
- which agent sent a request, beyond the session its proxy URL declares.

**`--untrusted`** is the preset for a fresh clone of somebody else's repository. Writes
reach only the repository, temp and the agent's own state; the Memnox rules, the trust
given and the answers to held calls stay unwritable inside it. Credentials and home
dotfiles are unreadable. TCP reaches only this session's own egress proxy, where package
registries and the agent's model provider go through and every other host asks. Every
outward or destructive action asks. On macOS seatbelt holds all of it. On Linux Landlock
holds the files, and holds TCP from ABI 4 (Linux 6.7); the ruleset is applied by a small
`python3` helper, and the start screen says plainly when the kernel, the helper or the
ABI is missing. Where no kernel can hold the wall the run refuses to start, and
`--no-guard` runs it with only the seams asking. Held calls are answered from files the
agent must not be able to write, so a shell command inside the wall that would ask is
refused with its reason instead; a request the proxy asks about is raised outside the
wall and answered with `memnox approvals`, and a file edit asks in the agent's own prompt.

When a run starts in a repository nobody here has worked in (no commit of yours, not
one the seams have seen, no matching origin), it prints one line suggesting `--untrusted`.

### `memnox agents trust <agent>` / `memnox mcp trust <server>`
An agent the daemon adopted, or an MCP server it wrapped, starts **on probation for seven
days**: its writes, outward and destructive actions ask whatever the rules allow, and
its reads do not. The notice that announced it says so, and `memnox status` lists what
is on probation and until when. `trust` ends one now, on the record. A probation that
was served or ended is never started again because a config was rewritten.

### `memnox agents pause <agent>` / `memnox agents resume <agent>`
Stops one agent on this machine, every session of it, and leaves every other agent
working. The agent is named the way a person says it (`codex`, `Claude Code`, the name
you gave it), and a name that fits two agents is refused with both named. The pause is a
local freeze the gate reads on the very next call, so it bites before any heartbeat, and
the agent is told a person paused it and to wait. When this machine is enrolled and you
are signed in with `memnox signin`, the same freeze is declared to the workspace scoped to
this machine, so teammates see it; a workspace that cannot be reached never undoes the
pause here. It lifts itself after a day. `resume` lifts it here and every workspace freeze
on that agent this machine knows of, and says so when the workspace still holds one. By
voice, "pause Codex" happens at once, and letting it carry on waits for Touch ID.

### `memnox daemon`
Holds the rules in one process so an interceptor pays a connect instead of a file
read. Optional: an interceptor that cannot reach it evaluates in process instead.
It also runs the egress proxy on a free loopback port the system picks, so it never
takes a port another tool expects. `memnox run` reads which one from the daemon. The
proxy is bounded in connections and idle time, and starts and stops with the daemon.

## What happened

### `memnox timeline`
| Flag | What it does |
|---|---|
| `--session` / `--agent` | narrow to one |
| `--since <when>` | `30m`, `2h`, `7d` or an ISO timestamp |
| `--only <effect>` | `allow`, `ask`, `deny` or `blocked` |
| `--export <format>` | `jsonl` or `json` |

### `memnox why [id]`
The last thing that did not simply proceed. `--allowed` for the last allow,
`--evidence` for the digests and the outcome. Read back from the row, never
re-evaluated against today's rules.

The **Context** block reads the action against everything that decided it, one row
per part: `person` (who the agent worked for, from `memnox run --for`), `agent`,
`intent` (the declared task), `tools` (what the call did), `systems` (where it landed
and what was in force there) and `history` (what this agent had never done before, and
what the session did on the way). A part marked `(decided)` is why the verdict came out
the way it did, so the same DELETE reads as refused for who the agent worked for in one
row and as new for this agent in another. A part with nothing recorded says so, since
"no task was declared" is not the same as "inside the task". `--json` carries it as
`context`.

```
Context
  person   working for tier1-sam; rule only-a-dba-deletes on who the agent works for  (decided)
  agent    support-assistant
  intent   no task was declared, so nothing was compared
  tools    mcp.query, a write call
  systems  on support-db
  history  nothing about it was new
```

### `memnox rewind`
Puts the working tree back to before an agent touched it. A milestone is a tree object
under `refs/memnox/` — never a commit, never a branch, never the stash — and a rewind
takes its own milestone first, so what it replaced is still reachable.

| Flag | What it does |
|---|---|
| `--list` | the milestones there are |
| `--to <id>` | a particular one, rather than the last |
| `--take` | keep the tree as it is now, restoring nothing |
| `--note <text>` | what this milestone is, for the listing |
| `--forget [keep]` | drop all but the newest few; the newest is never dropped |
| `--session <id>` | back to before that session first changed anything |
| `--last` | the same, for the session whose milestone is newest |

It moves files and nothing else, it leaves ignored files alone, and it refuses outright
mid-merge or mid-rebase — a restore there would write over the state that says how to
finish. `memnox run` takes one automatically unless you pass `--no-milestone`.

Agents started without `memnox run` are covered too. The editor hook keeps a milestone
before a session's first write in a repository, and the shell seams keep one before a
command that destroys work: `rm`, `rm -r`, `git reset --hard`, `git clean`,
`git checkout -- .`, `git restore .` and a `mv` of three or more paths. The first write is kept once per
session and repository, a destructive command at most once every twenty seconds per
session, and every milestone is labelled with its agent, session and reason, which
`--list` shows. Only the newest twenty are kept in a repository. The marks that remember
which sessions already have one live in `~/.memnox/checkpoints.json`, so a hook that owes
nothing starts no process, and every git call goes to the real git rather than the
interceptor on PATH. A milestone that cannot be kept is logged and never stops the agent.

### `memnox replay [session]`
One session step by step, in the order it happened: every action with its surface,
operation, target and verdict (and what enforce would have said while it was observed),
exit codes, breaker trips and who resumed them, holds still waiting, and the milestones
kept for it. The five actions right before a failure or a breaker trip are marked with
`>` and carry their reasons and the id `memnox trace` opens. No session, or `--last`,
means the most recent one; `--json` prints the replay itself. It is read from the
ledger, the pause records and the repositories the session kept milestones in, so it
works long after every process involved has gone. A hold that was answered is visible
only where its row names who allowed it, because an answered hold is cleared from disk.

### `memnox trace <id>`
One action end to end: the command, the rule that governed it, the exit code, the
duration and the argument digest. When the session kept a transcript, the tail of what
it printed. An id prefix is enough.

### `memnox traces [id]`
What ran, inside what, for how long, and what failed, drawn as a waterfall the way
Logfire draws one. Two kinds of trace live here:

- **An agent's session.** Name a session id and every turn the person gave it, and
  every action inside with its decision, duration and exit code, comes back as a
  tree. It is built from the ledger, so every session ever recorded has one.
- **Memnox itself.** Each question to the voice is traced as it is answered:
  waiting for the end of what was said, building the session list, the brain's turn
  and how soon its first word came, each tool it called, and speaking the answer.
  `last` opens the most recent.

With no id it lists the recent traces of Memnox itself. `--json` for the spans.
`--otlp [endpoint]` sends the trace as OTLP to Logfire, Honeycomb, Grafana Tempo or
any OpenTelemetry collector, reading `OTEL_EXPORTER_OTLP_ENDPOINT` and
`OTEL_EXPORTER_OTLP_HEADERS` when no endpoint is named, with `--header key=value`
for anything else. Nothing leaves the machine unless you ask for it this way, and
what is sent is names, timings, decisions and paths, never output or what was said.
Traces are kept locally for seven days.

### `memnox collisions`
Two agents in one file, and two agents building one thing. `--since <when>` to
narrow the window.

### `memnox lock [path]`
Holds a path while you work on it, so a second agent waits instead of writing
over you. `--list` shows every lease on this machine, `--for <duration>` sets
how long, `--release <id>` lets one go early, `--forget` drops the records of
leases nobody holds.

It holds exactly the path you name, and the lease belongs to your shell rather
than to the command — so it is still there when you run the next one, and it is
released when that shell is gone.

Four rules keep this usable rather than a thing people turn off:

- **It locks paths, never meaning.** A write claims the directory it lands in,
  compared on segment boundaries — `src/billing` holds `src/billing/invoice.ts`
  and does not hold `src/billing-legacy`.
- **A lock never blocks a read.** Only write-class and destructive actions take
  or wait on a lease. Nothing here can make a reader wait.
- **Every lease expires**, and a holder whose process is gone is reclaimed
  rather than waited on.
- **A wait is always bounded.** When a path is held you are offered `[w]` wait,
  `[t]` take it anyway with a reason, `[d]` don't. A timeout is a refusal that
  names the holder, and taking it anyway is a row in the record, never a silent
  allow.

Worktrees and clones of one repository are one repository here. A lease is kept
relative to its checkout and also names the project every checkout of it shares: its
`origin`, or with no remote the git directory its worktrees have in common. So an agent
in `api-feature/` writing `src/billing.ts` waits on the one already writing it in `api/`,
and the refusal names the other checkout. This is the rule the workspace register
already used across machines; this machine now agrees with it.

The seams take a lease on their own: a session writing ten files in one
directory holds one lease, not ten, and `memnox run` releases everything the
session held when the agent exits — including when it crashed.

**Work that writes no path takes a claim instead.** Posting the message,
opening the issue, restarting the service: the MCP proxy asks the workspace
before it forwards one, and is told either that another agent is about to do
that exact thing or that one is already working on that same issue, page or
event. Both name who and on which machine, and neither is refused by the
workspace: the proxy is what stops the repeat, and the people who started both
agents are written to. Only what changes something outside is claimed, so a
read never waits. `memnox setup` wraps the servers, which is what puts the
proxy in front of them, and writes into each wrapped line which agent it
belongs to, so a refusal names Claude Code or Cursor rather than "an agent".

The shell asks the same register. A command the PATH wrappers run that writes,
deletes, messages, or sends a body over HTTP is claimed by its exact line, and
`gh pr` and `gh issue` name the pull request or issue the way the proxy does,
so `gh pr close 12` on one machine meets `close_pull_request` on another. A
channel or a repository is never the thing claimed: two different messages to
one channel, or two new issues in one repository, both go through.

Claude Code's Write and Edit tools write from inside the agent and pass through
no wrapper, so they take theirs through a hook instead, and so do Codex, Cursor,
Gemini CLI (`~/.gemini/settings.json`) and Windsurf (`~/.codeium/windsurf/hooks.json`).
Windsurf reads nothing back from its hooks but a refusal, so its notes reach it
through the MCP proxy, and it has no session end, so its holds lapse on the idle
window.

**Everything else is watched.** OpenClaw, Hermes, any agent with no hooks, and a
person in their own editor run nothing before they write, so the daemon watches
the repositories agents here work in and claims the lines a saved file changed, a
moment after the save. It cannot stop that save, and says so: another machine
reaching for those lines afterwards is stopped, and where another machine already
had them, a desktop notice says so here and the other side is told the change was
saved, not stopped. Editors' scratch files, generated folders and anything git
ignores are left alone, claims are capped per minute, and a change a hooked agent
here already claimed is skipped. A watcher's claim never stands in the way of an
agent on its own machine. `setup` adds the repository it runs in to the list, and
every seam adds the ones it sees.

`memnox setup` installs the one hook wherever each of them is: Claude
Code's settings, `~/.codex/hooks.json` for Codex's `apply_patch`, and
`~/.cursor/hooks.json` for Cursor, before a write and just after one, since
Cursor's write tool does not always say what it is about to change. Each is
refused in its own words, and `memnox protect --claude-hook` still does Claude
Code by hand. Some Codex releases ignore a hook's refusal of `apply_patch`
([openai/codex#27833](https://github.com/openai/codex/issues/27833)); the lines
are still claimed there, so the other machine is stopped and both people are
told.
An editor claims the one file it writes rather than its directory, so two
sessions in one folder only meet on the same file. The hold lasts five minutes
and is renewed after each tool call the session makes, so an agent that keeps
working keeps its lines and one that goes quiet lets them go; a refusal on lines
whose holder has gone quiet says so, and says when they free up. Across machines it claims
less than that: the hook reads the lines and the function the edit is about to
change from the edit itself, so two agents on two computers in one file only
meet where their edits do, and the one that is stopped is told which lines are
taken and that the rest of the file is free. A held file is waited on for five
seconds, then refused with the holder named, and the lease goes when the
session ends. The people who own both machines are mailed, and the team's
channel is told.

**A person decides where they already are.** When Claude Code is refused lines
another machine holds and a person is at the session (the Manual, accept-edits
and plan modes), it is not refused: the person is asked, in Claude Code's own
permission prompt, whether to take those lines over. Yes lets the edit through,
takes the lines over on the record with why, and the agent that held them is
told in its own session. An unattended session, and every agent that cannot ask
its person, is refused as before and names `memnox lock --free` for a person to
run. A note about a collision is also put on the person's desktop as their agent
reads it, since they are usually in another window.

**Built not to get in the way.** A session asks for notes at most every ten
seconds, alongside renewing what it holds, so a burst of tool calls is not a
burst of requests. At the end of a turn only a person's note makes the agent
carry on; a note Memnox wrote about a collision waits for the agent's next tool
call or the person's next prompt instead of waking an agent that had finished. A
refusal is two sentences and ends on the one thing a person can type to step
in, `memnox lock --free <id>`, which frees another machine's hold on the record
with a reason. It asks for confirmation and runs only in a terminal, so the
agent that was refused cannot run it on itself.

**A session is told, and seen, while it works.** The same hook runs after
every tool call and when a turn ends, in Claude Code, Codex and Cursor, and the
MCP proxy does the same for an agent with no hooks. At each of those pauses it
collects what was said to that session in the workspace and hands it to the
agent: beside the tool result, or, at the end of a turn, as the next thing to
work on. Two kinds of note arrive this way. When another agent collides with
lines or an action this session holds, Memnox writes one, so the agent that got
there first hears of it in its own session. And a person can write one through
`POST /v1/workspaces/:ws/agents/:agent/control/commands`, naming a `session` to
reach just that one. Each note is handed over once and recorded with who wrote
it. What the agent did at that call, names and paths only, is written to the
ledger and sent within a couple of seconds rather than on the next heartbeat.

A claim on outward work lasts as long as the work. The proxy renews it every
ten seconds while a call is out and finishes it the moment the call returns,
so the thing is free again at once. An identical action still counts as a
repeat for ten seconds after it returns, which is what catches two agents
reacting to one trigger a second apart, and a claim left by an agent that died
lapses within thirty.

When the machine is enrolled, the workspace's register is consulted too, so two
machines on one repository stop being a coin flip. It makes no call at all
without an account, and an unreachable control plane never stops a write: a
lease is coordination, not safety, and one that blocked work whenever the
network hiccuped is one people would turn off inside a day.

### `memnox next`
What you could safely stop being asked about. Reads the approval history and
names the things a person has already said yes to often enough that being asked
again is the tool wasting their attention. `--since <window>` to widen it.

Three rules keep it honest. One refusal is enough to stop a recommendation. A
destructive or outward action never rises past *supervised*, however routine it
became. And the ladder position is read off what is actually configured and
seen, not off what the config claims — an install that says *autonomous* while
asking about everything is telling you a story about yourself.

It prints counts, never hours. "Six hours a week you could get back" is a number
nobody can check, on a screen you are being asked to act on.

A handed-over rule allows what was approved and no more. It names the targets the yeses
were about, so a push approved on `feature/a` five times is allowed on `feature/a`, never on
`main`. An action is judged by the widest class it was ever recorded under. One approved on
a target a rule would read as a pattern, or across more than twenty targets, stays a
question with that reason beside it, since no single rule could allow it without allowing
more than was said yes to.

### `memnox next --agent <name>`
What that agent would do on its own, in three bands: runs on its own, waits for
you, never. Under `next` rather than beside it, because it answers the same
decision from the other side: bare `next` reads the ledger backwards for what
has already been approved often enough to hand over, and `--agent` reads the
rules forwards for what would happen if you did. Every line is the verdict the engine actually reaches for that
action, asked one at a time — a screen that summarised the rules would be the
one you trust most and the one most likely to be subtly wrong.

Capabilities no rule covers are counted separately and never filed under "runs
on its own". It refuses to call a boundary ready when something destructive
would run unasked, or when more of what the agent can do is unruled than ruled.

### `memnox autopilot`
What the daemon handed each agent on its own record, and the way to take it back.
It is off until a person runs `memnox config set autopilot true`, and an agent can
never turn it on or run `next --hand-over` itself.

Once it is on, the daemon reads the last thirty days of the ledger every pass and,
per agent, hands over exactly what `next --hand-over` would offer: an action that
agent was asked about and approved at least five times, with no refusal, never
destructive or outward, on the targets it was approved for and none named like
production. The grant is an allowance for that one agent, for seven days, so it
only answers a question a rule would have asked and never overrules a refusal or a
workspace ask. One refusal of that action for that agent takes it back on the next
pass. Every grant and every revocation is a row in the ledger and a notice on the
desktop naming the command that undoes it. `--revoke <id>` takes one back now.

### `memnox unattended [--agent <name>] [--json]`
Whether an agent can be left running, as one screen: how many of its actions run
on their own, wait for you, never happen or have no rule, and then every reason
not to walk away yet, in the order to deal with them. Observe mode comes first,
since nothing below it would be stopped; then something destructive running
unasked, calls waiting on you, paused sessions and spent budgets. Each line is a
count or a fact, never a score.

### `memnox voice` / `memnox voice forget-key`
`memnox voice` shows the key the Mac app signs its confirmations with: when it was
registered and how it ends, never the whole of it. The first key to register is
trusted and the daemon never replaces it, so `forget-key` is how a person clears it,
for a new Mac or a reinstalled app. It asks first and defaults to no, because the next
key to register is the one trusted; open the app straight after. An agent is refused
it, like every command that loosens what agents may do.

### `memnox voice address [words]`
How the voice addresses you, such as `sir`, `ma'am` or your name, said the way
J.A.R.V.I.S. says it: now and then, at the end of a sentence. Nothing is guessed, so
with none chosen it uses no form of address at all; `--clear` goes back to that, and
with no words it says the current one. You can also just tell the voice, "call me
sir". It applies from the voice's next conversation.

### `memnox ask "<anything>"`
Ask about your agents in your own words, and get the answer your voice would
hear. The words go whole to your own Claude Code, logged in as you already are,
started with every built-in tool switched off and one MCP server,
`memnox-operator`. Memnox holds no model credential, and there is no keyword
matching between what you say and what happens.

`memnox-operator` reads the machine: every session lately (`sessions`, so two
Claude sessions are two rows and it asks which you mean), what is waiting on you,
whether an agent can be left, why something was refused, a session step by step,
and what a session changed in the code since its first write (`changes`, read
against the milestone taken before that write). It writes nothing but proposals.
A refusal of a held call takes effect at once; anything that lets something
happen, an allow or a new rule, waits for Touch ID on the Mac. It is never
registered into a working agent's own session.

It also speaks when something happens, through the daemon's `brief`: a held call is told
with what its session has been doing and why it needs you, a paused session with where it
got stuck, and when you come back to the Mac after a while, what finished, what got stuck
and what is waiting. It speaks to you by the name you gave the Mac app.

The conversation stays warm between questions and resumes for thirty minutes, so
"and the other one?" works. A plan that has run out says so rather than going
quiet. Cursor is not a brain: `cursor-agent -p` has write and shell access with
no way to narrow it.

### `memnox report`
What your agents did in a window and what of it was redone: actions, succeeded,
failed, blocked, held, and where the same work went twice.

Spend is whatever something else reported through `EventCost` and nothing else.
A window nobody reported a cost for says so instead of showing `$0.00`, because
a reassuring zero on a screen about money is worse than an absence. Memnox
prices nothing: a model call's cost is knowable to the agent and to nobody else
on this machine.

### `memnox budget`
How much an agent may do in a window, as against what it may do. `budget set
<name> --actions <patterns> --limit <n>` writes one, `--window day|hour|session`
and `--unit calls|usd`, `budget suggest --yes` writes a generous starting set,
`budget remove <name>` drops one. Counted from the ledger, so it survives a
restart and cannot be cleared by killing something.

Only what actually ran is charged: an action the rules refused never reached a
terminal, and charging for it would let a strict policy exhaust the budget it
was protecting. A `usd` budget counts only cost something else reports.

A budget can be counted across the fleet rather than on one machine — three
VPSs each allowed twenty pull requests a day is sixty, which is not what anybody
set. The workspace's total arrives on the heartbeat and is added to what this
machine has counted itself, so a control plane that cannot be reached degrades a
fleet budget to a machine budget rather than to no budget at all.

### `memnox paused` / `memnox resume <session>`
Sessions the circuit breaker is holding, and lifting one. The breaker watches
outcomes rather than requests, and holds a session on five identical failures,
eight failures in a row with nothing succeeding between them, an action count
far past what the task estimated, five actions outside the declared task, or a
spend ceiling. A pause names the count that produced it and says how to lift it:
a stop nobody can argue with or undo is one people work around by uninstalling.

### `memnox skills`
What your agents run on beyond their config, treated like deployments: skills
they wrote for themselves, and definitions somebody installed into them.
`--accept <name>` records that you have looked.

Two things are held. A skill or definition whose reach has grown since you
accepted it — yesterday it edited files, today it also names `kubectl`, or it
named four tools and now names none. And a roster that arrived all at once:
twelve or more new definitions in one directory is an install rather than
somebody's own work, and it is shown as one row with a count, never as three
hundred.

The count that matters is on that row. On Claude Code, Qwen and ZCode a
definition file with no `tools:` key inherits every tool in the session — the
shell, writes, and every connected MCP server — so an absent key is the widest
grant on the machine and not the narrowest. Public rosters run to hundreds of
files and almost none of them set it.

Two claims, kept apart. What a file *declares* is read out of its own header and
stated as fact. What it *names* is a match against the verb tables: evidence it
may use a tool, never proof that it does, and the screen says so.

### `memnox claims [session]`
What the agent said it did, against what the record says it did. Reads the
transcript from `memnox run --transcript`, or `--file <path>`. `contradicted` is
the one that matters: it ran, it failed, and somebody was told otherwise.
`unsupported` means nothing here recorded it, which is very often work done
somewhere this machine cannot see — never a finding of dishonesty.

### `memnox env`
The environment an agent needs when something other than `memnox run` starts it:
systemd, a container, a cron line. `--format sh|systemd|docker`, `--shell`,
`--session`.

`PATH` is expanded before printing for systemd and Docker, because neither runs
a shell — a literal `$PATH` in a unit file would make the interceptor directory
the whole path, which is an agent that can run nothing at all. Nothing here
edits a unit file.

### `memnox purge`
Drops history past `retentionDays`. `--dry-run` says what would go.

## Connecting to a workspace

Optional, and off until you run it. Everything above works with no account, no
network and no key; this section is the only part of the runtime that talks to
anything, and it does nothing at all until `memnox login` has succeeded.

### `memnox login`
Connects this machine to a workspace, so it gets the rules that workspace
publishes. It opens the approval page in a browser and waits for somebody with
access to approve it there. **Nothing has to be typed:** the link the control
plane sends carries the code in it, so approving is one click on a page that is
already showing what is being granted.

Underneath it is a device-code flow, and the code shows on screen in the two
cases where a browser is not enough: no browser could be opened, which is an
ordinary CI runner, container or SSH session, or the control plane named no
console and the address is this CLI's guess. Then somebody types the eight
characters into a console they open themselves.

**The control plane says where the approval page is**, in the `verificationUri`
of its answer. It has to: `--url` names an API, and on every deployment with a
console those are two different origins, so a page derived from the API base is
a page that does not exist. A control plane too old to say gets the derived
address as a fallback, which is right only where the two share an origin.

| Flag | What it does |
|---|---|
| `--url <base>` | the control plane, default `https://api.memnox.com` |
| `--enforce` | start in enforce rather than observe |
| `--no-open` | print the code and the URL instead of opening a browser |

It writes `~/.memnox/account.json`, owner only: the workspace, a machine id, a
token scoped to this machine, and an Ed25519 private key generated here. **The
private key never leaves.** Anything that can read that file can act as this
machine, which is why it is `0600` and why `memnox logout` exists.

### `memnox logout`
Forgets the credential. Rules already pulled stay in force, because a machine
that silently stopped being governed the moment it lost its token would be a
worse failure than one that keeps the last rules it was given.

### `memnox sync`
Pulls the rules the workspace publishes and sends what happened. It runs on the
daemon's heartbeat, about once a minute, backing off to fifteen minutes while the
control plane is unreachable.

### `memnox sync now`
Does a pass immediately rather than waiting. `--json` for the result.

### What crosses the wire

**Pulled:** a rule bundle, written to `~/.memnox/org.policies.json` and
`~/.memnox/org-conditions.json`, where the engine already looks. An unchanged
bundle costs one `304`. Nothing about the pull is on the decision path: the gate
reads the file this wrote, minutes later, with no network anywhere near it.

**Sent, per action, in signed batches of at most 500:**

| Field | What it is |
|---|---|
| `dedupKey`, `subjectId` | the event id, so a resend is deduplicated |
| `occurredAt`, `agentSessionId` | when, and which session |
| `surface`, `operation`, `classes` | `shell`, `git.push-force`, `destructive` |
| `effect`, `reason`, `ruleId` | what was decided and which rule decided it |
| `resourceRef` | what it acted on: a path, a host, a branch |
| `argsDigest` | **a hash of the arguments, never the arguments** |
| `exitCode`, `startedAt` | how it ended and how long it took |
| `policyHash` | the rule set in force at the time |

**Never sent:** the arguments themselves, transcripts, file contents, credential
values, or anything under `~/.memnox/` other than the fields above. The payload is
an explicit allow-list in `sync/push.ts` rather than the event minus a blocklist,
so a field added to the ledger does not start travelling by accident.

**Sent on the heartbeat:** the hash of the bundle this machine has applied, which
is what lets a workspace see which machines are on which rules.

**Collected by `memnox agents control`:** what an operator has said to an agent on
this machine, and a receipt saying it was collected. Two more paths on the same
credential, asked for the same way everything else here is asked for: nothing
dials this machine, and there is no connection held open waiting to be told. What
comes back is a person's own words and never a verdict, so collecting one changes
nothing about what the agent may then do. That is still decided here, against the
rules already on disk.

### What authenticates a pull

TLS, and the machine token. **The bundle carries no signature of its own**, so
https is required and `memnox login --url` refuses anything else, loopback aside.

What makes that sufficient rather than merely acceptable is the engine: rules
compose most-restrictive-wins, so a pulled rule can only ever *tighten* what this
machine already enforces. A control plane cannot grant your agent anything. The
worst a bad bundle can do is deny too much, which is visible immediately.

A bundle is applied whole or not at all: it is written to a temporary file, read
back through the same loader the gate uses, and renamed into place only once it
has parsed. A half-applied rule set is one nobody wrote.

### If it cannot reach the control plane
Nothing stops. The gate has already answered and the row is already written by
the time any of this runs, so a failed send loses a send and never a verdict.
The rows stay and the next pass retries them.

## Taking it back out

### `memnox uninstall`
Interceptors, git hooks and wrapping. `--purge` also deletes `~/.memnox`.
