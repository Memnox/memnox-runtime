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

- **Top, with no heading:** Home, Needs you, Sessions, Agents, Projects and Work.
- **Govern:** Rules, Hand over and Activity.
- **Knowledge:** Memory and Connectors.
- **Foot:** Machines, People and Settings.

**A page or tab marked for some platforms appears only on those.** A page that is not in the
contract is not in the sidebar. The command palette and the keyboard shortcuts use the same
labels, because a second name for a page is a second page as far as a person can tell.

## Home

Home shows the same blocks in the same order everywhere:

1. the greeting and mode;
2. one "Do this next" card;
3. Needs you;
4. Working now;
5. Ready to hand over;
6. Budgets and missions;
7. Today.

**Each block shows its count in its own header rather than in a row of tiles above it.** The
"Do this next" card goes once every step is done.

## Onboarding

Onboarding has five steps and an end on every shell:

1. who it is for;
2. which agents;
3. connect this machine;
4. where Memnox asks you;
5. the starting rules.

The end is "You're set", with one prompt to paste into the agent, so the first ask arrives in
minutes. Setup can be run again from Settings.
