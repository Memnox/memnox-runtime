# Chat and terminal: the two doors that need no app

Memnox reaches a person through five doors: the console, the Mac, the iPhone, chat and the
terminal. This spec covers the last two, because they are how Lin (Linux, no Apple device) and
Bo (a Linux laptop and Discord) get the whole product. If either door is weaker than the iPhone,
those two people get a lesser Memnox, and `user-flows.md` promises they will not.

Each message type and each command is treated as a page in the shape of `TEMPLATE.md`. Labels in
quotes come from the working tree, uncommitted files included:

- Chat: `memnox-cloud/src/notifications`. Messages are built in `notification.service.ts`,
  `held-grouping.ts`, `plain-words.ts` and `held-answer-text.ts`. Presses are answered in
  `conversation-decisions.ts` and `policy-reply.ts`, commands in `chat-commands.ts` and
  `bot-hooks.ts`, and each tool is rendered by `conversation-channel.ts` (Slack and Discord),
  `telegram-bot.ts` and `teams-bot.ts`.
- Terminal: `memnox-runtime/packages/cli/src`, with the held card in
  `packages/core/src/gate/permission-card.ts` and `tty-prompt.ts`.

Every **Improved** block can be built from what the code already holds. Nothing in it is
described as shipped.

**Three facts shape everything below.**

1. A held call is one object that every door shows. On chat it is a direct message with six
   buttons. On the terminal it is a card drawn over the agent's own output, plus
   `memnox approve <id>` from any other shell. The first answer wins on every door.
2. Chat holds no signing key, so a yes from chat is signed by the linked account and nothing
   more. That is why linking comes first in this spec, and why an unlinked account can decide
   nothing.
3. The terminal has two sign ins that people confuse: `memnox login` enrols the **machine** and
   `memnox signin` signs in the **person**. Only the second one lets this terminal answer
   questions routed from the workspace. It was `memnox signin` until the word misled:
   one person signs in, and the Mac app's Account page runs the same flow for the daemon.

---

# Chat

## Linking a chat account

`chat-link.ts`, `chat-link-attach.ts`, `bot-hooks.ts` · reached from: console Settings > Account,
"Chat accounts", then the chat tool.

**Job.** Is this chat account me, so Memnox can ask me here and believe my answer?

**Today.**

- **Slack** needs no step. An account is matched by the address in Slack's directory, so the
  console card reads "Found by your address" and there is nothing to undo ("unlinkable" is false
  for Slack).
- **Discord, Telegram and Teams.** The console issues an eight character code with no 0, O, 1, I
  or L in it, good for 15 minutes (`CHAT_LINK_TTL_S`) and usable once. The person types
  `/memnox link <code>` (on Telegram and Teams, just `link <code>`). A Telegram deep link opens
  `t.me/<bot>?start=<code>` and reads `/start <code>` as `link <code>`. A Teams link opens the
  one to one chat, but the code is still typed, because Teams passes nothing from a link into the
  conversation.
- **Replies** (`linkReply`):
  - linked: "Linked. Memnox now knows this account is <name>, and will ask you here."
  - code belongs to a former member: "That code belongs to somebody who is no longer a member
    here, so nothing was linked."
  - account already somebody else's: "This account is already linked to somebody else in that
    workspace, so nothing changed."
  - unknown, used or expired: "That code is not valid. Codes work once and expire after 15
    minutes, so get a new one in the console."
- **Not linked**, on any press or command (`UNKNOWN_ACCOUNT`): "Memnox does not recognise this
  account yet. Get a link code in the Memnox console on the Connectors page, then type /memnox
  link <code> here."
- **Wrong place.** Telegram outside a private chat: "Memnox answers in a private chat. Message
  the bot directly." Teams outside a personal chat: "Memnox answers in a one to one chat. Open a
  chat with the Memnox bot and type there."

**What gets in the way.**

- [Consistency] The not linked reply sends people to "the Connectors page", but `user-flows.md`
  puts the code under Settings > Account, "Chat accounts". Someone told the wrong page looks
  there, finds nothing and gives up.
- [Consistency] A policy button pressed from an unknown Slack account says "Ask an admin to link
  it to your profile, or approve in the console." (`policy-reply.ts`). No admin can link someone
  else's account: the person links their own, with a code.
- [Progressive disclosure] The linked reply names the person and stops. It never says what is
  waiting right now or what the bot can do, so the very first DM after linking is an
  unexplained question.
- [Accessibility] On Telegram the help and the reply text arrive as plain text with no parse
  mode, so every backtick in "`link <code>`" is shown as a literal character.

**Improved.**

```
┌ Memnox ─────────────────────────────────────────────────────┐
│ Linked. Memnox knows this Discord account is Bo Lindqvist.  │
│                                                             │
│ From now on, when an agent you answer for is waiting,       │
│ the question comes here with its buttons.                   │
│                                                             │
│ 1 is waiting on you right now:                              │
│ Codex on build-box wants to push to main.                   │
│ [ Allow once ] [ Allow for this session ] [ Deny ]          │
│                                                             │
│ Type /memnox help to see what else works here.              │
└─────────────────────────────────────────────────────────────┘
```

- One place name everywhere: "Get a link code in the Memnox console, under Settings > Account,
  Chat accounts, then type /memnox link <code> here." Use the same sentence in `policy-reply.ts`,
  so no message asks an admin to do what only the person can.
- After `LINKED`, post whatever `waiting` would post for this person, so linking pays off at
  once (_hierarchy_: the waiting question comes first).
- Strip backticks from text bound for Telegram and Teams, which render plain text.

---

## Held call: "Memnox needs your OK"

`notification.service.ts` `heldMessage`, `plain-words.ts` `heldLines` · reached from: a direct
message, raised when the machine's heartbeat reports a held call (every 2 seconds while
something is held).

**Job.** An agent is stopped and waiting on me. What does it want, and do I let it?

**Today.**

- Header: "Memnox needs your OK".
- Line 1, the question (`heldSummary`): the machine's own summary where it sent one, otherwise
  built as "<Agent> wants to <verb> `<target>`.", for example "Claude Code wants to push to
  `main`." Without a verb it reads "<Agent> wants your OK for this <operation> on `<target>`."
  A shell variable as the target becomes "a path its command keeps in `$OUT`".
- Line 2, when a task is known: "While working on: "<task>"".
- Line 3: "Why you are asked: <reason>", with "you chose to be asked about this: " rewritten as
  "You asked to check this yourself: ".
- A link "Open in Memnox: <console>/inbox" in plain text renderings, and "Open in Memnox" as a
  card button on Teams.
- Six buttons in this order: "Allow once" (primary), "Allow for this session" (or "Allow this
  one for the session" on a destructive action with a target), "Deny" (danger), "Always allow
  this agent", "Allow once, always ask", "Always deny".
- Per tool: Slack draws one actions row that wraps. Discord puts five buttons in the first row
  and "Always deny" alone in a second. Telegram puts the first three on one row and each always
  answer on a row of its own. Teams draws an Adaptive Card with six Submit actions and
  "Open in Memnox" as a seventh.
- Who sees which buttons: Telegram and Teams leave the three always buttons off for anyone who is
  not an admin (`bot-delivery.ts` `forReader`). Slack and Discord show all six to everyone.
- Escalation: when nobody who answers for the agent answers within the escalation window (5
  minutes by default), the same message goes to the next people with the extra line "• Nobody
  who answers for this agent has answered yet, so it is asked of you too."
- What a press does:
  - "Allow once" and "Allow for this session" answer `once` and `session`. "Deny" answers `deny`
    and needs no proof beyond the linked account.
  - Each always button answers the call and proposes a team rule, which only an admin may press.
  - The message is replaced by one line, for example "Git push allowed once." in a DM, or
    "Git push allowed once by Ana." in a room.
- States:
  - Not linked: `UNKNOWN_ACCOUNT`, shown only to the presser.
  - Not reached yet: "This question has not been put to you. It goes to the people who answer
    for that agent first, and wider after the escalation window."
  - Teamless workspace pressed by a viewer: "This workspace has no team to route its questions
    among, so a reviewer or an admin answers them."
  - Role too low for an always answer: "Only an admin can decide this."
  - Already answered or gone: "Already decided, or no longer waiting. Nothing to do."
  - Telegram button past 24 hours: "This button has expired. The question is still in the Memnox
    console, under Waiting on you."
  - Each call is asked at most once a day per person, and at most five calls are named at once
    (`MOST_CALLS_NAMED`).

**What gets in the way.**

- [Consistency] The single message never names the machine. "Claude Code wants to push to
  `main`." breaks the shared label "<agent> on <machine>", while the grouped message does carry
  "(build-box)". Bo, who answers for Ana's team, cannot tell her laptop from her VPS.
- [Hierarchy] Six buttons with equal weight. The three always answers write team rules, yet they
  sit beside the everyday three. On Discord "Always deny" lands alone on a second row, where it
  looks like the most important button.
- [Consistency] Slack and Discord show the three admin answers to people who will be refused
  with "Only an admin can decide this.", while Telegram and Teams hide them. The same person sees
  six buttons in one tool and three in the other.
- [Proximity] Once answered, the whole message is replaced by "Git push allowed once.", so the
  question, the agent and the reason all vanish. Scrolling back a day later shows an answer
  with nothing to say what it answered.
- [Contrast] No line says how long the agent will wait. A terminal hold lasts 2 minutes and an
  unattended one 10, so a press that arrives late meets "Already decided, or no longer waiting"
  with no warning beforehand.
- [Consistency] The message carries no action id, yet `/memnox why` asks for one and says
  "The id is on the line in the channel".
- [Accessibility] "Allow this one for the session" differs from "Allow for this session" by
  one word, and nothing explains why.

**Improved.**

```
┌ Memnox ─────────────────────────────────────────────────────┐
│ Codex on build-box wants to push to main                    │
│ from Ana's team                                             │
│                                                             │
│ While working on: "ship the billing migration"              │
│ Why you are asked: pushes to main ask first (team rule)     │
│ Waits 9 more minutes, then it is refused.        act_8f21   │
│                                                             │
│ [ Allow once ]  [ Allow for this session ]  [ Deny ]        │
│                                                             │
│ More answers ▾   (admins: Always allow this agent,          │
│                   Allow once, always ask, Always deny)      │
│ Open in Memnox                                              │
└─────────────────────────────────────────────────────────────┘
```

After any door answers, the same message keeps its first two lines:

```
┌ Memnox ─────────────────────────────────────────────────────┐
│ Codex on build-box wants to push to main                    │
│ ✓ Allowed once by Ana on iPhone at 14:05 UTC.               │
└─────────────────────────────────────────────────────────────┘
```

- Put the machine in the headline through `machineName`, which `askOne` already looks up for
  grouped messages, and add ", from <person>'s team" when `call.reachedPersonIds` widened.
- Show three buttons. On Slack, put the always answers behind an overflow menu (Block Kit
  `overflow`). On Discord, use a second row offered only to admins, through the same
  `forReader` filter Telegram and Teams use, since `Recipient.admin` is already known.
- Name the deadline from the call's expiry, and carry the action id so `/memnox why` works from
  the message itself.
- Never replace the question. Write `settledText` under the headline instead of over it.

---

## Grouped held calls

`held-grouping.ts` `groupedHeldMessage` · reached from: a direct message, when two or more
questions reach one person within 120 seconds (`HELD_GROUP_WINDOW_S`).

**Job.** Several agents are waiting on me at once. Which ones, and on which machines?

**Today.**

- Header: "Memnox needs your OK".
- Count line (`waitingLine`): "3 waiting: 2 on build-box, 1 on Ana's Mac", busiest machine first.
- Past five: "• and <n> more in your inbox".
- One block per call: "• <question> (<machine>)", each with its own "Allow once", "Allow for
  this session" and "Deny". There are no always answers in a group.
- Telegram numbers each line and prefixes each button ("1. Allow once"), because its buttons sit
  below all of the text.
- When one call in the group is settled, the group is not rewritten. The answer is posted once
  as a thread reply, so the buttons of the others survive.

**What gets in the way.**

- [Proximity] On Telegram the questions are numbered in the text and their buttons are stacked
  under all of it, so the reader matches "2." in the text to "2. Deny" by eye. A misread
  answers the wrong agent.
- [Consistency] The line reads "<question> (<machine>)", which reverses the shared label "<agent>
  on <machine>".
- [Hierarchy] The thread replies pile up under the group, and the group itself still shows
  buttons for calls that are already settled. Pressing one returns "Already decided, or no
  longer waiting. Nothing to do."
- [Progressive disclosure] A group with nothing in it but the three answers offers no route to
  always. That is reasonable, but it does not say so, so an admin looking for "Always allow"
  never finds it.

**Improved.**

```
┌ Memnox ─────────────────────────────────────────────────────┐
│ 3 waiting on you: 2 on build-box, 1 on Ana's Mac            │
│                                                             │
│ 1  Codex on build-box wants to push to main                 │
│    [ Allow once ] [ Allow for this session ] [ Deny ]       │
│                                                             │
│ 2  Codex on build-box wants to delete dist/                 │
│    ✓ Denied by you at 14:06 UTC.                            │
│                                                             │
│ 3  Claude Code on Ana's Mac wants to reach api.stripe.com   │
│    [ Allow once ] [ Allow for this session ] [ Deny ]       │
│                                                             │
│ Open one in Memnox for its other answers.                   │
└─────────────────────────────────────────────────────────────┘
```

- Where the tool can edit (Slack, Discord, Telegram, Teams all can), rewrite the settled row in
  place and keep the buttons of the rest. Each row is already its own `actionGroup`.
- On Telegram, label each button with the agent ("Codex: Allow once") rather than a bare number.
- Use "<agent> on <machine> wants to ..." for every row.

---

## Answered elsewhere

`held-answer-text.ts` `settledText`, `notification.service.ts` `heldCallSettled` · reached
from: any DM that asked a call somebody else, or another door, has answered.

**Job.** Do I still need to do anything?

**Today.**

- Single question: the message is rewritten where the tool allows it, buttons gone, to "<What>
  <outcome> by <person> on <door>.", for example "Git push allowed once by Ana on iPhone."
  - Outcomes: "allowed once", "allowed for this session", "denied".
  - Doors: "iPhone", "Mac", "the web", "Slack", "Discord", "Telegram", "Teams", "the console",
    "the terminal", or "Memnox" when unknown.
- A call with no answer recorded reads "<What> is no longer waiting."
- Grouped question: the answer is posted as a thread reply rather than rewriting the group.
- The words for what was held come from a table (`OPERATION_PHRASE`), for example "File
  deletion", "Force push", "MCP call <tool>". A name the table does not know is shown in
  backticks as the raw operation.

**What gets in the way.**

- [Consistency] The template sentence is "Allowed once by <person> on <door>." Today's sentence
  starts with the operation ("Git push allowed once by ..."), so it reads differently from the
  Mac and the iPhone.
- [Contrast] A timeout and a cancellation both read "<What> is no longer waiting.", which does
  not say whether the agent went ahead. For a timeout it did not, and that is the one thing the
  reader needs to know.
- [Consistency] "the terminal" names no person. Locally the hold is recorded as answered by
  "the terminal" (`routed-prompt.ts`), so the record never says who was at it.

**Improved.**

```
Codex on build-box wants to push to main
✓ Allowed once by Ana on iPhone at 14:05 UTC.

Claude Code on Ana's Mac wants to delete dist/
✗ Nobody answered in 10 minutes, so it was refused.
```

- One sentence on every door: "Allowed once by <person> on <door>." under the unchanged
  question.
- Separate timeout ("Nobody answered in <n> minutes, so it was refused.") from withdrawn ("The
  agent stopped waiting.").
- Record the terminal answer with the operating system user, which `approvals.command.ts`
  already reads through `userInfo().username`: "by lin on the terminal".

---

## Rule proposals

`notification.service.ts` `policyProposed`, `policyResolved`, `offerHandOvers`; the always
buttons in `conversation-decisions.ts` · reached from: a team channel (the one the proposal came
from), or each admin's DM except the proposer's.

**Job.** Someone wants to change what agents may do. Do I agree?

**Today.**

- **Proposed.** Header "Policy change proposed by <proposedBy>". Lines from `describeChange`:
  "• Adds: <names>", "• Removes: <names>", "• Changes: <names>", and "• Leaves <n> other rules as
  they are". Buttons "Approve" (primary) and "Reject" (danger), or no buttons at all when the
  workspace approves only in the console.
- **Press replies** (`policy-reply.ts`):
  - "Policy change approved by <by>, now in force as version <n>."
  - "Policy change rejected by <by>."
  - Not an admin: "Only an admin can publish a policy change."
  - Console only: "This workspace approves policy changes in the Memnox console. Open the link on
    the message to approve it there."
  - Already resolved: "Already <detail>", then a dash, then "nothing to do."
  - Publish failed: "Could not publish it: <detail>. It is still pending."
- **Failed after approval**, to the proposer only: "Policy change approved but NOT published",
  the change lines, "• Why it failed: <reason>", and "• Nothing changed on any machine. Approving
  it again retries the publish."
- **Always answers** on a held call reply "Allowed once, and proposed as a rule for this agent,
  waiting on a second admin", or the ask and deny equivalents. The rule is asked in the room
  where the button was pressed, never in a DM.
- **`/memnox next`** posts up to three "Something your team keeps approving" messages: "• <agent>
  was approved <n> times for <operation> and refused none", with "Propose this rule". The press
  replies "Proposed as a rule, waiting on a second admin".

**What gets in the way.**

- [Hierarchy] The change lines name rules and nothing else ("Adds: git-push-main"). The approver
  is asked to agree to a name, not to what agents will now do.
- [Consistency] "Already ..." uses a dash, which breaks the copy rule, and "NOT" in capitals is
  the only shouted word anywhere in chat.
- [Progressive disclosure] An always answer pressed in a DM proposes a rule that "waits on a
  second admin", but the reply does not say where that admin will be asked. When it was a DM,
  the rule waits silently in the console.
- [Consistency] The proposer is named by `proposedBy`, which can be an address, while every
  other message uses a display name.
- [Accessibility] A console only workspace gets a message with no buttons and a reply that tells
  the person to "Open the link on the message", but on Slack and Discord the link is not in the
  rendered blocks (`slackBlocks` draws the header and the lines only).

**Improved.**

```
┌ Memnox ─────────────────────────────────────────────────────┐
│ Ana proposes a rule change                                  │
│                                                             │
│ Adds    pushes to main ask first                            │
│         Codex and Claude Code on every server               │
│ Leaves  14 other rules as they are                          │
│                                                             │
│ A second admin has to agree. Ana cannot approve her own.    │
│ [ Approve ]  [ Reject ]               Open in Memnox        │
└─────────────────────────────────────────────────────────────┘
```

Press reply:

```
✓ Approved by Bo. In force as version 42 on every machine within a minute.
```

- Describe each rule by its effect and scope, which `PolicyChangeSummary` can carry, rather
  than by its name.
- Rewrite the already resolved reply as "Already approved, so there is nothing to do." and the
  failure header as "Approved, but not published yet".
- When an always answer is pressed in a DM, say where the rule went: "Proposed as a rule. The
  other admins are asked in their DMs."
- Always draw the console link as a button on Slack and Discord when there are no actions.

---

## Findings

`notification.service.ts` `agentReported`, `incidentOpened`, `decisionChecksRaised`,
`leaseCollided`, `agentFrozen`, `freezeDeclared` · reached from: a DM to the machine's owner or
to the admins, or the channel a command was typed in.

**Job.** Something happened that only a person can judge. What is it, and what can I do here?

**Today.**

- **New agent.** "A new agent is running", with "• <Agent> started working on <machine>, and
  nobody has approved it yet." and "• Memnox watches and records what it does either way.
  Approving it says it belongs here." Button "Approve it" (primary, admin).
- **Incident.** "Incident opened, <title>", with "• What happened: <summary>", "• Agent:
  <agent>", "• How serious: <severity>", "• Opened at <time>", and "• Nothing stops this on its
  own, so it waits for somebody to look."
  - Buttons: "Acknowledge", "Resolve" (primary), "Pause <agent> on every machine" (danger), and
    "Enforce the rules on every machine".
  - The two containment buttons leave the message open and tell only the presser.
  - Repeated blocks never reach chat, because the rules already stopped them.
- **Decision check.** "An agent changed files a decision you answer for bears on", with "•
  <agent> on <machine> wrote <paths>", then the decision quoted (or "• The decision is not shared
  outside Memnox. Open it there to read it."), then "Does the change match what was decided?"
  Buttons "Matches" and "Off course".
- **Collision.** "Two agents are editing the same lines" with a `diff` block:
  - "@@ <path> @@"
  - "+ <holder> holds <span>, editing since <time>"
  - "+ last doing: <activity>"
  - "- <other> was stopped at <span>"
  - Then a sentence on what happened next, and the button "Give these lines to <agent>".
- **Freeze.** "<agentId> is frozen on every machine" or "The fleet is frozen", with who, until
  when in UTC and why, and "Lift it" (danger).

**What gets in the way.**

- [Consistency] The agent freeze header uses the raw `agentId` ("agt_codex is frozen on every
  machine") where every other message runs the name through `agentShown`.
- [Contrast] "Lift it" is styled danger. Lifting a freeze lets agents ship again, so danger is
  right, but the incident's "Pause <agent> on every machine" uses the same red. Two opposite acts
  look alike.
- [Hierarchy] The incident's four buttons share one row. "Acknowledge" (doing nothing yet) sits
  first, and the containment a person most needs in a real incident is third.
- [Accessibility] The collision `diff` block relies on Discord's red and green. Slack strips the
  language and shows plain `+` and `-`, so the reader has to know diff notation to know who
  holds the lines.
- [Consistency] "How serious: high" shows a severity word, which is fine, but the time is UTC
  with no local time. That is a quiet cost at 03:00 for anyone outside UTC.

**Improved.**

```
┌ Memnox ─────────────────────────────────────────────────────┐
│ Incident: Codex retried a failing deploy 14 times           │
│ Codex on build-box · high · opened 03:12 UTC                │
│ Nothing stops this on its own.                              │
│                                                             │
│ [ Pause Codex on every machine ]                            │
│ [ Enforce the rules everywhere ]                            │
│ [ Acknowledge ]  [ Resolve ]          Open in Memnox        │
└─────────────────────────────────────────────────────────────┘
```

```
┌ Memnox ─────────────────────────────────────────────────────┐
│ Two agents reached for src/billing/invoice.ts               │
│                                                             │
│ Keeps it   Claude Code on Ana's Mac, lines 40 to 88,        │
│            since 14:02 UTC (last: editing totals())         │
│ Stopped    Codex on build-box, lines 52 to 60               │
│                                                             │
│ [ Give these lines to Codex ]                               │
└─────────────────────────────────────────────────────────────┘
```

- Containment first, the bookkeeping last.
- The collision as two labelled rows ("Keeps it" and "Stopped") rather than diff signs, so it
  reads the same with or without colour.
- `agentShown` on every header.

---

## Quiet server

`notification.service.ts` `serversSilent`, `serverBack` · reached from: a DM to the server's
owner, or the admins, only when the workspace turned on `fleet.silenceToChat`.

**Job.** Is my unattended server still governed?

**Today.**

- Header "<label> has gone quiet" (or "server <8 chars>").
- "• Its last heartbeat was at <time>, and nothing since." (or "• It has not sent a heartbeat
  since it enrolled.")
- "• Either the box is down or its runtime stopped, and nothing it does reaches this workspace
  until it beats again."
- "• You are told once for this outage. The next heartbeat ends it."
- Link to the inbox. Back: a thread reply "<label> is back: it beat again at <time>."
- Off by default, in which case only the owner's devices are woken.

**What gets in the way.**

- [Progressive disclosure] Nothing says what to do. The owner of a VPS has to know to SSH in and
  run `memnox doctor` or `memnox daemon --status`.
- [Hierarchy] "Either the box is down or its runtime stopped" is the most useful line and it
  sits second.
- [Consistency] Lin and Bo have no Apple device to wake, so with the default off they learn
  nothing at all. The default suits Maya and leaves out exactly the people this door serves.

**Improved.**

```
┌ Memnox ─────────────────────────────────────────────────────┐
│ build-box has gone quiet                                    │
│ Last heartbeat 02:41 UTC. Nothing it does reaches you now.  │
│                                                             │
│ On the box:  memnox daemon --status                         │
│              memnox doctor --wiring                         │
│                                                             │
│ Told once. The next heartbeat ends it.   Open in Memnox     │
└─────────────────────────────────────────────────────────────┘
```

- Turn chat on by default for an owner who has a linked chat account and no paired device.
- Name the two commands that diagnose it.

---

## The `/memnox` commands

`chat-commands.ts` (Slack and Discord), `bot-hooks.ts` (Telegram and Teams) · reached from:
typing `/memnox <words>` in Slack or Discord, or the words alone in a Telegram or Teams chat with
the bot.

Every command checks the linked account first. An unlinked one gets `UNKNOWN_ACCOUNT`. Replies
marked **to the person** are ephemeral. Replies marked **to the channel** are posted for
everyone, with the person's name.

### `/memnox` and `/memnox help`

**Job.** What can I do from here?

**Today.** Fifteen lines, "What `/memnox` does here:", one per command, in this order: waiting,
tell, why, next, join, leave, freeze, unfreeze, freeze-agent, enforce-everywhere, approve-agent,
mode, revoke, link. An unknown verb replies "`<verb>` is not something /memnox does." followed
by all fifteen lines.

- Telegram and Teams get `BOT_HELP` instead: waiting, tell, why and link. Any other verb gets
  "That one is done in Slack, Discord or the console. Here Memnox does waiting, tell, why and
  link."
- Discord's registered command describes itself as "Ask Memnox, or have it join a meeting", and
  its option as "join <meeting link>, next, or help".

**What gets in the way.**

- [Progressive disclosure] Fifteen commands for everyone, and nine of them are admin only. A
  viewer reads them all and is refused by most.
- [Consistency] Discord's description sells the notetaker first. The commands people use most
  are `waiting` and `why`.
- [Hierarchy] An unknown verb repeats the whole list instead of the nearest command.

**Improved.**

```
/memnox help                                   (only you can see this)

Answer and ask
  waiting                 what is waiting on you, with its buttons
  why <act_id>            why an action went ahead or was stopped
  tell <agent> <words>    say something to an agent at its next step

Admins
  freeze 2h [why]   unfreeze   freeze-agent <agent> 2h   mode <machine> <mode>
  … and 6 more:  /memnox help admin

Not linked yet?  /memnox link <code>, code from Settings > Account.
```

- Show the admin block only to admins (the role is known by now).
- Discord: "Answer your agents, see why, or tell one something."
- An unknown verb answers with the nearest command ("Did you mean `freeze-agent`?"), the way
  `unknown-command.ts` already does in the terminal.

### `/memnox link <code>`

Covered under **Linking a chat account**. It is the one command that runs before the account is
known.

### `/memnox waiting`

**Job.** Show me everything waiting, so I can answer it here.

**Today.** It posts, in the channel it was typed in, every held call in the workspace (up to the
cloud's re-ask limit), every pending decision and every candidate fact, each with buttons. The
reply to the person is "Posted <n> in this channel, each with its buttons." or "Nothing is
waiting on a person."

**What gets in the way.**

- [Hierarchy] It posts everything waiting in the **workspace**, not what is waiting on **me**.
  Bo types it and sees Ana's calls, presses one and is told "This question has not been put to
  you."
- [Consistency] In a team channel it posts held questions where everyone can read them. The DM
  path deliberately sends each question only to whoever may answer it.
- [Proximity] Three kinds of thing arrive as separate messages with no heading, so a busy
  channel interleaves them.

**Improved.**

```
/memnox waiting                                (only you can see this)

2 waiting on you, 1 more on your team
Posted the 2 that are yours in your DM.
The team's 1 is Hermes on build-box, asked of Ana until 14:10 UTC.
```

- Filter by `reachedPersonIds` for the person who typed it, and send held calls to their DM even
  when typed in a room. Decisions and facts keep going to the room they came from.
- Summarise the team's count in one line, so nothing is hidden and nothing is pressable that
  would be refused.

### `/memnox why <action>`

**Job.** Why did this go ahead, or why was it stopped?

**Today.** With no id: "Say which action: `/memnox why act_8f21`. The id is on the line in the
channel or in `memnox timeline`." With an id, up to six lines from `whyNote`:

- "`act_8f21` was stopped." or "`act_8f21` waited for a person, after the rules said ask."
- "Rule: `<match>` (<layer>, line <n>), because <reason>", or "No rule matched it, so the
  workspace's default decided."
- "Instead: <alternative>"
- "True at the time: <conditions>, and <n> more."
- "Evidence: <n> items you can see. <n> more is above your clearance."

Unknown id: "Nothing was decided for <id>, or it is not in this workspace."

**What gets in the way.**

- [Consistency] No chat message carries an action id, so "the id is on the line in the channel"
  is untrue for every held question.
- [Hierarchy] The first line repeats the id rather than saying what the agent tried to do.
- [Progressive disclosure] No id means no answer, when "the last thing stopped for me" is the
  question people actually ask.

**Improved.**

```
/memnox why                                    (only you can see this)

Codex on build-box was stopped from force pushing to main.   act_8f21
Rule     no force pushes (team rule, decided by Ana on 2026-09-30)
Instead  push a branch and open a pull request
Evidence 3 items you can see.                         Open in Memnox
```

- With no id, answer for the last non allow decision the person can see.
- Lead with "<agent> on <machine> <what happened>", and keep the id at the end of the line.

### `/memnox tell <agent> <message>`

**Today.** Missing words: "Say who and what: `/memnox tell claude-code finish the migration and
stop`." Not permitted: "Only a reviewer, an admin, or an owner of that agent can tell it
anything." Sent: "Sent. <agent> reads it at its next step." Empty or too long: "That message was
empty or too long, so nothing was sent."

**What gets in the way.** [Consistency] The agent is named by its id ("claude-code"), with no
machine, so a person running Claude Code on two machines cannot choose one. [Progressive
disclosure] "Too long" never says the limit.

**Improved.** "Sent to Claude Code on Ana's Mac. It reads it at its next step, and you will see
its reply in `/memnox why` once it acts." Accept `<agent>@<machine>`. When two sessions match,
reply with both and ask which. State the limit in the refusal.

### `/memnox next`

**Today.** Reviewer or admin. It posts up to three "Something your team keeps approving"
messages and replies "Posted <n> in this channel. Pressing one proposes a rule, which still waits
on a second admin." or "Nothing yet: this is for something approved several times and refused
none, and there is no such habit in the last fortnight."

**What gets in the way.** [Consistency] The terminal's `memnox next` reads 30 days, while this
reads "the last fortnight". [Hierarchy] The posted line "<agent> was approved <n> times for
<operation>" uses the raw operation (`git.push`).

**Improved.** "Codex on build-box: you allowed pushes to feature branches 9 times and refused
none in 30 days. [Propose this rule]". Use one window on both doors, and the phrase table for
the operation.

### `/memnox join <link> [title]` and `/memnox leave`

**Today.** Reviewer or admin. Join posts to the channel: "<name> sent the notetaker into a call.
It records and transcribes until it is called out, and the decisions read out of it are asked
here." Failure: "The notetaker could not join. It may not be configured for this workspace, or
the link was not one it can enter." Leave: "<name> called the notetaker out of the call." or
"The notetaker is not in a call."

**What gets in the way.** [Progressive disclosure] These two have nothing to do with agents, yet
sit second in Discord's command description. They are fine as commands.

**Improved.** Keep them as they are, and move them under a "Meetings" heading in help.

### `/memnox freeze <30m|2h|1d> [why]` and `/memnox unfreeze`

**Today.** Admin. Freeze needs a duration of up to a week: "Say for how long, up to a week:
`/memnox freeze 2h release day`." It replies to the person "Frozen. The channel has it, with a
button to lift it." and posts "The fleet is frozen" with "Lift it". Unfreeze posts "<name> lifted
the freeze. Agents can ship again." or replies "Nothing is frozen."

**What gets in the way.** [Consistency] The posted message says "Agents keep working and nothing
ships until it is lifted." "Ships" is undefined. Is it pushes, deploys, or every write class
action? [Accessibility] The time is given as "2026-10-07T16:00 UTC" style (`toISOString`), which
nobody reads at a glance.

**Improved.** "The fleet is frozen until 16:00 UTC (in 2 hours) by Ana: release day. Agents keep
working. Pushes, deploys and publishes are refused until then. [Lift it]"

### `/memnox freeze-agent <agent> <duration> [why]`

**Today.** Admin. "Say which agent and for how long, up to a week: `/memnox freeze-agent
claude-code 2h pushed to main`." Success: "<agent> is frozen on every machine. The channel has
it, with a button to lift it."

**What gets in the way.** [Consistency] The posted header uses the raw id (see **Findings**).

**Improved.** "Claude Code is frozen on every machine until 16:00 UTC by Ana. Every machine
refuses its actions from its next bundle, within a minute. [Lift it]"

### `/memnox enforce-everywhere`

**Today.** Admin. It posts "<name> moved <n> machines to enforce. Each applies it at its next
heartbeat." or replies "Every machine is already enforcing." or "No active machine to move."

**What gets in the way.** [Progressive disclosure] There is no confirmation for a fleet wide
change, and no undo is named.

**Improved.** Reply first, to the person only: "This moves 6 machines from observe to enforce,
so what the rules refuse is refused. [Move all 6] [Cancel]". After the move, the channel
message names the undo: "/memnox mode <machine> observe".

### `/memnox approve-agent <agent>`

**Today.** Admin. "Say which agent: `/memnox approve-agent hermes`." Not governed: "<agent>
holds no credential from this workspace, so there is nothing here to approve. Onboard it on its
machine with `memnox agents onboard` first." Unknown: "No agent called <agent> in this
workspace." Success, to the channel: "<name> approved <agent>. It is out of shadow."

**What gets in the way.** [Consistency] "Out of shadow" is internal language, and nowhere else
calls an unapproved agent shadowed. [Consistency] The onboarding hint names `memnox agents
onboard`, while every terminal screen sends people to `memnox setup`.

**Improved.** "Ana approved Hermes on build-box. It now counts as one of the team's agents."
For the hint, use "Put it under Memnox on its machine with `memnox setup`."

### `/memnox mode <machine> <off|observe|advise|enforce>`

**Today.** Admin. Usage: "Say which machine and one of off, observe, advise, enforce: `/memnox
mode ana-laptop observe`." Unknown: "No active machine is called <machine>." Success, to the
channel: "<name> put <machine> into <mode>. It takes effect at its next heartbeat."

**What gets in the way.** [Progressive disclosure] Four modes, none explained. "advise" appears
nowhere else a person meets.

**Improved.** Usage reads "observe watches and refuses nothing, advise tells the agent but lets
it go, enforce refuses what the rules refuse, off stops Memnox on that machine." The success
line says what changed: "build-box now enforces (was observe), from its next heartbeat."

### `/memnox revoke <machine>`

**Today.** Admin. "Say which machine: `/memnox revoke hermes-vps`." Success, to the channel:
"<name> revoked <machine>. Its credential no longer works."

**What gets in the way.** [Progressive disclosure] An irreversible act with no confirmation and
no word on what happens to the agents on it.

**Improved.** First "Revoking build-box ends its credential and those of its 2 agents. The rules
it last pulled keep applying there. [Revoke build-box] [Cancel]", then the channel line.

---

# Terminal

## First run: bare `memnox` and `memnox --help`

`program.ts` `withDefaultCommand`, `help.ts` · reached from: typing `memnox` after
`npm i -g memnox`.

**Job.** What is this, and what should I do first?

**Today.**

- Bare `memnox` runs `scan` on a machine that is not set up, and `status` once it is.
- Every run except `--json` and `help` draws the "memnox" wordmark first (`renderMasthead`).
- `memnox --help` describes the program as "Memnox, the execution trust layer for AI agents" and
  lists only the SPINE: setup, status, rewind, doctor, stop, start, update, login. Under it:
  "Everything else happens in your agent session; "memnox help --all" lists every command."

**What gets in the way.**

- [Consistency] "Execution trust layer" contradicts the vision's category, a control plane for
  autonomous work, and the console's own promise.
- [Hierarchy] The SPINE leaves out every command Lin needs to answer from the terminal:
  `inbox`, `approve`, `deny`, `why`, `timeline`, `team`, `pair`. The footer says "everything
  else happens in your agent session", which is true for Maya and false for Lin. Lin's question
  is in the terminal, not in a session.
- [Hierarchy] The SPINE order puts `rewind`, `stop` and `start` above `login`, so the first
  run sees recovery before connection.
- [Progressive disclosure] The wordmark is drawn on every command, including `approve`, which
  pushes the answer down by five lines.

**Improved.**

```
$ memnox --help
Memnox: decide what your agents may do, and answer them from anywhere.

Start
  setup            find your agents and put this machine under Memnox
  login            join your workspace, so it gets your team's rules

Every day
  status           where this machine stands, in five blocks
  inbox            what is waiting on you, here and from your team
  approve <id>     allow once (--session for the rest of it)
  deny <id>        refuse
  why [id]         why the last thing was stopped

When something is wrong
  doctor           what is risky, and the change that closes it
  rewind           put the working tree back
  stop / start     turn protection off and on

memnox help --all lists every command.
```

- Group the SPINE under three headings, and add `inbox`, `approve`, `deny` and `why`.
- Draw the wordmark only on `setup`, `status` and bare `memnox`.
- Use the vision's words for the description.

---

## The held prompt in place

`core/src/gate/permission-card.ts`, `tty-prompt.ts`, `routed-prompt.ts` · reached from: an
agent's shell command or tool call that a rule says to ask about, drawn on the controlling
terminal (never on the agent's own stdin).

**Job.** My agent stopped in front of me. Do I let it?

**Today.** A rounded card titled " Memnox ":

```
╭─ Memnox ───────────────────────────────────────────────╮
│ Codex wants to push to a remote                        │
│                                                        │
│   git push origin main                                 │
│   git.push main                                        │
│                                                        │
│ Why   pushes to main ask first                         │
│ Risk  This cannot be undone.                           │
│                                                        │
│ Do you want to allow it?                               │
│ ❯ 1. Yes, once                                         │
│   2. Yes, for the rest of this session                 │
│   3. Edit the command first                            │
│   4. No                                                │
│                                                        │
│ ↑↓ to choose · enter to confirm · esc to say no        │
│ No answer in 1:54 means no.                            │
│ Or answer from anywhere: memnox approve 7f3a           │
╰────────────────────────────────────────────────────────╯
```

- Title phrases: "delete files", "change a file", "read a file", "reach the network", "push to
  a remote", "change the repository", "call a tool", "open a site", otherwise "run a command".
- Keys: arrows and enter. "a" or "y" picks once, "s" session, "e" edit, "d" or "n" no, or a
  number. Escape and Ctrl+C mean no.
- Without raw mode the same card ends "type 1 to 4 and press enter" and " > ".
- Edit puts the command on the line: "Edit the command, then enter (empty cancels):".
- The clock is 2 minutes with a terminal, 10 minutes unattended.
- After answering, the card collapses to one scrollback line: " Memnox · git push origin main ·
  allowed once" (or "refused", "editing", "nobody answered, so refused").
- No terminal: one line, "held <operation> <target> for a person (<n>s): memnox approve <id> |
  memnox deny <id>".
- In parallel, the question is written to `~/.memnox` so a second terminal, the workspace and
  every chat DM can answer it, and the first answer wins.

**What gets in the way.**

- [Consistency] "Yes, once", "Yes, for the rest of this session" and "No" are the only answer
  words on any door that differ from "Allow once", "Allow for this session" and "Deny".
- [Consistency] The title reads "Codex wants to push to a remote", with no machine, and the
  agent name is whatever the request carried, which can be a raw id.
- [Contrast] When an answer arrives from another door, nothing in `RoutedHoldPrompt` closes the
  terminal card: the TTY prompt has no cancel. The card keeps counting down over a call that has
  already been released. When its clock runs out, it can print "nobody answered, so refused"
  into scrollback for a call that was in fact allowed.
- [Proximity] The second line (`git.push main`) is the internal operation name, printed dim
  under the real command. It adds a line and explains nothing.
- [Hierarchy] "Or answer from anywhere: memnox approve 7f3a" names one door. It does not say the
  question is also on the person's phone and in their DM, which is the most reassuring fact on
  the card.
- [Consistency] An interactive hold lasts 2 minutes (`DEFAULT_HOLD_TIMEOUT_MS`), and the cloud
  widens a question after 5 (`HELD_ESCALATION_DEFAULT_MINUTES`). A teammate is therefore never
  asked about a call held at a terminal, which is exactly the call whose owner just walked away.
- [Accessibility] Escape means no, which is safe, but the footer's "esc to say no" sits beside
  a clock that also means no. Nothing on the card shows that "e" edits or "s" picks session
  unless the reader knows the old letters.

**Improved.**

```
╭─ Memnox ───────────────────────────────────────────────╮
│ Codex on lin-laptop wants to push to main              │
│                                                        │
│   git push origin main                                 │
│                                                        │
│ Why   pushes to main ask first (team rule)             │
│ Risk  This cannot be undone.                           │
│                                                        │
│ ❯ 1. Allow once                                  a     │
│   2. Allow for this session                      s     │
│   3. Edit the command first                      e     │
│   4. Deny                                        d     │
│                                                        │
│ Also asked in your Discord DM. First answer wins.      │
│ No answer in 1:54 means deny.        id 7f3a           │
╰────────────────────────────────────────────────────────╯
```

When another door answers first, the card collapses at once to:

```
  Memnox · git push origin main · allowed once by Lin on Discord
```

- Use the shared answer words, with the letter shown beside each.
- Pass an `AbortSignal` from `firstAnswer` into `TtyHoldPrompt.ask`, so a remote answer closes
  the card and prints who answered, using `settled.answeredBy`, which is already read.
- Name the other doors the question reached, from the approval route (`readApprovalRoute`).
- Drop the dotted operation line.
- Make the interactive hold outlast the escalation window when the route includes the workspace,
  or escalate a terminal hold sooner.

---

## `memnox scan`

`commands/scan.command.ts`, `scan/machine-report.ts` · reached from: bare `memnox` on a fresh
machine.

**Job.** What can act on this machine, and what can it reach?

**Today.**

- Rows under "On this machine": "agents", then "removed", "unapproved", "no prompt", "harnesses",
  "definitions", "hooks", "mcp clients", "mcp servers" and "tools" as each applies.
- Then lists: "Credentials these agents can read", "What they can do with them, through a shell",
  "Browser automation", "Combined capability, where no single tool does this" ("Each of these
  tools is ordinary. Holding all of them is the path."), and "Reachable from an agent right now".
- Close: "<n> execution surfaces, and nothing is checking any of them." (or "<n> execution
  surfaces."), then "<n> capabilities can change something outside this laptop." and "None of
  them is governed by a policy." (or "<n> of them are governed by a policy.").
- Hints: "No agent has been approved or refused here. Decide with "memnox config set
  approvedAgents <list>".", "memnox explain <name> where any of these comes from", and
  "memnox protect put the dangerous ones behind ask or deny".
- Empty: "No AI agents found on this machine." and "Nothing was transmitted. Install an agent
  and run this again."
- Flags: `--json`, `--tools`, `--mcp <server>`, `--usage <window>`, `--save`, `--share`,
  `--since`, `--from`, `--to`, `--fail-on`, `--sarif`, `--no-probe`.

**What gets in the way.**

- [Hierarchy] The screen ends on three hints, and none is `memnox setup`, the one command that
  acts on what was just shown. `protect` and `explain` are not on the SPINE.
- [Consistency] "execution surfaces" and "capabilities" are two counts with two nouns in two
  consecutive lines, and nothing says how they differ.
- [Progressive disclosure] `memnox config set approvedAgents claude-code,codex` asks a newcomer
  to type a config key before they have run setup.
- [Contrast] With nothing governed, the warning line is the only colour, which is right, but it
  says "nothing is checking" without saying what would.

**Improved.**

```
┌ memnox scan
│
│ On this machine
│   agents       Claude Code, Codex
│   no prompt    Codex acts without asking, and can read 3 sensitive paths
│   mcp servers  github, postgres   (14 tools, 4 destructive)
│
│ Credentials these agents can read
│   ~/.aws/credentials   2 agents   can modify infra in 2 accounts
│   .env                 2 agents   12 variables, 4 look like credentials
│
└ 9 things here can change something outside this laptop. None is checked.

  memnox setup     put Claude Code and Codex under Memnox, no account needed
  memnox explain   where any of these comes from
```

- One count, one noun.
- `memnox setup` as the first hint, naming the agents it will cover.
- Drop the config key hint, because setup asks the question.

---

## `memnox setup`

`commands/setup.command.ts`, `commands/setup/*.ts` · reached from: the scan hint, the console's
"Add a server" panel, or `memnox login`'s closing hint.

**Job.** Put my agents under Memnox, and connect them to my team if I have one.

**Today.**

- "Looking for agents on this machine", then "Found <n> agents" and their names.
- **With no account.** "What they can reach today" (`mcp`, `can reach`), then "Put them under
  Memnox?" On yes: "Wired this machine" with counts, "This machine is under Memnox.", "Nothing
  left this machine: no account, no key, no network call.", then up to four hints on
  interceptors, the daemon, observe mode and `memnox login`, and "Take all of it back out with
  "memnox uninstall"."
- **With an account.** Per agent: a name prompt ("Call it something <workspace> will
  recognise"), then "Put <name> under Memnox now?" Then the wiring, two questions ("Add the
  interceptors to your login PATH, so an editor started from the dock meets them too?" and "When
  an agent cannot ask you in its own session, send the question to your Slack or Discord DM
  too?"), and a table "In <workspace>" with columns Agent, Status and Reason.
- Moving planes: "Connected to a different control plane", "Move this machine to <url>?"
  (default no).
- No terminal: "Nothing is attached to this terminal, so nobody can be asked." with "Run "memnox
  setup --yes" ...".
- Flags: `--url`, `-y`/`--yes`, `--enforce`, `--name`, `--no-open`, `--no-probe`.

**What gets in the way.**

- [Consistency] The DM question names "Slack or Discord" only. Telegram and Teams users (Lin
  among them) are not offered their own tool.
- [Hierarchy] The DM question comes last, after the PATH question, yet for Lin it decides
  whether any question ever reaches them away from the desk.
- [Progressive disclosure] The closing screen carries up to six hints, and two of them tell the
  person to type `memnox config set mode enforce` "when you have read a week of it". The day
  seven nudge belongs in `status` on day seven.
- [Consistency] Setup never mentions `memnox signin`, so a person who set up their machine
  still cannot answer team questions from this terminal and is not told so.

**Improved.**

```
┌ memnox setup
│
◇ Found 2 agents   Claude Code, Codex
│
◇ Codex   can read ~/.aws/credentials, .env, 4 destructive tools
│  Name in Acme workspace  › Codex on lin-laptop
│  Put it under Memnox?    › Yes
│
◇ Where should questions reach you when you are away?
│  › Discord DM (linked as bo#2231)
│    Terminal only
│
└ 2 agents under Memnox, watching for a week before refusing anything.

  Answer from this terminal too:  memnox signin
  Take it all back out:           memnox uninstall
```

- Ask where questions go as a choice that lists the person's linked tools, read from the
  workspace, rather than a yes or no about two named tools.
- Offer `memnox signin` at the end when the person is not signed in.
- Two hints at most. Move the enforce nudge to `status`.

---

## `memnox login`, `logout` and `whoami`

`commands/login.command.ts`, `sync/connect.ts` · reached from: the console's "Run this on the
server" panel, or setup's hint.

**Job.** Join this machine to my workspace.

**Today.**

- "Control plane <url>", "Machine key generated", "ed25519, never leaves this machine", then
  either "Joining with the token from the console" or "Approving in your browser <url>" (or
  "Approve at <url>"), "Your code <code>", and "Waiting for approval…" with "the code is good for
  <time>. Ctrl+C stops, and nothing will change."
- "Enrolled" rows: name, machine, workspace, mode and credential path. Then "This machine is
  enrolled.", "It now pulls your workspace rules. Nothing else leaves this machine.", "Put your
  agents to work with "memnox setup"." and "Take it back off with "memnox logout"."
- `logout`: "Logged out. The credential is gone.", then "The rules already pulled are still
  enforced, and are no longer refreshed." and "Revoke this machine in the console to end the
  enrolment."
- `whoami`: "Enrolled" rows (workspace, machine, control), "This machine belongs to
  <workspaceId>." Not enrolled: "Not logged in. This machine talks to nothing."
- Flags: `--url`, `--enforce`, `--name`, `--no-open`, `--class`, `--token`.

**What gets in the way.**

- [Consistency] `whoami` and the close name the workspace and machine by id ("This machine
  belongs to ws_8c1d..."), while setup and chat use names.
- [Consistency] `login` is the machine and the person's sign in read alike until the second
  became `memnox signin`, whose description says "login is the machine; this is you", and
  `login` closes by offering it.
- [Progressive disclosure] "Machine key generated" and "ed25519" are shown before the step the
  person must take, which pushes the code and URL down.

**Improved.**

```
┌ memnox login
│
◇ Approve this machine in your browser
│  https://app.memnox.dev/device?code=QKDT-7HXM
│  Your code  QKDT-7HXM      good for 10 minutes · Ctrl+C stops
│
└ lin-laptop joined Acme as a workstation, watching.

  Next:  memnox setup        put your agents under Memnox
         memnox signin       answer what your workspace routes to you, here
```

- Names, not ids, everywhere a person reads.
- Put the key line in `--verbose` (or after the close), and lead with the action.
- Name both next steps, and say which login is which.

---

## `memnox status`

`commands/status.command.ts` · reached from: bare `memnox` on a set up machine.

**Job.** Is this machine held, and does anything need me?

**Today.**

- "This machine" rows: "protection" (only when stopped), "mode" ("observe, watching rather than
  stopping"), "daemon" ("running, and keeping new agents and servers under Memnox"), "agents"
  ("2 agents, hooked: ..."), "mcp" ("3 of 4 servers through Memnox"), "rules", "probation",
  "today" ("41 actions, 6 asked, 1 denied", with "would have been" in observe), "waiting"
  ("nothing" or "2 approvals, 1 paused session"), "dormant" and "team".
- Then "Working now" (a list) and "Ready to hand over" ("<action>: allowed <n> times, never
  refused. "memnox next --hand-over" lets it run without asking.").
- Close: "Memnox is keeping this machine." or "Rules are in force, but nothing keeps new agents
  under Memnox." or "Memnox protection is stopped on this machine."
- Hints: daemon install, ""memnox approvals" lists what is waiting.", offboarding dormant
  agents, and `memnox login`.
- Not set up: "This machine is not under Memnox yet." and ""memnox setup" puts it there, with no
  account."

**What gets in the way.**

- [Consistency] `user-flows.md` says `memnox status` "shows the same five blocks". It does not.
  "Waiting" is the eighth row of a wiring table, "Today" sits above it, and "Not covered" does
  not exist.
- [Hierarchy] What waits on the person is buried in yellow halfway down, after mode, daemon,
  agents, mcp and rules.
- [Consistency] The waiting hint names `memnox approvals`, which shows only this machine. The
  command that shows team questions too is `memnox inbox`.
- [Consistency] "today" counts actions, asks and denials, but never "allowed", which every
  other door counts ("41 actions, 6 asked you, 5 allowed, 1 refused").

**Improved.**

```
┌ memnox status   lin-laptop · Acme · enforcing
│
◆ Waiting on you   2
│   7f3a  Codex on lin-laptop wants to push to main      1m ago
│   c19e  Hermes on build-box wants to run the migration  from Ana's team
│   memnox approve <id>  or  memnox deny <id>
│
◇ Working now
│   Codex on lin-laptop: ship the billing migration
│
◇ Today   41 actions, 6 asked you, 5 allowed, 1 refused
│
◇ Ready to hand over
│   You allowed git.push to feature branches 9 times. memnox next
│
◇ Not covered
│   1 MCP server not through Memnox (postgres)   memnox setup
│
└ Memnox is keeping this machine.   memnox status --wiring for the rest
```

- The five blocks in the shared order, with "Your team" sixth when signed in with `signin`.
- Wiring details (daemon, hooks, rules, probation) under `--wiring`, with only a failure
  surfacing in "Not covered".
- Show the inbox inline rather than a hint to another command.

---

## `memnox approvals`

`commands/approvals.command.ts` · reached from: the `status` hint.

**Job.** What is held on this machine?

**Today.** "Waiting", one row per kind of work: "<id> <agent> wants to <operation> on <target>:
<n> calls", with up to five targets under it, and "and <n> more". Close: "<n> call(s) waiting, in
<k> kind(s) of work." Hints: "memnox approve <id> or memnox deny <id>" and "add --group to
answer for every call of that kind at once". `--flat` gives one row per call. Empty: "Nothing is
waiting."

**What gets in the way.**

- [Consistency] `approvals` and `inbox` overlap. `approvals` shows this machine only, while
  `inbox` shows this machine and the team, and the help never says which to use.
- [Consistency] "call(s)" and "kind(s)" are the only parenthesised plurals in the product.
  `describeCount` already exists.
- [Consistency] The operation is raw ("wants to git.push on main").

**Improved.** Make `approvals` an alias of `inbox`, and keep `--group` and `--flat` on `inbox`
so grouping is not lost. Use "3 calls waiting, in 2 kinds of work."

---

## `memnox approve <id>` and `memnox deny <id>`

`commands/approvals.command.ts` · reached from: the card footer, `inbox`, `approvals`.

**Job.** Answer one question from this terminal.

**Today.**

- `approve`: "Release a call that is waiting for a person". Flags `--session`, `--group`, and
  `--always`, which refuses: "An always answer becomes a team rule, so it is made in the console,
  in Slack or Discord, or in the Memnox apps, where a second admin approves it." with "memnox
  allow <action> --for 2h covers it on this machine for a while".
- `deny`: "Refuse a call that is waiting for a person", flag `--group`.
- Local success: rows "call", "by", "at", then "Approved <id>. The call is released on the
  waiting side." (or "Denied <id>.", or "Approved for this session").
- Team success: "Approved <id> for your team." or "Counted your yes on <id>. <n> more people need
  to agree."
- Already answered: rows "call", "answer", "by", "at", and "Somebody else got there first, which
  is ordinary."
- Errors:
  - "Nothing is waiting under "<id>". It may have timed out. Try "memnox approvals"."
  - "<id> was already answered, or it ran out."
  - "<id> has not reached you, or this terminal could not sign it."

**What gets in the way.**

- [Consistency] The verbs are "approve" and "Approved", where every other door says "Allow once"
  and "Allowed once".
- [Consistency] `--always` names "Slack or Discord" and leaves out Telegram and Teams.
- [Proximity] The success screen shows the id, the operating system user and an ISO timestamp,
  but not what was allowed. Somebody who typed the wrong id learns nothing.
- [Consistency] The not found error sends people to `memnox approvals`, which cannot show team
  questions.

**Improved.**

```
$ memnox approve c19e
✓ Allowed once: Hermes on build-box runs the migration.
  Signed by this terminal as Lin. Ana's iPhone now shows it as answered.
```

- Say what was allowed and on which machine.
- Keep `approve` as the command, and print "Allowed once" as the outcome.
- Name all four chat tools in the `--always` refusal.
- Point the not found error at `memnox inbox`.

---

## `memnox inbox`

`commands/inbox.command.ts` (new, uncommitted) · reached from: `signin`'s hint, the card
footer in the improved version.

**Job.** Everything waiting on me, here and from my team, in one list.

**Today.**

- Heading by count: "<n> waiting here", "<n> waiting from your team", or "<n> waiting: <h> here,
  <t> from your team".
- Local rows: "<id> <describePending>" with detail "on this machine".
- Team rows: "<id> <agent> on <machine> wants to <summary>" with detail "asked of you" or
  "asked of your team" (", needs <n> people"), then the reason.
- Close: "memnox approve <id> allows once, --session for the rest of it, memnox deny <id>
  refuses."
- Not signed in: "memnox signin also shows what your team routes to you". Team read
  failure: the error, as an aside.
- Empty: "Nothing is waiting on you."

**What gets in the way.**

- [Consistency] Local rows print the id twice, because `describePending` already begins with
  `pending.id` and the row prefixes it again: "7f3a 7f3a codex wants to ... (42s ago)".
- [Consistency] Local rows say "<agent> wants to" with no machine, while team rows say "<agent>
  on <machine>". A mixed list reads as two products.
- [Contrast] The age is always in seconds ("(3600s ago)").
- [Hierarchy] The close is a sentence of three commands. That is the most important line, and
  it reads as a paragraph.

**Improved.**

```
┌ memnox inbox
│
◆ 2 waiting on you: 1 here, 1 from your team
│
│ 7f3a  Codex on lin-laptop wants to push to main            1 min
│       Why: pushes to main ask first
│ c19e  Hermes on build-box wants to run the migration       6 min
│       from Ana's team · needs 2 people · Why: migrations ask first
│
└ memnox approve <id>   allow once   (--session for the rest of it)
  memnox deny <id>      refuse
```

- Drop the duplicate id, label local calls with this machine's name, and show ages in minutes
  and hours.
- Add `--follow`, which redraws as calls arrive and settle, so Lin can keep one pane open as an
  island.

---

## `memnox why [id]`

`commands/why.command.ts`, `commands/why/*.ts` · reached from: a refusal the agent printed, or a
chat `/memnox why`.

**Job.** Why was that stopped, or why did it go ahead?

**Today.**

- Heading "<EFFECT> <operation> <target>" (for example "DENY git.push main"), with rows "when",
  "agent", "surface", "class", "does", "reason", "rule" ("<name> (the workspace's rule)" or
  "(<layer> layer)", or "none matched, so the default for this mode applied"), "decided by" or
  "declared in", "ruleset", "would have", and "released by".
- "Instead <alternative>". Then "The task" and "Just before".
- Close: "DENY git.push", then "Add --evidence for the digests and the outcome behind it."
- `--evidence` adds "Evidence" rows and "Evidence from this repository" (branch protection
  through `gh`, the pull request, CODEOWNERS).
- Empty: "Nothing has been decided on this machine yet." with "Run an agent through "memnox mcp
  wrap" first."

**What gets in the way.**

- [Hierarchy] Seven to eleven rows, with "surface", "class" and "ruleset" (a hash) before the
  reason a person came for.
- [Consistency] Shouted effect words and dotted operations ("DENY git.push"), where chat says
  "Git push denied".
- [Consistency] The empty hint names `memnox mcp wrap`, which is no longer how anyone starts.
  Setup is.
- [Consistency] "released by" shows the raw `authorizedBy` and not the door ("Ana on iPhone").

**Improved.**

```
┌ memnox why
│
◆ Codex on lin-laptop was stopped from force pushing to main
│
│ Rule      no force pushes, the workspace's rule, decided by Ana on 2026-09-30
│ Instead   push a branch and open a pull request
│ Task      ship the billing migration
│ Before    git commit -m "fix totals", then git rebase main
│
└ act_8f21 · 14:05 UTC   --evidence for the hashes and the repository
```

- One sentence first, then four rows, with the technical rows under `--evidence`.
- The empty hint: "Run "memnox setup" and use an agent for a while."

---

## `memnox timeline`

`commands/timeline.command.ts` · reached from: `/memnox why`'s hint, the user flows for Lin.

**Job.** What did my agents actually do, in order?

**Today.** One table per session, titled "<agent> <session> <date>", with columns "Time", "",
"Action", "" (symbol and effect, the operation and target, a verb table note, the helper, the exit
code). Close: "<n> action(s) across <m> session(s)." and "One of them end to end: "memnox trace
<id>"." `--follow` opens "memnox timeline --follow" with "Following this machine. Ctrl+C stops."
Empty: "Nothing recorded yet." and "Wrap an agent with "memnox mcp wrap", then use it." Flags:
`--session`, `--agent`, `--since`, `--only allow|ask|deny|blocked`, `--limit`, `--export
jsonl|json|bundle`, `--out`, `--follow`.

**What gets in the way.**

- [Consistency] The same stale `mcp wrap` hint as `why`.
- [Hierarchy] Sessions are titled by session id, not by the task or the machine.
- [Progressive disclosure] It shows this machine only, while Lin's held questions came from
  build-box too. Nothing says so.

**Improved.** Title each session "Codex on lin-laptop · ship the billing migration · 14:00 to
14:32", say "this machine only, the console shows every machine" under the close, and replace
the empty hint with `memnox setup`.

---

## `memnox next`

`commands/next.command.ts` · reached from: the "Ready to hand over" line in `status`.

**Job.** What can I safely stop being asked about?

**Today.**

- "Where you are", a level from "watching, enforcing nothing" to "running, and the boundary has
  caught nothing".
- "What you could hand over": each action, its reason, and "memnox protect --allow <action> (or
  keep being asked)", or "stays a question: <why>".
- "What interrupted you, <n> times in 30 days", a table of Times and Action.
- Close: "<n> thing(s) you have already said yes to enough times that being asked again is the
  tool wasting your attention." and "memnox next --hand-over writes all of them at once".
- Empty: "Nothing has been held for you yet, so there is nothing to hand over." and "Run an
  agent under "memnox run" for a few days first."
- Flags: `--since`, `--agent`, `--role`, `--roles`, `--file`, `--hand-over`, `--json`.

**What gets in the way.**

- [Consistency] The hint points at `memnox protect --allow`, which writes a local rule. On a team
  machine the same act from chat or the console is a proposal a second admin approves, and
  nothing here says the two differ.
- [Contrast] "the tool wasting your attention" is the one line in the product that blames the
  product. It is honest, but it reads as a joke at the moment of a decision.
- [Consistency] The empty hint names `memnox run`, not setup.

**Improved.**

```
┌ memnox next
│
◇ Where you are   routine work runs, the rest is held
│
◆ Ready to hand over
│   git.push to feature branches   allowed 9 times, refused 0
│   npm install                    allowed 6 times, refused 0
│
└ 2 things you keep allowing.
  memnox next --hand-over   on this machine now
                            on Acme: proposed for a second admin
```

---

## `memnox pair`

`commands/pair.command.ts` (new, uncommitted) · reached from: Sam's flow, or `devices`' hint.

**Job.** Let my phone or my Mac reach the agents on this machine.

**Today.**

- "Pairing <name>", "On your iPhone, open Memnox and scan this code.", a QR, and "On a Mac,
  choose Connect to a server in Memnox and paste this link <link>".
- "Waiting for a device to scan it. It works until <time>."
- "<phone> reached <machine>", then "The six digits the device shows: ".
- "Paired <device>. It sees the agents here, answers them and talks to them." and "memnox
  devices lists every device, and revoke takes one away".
- Refusals:
  - On a Mac: "This Mac approves pairings with Touch ID, so pair from the Memnox app in the menu
    bar."
  - Under an agent: "memnox pair asks for the digits a device shows, so it runs in your own
    terminal and never under an agent."
  - Timeout: "No device scanned the code in time. Run memnox pair again."
  - Declined: "The pairing was declined."
  - No daemon: "The Memnox daemon is not answering here. Start it with memnox daemon --install,
    then pair again."

**What gets in the way.**

- [Consistency] For Lin, who has no Apple device, the screen speaks only of iPhones and Macs,
  with no word that chat or `signin` is the way for them.

**Improved.** Add one closing aside when nothing is paired: "No iPhone
or Mac? Answer from your chat DM or this terminal: memnox signin."

---

## `memnox devices`

`commands/devices.command.ts` (new, uncommitted) · reached from: `pair`'s hint.

**Job.** Which devices can reach this machine, and what may each do?

**Today.** Heading "devices" (not "memnox devices"). A table "Paired" with columns id, name, kind
and may, closed by "<n> paired." Subcommands `list`, `revoke <device>`, `grant <device>
<capability>` and `ungrant`. Empty: "No device is paired with this machine." and "memnox pair
pairs a phone or a Mac". No daemon: "The Memnox daemon is not answering here. Start it with
memnox daemon --install."

**What gets in the way.** [Consistency] The heading is the only one without "memnox", and the
daemon spelling is wrong again. [Progressive disclosure] Capabilities are listed by internal name
in `grant`'s description.

**Improved.** Heading "memnox devices", the daemon fix, and capability names a person reads
("answer questions", "drive this machine", "change rules").

---

## `memnox signin` and `signout`

`commands/signin.command.ts` (was `team.command.ts`) · reached from: `login`'s close and `inbox`'s hint.

**Job.** Sign me in as myself, so my team's questions reach this terminal.

**Today.** Login: "Your code <code>", "Approve it in your browser <url>" (or "Approve it at"),
"Waiting for you to approve it...", then "Signed in as <name>. Questions your team routes to you
show in memnox inbox." and "memnox inbox lists them, and memnox approve or memnox deny
answers one". Logout: "Signed <name> out of this terminal." or "Nobody is signed in here."

**What gets in the way.**

- [Consistency] "Waiting for you to approve it..." uses three dots, while `login` uses an
  ellipsis and names the deadline.
- [Consistency] The code is shown before the URL, which is the reverse of `login`.
- [Hierarchy] It lived under `team`, which reads as administration, when it is the personal
  sign in every Linux user needs. Now `memnox signin`, top level, and `memnox team` says where it went.

**Improved.** Same layout as `login`, URL then code, with the deadline named, and `login`'s close
offers it. The Mac app's Account page runs the same flow for the daemon, so a Mac needs no terminal.

---

## `memnox doctor`

`commands/doctor.command.ts`, `commands/doctor/*.ts` · reached from: the SPINE, the quiet server
fix, and Windows users in `user-flows.md`.

**Job.** What is wrong here, and what single change fixes each thing?

**Today.**

- Default: "What is reachable that should not be", each finding with a severity and "fix:
  <remediation>", closed by "<c> critical, <h> high, <m> medium, <l> low." and "Nothing here
  compares this machine to another." Clean: "Nothing on this machine is reachable that should not
  be."
- `--wiring`: "What is actually gating", one row per check with "→ <fix>". On Windows: "What can
  govern each agent on Windows", with "not available on Windows: <seam>, because <detail>".
- `--by-agent`: "On this machine", per agent with a footnote that this is "never a safety rating
  of software nobody in this room has tested."
- `--servers`: "MCP servers, started and asked", closed by "All <n> server(s) answer." or "<s> of
  <n> server(s) did not answer, so an agent relying on them will fail."
- `--prove`: every seam is asked to refuse something.

**What gets in the way.**

- [Progressive disclosure] Plain `doctor` answers "what is risky", and the question Lin brings
  ("why did my question not reach Discord?") is answered by no flag. Doctor never checks the
  approval route, the chat link, the team sign in or the last heartbeat.
- [Hierarchy] The wiring check, which says whether Memnox is doing anything at all, hides behind
  `--wiring`.

**Improved.**

```
┌ memnox doctor
│
◇ Is Memnox in the path        yes, 2 agents hooked, daemon running
◇ Does the workspace hear you  yes, last heartbeat 12s ago
◆ Do questions reach you       no: approvals go to the session only
│                              → memnox config set approvals both
◇ Can you answer from here     no: nobody is signed in
│                              → memnox signin
│
◇ What is reachable that should not be   1 high
│   ~/.aws/credentials readable by Codex
│   → memnox protect --for aws
│
└ 2 things to fix. memnox doctor --wiring for every check.
```

- Four reachability lines first, each with its fix, built from `readApprovalRoute`,
  `readPerson`, the account and the heartbeat state the CLI already reads.

---

# Across chat and terminal

The top ten improvements, in priority order.

1. Close the terminal card the moment another door answers, and print "allowed once by <person>
   on <door>" rather than a false "nobody answered, so refused".
2. Name the machine in every held question ("<agent> on <machine>"), on the single chat DM, the
   terminal card and local `inbox` rows.
3. Use the shared answer words everywhere: "Allow once", "Allow for this session", "Deny" on the
   card and in `approve` output, with the always answers offered only to admins on every chat
   tool.
4. Keep the question when a chat message is settled, and write "Allowed once by <person> on
   <door>." under it rather than over it.
5. Make `/memnox waiting` show what is waiting on the person who typed it, sent to their DM, and
   never post held questions in a room.
6. Put `inbox`, `approve`, `deny` and `why` on the terminal's front page, and make `approvals`
   an alias of `inbox`.
7. Give `memnox status` the five blocks in the shared order, with "Waiting on you" first and the
   wiring behind `--wiring`.
8. Make setup ask where questions go from the person's linked chat tools (Telegram and Teams
   included), and offer `memnox signin` before it closes.
9. Carry the action id and the deadline on every chat question, and let `/memnox why` and
   `memnox why` with no id answer for the last stop the person can see.
10. Fix the stale pointers: setup in
    place of `mcp wrap` and `run`, Settings > Account in place of "the Connectors page", the
    duplicate id in `inbox`, and the dash in the policy reply.
