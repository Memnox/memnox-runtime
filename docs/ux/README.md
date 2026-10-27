# Memnox UX: every page, what it shows, what it should

This folder describes every page a person meets in Memnox, on every door, as it is today and as
it should be. Each entry says the page's job, what is on it now with every label quoted from the
code, what gets in the way, and an improved version with a wireframe in real copy. The shape of
an entry is in [TEMPLATE.md](TEMPLATE.md), and the judgments follow Figma's seven
[UI design principles](https://www.figma.com/resource-library/ui-design-principles): hierarchy,
progressive disclosure, consistency, contrast, accessibility, proximity and alignment.

Start with [../user-flows.md](../user-flows.md) for the journeys (Maya on a Mac and iPhone, Sam
with a server, Lin with no Apple device, Ana and Bo as a team). Come here for the pages those
journeys pass through.

| File                                         | Door                                                            | Covers                                                                                                                                                                                                                                                     |
| -------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [console.md](console.md)                     | Web console, every browser, installable as an app               | 31 routes in 60 entries: sign up, onboarding, Home, Machines and Add a server, Agents, Map, Waiting on you, Autonomy, Memory, What was caught, Connectors, Files, Meetings, People, Billing, Settings, File locks, Usage, Admin, and the shell around them |
| [mac.md](mac.md)                             | Mac app                                                         | First launch, the island in each of its states, the menu bar, every Settings page, the live session window, voice and keys                                                                                                                                 |
| [iphone.md](iphone.md)                       | iPhone app                                                      | Welcome and pairing, Home, Needs you and answering, Sessions, Voice, Drive my Mac, Team, Settings, Live Activity, Dynamic Island, Siri and controls                                                                                                        |
| [chat-and-terminal.md](chat-and-terminal.md) | Slack, Discord, Telegram, Microsoft Teams, and the `memnox` CLI | Linking, every DM a person receives, every `/memnox` command, the held card in the terminal, and each command a person uses day to day                                                                                                                     |

## What every door must share

These are the rules the four files measure each page against. A page that breaks one is wrong
whatever else it gets right.

1. **The home, in one order.** Waiting on you, Working now, Today, Ready to hand over, Not
   covered, and Your team last on a team.
2. **One label for an agent.** "<agent> on <machine>", and "from <person>'s team" when it came
   through the team.
3. **One set of answer words.** "Allow once", "Allow for this session" and "Deny" first, at equal
   weight. "Always allow this agent", "Allow once, always ask" and "Always deny" behind "More
   answers".
4. **One answered line.** "Allowed once by <person> on <door>." on every door that still shows
   the question, written under the question rather than over it.
5. **A yes is signed, a no is free.** Touch ID, Face ID, a passkey, a linked chat account or the
   person's own terminal for a yes. Nothing for a no.
6. **Deny is never the dimmed button.** It differs from allow in word, symbol and position as
   well as colour.
7. **No button that cannot work.** A phone without the rules capability, a team only phone, a
   server with no screen: each says where the thing can be done instead.
8. **A failed read never looks calm.** "Could not reach the workspace. Try again" and never
   "Nothing needs you."
9. **Counts, never scores. Names, never secrets.**

## Across the product: the fifteen changes that matter most

Drawn from the four files' own top ten lists and ordered for the whole product. The first five
decide whether a person can trust Memnox at all; the rest decide whether it feels like one
product.

**Trust: a question always reaches the person and never lies about its state**

1. **A question at 2am always reaches the person.** The iPhone posts no notification of its own,
   so with Live Activities off nothing alerts. Add a fallback notification with "Deny" and "Allow
   once". [iphone.md: Alerts and notifications, Live Activity]
2. **A settled question says so everywhere.** The terminal card keeps counting down after another
   door answers and can print "nobody answered, so refused" for a call that was allowed. Close it
   and print who answered. Do the same on chat, the island and the Live Activity.
   [chat-and-terminal.md: the held card; mac.md: Held call; iphone.md: approval card]
3. **A failed read never shows calm.** The console renders a failed read as "Nothing needs you.
   Memnox is running." and the same on Machines, Agents and others. [console.md: Home, Waiting on
   you, Machines, Agents, Memory, File locks, Usage, Admin]
4. **Teammates are asked before the hold runs out.** A terminal hold lasts two minutes but
   escalation waits five, so a teammate is never asked about it. Escalate before the hold ends, or
   hold until escalation has had its turn. [chat-and-terminal.md: the held card]
5. **Held questions never land in a room.** `/memnox waiting` posts the whole workspace's
   questions into the channel it was typed in. Send the typer's own to their DM.
   [chat-and-terminal.md: /memnox waiting]

**One product: the same words, order and shape on every door**

6. **The shared answer words and a deny that is never dimmed**, on the console's held card, the
   Mac island and held strip, the iPhone approval card and Dynamic Island, every chat tool and the
   terminal. Show the always answers to admins only, on every chat tool alike.
7. **One home in one order** on the console, the Mac Overview, the iPhone and `memnox status`, with
   the waiting count in the console's tab title and app badge and in the Mac menu bar.
8. **"<agent> on <machine>" everywhere**: chat questions leave the machine out today, and so do the
   Mac's working rows and live window.
9. **Answer in place.** A single held call is answered on Home, on the agent page and from the
   keyboard on the Mac (Option Space opens it with focus, Escape closes, Return never allows).
10. **The rule beside the question.** Every held card shows which rule asked and lets the person
    see the whole command, so the reason sits with the ask.

**First run: value before effort**

11. **One next step on an empty home**, chosen from what onboarding learned: "Install the Mac
    app", "Add a server" or "Install Memnox on this computer". [console.md: Onboarding, Home]
12. **Add a server closes its own loop.** Show the `memnox setup` line too, wait for the machine to
    check in and say "build-box joined". [console.md: Add a server, Machines]
13. **The Mac checklist in two parts**, "Get started" and "When you are ready", with joining the
    team as an optional row. [mac.md: Start here, Do this next]

**Clarity: no dead ends**

14. **Each device knows what it may do.** A Machines section in iPhone Settings with each machine's
    permissions in words. A team only phone shows no orb or Siri dead end, and server and Mac are
    worded apart ("Confirm on build-box"). [iphone.md: Settings, Home dock, Ready to hand over]
15. **Stale names and pointers fixed.** One name per console page ("People" not "Members"), a link
    to File locks from Machines, `setup` in place of `mcp wrap` and `run` in CLI hints, Settings >
    Account in place of "the Connectors page", and the duplicate id in `memnox inbox`.

## Already corrected while writing this

- The CLI's `pair` and `devices` told people to run "memnox daemon install", which does not
  exist. They now say `memnox daemon --install`.
- `user-flows.md` showed a four digit pairing code. The app shows six, and the journey now says
  so.
