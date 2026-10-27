# ADR 0003: Native Windows, with WSL still supported

**Status:** accepted, and it supersedes [ADR 0001](0001-windows-support.md)
**Date:** 2026-10-06

The brief that asked for this called it ADR 0002. That number was already the telemetry
decision, so this one is 0003.

## Context

ADR 0001 shipped 1.0 as macOS and Linux and pointed Windows at WSL, because three things
were not portable: the interceptors were `#!/bin/sh` scripts that PATHEXT never finds, the
daemon bound a unix socket, and the kernel guard is `sandbox-exec` on macOS and Landlock on
Linux. It said to revisit when somebody asked. Somebody asked: agents run on the Windows
side of the machine, outside WSL, and nothing governed them.

WSL keeps working exactly as before. Inside WSL everything is Linux, and that path is not
touched by anything below.

## Decision

Build the native foundation behind platform checks, so macOS and Linux behave as they did,
and say plainly what Windows does not have yet.

**The daemon listens on a named pipe.** `socketPathFor` in core is the one place the address
is decided, and on `win32` it returns `\\.\pipe\memnox-<account>-<digest of the home>`. The
digest keeps two homes on one machine, a second profile or a test, from answering for each
other. Every caller already went through that function: the daemon, the interceptors'
client, the voice and remote paths, and `doctor`. The credential broker of
`memnox run --hold-credentials` gets a pipe per session the same way. A pipe has no file, so
nothing creates a directory for it, chmods it or removes it, and `doctor` checks it by
asking the daemon rather than by looking for a file.

**The interceptors are `.cmd` shims beside the scripts.** On Windows the installer writes
both: the `#!/bin/sh` script, which Git Bash runs, and a `.cmd` that cmd.exe and PowerShell
find through PATHEXT. The `.cmd` names this node and the interceptor entry by absolute path
and passes the arguments as `%*`, the one form cmd.exe hands on as the caller quoted it.
When the entry is gone it takes its own directory off PATH and runs the real binary, which
is what the script does on macOS and Linux. Agent launchers get the same treatment.

No `.ps1` is written. PowerShell prefers a `.ps1` to a `.cmd` in the same directory, and
under a restricted execution policy it refuses the `.ps1` rather than falling back, so a
`.ps1` shim would stop `git` working for exactly the people who never changed that policy.
Without one, PowerShell runs the `.cmd`.

**The real binary is found and started the Windows way.** `resolveReal` tries each PATHEXT
extension rather than the bare name, accepts quoted PATH entries, and never resolves to its
own `.cmd`. A real binary that is a batch file, which is how npm installs every CLI, is
started under `cmd.exe /d /s /c` with each argument quoted by the C runtime's rule and caret
escaped for cmd.exe, twice, because the batch file's own `%*` line reads them again. That is
the approach cross-spawn takes; Node itself refuses to start a `.cmd` without a shell since
the BatBadBut fix. An `.exe` is started directly, untouched. `memnox run` starts an
npm installed agent the same way, and `onPath` finds `claude.exe` where a bare lookup would not.

**PATH is set under the spelling Windows uses.** Windows keeps the variable as `Path`, and a
copy of its environment is an ordinary object, so `env.PATH` on that copy is undefined and a
second spelling set beside it reaches the child by sort order. `pathValueOf`, `withPathValue`
and `prependedPath` in core read and write it under whichever spelling is there, and leave
one. `memnox run` and the interceptors use them; on macOS and Linux they do what the old code did.

**The daemon starts at logon through Task Scheduler.** `memnox daemon --install` writes
`~/.memnox/daemon-task.cmd`, which sets PATH, names this node and this CLI by absolute path
and appends to `daemon.log`, and registers it with
`schtasks /Create /TN com.memnox.daemon /TR "<launcher>" /SC ONLOGON /RL LIMITED /F`, then
`/Run` so it starts now. The launcher exists because `/TR` is capped at 261 characters and
nests quotes badly. `--uninstall` ends and deletes the task, then removes the launcher. It
goes through the same `ServiceSeams` injection launchd and systemd use, with a `platform`
seam added so a test on a Mac installs what Windows would. Status says Task Scheduler
starts it at logon, and does not claim it keeps it running, because a task is not restarted
after a crash the way `KeepAlive` and `Restart=always` are.

**`memnox-shell` hands off to Git Bash.** Claude Code on Windows runs its commands through
Git Bash, so the line it sends is bash. On `win32` the real shell is `MEMNOX_REAL_SHELL`, then
`CLAUDE_CODE_GIT_BASH_PATH`, then `SHELL` unless it is an MSYS path such as `/usr/bin/bash`
that Node cannot start, and otherwise Git for Windows' default install. Being invoked as
`bash -c "<line>"` from Git Bash works as it does today.

**`doctor` says what Windows lacks.** On Windows, `memnox doctor` and `doctor --wiring` list
each agent with the seams that govern it natively (the MCP proxy and the interceptors for
every agent, and the hook for Claude Code) and the ones that are not available on Windows: the
kernel guard for every agent, and `memnox-shell` as Claude Code's shell. `--json` carries the
same list. `protect --os-guard` says Windows has neither `sandbox-exec` nor Landlock.

## What Node gives for the pipe, and what it does not

This is the part that is weaker than macOS and Linux, and it is written down rather than
papered over.

- On macOS and Linux the socket sits in `~/.memnox`, a `0700` directory, and is `0600`.
  Nobody else can create it, open it or replace it.
- Node cannot set an access list on a named pipe. `net.Server.listen` creates it with
  Windows' default security descriptor: full control for the creator, LocalSystem and
  Administrators, and read access for Everyone and the anonymous account. Read access alone
  cannot send a request, and the daemon writes nothing it was not asked for, but it is not
  the owner only guarantee the socket has.
- The only knobs Node offers are `readableAll` and `writableAll`, and both widen access.
  `listenOptionsFor` names both `false` and a test holds them there, so nothing in this
  codebase can loosen the pipe further.
- **Pipe squatting is not covered.** Another local user who creates
  `\\.\pipe\memnox-<account>-<digest>` before the daemon starts holds the name, and both the
  interceptors and a starting daemon would talk to it. The daemon refuses to take over a pipe
  that is in use and does not answer, but a squatter that answers is indistinguishable from a
  daemon this account started. Closing it needs either an explicit DACL at creation or a check
  of the server's process owner (`GetNamedPipeServerProcessId`), and Node exposes neither
  without a native addon. Until then, a native Windows install is not a boundary against
  another local user on the same machine, and the threat model says so.

## What is verified, and what is not

Nothing in this change has been run on Windows. Every Windows branch is exercised by unit
tests on macOS with the platform injected, and those tests prove the text and the command
lines Memnox would hand Windows: the pipe name, the shim and launcher files line by line, the
PATHEXT lookup, the cmd.exe command line and its escaping, the PATH spelling, the
`schtasks` arguments, the task launcher, and what `doctor` prints.

They prove nothing about how Windows treats any of it. In particular these are unverified:

- that `schtasks /SC ONLOGON` without `/RU` is accepted from a standard account. Logon
  triggers have needed elevation on some configurations; if Task Scheduler refuses, the
  install reports its words and leaves the launcher in place. The fallback, a task defined in
  XML with a `LogonTrigger` scoped to this user, or the `HKCU\...\Run` key, is not built.
- that a task running a `.cmd` at logon does not leave a console window open.
- that cmd.exe's `%PATH:<dir>;=;%` substitution removes the interceptor directory in every
  spelling a PATH entry might take, which is what keeps the fallback from finding itself.
- that the escaping holds for every argument an agent might pass through a batch file.
- the named pipe end to end: listen, connect, the stale and squatted cases.

## What is not built

- **A Windows kernel guard.** The equivalent is a job object with a restricted token or an
  AppContainer, which is a separate project. `memnox run --untrusted` refuses to start where
  no kernel sandbox exists, which on Windows is always.
- **`memnox-shell` as Claude Code's shell on Windows.** Claude Code finds its own `bash.exe`
  through `CLAUDE_CODE_GIT_BASH_PATH` and starts it directly, and a `.cmd` cannot stand in for
  an executable there, because Node will not start one without a shell. Doing it cleanly needs
  a small native launcher. Until then commands are gated by the interceptors inside Git Bash
  and by the hook, which already reach every command Claude Code runs.
- **A PowerShell shell seam.** Same reason, and PowerShell's own argument rules besides.
- **A program that starts `git.exe` directly** without a shell is not intercepted, because
  Windows' own lookup appends `.com` and `.exe` and never reads a `.cmd`. That is the Windows
  form of calling a binary by absolute path, which the interceptors never covered anywhere.
- **`protect --path` on Windows** prints the PowerShell line and where to set it for every
  new app rather than writing it, because Path lives in the registry and `setx` truncates it
  at 1024 characters.

## Consequences

- A Windows user can run Memnox natively, and an agent on the Windows side is governed by the
  proxy, the interceptors and, for Claude Code, the hook. `doctor` names what it is not.
- WSL stays the stronger option on Windows today, because inside it the kernel guard and the
  owner only socket both exist. The README says both.
- The next step is the pipe: an owner only DACL or a server owner check closes the squatting
  gap, and is the thing to build before calling native Windows a security boundary.
