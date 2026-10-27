# Policies

Rules are plain TOML, so they stay reviewable and diffable. Every field you leave out
matches everything; every field you set narrows.

A file ending `.yaml` is still read, so a rule set you already have keeps working. New
files are written as `.toml`, and a save never changes the format of a file you wrote.

## A rule

```toml
version = 1

[[policies]]
name = "no-force-push-to-main"
description = "A force push rewrites history somebody else may have pulled."

[policies.match]
actions = ["git.push*"]
targets = ["*main*"]

[policies.decision]
effect = "deny"
reason = "main is shared, and a force push loses somebody's work."

[policies.decision.alternative]
action = "git.push"
resource = "a branch"
note = "Push a branch and open a PR."
```

## The three effects

| Effect | What happens |
|---|---|
| `allow` | it proceeds |
| `ask` | it is held until a person answers at the terminal |
| `deny` | it does not run, and the agent is told what to do instead |

There is no fourth. When several rules match, the strictest wins: `deny` beats `ask`,
which beats `allow`.

## Every deny needs an alternative

`alternative` is not decoration. An agent told only "no" abandons the task; one told
what to use instead finishes it. The alternative is resolved from the rule that
denied — it is never invented.

## Matching

| Field | Matches on |
|---|---|
| `actions` | the namespaced verb, e.g. `git.push`, `filesystem.read` |
| `targets` | what it operates on: a path, a branch, a host |
| `agents` | which agent, by product name |
| `environments` | `production`, `staging`, whatever you name |
| `classes` | what the action does: `read`, `write`, `destructive`, `communication`, `unknown` |
| `arguments` | a named argument, e.g. `method = ["POST", "DELETE"]` on `http.request` |
| `roles` | the job the agent was enrolled under, from `memnox run --role` |
| `principals` | the person the agent works for, from `memnox run --for` |

Patterns take `*`. A pattern starting with `!` takes matches back out, and `{workspace}`
stands for the directory the agent is working in:

```toml
# Ask about every host except the two this project talks to.
[policies.match]
actions = [ "http.request" ]
targets = [ "*", "!api.stripe.com", "!api.github.com" ]

# Refuse a write anywhere but the workspace, and let the workspace through untouched.
[policies.match]
actions = [ "filesystem.write", "filesystem.delete" ]
targets = [ "!{workspace}/**" ]
```

A list of exclusions only covers everything it does not name. A request that reports no
target, or no working directory, cannot be shown to be excluded, so the rule still
applies to it. Claude Code's native permissions and the kernel wall cannot leave
anything out, so an exclusion is left to the rules there, and those two stay wider.

### The person behind the agent

An agent on a shared database credential can do whatever every workflow on that
credential needed, so the database cannot tell a support assistant from a DBA. The rules
can, once the run says who the agent works for. What an agent may do is then what its own
rules allow *and* what its person's rules allow, never either alone:

```toml
# Only somebody on the DBA team deletes rows, through whichever agent and credential.
[[policies]]
name = "only-a-dba-deletes"
[policies.match]
actions = [ "mcp.*", "psql.*" ]
classes = [ "destructive" ]
principals = [ "!dba-*" ]
[policies.decision]
effect = "deny"
reason = "the person this agent works for may not delete rows"
```

The person comes from `memnox run --for <person>` and nothing else. A call that names a
principal of its own is overruled by the run's, and an agent that sets or clears
`MEMNOX_PRINCIPAL`, `MEMNOX_AGENT_ROLE`, `MEMNOX_AGENT_NAME` or `MEMNOX_PARENT_AGENTS` in
a shell line, or runs `memnox run --for` or `--role` itself, is refused, because naming
whose authority it holds is exactly what an agent must not do for itself. A run that names
nobody matches no `principals = ["dba-*"]` and every `principals = ["!dba-*"]`, so a rule
written as an exclusion fails closed.

### Reads and changes under one name

`gh api`, an MCP server's tools and a web request each go by one action name whether they
read or change something. `classes` is how one rule asks about the change and lets the
read through:

```toml
[policies.match]
actions = [ "mcp.*" ]
classes = [ "write", "destructive", "communication", "unknown" ]
```

An action nothing classified counts as `unknown`, so list it where a tool that could not be
read should still be asked about. An `http.request` names its method in `arguments`: `GET`
for a fetch or a search, what `curl` or `wget` was told, the method on the wire at the
egress proxy, and `UNKNOWN` where nothing could read it. A rule narrowed by `classes` or
`arguments` is not written into Claude Code's native permissions, which can only name the
whole tool and would ask about every read.

### What a change does

`capabilities` narrows a rule finer than `classes`: `transfer` moves money (a refund, a
payout, a captured payment), `deploy` puts something in front of users (a deploy, a
release, `kubectl apply`, `terraform apply`), `admin` hands out authority (IAM, secrets,
roles, invites), `execute` runs code somewhere else (`kubectl exec`, `railway ssh`), and
`delete`, `send`, `write` and `read` as they say. It is read from the action's name and
class, so an MCP tool and a CLI verb name it the same way, and a local command such as
`git apply` stays a `write`.

```toml
[policies.match]
actions = [ "*" ]
capabilities = [ "transfer", "deploy" ]
```

### What a payload carries

`dataClassifications` matches what a call is sending, read where the call is made by shape
and never by a model, and never recorded. Every kind found also carries `sensitive`, so
one rule can name them all:

| Classification | What it found |
|---|---|
| `secret` | an API key or token, a private key, a password, a connection string with its password |
| `financial` | a Luhn checked card, an IBAN that checks, a bank account, an invoice, a payroll line |
| `health` | a diagnosis, a prescription, a medical record |
| `government-id` | a social security or national insurance number, a passport, a tax id |
| `personal-data` | one person's email, phone, address or date of birth |
| `customer-record` | several of those about one person, or any under a `customer` key |
| `confidential` | text marked confidential, internal only, restricted or under NDA |
| `source-code` | a program, or a file from inside the repository named for upload |
| `bulk-records` | twenty rows or more of anything: a table, an export, a dump |

On the need to know ladder, `secret`, `financial`, `health`, `government-id` and
`customer-record` are `restricted`, the ceiling, and the rest are `confidential`.

It is read on every seam that sees what goes out: an MCP call through the proxy or an
agent's hook, a `curl` or `wget` body, a plain HTTP body through the egress proxy, and
every call a cloud agent makes through `@memnox/guard`. A body inside an HTTPS tunnel is
the one it cannot read. Where a call names where it is going, as a recipient address, a
URL or a webhook, the classified request carries that host as its target, so the
approved destinations are a list of `!` patterns:

```toml
[[policies]]
name = "sensitive-stays-approved"

[policies.match]
actions = [ "*" ]
dataClassifications = [ "sensitive" ]
targets = [ "*", "!ourcompany.com", "!*.ourcompany.com" ]

[policies.decision]
effect = "deny"
reason = "sensitive data leaves only to destinations the team approved"

[policies.decision.alternative]
action = "ticket.reply"
note = "reply inside the ticket, which keeps the data where it lives"
```

A call that names nowhere is ruled on where it stands, and nowhere named is nowhere
approved. `memnox protect` offers this as its sensitive data question, on ask until the
approved destinations are listed and it is turned to deny.

A team adds its own words under a classification of its choosing, a codename under
`confidential` or a name of its own. Each pattern is a whole word in any case, or a
`/regex/` of at most 200 characters, and a rule naming `sensitive` holds on them too:

```toml
[[classifications]]
classification = "confidential"
patterns = [ "falcon", "/PRJ-\\d{4}/" ]
```

### Where a command lands

A command's environment is the one it names, as it names it: railway's `--environment`,
kubectl's `--context`, aws's `--profile`, gcloud's `--project`, docker's `--context`, and
`RAILWAY_ENVIRONMENT`, `AWS_PROFILE`, `TF_WORKSPACE` or `DOCKER_CONTEXT` where no flag says.
`vercel --prod`, `netlify --prod` and `stripe --live` are `production`, because the CLI says
so outright. An MCP call names its own in an `environment`, `environmentName`, `env` or
`stage` argument. Nothing is guessed from a name, so a rule lists the names it means:

```toml
[policies.match]
actions = [ "railway.*", "kubectl.*", "mcp.*" ]
environments = [ "prod*", "production" ]
classes = [ "write", "destructive", "communication" ]
```

A command that names no environment never matches such a rule, so pair it with a rule
that has no `environments` if an unnamed one should be refused too. The refusal says
which environment it was, and names the verb table's way forward where the rule only
said to ask somebody.

### The action is the verb *and its flags*

`git push --force` is `git.push-force`, not `git.push`. They are separate on purpose:
a rule about force-pushing must not deny every push, or the gate stops being used. The
cost is that a rule meant to cover the family has to say so — `git.push*` catches
`git.push`, `git.push-force` and `git.push-f`, which is why the example above is
written that way.

`memnox policy test "<the command you mean>"` prints the action it resolved to. Use it
before you rely on a rule; guessing the name is how a rule ends up matching nothing.

### The target is the last thing on the line

What a command is aimed at sits last in CLI grammar, and that is what `targets` sees:
`main` in `git push origin main`, `s3://bucket/key` in `aws s3 rm s3://bucket/key`,
`api-7` in `kubectl delete pod api-7`. A command with nothing after its verb — `git
push`, `git status` — has no target at all, and a rule scoped with `targets` will not
match it.

## Layers

Rules stack: **org**, then **user**, then **project**. An outer layer may seal a domain
by prefix; an inner layer can then only tighten it. A project rule that would loosen a
sealed one is **refused and named**, never silently dropped — a project that thought it
had loosened something and had not would be governed by something nobody can see.

## Schedules

```toml
[policies.match]
actions = ["deploy.*"]
when = "Fri 16:00-23:59"
```

Evaluated in local time, against a moment passed in rather than a clock read, so a
replay gives the same answer.

## Testing a rule

```sh
memnox policy test "git push --force"
```

The command line is classified exactly as an interceptor classifies it, so a rule
about `git.push` matches what you actually type. A namespaced action works too, which
is how the git hooks call it.

Prints the effect, the reason, the rule and the alternative, and exits non-zero on
anything that is not an allow.

## Who may answer an `ask`

Nobody, by name. An `ask` holds the call for whoever is at the terminal, because
naming an approver needs an identity this machine does not have. `approvers` is
accepted and recorded, and routing it to a named person is the cloud's half.

A rule your workspace publishes is stricter about it. When a team rule names
approvers, asks for more than one approval, or carries a rate limit, the pulled copy
of an `ask` is a `deny` on this machine, and an `allow` is left out, because a question
here goes to whoever answers first and nothing here counts calls. Holding it to less
than the team wrote would be the one direction a gate must not fail in.
