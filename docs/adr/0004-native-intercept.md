# ADR 0004: A native wrapper rules through the daemon, and every doubt runs Node

**Status:** accepted, built and unit tested; the end to end round trip is measured with `pnpm bench` outside a sandbox
**Date:** 2026-10-08
**Task:** OSS-5.1 (under 10 ms per wrapped command), OSS-7.1 (the daemon's evaluate path)

## Context

Every command an agent runs through `~/.memnox/bin` starts a fresh Node process for
`memnox-intercept`. Measured on an M series Mac with `pnpm bench`
(`packages/cli/test/intercept-wrapper.bench.ts`): `true` unwrapped takes about 2 ms,
and through the Node interceptor about 110 ms. Node itself is about 30 ms of that, and
loading the bundle, reading the rules, three `git rev-parse` spawns and the ledger make
up the rest. The plan's budget is 10 ms.

The daemon already holds a socket and already answers `evaluate`, but `evaluate` takes
an action that is already resolved, and the Node interceptor does much more than ask a
gate: it tells a person from an agent by the process tree, reads pauses, loads the
rules with the session's task and containment, holds a call for a person, asks the
claim register, keeps a milestone before a destructive command, fetches brokered
credentials, records the row and replays the breaker.

## Decision

**A small Rust client, standard library only, stands in front of the Node interceptor
and asks the daemon to plan the whole command with the Node interceptor's own
functions.** `native/intercept` sends one `intercept` line: argv, the environment, the
working directory and the parent pid. The daemon runs `planIntercept`
(`packages/interceptors/src/fast-intercept.ts`), which calls the same `invokedFor`,
`agentBehind`, `protectionStopped`, `pauseHolding`, `loadHookGate`, `ruleOnCommand` and
`resolveReal` the Node path calls, in the same order, and answers one of four plans:

- `run`: the real binary and the PATH without the shims. The client runs it, waits,
  and reports the exit code; the daemon then counts it for the breaker, writes the row
  and replays the session, and any pause comes back as a line to print.
- `pass`: a person typed it, or protection is stopped. Run it, record nothing.
- `refuse`: print the message, exit 1. The row is the Node interceptor's deny row.
- `node`: hand the same argv to `memnox-intercept`.

**Anything the daemon cannot reproduce exactly is `node`.** That is: a rule that asks a
person (only Node has the agent's terminal), a session with brokered credentials, a
different `HOME`, git discovery variables that differ from the daemon's, a target that
could be a protected path from either directory, a browser launcher, a command the
claim register could be asked about (every `gh` acting on one thing and every push,
since those read the checkout), and a command that destroys work (a milestone comes
first). The client adds its own doubts: no daemon, a timeout of 150 ms, a protocol
version mismatch, an answer that is not exactly this version's shape, a non UTF-8
argument or variable, a variable named twice, a real binary that is not absolute, is
named `memnox-intercept`, or lives in a shims folder, and a panic. **The native client
is never the reason a command runs that Node would refuse**, because the only verdicts
it acts on are the Node interceptor's own, computed by the Node interceptor's code.

**A row is written only after the client says it acted.** The client writes
`intercept-acted` once it prints a refusal or starts the command, and the daemon writes
nothing before that line. A client that gave up waiting and ran Node instead is
therefore never recorded twice. A client that hangs up after acting still gets its row,
without an exit code, which is more than the Node path keeps when it is killed.

**The shims stay shell scripts, and only gain one line.** Where `memnox protect` finds a
native build for the platform under the package's own `dist/native/<platform>-<arch>`,
the shim runs it first, and only while `memnox-intercept` is on PATH to fall back to.
The binary is named where it lies rather than copied, so `memnox uninstall` removes the
shims and the restore stays byte identical. Windows keeps its `.cmd` shims and Node.

## Why not port the rules to Rust

Because the rules are not the expensive part and are the part that changes. A second
implementation of the verb tables, the gate and the notices would drift from the first
on the next pull request, and the drift would be an allow nobody wrote.

## Why the arguments now travel over the socket

The protocol said arguments never travel, not even locally. They have to for the daemon
to rule on a command line. They go to a socket that is the person's own, mode 0600, to
a process running as the same user that could read the same arguments from `ps`, and
they are held in memory for one plan and never logged or stored: the row keeps the
digest, as every other path does. The environment travels for the same reason and on
the same terms.

## Consequences

- Measured in this sandbox: the native client starts, builds its line and fails over in
  about 3 ms, and the daemon plans `true` in about 7 ms, most of it one `git rev-parse`
  (the three a load used to make are asked once per plan). Expected end to end: about
  10 ms over the bare binary here, and less on a machine whose process spawn is not
  slowed by a sandbox. The round trip itself is measured by `pnpm bench` wherever the
  bench may listen on a socket.
- A person typing in their own terminal is planned by a `ps` walk in the daemon, about
  as costly as it was in Node, but without the Node start.
- Asks, pushes and destructive commands still pay the Node start. They are the
  commands where a person may be waiting anyway.
- `MEMNOX_INTERCEPT_NATIVE=off` sends every command to Node, for comparing the two
  paths on one machine.
- Build with `sh native/intercept/scripts/build.sh` before `pnpm build`; the CLI build
  copies `native/intercept/dist` into `dist/native`. Without a build, nothing changes.
