# Threat model

What this product defends against, what it does not, and where it would fail. Written
before 1.0 so the gaps are stated rather than discovered.

## What is being protected

An agent on somebody's laptop holds their credentials, their filesystem and their
network. The thing worth protecting is **the gap between what it can reach and what
anybody meant it to reach.**

## What Memnox is not

It is not a sandbox, and it is not antivirus. A determined attacker with code
execution on this machine is already past everything here. Memnox governs an agent
doing roughly what it was asked to do, in a way somebody can inspect afterwards.

## Assets

| Asset | Where it lives | Worst case |
|---|---|---|
| Credentials on disk (`~/.ssh`, `~/.aws`, `.env`) | the user's home | read and sent somewhere |
| The event ledger | `~/.memnox/memnox.db` | reveals what was done and when |
| The rules | `memnox.policies.yaml` | edited to permit what it forbade |
| The interceptor directory | `~/.memnox/bin` | replaced, so every command is attacker code |

## What the design already refuses to do

**A secret value never leaves the process that read it.** Discovery stores a path, a
kind and a fingerprint. The ledger stores a digest. `validateEvent` refuses a digest
field holding more than 128 characters, which is the shape of a payload that escaped.

**Nothing is encrypted at rest, and nothing pretends to be.** Files are owner-only
(`0600`) under a `0700` directory. A key this runtime could not honestly promise to
rotate would be worse than none.

**No model is on any enforcement path.** Every verdict comes from a rule table and a
matcher. A model is not consulted, so a prompt cannot talk one around.

**The ledger is append-only in the database, not by convention.** A trigger rejects
any `UPDATE` except recording who released a held call.

## Threats, and where we stand

| Threat | Standing |
|---|---|
| Agent reads a credential it was never meant to | **Covered** by path rules, and by the OS guard where the platform has one |
| Agent exfiltrates a credential in a request body | **Covered** by the egress inspector's credential shapes |
| Agent runs a destructive command | **Covered** by the interceptors and the git hooks |
| Prompt injection makes the agent try something | **Covered**, because the rules do not care why it was asked |
| Agent calls the real binary by absolute path | **Not covered by interceptors.** The OS guard and the git hooks are the second line |
| Attacker edits `memnox.policies.yaml` | **Not covered.** Anyone who can write your rules can write your shell profile |
| Attacker replaces `~/.memnox/bin/git` | **Not covered.** Same trust boundary as the rules |
| Another local user reads the ledger | **Covered** by owner-only permissions, and no further |
| Another local user reads a command's arguments or environment on their way to the daemon | **Covered** by the socket's owner-only permissions. The native fast path sends argv and the environment so the daemon can plan exactly as the Node interceptor would; they are held in memory for one plan, never written to the ledger (which keeps a digest), and masked before any log line ([ADR 0004](adr/0004-native-intercept.md)) |
| Another local user squats the daemon's named pipe on native Windows | **Not covered.** Node cannot set an owner only access list on a pipe or check who serves one, so native Windows is not a boundary against another local user; [ADR 0003](adr/0003-native-windows.md) says what closes it |
| Malicious MCP server lies in `tools/list` | **Partly.** Classification is by name and annotation; a tool that lies about its name is classified by the lie |
| A dependency of ours is compromised | **Partly.** Few runtime dependencies, pinned, with a lockfile. A Memnox package published from anywhere but this repository's release workflow, as a stolen npm token would publish it, is refused by `memnox update`; one installed by hand with `npm install` is not checked |
| Agent writes outside the repository it was started in | **Covered** by the repository boundary, which asks first, for `memnox run` sessions and hooked agents alike |
| A freshly cloned repository turns the agent against the machine | **Covered** by `memnox run --untrusted` where the kernel holds a sandbox; the run refuses to start where none can |
| A newly installed agent or MCP server does more than it should | **Partly.** It starts on probation, so its writes and outward actions ask for seven days; after that only the rules decide |
| Memnox itself sends something somewhere | **Covered by construction.** Only two modules reach a network, `sync/client.ts` after `memnox login` and `remote/relay-link.ts` once a phone is paired, and a test holds the list to those two; the other sockets are the daemon's unix socket (a named pipe on Windows) and the egress proxy on loopback, which forwards the agent's own traffic |
| A stolen relay token, or a compromised Memnox Cloud, steers this machine | **Covered.** A token only lets a connection put bytes into a mailbox. The daemon treats a frame as a device's only after a Noise IK handshake completes against a static key in the device registry, and reads what that device may do from the key, never from a token, a header or a mailbox id. The relay's one text message, the beat, only brings the next heartbeat forward, at most once a second and only while a call is held, so a forged one costs a request and decides nothing |
| A paired phone is lost or stolen | **Partly.** Every yes from a phone is signed by its Secure Enclave key behind Face ID, so the phone alone allows nothing; it can still see sessions and ask questions until it is revoked from the Mac, which closes its live session at once |

## A release is checked before it runs

The interceptors run on every command every agent issues, so a bad publish of
`memnox` or `@memnox/*` would sit on every agent's execution path. Releases are
published only by `release.yml` from a version tag, with npm provenance, which signs a
statement naming the repository, the workflow and the tag through Sigstore. `memnox
update` installs exactly the new version into a scratch directory with scripts off,
has `npm audit signatures --include-attestations` verify every signature and
attestation, and then requires each of our packages to carry provenance whose
statement and signing certificate both name `github.com/Memnox/memnox`,
`.github/workflows/release.yml` and a `refs/tags/v` ref. A package published with a
stolen token carries no such provenance, so the update refuses and names it. npm does
the cryptography and the network, so no new module here reaches the network.
`--skip-verify` installs anyway, says so on screen and writes `verified: false` to
`~/.memnox/updates.jsonl`. What it does not cover: an install by hand, npx, a
compromise of the release workflow or the repository itself, and a third party
dependency, which is held only to npm's registry signature.

## Where it would fail

1. **PATH is advisory.** An agent that calls `/usr/bin/git` never meets an interceptor.
   The OS guard, the git hooks and the MCP proxy each close part of this; none closes
   all of it, and no PATH-based tool can.
2. **The rules are a file the agent can write.** If an agent has filesystem write and
   no path rule covering `memnox.policies.yaml`, it can permit itself. `protect`
   proposes a rule for this, and it is not on by default.
3. **Classification by name is a heuristic.** `frobnicate_widget` is `unknown`, and
   unknown is not blocked by default. The overrides file exists for exactly this.
4. **A parked yes arrives late.** Nobody answering in time refuses the call and parks the
   question for sixteen hours, so an unattended run can use ASK rules and carry on around
   them. A yes given hours later lets the agent's next retry through, against a session
   that may have moved on since the question was asked. What bounds it is below.
5. **A harness's far side is somebody else's machine.** Ruflo and OpenClaw can both
   hand work to agents elsewhere. A local scan reports that federation is switched on
   and cannot see what crosses it, what the other side holds, or what it did. The scan
   says so out loud rather than leaving it as an absence.
6. **A harness's roles are read from disk, not from what is running.** A swarm that
   defines its roles at runtime, or one whose layout changed in a version we have not
   caught up with, is reported with fewer principals than it has. Detection is by
   config file on purpose, since a process list is a different tool with different risks,
   and the layout revision each detector was written against is printed in the report.
7. **A row is best effort.** Every seam writes its row after the verdict has been
   applied, and a ledger that cannot be opened loses the row rather than stopping the
   agent. So the record can be short where the disk was full or the file unwritable,
   and nothing says so at the time. The alternative, refusing to act because the
   record failed, is a tool people uninstall.
8. **The egress proxy sees only what is pointed at it.** Outside `--untrusted`, a tool
   that ignores `HTTPS_PROXY`, or an agent started from the desktop with no proxy in
   its own settings, reaches the network directly and unrecorded. Inside HTTPS only
   the destination is known, and which agent sent a request is what its proxy URL
   declares rather than anything proven.
9. **Linux holds less than macOS.** Landlock needs a `python3` helper to apply it,
   holds TCP only from ABI 4, cannot let an agent create a new file directly in the
   home directory, and with ABI 1 refuses every rename across directories. Each of
   these is printed at the start of the run rather than discovered later.

## A question kept for later

Parking turns a refusal at the deadline into a refusal now and a question that stays
answerable. Four things bound what a late yes can do.

- **It is the same call.** A parked answer is matched on session and fingerprint, the
  digest of the action and its target, so a yes to `git push origin feature` never lets
  `git push origin main` through, and a yes in one session never answers another.
- **It is spent once.** A parked answer is cleared the moment a retry reads it, and the
  single yes it writes is spent under a cross process lock, so two seams cannot both take it.
- **It ages out.** Sixteen hours after it was parked the question can no longer be
  answered, and `memnox purge` removes it.
- **It is signed like any other.** A phone's yes still carries its Secure Enclave
  signature; parking changes when a question can be answered, never who may answer it.

The agent is told the call is parked and not to reach the same result another way. That
sentence is advice to the model and not a control: the rules, the narrowing of a session
with failures standing, and the breaker are what stop a second route.

**What the evidence on a question shows.** A held call now carries what its session did:
the last test run, the files it changed, what it changed elsewhere, and what failed. These
lines stay on this machine and go to the terminal and, through the tunnel, to a paired
phone. The heartbeat carries none of them to the cloud. Commands are masked for secrets
before they are written into a line, the same masking the heartbeat applies.

## What an action sends to the workspace

An enrolled machine sends each action's operation, verdict, rule and timing, and its target
masked for secrets. A file path or a command line can still name a customer, so `uploadPaths
= "hashed"` in `config.toml` sends those as an HMAC under a key made on this machine and never
sent (`~/.memnox/upload-key`). The workspace can still see that two actions touched the same
file and can neither read nor guess which; a key the workspace held could hash a dictionary of
likely paths, which is why it is the machine's. MCP tools, hosts and git refs go as written,
since the workspace reads its inventory and capabilities from them. The default stays `full`,
so what a workspace already shows does not change under it.

## What the cloud learns when a phone steers this machine

The phone and the daemon meet through a blind relay in Memnox Cloud, and the tunnel ends in the
daemon rather than in the cloud. `docs/remote-contract.md` is the whole protocol; this is the limit
it is built to keep.

**The relay learns** that a mailbox exists and which machine opened it, when a phone connected to it
and for how long, how many messages went each way and how large each was, and, through the push
route, that a phone was woken. Put together, the cloud knows that phone A talked to machine B, when,
and roughly how much.

**The relay never learns** anything said, asked or answered, which session, agent or repository a
message is about, what was held, allowed or denied, the voice the person picked, the six digit
pairing code, or any key that could read the tunnel. Every payload is Noise ciphertext under keys
that live only on the phone and in the machine's `remote/noise-key.json`, and the relay stores
nothing. A push carries generic words only ("Memnox needs you"), and the phone reads the detail
through the tunnel once it wakes.

**A compromised cloud can** refuse to forward, drop a connection, delay a message or replay bytes,
each of which fails the Noise handshake or its nonces and ends the session. It could put a wrong
mailbox in front of a phone, which is why pairing ends with the person comparing six digits taken
from the handshake hash, and why no device is written until the Mac's own Touch ID signs
`pair-accept`.

**It cannot** read a frame, forge one that passes the handshake, add a device, widen what a device
may do, or allow anything held. Capabilities are written only by `device-grant` with the Mac's
Touch ID, and a remote yes always carries the phone's own signature, so the inside the session
exception, which lets the Mac allow a call that stays in its repository without Touch ID, never
applies to a phone.

## Reporting

`SECURITY.md` has the address. Anything that gets a secret value into a report, a
snapshot or the ledger is the highest severity here, whatever else it does.
