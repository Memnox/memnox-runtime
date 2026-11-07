# Contributing

Memnox decides whether somebody's agent may do something. That is the reason for
every rule below: a bug here is not a wrong pixel, it is a gate that was supposed
to be closed.

New here? Read [`ARCHITECTURE.md`](ARCHITECTURE.md) first: four packages, one
direction of dependency, and one path every decision travels down. It ends with a
table of where to make each kind of change.

## Getting set up

### What to install first

| | macOS | Linux | Windows |
|---|---|---|---|
| **Node** | 24, as `.nvmrc` says (22 also works) | the same | the same |
| **pnpm** | `corepack enable`, which picks the version `packageManager` pins | the same | the same |
| **Build tools** | `xcode-select --install`, which also gives you git | `sudo apt install build-essential git zip unzip` (Fedora: `dnf install gcc gcc-c++ make git zip unzip`) | [Git for Windows](https://gitforwindows.org), and run every command below from Git Bash |
| **Rust** | only when no prebuilt Noise addon loads, see below | the same | the same, with Visual Studio's C++ build tools |

Node 25 and later no longer ship corepack, so on those run `npm install -g corepack` before
`corepack enable`. A pnpm installed some other way is likely to misread the lockfile.

Run the suite as an ordinary user, never as root, and not in a container that defaults to root,
because a test that checks a file is unreadable passes for root whatever it says.

**On Windows, run the test suite inside WSL 2 for now.** Memnox itself runs natively on Windows
(see [ADR 0003](docs/adr/0003-native-windows.md)), but CI does not hold the native suite green yet,
so a native run shows failures that are not yours. The `test-windows` job in CI shows which ones.

### Getting the code

Clone it as `memnox-runtime`, because the desktop and mobile repositories look for a sibling folder
with exactly that name:

```sh
git clone https://github.com/Memnox/memnox.git memnox-runtime
cd memnox-runtime
pnpm install
pnpm check-setup      # names anything this machine is missing, one line each
pnpm build            # every package, in dependency order
pnpm test             # ~2100 tests, a few seconds
pnpm bench            # the wall-clock ones, run on purpose
```

To work on the apps as well, clone them beside it:

```sh
git clone https://github.com/Memnox/memnox-desktop.git
git clone https://github.com/Memnox/memnox-mobile.git
```

### The Noise addon, and when you need Rust

Pairing a phone runs over an encrypted tunnel written in Rust (`native/noise`), and about forty
pairing tests load the real addon. `pnpm install` fetches the published build for your platform
(macOS on arm64 and x64, Linux on x64 and arm64 with glibc, Windows on x64) and checks it against
the registry's integrity, so most machines need no Rust at all.

You need Rust (`curl https://sh.rustup.rs -sSf | sh`) and `pnpm --filter @memnox/noise build` when:

- you change anything under `native/noise`;
- the install said it could not fetch the addon, which happens offline or behind a proxy;
- nothing is published for your platform, such as Windows on arm64 or Alpine.

A local build always wins over the fetched one. Without either, those pairing tests fail with
"Pairing needs the Noise addon", and `pnpm check-setup` says so first.

### Running your working copy

```sh
node packages/cli/dist/index.js scan
node packages/cli/dist/index.js doctor --wiring
```

`pnpm build` first, because the `dist/` you just ran is whatever was last built, and a
change you did not build is a change you did not test.

Nothing in the suite reads your home directory, spawns an agent, or watches a real
directory. If a test you write needs one of those, inject it instead; see **Seams**
in `ARCHITECTURE.md`.

## Before you open a pull request

```sh
pnpm format          # writes the formatting, then
pnpm verify          # what CI runs, in its order: format check, typecheck, build, test, deadcode
pnpm verify:linux    # the same inside a Linux container, with Docker running
```

All clean. CI runs them on Ubuntu and macOS against Node 22 and 24, plus a
publish dry run and a Windows leg that reports but does not block yet, because a shim that works on one platform and not the other is the bug
that matrix exists to catch. `verify:linux` is that Ubuntu leg on your own machine, as a
user who is not root, and `NODE_VERSION=22 pnpm verify:linux` is the other Node.

- Unit tests for new logic; an integration test when a command or a flag moves.
- `docs/` updated when a user-visible command, flag, file or path changes.
- A new dependency carries a one-line justification in the description. `core` has
  three and none of them reaches a network; adding a fourth is a conversation.
- Nothing writes outside `~/.memnox/` or `<project>/.memnox/` unless the change
  says so and takes a backup first.

## Clean code, and where each principle is held

Five principles, each mapped to the rule below that holds it, so a review can point at
one line rather than argue taste.

| Principle | What it means here | Held by |
|---|---|---|
| DRY | One owner per helper, constant and list. Search before you write one. | 3, 4b |
| KISS | The plainest code that works: no nested ternaries, no clever one-liners. | 4b |
| Single responsibility | A function does one job; a module holds one kind of thing. | 2, 3a, 4b |
| Meaningful names | A name says what the thing does, in the shared vocabulary. | 3b, 4a |
| Small functions | At most forty lines and four parameters, one level of abstraction. | 4b |

## The rules review enforces

**1. No `any`.** Use `unknown` and narrow at the boundary. Every function declares
its return type, `async` included. An `as` cast carries a one-line reason. `any` is
how an untrusted MCP payload becomes a trusted object with nobody noticing.

**2. Dependencies point one way**, interface to application to domain, and
infrastructure implements ports the domain defines. Never import another package's
internals, only its `index.ts`. A command holds no logic: when one grows past
shape-checking and dispatch, the logic moves out and the test moves with it.

**3. No magic values.** A number or a string that means something gets a named
constant, in the one place that owns it. A path built in two files is one rename from
being written by one command and looked for by another, and an action name spelled in
two files is a rule that silently stops firing. Before you declare one, check the table
in `ARCHITECTURE.md` under **Where a shared constant lives**: durations, exit codes,
HTTP statuses, action names, ledger limits and the Memnox home all already have an
owner, and a second copy is the bug.

**3a. A command with several subcommands registers them and nothing else.** `agents`
and `setup` keep their wiring in `<name>.command.ts` and one `run*` function per
subcommand in `commands/<name>/`, so the registration file reads as a list of what the
command offers. `test/one-rail.test.ts` reads that folder together with the command
file, so moving a handler out never moves it out of a check.

**3b. One shape per job, and a test holds you to it.** `packages/cli/test/house-style.test.ts`
asserts the three that were actually diverging, across all four packages:

- A command **registers and delegates**. `register<X>Command` declares its flags and each
  `.action()` is one call to a `run<Something>` function. That is what makes a command
  testable without commander, and what makes thirty-one files read as one product.
- Every non-trivial module **opens with a doc comment** saying what it is. A newcomer
  opening `policy-engine.ts` should not have to read the imports to find out.
- `render*` **writes to the rail** and `describe*` **returns a string**. In `core`, which
  has no rail, `render*` produces the text instead. There is no `say*`.

The verb vocabulary the rest of the codebase already uses, so reach for these before
inventing one: `run` (do the thing), `render`/`describe` (present it), `read`/`write`
(persist it), `is`/`has`/`matches` (ask about it), `parse`/`classify`/`resolve` (turn one
shape into another), `build` (assemble a collaborator).

The same goes for shapes. A command's injected collaborators are `<Name>Deps` and its
flags are `<Name>Options`; a function is a `function` declaration rather than an arrow
assigned to a const; an array parameter is `readonly` unless the function mutates it;
and a failure throws in `packages/cli` and returns `null` or an outcome everywhere else.
None of that was decided in a style meeting, it is what the code already does, and
`house-style.test.ts` holds the parts of it a test can check.

**4. Comments are short and say why.** Never restate the code, never leave a
commented-out block, never tell the story of how the code got here: that is what git
history is for. The limits are checked by `house-style.test.ts`:

- A module opens with a `/** */` comment saying what it is, in at most three lines.
- A symbol gets at most one `/** */` comment, of at most three lines.
- Inside a function, a comment is `//` and at most two lines. There is no `/* */`.

Anything longer belongs in `docs/`, where it is read on purpose.

```ts
// WRONG: a banner, and it restates the function below
/* =====================================================
 *  Tool classifier, mapping tool names to read / write /
 *  destructive using the verb table.
 * ===================================================== */

// WRONG: history. Nobody reading this needs to know what it used to do.
// This used to read only mcpServers, which missed VS Code for a release.

// RIGHT
// Annotations win over the verb table: the server author knows the tool better than we do.
```

**4a. Names say what the thing is, in the words the rest of the code uses.**

| Kind | Shape | Example |
|---|---|---|
| Function | verb first, from the vocabulary in 3b | `readRecord`, `isWriteCapable`, `renderAgent` |
| Predicate | `is`, `has`, `matches`, `can` | `isCredentialExposure`, `hasLease` |
| Conversion | `xToY`, or `yOf(x)` for a lookup | `minutesToMs`, `hostnameOf` |
| Constant set | `UPPER_SNAKE` object `as const`, and a type derived from it | `EXIT`, `SENSITIVITY` |
| Collaborators | `<Name>Deps`; flags `<Name>Options`; a long argument list `<Name>Input` | `SetupDeps`, `OfferInput` |
| Local | camelCase, a whole word, never one letter outside a tiny callback | `servers`, not `s` |

A name that says one thing and does another is a bug, even when the tests pass: `ask()`
that raises a risk level, or `toCents()` that returns dollars, will be misused by the
next person who trusts it. Two exported functions with the same name in two modules is
the same bug.

**4b. Small enough to hold in your head.** Also checked by `house-style.test.ts`:

- A function does one job at one level of abstraction, in at most forty lines. Past
  that, name the steps and call them.
- A function takes at most four parameters. Past that, it takes one object, named
  `<Name>Input`, so every call site says which value is which.
- A module stays under five hundred lines. Past that it is doing more than one job.
- A value the function could be handed (`process.cwd()`, `process.env`, `homedir()`,
  `new Date()`) is handed to it, the same way `home` and `now` already are.
- Before writing a helper, search for it. A second copy of a helper is a second place
  for the same bug, and the copies drift apart.

**5. An empty function body is a lie about what the code does.** If a seam is not
wired, say so where it would have been wired and in the docs. The MCP proxy went a
release recording nothing behind a comment that said every call reached the ledger,
and every test passed the whole time.

## Two things that are rejected whatever the deadline

**No model on an enforcement path.** Discovery, classification and decisions are
deterministic. A pull request that puts an LLM call between an action and its
verdict is closed, not revised.

**No secret value in output.** Names, counts, structure and fingerprints only. The
failure mode is a screenshot pasted into Slack, and it is unrecoverable.

## Verb tables are code review, not a data drop

`packages/core/src/verbs/` decides what gets asked about. A change that moves
`iam delete-*` from destructive to read is an attack, and "it is only data" is
exactly why it would land. A pull request touching a table names the classes that
moved, in the description.

## Tests

Vitest, no framework beyond it. A test file sits next to the package it covers, in
`packages/*/test/`, named for the thing rather than the file.

- **Pure logic gets a unit test** with no filesystem at all.
- **A command gets its program built with fakes**, which `test/cli-harness.ts` does
  for a command whose collaborator would otherwise spawn something.
- **Never assert against a real watched directory or a real clock.** Both have cost
  a green suite before: an fs watcher that had not armed yet failed one run in ten,
  and a suite that fails at random is a suite everybody re-runs instead of reading.

## Commits

One subject line, no body, no trailers. Keep the prefix the repository already uses
(`feat(cli):`, `fix(policy):`, `docs:`, `refactor(core):`). Say what the commit
does, in under 80 characters.

A user-visible change also needs a changeset:

```sh
pnpm changeset
```

A release is one command, run on `main` once the changes it carries are committed:

```sh
pnpm ship "what this release does"
```

It bumps the manifests from the pending changesets, commits the release, tags it
`vX.Y.Z` and pushes both. The tag is what `release.yml` listens for: GitHub typechecks,
builds and tests the tag, then publishes every package with the repository's npm token,
so no passkey is asked for and nothing is published from a working tree that holds
unfinished work. A push to `main` on its own never publishes anything.

`pnpm version` syncs `CLI_VERSION` with the manifests, so never edit that constant by
hand, because `memnox --version` reading a number the package was not published under
is a bug this project has already shipped once.

## Reporting something that should not be public

A policy bypass or an audit-tampering finding goes through GitHub's private
vulnerability reporting, not an issue. [`SECURITY.md`](SECURITY.md) has the detail.
