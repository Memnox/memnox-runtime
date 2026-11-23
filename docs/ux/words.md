# One set of words, one map of pages

The console, the Mac app, the Linux and Windows shell, the phone and the terminal are one
product to the person using them. They use the same words for the same things, list pages in
the same order and open on the same Home. A person who learns one already knows the others.

`contract.json`, next to this file, is the source. It holds:

- the answer words and the order they go in;
- the session statuses and the reasons behind them;
- the sidebar, with each page's id, label, icons, route and tabs, and the platforms it shows on;
- the blocks of Home, in order;
- the steps of onboarding;
- the one install line;
- the prompt a person is given to try first.

**Every repository keeps a verbatim copy, the same way it keeps `VISION.md`.** Each one tests
its own words and pages against its copy. The runtime's test is `ux-contract.test.ts`. Change
the copy in this repository first, then copy it across whole.

## Answers

A held call is answered with `Allow once`, `Allow for this session`, `Edit the command
first` (on a terminal only, and only beside a command) or `Deny`. **They go in that order on
every surface**, with the narrowest yes first and `Deny` always last, so a hand that reaches
for the usual place never lands on the wrong answer.

`Always allow` and `Always deny` write a rule rather than decide one call. They appear only
where a rule can be signed, and never in the main row of buttons.

Once a call is decided, the line left behind reads `allowed once`, `allowed for this session`,
`denied` or `nobody answered, so denied`. When the answer came from another route, the line
names who answered.

## Session status

Every session is in one of five statuses, listed in this order:

| Status | Shown as | Means |
|---|---|---|
| `needs-you` | Needs you | Only a person can move it on. |
| `stopped` | Stopped | Memnox held it, so a setting of the person's did. |
| `working` | Working | Something was recorded in the last few minutes. |
| `finished` | Finished | Its turn ended and it handed back. |
| `idle` | Idle | Quiet, and nothing is waiting on anyone. |

A status that needs or stops something carries a reason, worded as what the person will do:

- `Needs approval`, `Has a question` and `Plan to review` go with `needs-you`.
- `Paused`, `Paused by the breaker`, `Stopped by a budget` and `Interrupted, resumable` go with
  `stopped`.

These words replace the ones that drifted apart: Waiting on you, Need you, Held, Done, Ended,
Quiet and Thinking.

## Pages

The sidebar is the list of `pages` in the contract, in the order given:

- **Top, with no heading:** Home, Needs you, Sessions, Agents and Projects.
- **Govern:** Rules and Activity. Rules holds what agents may do, what they could be let do next,
  their spending limits and the history of every change.
- **Knowledge:** Memory and Connectors.
- **Foot:** Machines, People and Settings.

**Every page answers one of four questions a person has about their agents.** What happened is
Activity. What needs me is Needs you. Who is doing what is Sessions and Agents. What can I let go
of is Rules and Home. A page that answers none of them does not belong in the sidebar.

**A label is a word anybody uses.** No page or tab is called after the plumbing behind it, so
there is no profile, job, MCP, hook, daemon, runtime, verdict or enforce in a label, and the
contract test checks that. The two modes are said as `Watching only` and `Protecting`.

**A page or tab marked for some platforms appears only on those.** A page that is not in the
contract is not in the sidebar. The command palette and the keyboard shortcuts use the same
labels, because a second name for a page is a second page as far as a person can tell.

## Home

Home opens on one sentence of how things stand, then shows the same blocks in the same order
everywhere:

1. the greeting and mode;
2. one "Get set up" card, with three steps at most;
3. Needs you;
4. Working now;
5. You could let go of;
6. Today.

**Each block shows its count in its own header rather than in a row of tiles above it.** The
"Get set up" card goes once every step is done.

## Onboarding

Onboarding teaches what Memnox is for before anything about how it works. Every shell opens
with the same line: *Your AI agents do real work. Memnox shows you what they did, asks you
before anything risky, and keeps them from getting in each other's way.*

On a computer it is three screens and nothing typed:

1. **Welcome**, and what to call you.
2. **Your agents.** The scan runs by itself and each agent found says, in one line, whether
   Memnox can stop it or can only watch it. Permissions a voice feature needs are asked the
   first time that feature is used, never here.
3. **How careful should Memnox be?** Three choices, from `careful` in the contract: Just watch,
   Ask me before risky things (the one recommended) and Ask me about almost everything. Each
   names the mode and the shipped rule pack it starts, and each rule still arrives as a
   proposal the person signs. Pairing a phone is one optional button here.

In the console the steps are who it is for, where the agents run, where Memnox asks you and how
careful to be. Where the agents run is answered in plain choices: on my computer, which offers
the app download and no terminal; in an automation tool, which gives one link to paste; inside
an app, which adds Memnox as a connector; and in my own code, which leads to the developer
docs.

The end is "You're set", which says the first time an agent wants to do something risky it
will wait for the person right there. The prompt to paste into an agent stays for developers.
Setup can be run again from Settings.
