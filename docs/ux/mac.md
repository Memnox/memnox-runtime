# Memnox for Mac, screen by screen

The Mac app is where Memnox lives beside the work: an island that grows out of the notch, a voice
that answers to Option Space or to its name, Touch ID for every yes that reaches outside a
session, and hands that type into the agent's own terminal or editor while the person watches.
This document walks every surface the app draws, from the first launch to the cards the voice
puts on screen, in the shape `docs/ux/TEMPLATE.md` asks for.

Every label in quotes is taken from the working tree of `memnox-macos` on 2026-10-07, including
the files not yet committed (`Presentation/Settings/`, `Presentation/Home/`,
`Presentation/Components/`, `Cards/CardHeader.swift`, `Side/SideFilter.swift`, `QRImage.swift`,
and the new `Platform/AXTree.swift`, `Readback.swift`, `RuntimeInstaller.swift`,
`ScreenSight.swift`). Paths are relative to `memnox-macos/Sources/MemnoxVoice/` unless they name
`MemnoxVoiceCore`, where most of the words the screens show are built and tested. A label built
at run time is shown with the fields it is built from.

The people are the ones in `docs/user-flows.md`. Maya is solo with a Mac and an iPhone, runs
Claude Code and Cursor, and answers from the island, the phone and her voice. Ana is a team
admin whose teammates' calls reach her island through the workspace. Sam pairs his Mac with a
server called `build-box`. Wireframes use their names and invented but plausible numbers.

Anything under **Improved** is a proposal, built on what the code already has. Nothing under
**Today** is invented.

---

## Surfaces map

The app has no Dock icon and no main window. It draws ten surfaces, each a borderless panel or
one ordinary window, all painted the same flat black with the island's grey cards
(`IslandPalette.card`, `#141518`).

| Surface                 | File                                               | What it is                                                                                                 | How it appears                                                                                        |
| ----------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **Island**              | `Presentation/Island/*`                            | The black shape that grows out of the notch, holding the orb, sessions, held calls, rules and answers      | Always on screen above the menu bar. Grows on a hover, a click, a hotkey, the wake word or an event   |
| **History panel**       | `Presentation/Side/*`                              | A second notch on its side at the middle of the left screen edge: what needs you, what works, every answer | A rest of the pointer on the left tab, on the orb's side of the notch, or the island's clock tab      |
| **Menu bar panel**      | `Presentation/MenuBar.swift`                       | A black panel under the Memnox icon in the menu bar                                                        | A click on the menu bar icon                                                                          |
| **Memnox window**       | `Presentation/Settings/*`, `Setup.swift`, `Home/*` | The one ordinary window: setup on the first run, Settings and the home after it                            | First launch, "Settings" in the menu, the menu's glance row, "Pair a phone" from the menu             |
| **Live session window** | `Presentation/LiveSession.swift`                   | One session in the middle of the screen, refreshed every two seconds                                       | "Working now" on the home, "Watch live" on a card, or the voice                                       |
| **Floating cards**      | `Presentation/Cards/*`                             | Summary, walk through, trace and the wall of session cards, in the top left corner                         | The voice, or "Open answer" on the island                                                             |
| **Switcher**            | `Presentation/Switcher.swift`                      | Session cards on a 3D shelf that turn to the one asked for                                                 | Before the live window or a focus, when more than one session is listed                               |
| **Scan**                | `Presentation/ScanOverlay.swift`                   | A full screen view of every agent on this Mac, found one by one                                            | The voice                                                                                             |
| **Flight**              | `Presentation/Flight.swift`                        | A comet from the orb to the window an instruction is sent to                                               | Every time words, a launch or a link go to an agent's app                                             |
| **Touch ID sheet**      | system, signed by `SecureEnclaveConfirmKey`        | macOS's own sheet, carrying the reason Memnox gives                                                        | Every allow that reaches outside a session, every rule, every phone pairing, a phone allowed to drive |

**How they relate.** The island is the front door and the only surface that answers a held call
in the notch. The history panel is the island's memory, opened from its left. The menu bar panel
is the way into the Memnox window, which holds setup, the home and every setting. The home's
blocks point back out: "Answer" opens the island, a "Working now" row opens the live window, "Let
it run on its own" puts a rule card on the island. A held call shows in three places at once, the
island's card, the history panel's "Needs you" and the live window's dock, and all three answer
through the same signed path (`IslandModel.answer`), so a yes from a window is signed exactly as a
yes from the notch.

```
                    ┌──────────── menu bar icon ────────────┐
                    │  click                                 │
                    ▼                                        │
             Menu bar panel ── "Settings", glance ──▶ Memnox window
                    │ "Talk to Memnox"                 (Overview, Profile, Team,
                    ▼                                   Connection, Phones, Voice,
 ⌥ Space ──▶     ISLAND  ◀── "Answer" ──────────────── Listening, Help)
 "Memnox" ──▶  (notch)   ◀── "Let it run on its own"         │
 ⌃⌥ hold ──▶     │   ▲                                       │ "Working now" row
                 │   └── held call, rule, finished,          ▼
                 │       phone turn (from the daemon)   Live session window
     hover left  ▼                                        ▲    (dock answers
           History panel ── "Working now" row ──▶ agent's  │     the held call)
           ("Needs you" answers in place)       own window │
                                                           │
            voice ──▶ Summary card · Walk · Trace · Wall ──┘ "Watch live"
            voice ──▶ Scan · Switcher · Flight
```

---

## First launch

On launch, `AppDelegate.applicationDidFinishLaunching` opens the Memnox window on Overview when
setup was never finished (`setupDone` is false) and the person is not signed in to a team. Somebody
signed in only to answer for their team is not pushed into setup again. Setup is not a separate
window: it is the Overview page and the pages its checklist links to, so there is one window.

### Start here

`Presentation/Settings/OverviewPage.swift`, `FirstRunChoice` · reached from: the first launch, or
Overview while setup is unfinished and no path was chosen yet (`firstRunPath` is empty)

**Job.** Am I here to set up my own agents, or only to answer my team?

**Today.** Top to bottom on the Overview page:

- "Overview" in small secondary text, then the greeting in display type: "Hi Maya" from the
  first word of the name field, or "Memnox" when there is no name yet. The name field is prefilled
  from the macOS account name through `suggestedName`.
- "What waits on you, what your agents are doing, and what could run on its own."
- A quiet button "Talk to Memnox" with keycaps "⌥" "Space", tooltip "Or press Option Space from
  anywhere".
- A card with a blue ring edge, labelled "Start here" in small blue capitals, holding two cards
  side by side. The first: a laptop symbol, "Set up this Mac", "Your own agents, the voice, and
  Touch ID for what they ask.", blue button "Set up". The second: a people symbol, "Join your
  team", "Answer the calls your teammates' agents route to you, before setting up anything
  else.", blue button "Join". Signed in already, its line reads "Signed in. Your teammates' calls
  come to the island." and its button "Open Team".
- Under the card, the home blocks (see **Home blocks**), which show only once the daemon answers.

Actions. "Set up" stores the choice `mac` and the card gives way to **Do this next**. "Join"
starts the team sign in (`TeamModel.start`, which opens the console in the browser), stores `team`
and switches to the Team page. The choice is asked once and never again across launches,
because it lives in `UserDefaults`.

States. The daemon row starts installing the runtime the moment the window appears
(`SetupModel.check` runs in the window's `.task`), so the work starts before a path is chosen.
Without a name the greeting reads "Memnox".

**What gets in the way.**

- The "Talk to Memnox" button sits above the choice on a first run, when the voice cannot hear yet
  and the daemon may still be installing. Pressing it then makes the orb say "I cannot hear you
  yet" and nothing on screen says why. [Hierarchy]
- The home blocks render under the choice on a first run, all empty, competing with the one
  decision the page asks for. [Progressive disclosure]
- Two blue primary buttons of equal weight sit side by side, while user-flows names "Set up this
  Mac" as the path for most people. [Hierarchy] [Contrast]

**Improved.**

```
┌ Memnox ──────────────────────────────────────────────────────────────┐
│ Overview                                                             │
│ Hi Maya                                                              │
│                                                                      │
│ ┌ START HERE ─────────────────────────────────────────────────────┐  │
│ │ Set up this Mac                                                 │  │
│ │ Your own agents, the voice, and Touch ID for what they ask.     │  │
│ │                                                [ Set up ]       │  │
│ │ ─────────────────────────────────────────────────────────────── │  │
│ │ Only here to answer your team?   Join your team ›               │  │
│ └─────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│ Memnox is getting ready on this Mac: Installing Memnox…              │
└──────────────────────────────────────────────────────────────────────┘
```

- One primary action, with joining the team as a quiet link, because most people own a Mac first.
- "Talk to Memnox" and the home blocks wait until setup is finished, so the page asks one thing.
- The daemon's progress line (`RuntimeInstaller.doing`) shows here, so the wait has a reason.

### Do this next

`Presentation/Settings/OverviewPage.swift`, `SetupProgressCard` · reached from: Overview after
"Set up", or any Overview visit once a path was chosen

**Job.** What is left before Memnox can hear me, act for me and sign for me?

**Today.** A card with a blue ring while a step is open:

- Header row: "Do this next" in small blue capitals (or "Set up" in green once all are done), and
  "3 of 7" on the right.
- The first open step's title in title type and its hint under it, then a blue button "Go to
  Profile" (the step's page name).
- Once nothing is open: "Everything is ready. Press Option Space from anywhere and ask about your
  agents."
- The checklist, each row a mark and a title, each a button to its page with tooltip "Open
  Profile":
  1. "Tell Memnox your name" (Profile), hint "So it greets you and speaks to you by name."
  2. "Let it hear you" (Profile), "Microphone and speech recognition, on this Mac only."
  3. "Let it see and act" (Profile), "Read your screen when you ask, and check that what it sent
     landed."
  4. "Start the Memnox daemon" (Connection), hint from the runtime: "Installing Memnox…",
     "Starting the Memnox daemon…", "Updating Memnox…", or "What your agents already talk to.
     Installed, started and updated for you."
  5. "Register Touch ID" (Connection), "Your finger approves anything outside a session's
     repository."
  6. "Choose who answers for you" (Voice), hint from the agent check.
  7. "Pick a voice" (Voice), hint from Kokoro's install.
- Marks (`StatusMark`): a green disc with a tick when done, a grey ring while waiting, an amber
  disc with "!" when it needs the person. A step that needs the person shows its own instruction
  as the hint, for example "Turn on Memnox in System Settings, Privacy and Security,
  Accessibility".
- While setup is unfinished, a white pill "Finish setup" at the bottom right, disabled until there
  is a name, tooltip "Add your name first" or "Finish and hear Memnox say hello".
- On a first run the home blocks follow the card; once finished they come before it.

Actions. "Go to …" and every row switch the page. "Finish setup" saves the name, catch up and the
voice, marks setup done, closes the window and the orb says "Online and ready, Maya. Press Option
Space whenever you need me." (or "Say Memnox whenever you need me." when the wake word is on).

States. Daemon unreachable: "The daemon would not start. In a terminal: memnox daemon --install".
Node missing: "Memnox needs Node.js. Install it from nodejs.org, then check again". Another key:
"Another key is trusted. Run memnox voice forget-key, then check again". Agents: "Install and log
in to one of Claude Code, Codex, Cursor, Hermes or OpenClaw, then check again", "Choose the agent
that answers for you", "None of your agents answered. Fix one below, then check again". Kokoro
failed: "Kokoro could not install, usually for want of a connection. Details are in <log path>".

**What gets in the way.**

- After setup is finished the card never leaves: every visit to Overview ends with "Set up 7 of 7",
  "Everything is ready…" and the full checklist under the home blocks. [Progressive disclosure]
- Pairing a phone, connecting a server, joining the team and catch up are not in the checklist at
  all, so the first launch never mentions the iPhone, which user-flows treats as half the value.
  [Consistency]
- "Go to Profile" is a blue filled button and "Finish setup" is a white pill (`IslandButton`), two
  different primaries on one card. [Consistency] [Hierarchy]
- "Finish setup" asks only for a name; a person can finish with no microphone, no daemon and no
  Touch ID, and the hello is then spoken by an orb that cannot hear the reply. [Hierarchy]
- The checklist is seven equal rows; user-flows asks for "Get started" and "When you are ready".
  [Progressive disclosure]

**Improved.**

```
┌ DO THIS NEXT ───────────────────────────────────────── 3 of 5 ┐
│ Let it see and act                                            │
│ Turn on Memnox in System Settings, Privacy and Security,      │
│ Accessibility.                                                │
│                                         [ Go to Profile ]     │
│                                                               │
│ GET STARTED                                                   │
│ ●✓ Tell Memnox your name                                      │
│ ●✓ Let it hear you                                            │
│ ●! Let it see and act                                         │
│ ○  Start the Memnox daemon    Installing Memnox…              │
│ ○  Register Touch ID                                          │
│                                                               │
│ WHEN YOU ARE READY ▸  Join your team · Pair a phone ·         │
│                       Connect to a server · Pick a voice      │
│                                                               │
│                              [ Finish setup ] (needs 1 to 5)  │
└───────────────────────────────────────────────────────────────┘
```

- Five rows to start, four optional ones folded, matching user-flows section 2.1.
- "Finish setup" waits on the five, so the hello is heard by an orb that can answer.
- Once finished the card is gone from Overview and lives on Help as "Check setup again".
- One button style for the primary action on the card.

---

## Island

`Presentation/Island/IslandPanel.swift` owns the window: a borderless, non activating panel three
levels above the main menu bar, on every Space and over full screen apps, which never takes the
keyboard and lets every click outside its drawn shape through. `IslandModel.settle()` is the one
place the mode is chosen, in this order: held call, draft, rule, finished, talking (hearing or
voice), a phone's turn, an opened answer, the open island (empty, session or overview), then
resting (compact or peek). Growing springs with an overshoot; shrinking eases in.

On a Mac without a notch, the island stands on an 80 point wide bar at the top centre of the main
screen (`NotchGeometry.standInWidth`).

Wireframes draw the screen's top edge as `━━`, the concave flare where the island meets it as `╮`
and `╭`, and the notch itself as `▓▓▓`.

### Idle (peek)

`Island/IslandView.swift`, `.peek` · reached from: always, when nothing works and nothing waits

**Job.** Is Memnox here?

**Today.** A black shape 64 points wider than the notch and as tall as it, the orb resting in the
left wing at 18 points, breathing. No words.

```
━━━━━━━━━━━━━━━━━━━━━━━━╮ ●  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓    ╭━━━━━━━━━━━━━━━━━━━━━━━━
                        ╰──────────────────────╯
```

Actions. A click starts listening (`tappedIsland` then `talk`). Hovering grows the orb to 22
points. A pointer resting 0.65 seconds on the right of the notch opens the island; on the left,
where the orb sits, it opens the history panel instead.

**What gets in the way.**

- Nothing tells a new person that a click talks and a hover opens, and there is no tooltip on a
  panel that never becomes key. [Accessibility]
- The left and right halves of one small shape open two different surfaces on a hover, a split
  nobody can see. [Consistency]

**Improved.**

```
━━━━━━━━━━━━━━━━━━━━━━━━╮ ●  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓    ╭━━━━━━━━━━━━━━━━━━━━━━━━
                        ╰──────────────────────╯
                          Click to talk · ⌥ Space
```

- A one line hint fades in under the shape on the first three hovers after setup, then never.
- VoiceOver gets an element for the orb, "Memnox, click to talk", and one for the right wing,
  "Open sessions".

### Working (compact)

`Island/IslandView.swift`, `IslandCompact`, `IslandLogos` · reached from: any session working

**Job.** Who is busy right now, and is one of them stuck on me?

**Today.** 104 points wider than the notch. The orb at 20 points in the left wing; in the right
wing up to three working agents' logos in discs of their own colour, overlapping like faces in a
doorway, each ringed in black. The logo of a session with a held call hops about once a second
until it is answered. A session that failed, paused or collided shivers grey for 0.9 seconds.
While the voice is active the logos give way to a seven bar sky blue waveform.

```
━━━━━━━━━━━━━━━━━━━━━━╮ ●  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓  ◐◑◒ ╭━━━━━━━━━━━━━━━━━━━━━━
                      ╰─────────────────────────╯
                                        ↑ Claude Code hops: a call waits
```

Actions. A click talks. A 0.2 second rest opens the island on Overview. Sessions are read every 5
seconds while resting and every 2 while open.

**What gets in the way.**

- A fourth working session is invisible; nothing says "+1". [Hierarchy]
- A waiting call is shown only by motion on a 16 point logo, which a person with Reduce Motion or
  a glance away misses, and the colour of the waiting state never reaches the resting shape.
  [Accessibility] [Contrast]

**Improved.**

```
━━━━━━━━━━━━━━━━━━━━━━╮ ●  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓  ◐◑◒+1 ● ╭━━━━━━━━━━━━━━━━━━
                      ╰────────────────────────────╯
                                          amber dot: 1 call waits
```

- "+1" after the third logo, so the count is never hidden.
- An amber dot in the right wing while any call waits, still under Reduce Motion, so waiting is a
  shape and a colour as well as a hop.

### Listening

`Island/IslandView.swift`, `IslandVoiceCard` (`.voice`) and `Island/IslandConversation.swift`,
`IslandHearing` (`.hearing`) · reached from: Option Space, a click on the resting island, the wake
word, "Talk to Memnox" in the menu or the window, a held call waiting on a spoken answer

**Job.** Is it hearing me, and did it hear me right?

**Today.** The island opens 440 wide and about 226 tall (`voiceBelowTop` 190 below the notch row)
with the orb grown to 150 points in the middle, rippling with the microphone level. A chime plays
(`.listening`). With "Live words" on (the default) the first recognised word turns the island into
`.hearing`: 520 wide, the orb shrinks to 84 points above the words, which arrive one at a time out
of a blur in title size, centred, the newest brighter, with a breathing blue caret after the last
word. Three lines fit. The header row carries the tabs (see **Overview**) in `.voice` only.

```
━━━━━━━━━━━━━━━╮ ▦ ◷ ⌁    ▓▓▓▓▓▓▓▓▓▓▓▓▓▓        0 working ╭━━━━━━━━━━━━━━━
               │                                         │
               │                  ◉                      │
               │               (orb, 84)                 │
               │                                         │
               │      what is cursor doing on the        │
               │            landing page ▍               │
               ╰─────────────────────────────────────────╯
```

Actions. A click on the open island while talking calls `panel.dismiss()`. Option Space again
interrupts (see **Voice and keys**). The listen ends on a pause in speech; the first word is
waited for 10 seconds, a follow up 15 seconds after an answer.

States. No permission: the orb says "I cannot hear you yet. Allow Memnox under Microphone and
Speech Recognition in System Settings, Privacy and Security." and closes. A voice heard with no
words: caption "Sorry, say that again?". A phone holding the voice: the Mac does not listen at all
(see **Phone voice pill**).

**What gets in the way.**

- Every caption the app sets while listening ("I need permission to hear you", "Sorry, say that
  again?") is stored in `IslandModel.caption` and never drawn; the only place a caption is drawn is
  the "Thinking" shimmer inside an answer card. With live words off, a person with the sound down
  sees an orb and nothing else. [Accessibility]
- A click on the open island hides it but leaves `converse` running, so the microphone stays open
  for up to 15 seconds behind a closed shape. [Consistency] [Accessibility]
- With live words off nothing confirms what was heard before the answer starts. [Accessibility]

**Improved.**

```
━━━━━━━━━━━━━━━╮ ▦ ◷ ⌁    ▓▓▓▓▓▓▓▓▓▓▓▓▓▓        0 working ╭━━━━━━━━━━━━━━━
               │                  ◉                      │
               │      what is cursor doing on the        │
               │            landing page ▍               │
               │  Listening · click or Esc to stop       │
               ╰─────────────────────────────────────────╯
```

- One caption line under the orb in every talking mode, drawn from `model.caption`, so "Sorry, say
  that again?" and every Touch ID reason are read as well as heard.
- A click on the open island ends the turn (`conversation.interrupt` and stop the microphone),
  matching what the shape shows.

### Thinking

`Island/IslandView.swift`, `.voice`; `OrbRenderer.swift` · reached from: a question heard and sent

**Job.** Did it take my question, and is it working on it?

**Today.** Once the question is sent (`asked`), the live words clear and the island falls back to
`.voice`: the large orb alone, its points rebuilding slowly into a knot (`Target.thinkingLevel`).
The caption is set to "reading <tool>", "catching up", "typing it in", "starting it", "opening
<app>" or "closing it" as the brain works, but none of it is drawn. The question joins the history
panel at once, where its row reads "Answering, 0:04" with a breathing blue dot.

```
━━━━━━━━━━━━━━━╮ ▦ ◷ ⌁    ▓▓▓▓▓▓▓▓▓▓▓▓▓▓        2 working ╭━━━━━━━━━━━━━━━
               │                                         │
               │                   ◎                     │
               │             (orb, knotting)             │
               │                                         │
               ╰─────────────────────────────────────────╯
```

**What gets in the way.**

- The question disappears from the island the moment it is sent, so the person cannot check what
  was asked while waiting. [Proximity]
- The brain's progress ("reading sessions") is computed and thrown away. [Accessibility]

**Improved.**

```
━━━━━━━━━━━━━━━╮ ▦ ◷ ⌁    ▓▓▓▓▓▓▓▓▓▓▓▓▓▓        2 working ╭━━━━━━━━━━━━━━━
               │                   ◎                     │
               │   ╭─────────────────────────────────╮   │
               │   │ what is cursor doing on the     │   │
               │   │ landing page                    │   │
               │   ╰─────────────────────────────────╯   │
               │   reading sessions…                     │
               ╰─────────────────────────────────────────╯
```

- The question stays in its bubble (`QuestionBubble`) under the orb until the answer starts.
- The caption shimmers under it (`ShimmerText`), which the answer card already does.

### Speaking

`Island/IslandView.swift`, `.voice`; `App/AppDelegate.swift`, `overVoice` · reached from: an answer,
a held call's briefing, a notice when "Speak up on its own" is on, catching up after the screen
was locked

**Job.** What is it telling me, and can I stop it?

**Today.** The orb ripples with the voice, a lit ring climbing it on each syllable. The words are
not on the island: `settle()` keeps the orb up during a turn "since what Memnox says is heard
rather than read", and the answer is kept in the history panel. With "Talk over it" on, the person
cuts in by speaking: the first word of theirs pauses the voice for 1.5 seconds, more words stop it
and become the next question. After the answer the microphone stays open 15 seconds for a follow
up, then the chime `.closed` plays and the island folds.

Captions set and not drawn: "Testing my voice", "New voice", "Kokoro is not running", "Hold
Control Option to say a rule", "Memnox needs Accessibility", "I cannot listen for my name here".

**What gets in the way.**

- An answer is sound only while it plays. With the sound off or in a meeting, the person must open
  the history panel to read it. [Accessibility]
- The `AnswerCard` with "Show more", "Copy" and "Open answer" exists but only shows for a phone's
  turn or an answer opened from history; "Show more" only appears when `live` is true, which
  `settle()` never produces. [Consistency]

**Improved.**

```
━━━━━━━━━━━━━╮ ◉  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓                         ╭━━━━━━━━━━━━━
             │ ╭────────────────────────────────────────╮ │
             │ │ what is cursor doing on the landing    │ │
             │ ╰────────────────────────────────────────╯ │
             │ ┌ ● Memnox                 ✓ Done   0:06 ┐ │
             │ │ Cursor is rewriting the hero copy in   │ │
             │ │ site, 3 files changed, tests not run.  │ │
             │ │                   [ Copy ] [Open answer]│ │
             │ └────────────────────────────────────────┘ │
             ╰────────────────────────────────────────────╯
```

- A setting "Show answers on the island" (on when sound is muted) uses the existing
  `.conversation` layout with `live: true`, so the answer card and its buttons finally show while
  talking.

### Saying a rule

`Island/IslandConversation.swift`, `IslandHearing` with `RuleModeChip` · reached from: Control and
Option held together for 0.3 seconds

**Job.** Is it taking my words down as a rule rather than a question?

**Today.** The island opens in `.hearing` whatever live words is set to. Before a word lands it
reads "Say the rule, then let go" in title size, secondary ink. An amber chip with a shield and
"Rule" sits in the header row right of the notch. The words arrive as in listening. Letting go of
either key sends them with the rule intent; the brain reads the rule back and asks where it should
hold, and the microphone stays open for that answer.

```
━━━━━━━━━━━━━━━╮          ▓▓▓▓▓▓▓▓▓▓▓▓▓▓       ⛨ Rule  ╭━━━━━━━━━━━━━━━
               │                  ◉                      │
               │   never let any agent push to main      │
               │        without asking me first ▍        │
               ╰─────────────────────────────────────────╯
```

States. Accessibility off: the keys are never seen and nothing happens; "Say a rule" in the menu
explains it aloud only.

**What gets in the way.**

- The hold is invisible without Accessibility and there is no on screen sign that the chord exists,
  except a spoken line behind "Say a rule". [Accessibility] [Progressive disclosure]

**Improved.**

```
               │   Say the rule, then let go             │
               │   ⌃ ⌥ held · release to send            │
```

- A second line names the keys while they are held, and the Listening page carries a row for the
  chord with its permission state (see **Listening**).

### Rule card

`Island/IslandRule.swift`, `IslandRuleCard` in `.rule` · reached from: a rule said with Control
and Option, a rule proposed by voice, or "Let it run on its own" on the home

**Job.** What exactly will this rule decide, and where should it hold?

**Today.** 580 by 470. The question bubble on top, then a card with a glow in the effect's colour
(red deny, amber ask, green allow, indigo unknown):

- Shield and "New rule", with a chip on the right: "Deny", "Ask first" or "Allow".
- The summary as a sentence in headline type, two lines at most.
- Detail rows: "Action" (monospaced), "Branches", "Paths" when present, "Why".
- "Where should it hold?" then the places, three in view and the rest a scroll away: a desktop
  symbol with "This Mac" and "Every agent, in every folder", or a folder symbol with the repository
  name and "Only agents in ~/Documents/shop". The suggested place is picked first, with a blue ring
  and a filled tick.
- "Not now" on the left; on the right a white pill with the Touch ID symbol, "Enforce in shop" or
  "Enforce on this Mac", disabled until a place is picked.

```
━━━━━━━━━━━━━╮ ◉  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓                         ╭━━━━━━━━━━━━━
             │ ╭────────────────────────────────────────╮ │
             │ │ Never let any agent push to main       │ │
             │ │ without asking me first                │ │
             │ ╰────────────────────────────────────────╯ │
             │ ┌ ⛨ New rule                 [Ask first] ┐ │
             │ │ Ask git.push on main                   │ │
             │ │ Action    git.push                     │ │
             │ │ Branches  main                         │ │
             │ │ Why       pushes to main go through    │ │
             │ │           the person first             │ │
             │ │ Where should it hold?                  │ │
             │ │ ▢ This Mac                          ○  │ │
             │ │   Every agent, in every folder         │ │
             │ │ ▣ shop                              ◉  │ │
             │ │   Only agents in ~/Documents/shop      │ │
             │ │ ▢ api                               ○  │ │
             │ │                                        │ │
             │ │ Not now               [⊛ Enforce in shop]│ │
             │ └────────────────────────────────────────┘ │
             ╰────────────────────────────────────────────╯
```

Actions. Picking a place sets `ruleScope`. "Enforce …" raises Touch ID with the reason "<summary>
in shop" (for example "ask git.push on main in shop"); the buttons dim while the sheet is up.
Answered, here or elsewhere, the card goes. Cancelled, it stays. Failed, the island shakes. "Not
now" declines unsigned. The place can also be said aloud, since the microphone stays open.

**What gets in the way.**

- The summary is the runtime's words with the first letter raised, "Ask git.push on main", which
  reads as code where the card is asking for consent. [Hierarchy]
- A failure only shakes the island; nothing says what failed. [Accessibility]
- "Not now" sits in the same grey as every secondary button while the effect chip is the only
  colour, so decline and confirm differ only by fill. [Contrast]

**Improved.**

- The headline uses the reason and the effect in plain words ("Agents ask you before pushing to
  main"), with `git.push` kept in the Action row.
- A failed enforce prints the refusal under the buttons in amber, the way the home prints
  `handOverNote`.

### Proposals and Touch ID

`MemnoxVoiceCore/Application/Conversation.swift`, `handle(.proposal)`; `App/AppDelegate.swift`,
`confirmations` · reached from: an action the person asked for by voice ("allow it", "tell Claude
to retry"), "Let it run on its own", a team answer said aloud

**Job.** Did I really ask for this, and what will my finger sign?

**Today.** A proposal from the daemon is only acted on if the person spoke in the last two minutes
or pressed the button that names it (`fromHandOver`); an allow nobody asked for is left alone. A
rule goes to the **Rule card**. Anything else is read back aloud first, then the Touch ID sheet
comes up with a reason, while the hidden caption reads "Touch ID to <reason>" and the orb takes its
`needsYou` bounce. Sheets queue one after another (`confirmations`), never two at once. A phone
holding the voice answers its own proposals; the Mac only shows a rule on its card.

**What gets in the way.**

- On the island there is nothing to see while the sheet is up except the orb's bounce; the reason
  lives only in the system sheet and the undrawn caption. [Proximity]

**Improved.**

```
━━━━━━━━━━━━━━━╮ ▦ ◷ ⌁    ▓▓▓▓▓▓▓▓▓▓▓▓▓▓        2 working ╭━━━━━━━━━━━━━━━
               │                  ◉                      │
               │  Touch ID to allow Claude Code on your  │
               │  Mac once: git push origin main         │
               │                       Cancel to say no  │
               ╰─────────────────────────────────────────╯
```

- The caption line under the orb shows the same reason the sheet carries, so the question and the
  signature sit together.

### Held call

`Island/IslandCalls.swift`, `IslandHeldCall` in `.held` · reached from: a daemon `held` event, a
server's held event over the relay, or a teammate's call from the workspace inbox

**Job.** Which agent wants what, on which machine, and do I let it?

**Today.** The island opens 640 by 206 the moment the call arrives, before the voice has said
anything, over whatever it showed. A chime (`.held`) plays and the voice briefs the call, then
listens for a spoken answer. The orb sits left at 56 points; the card glows amber from its lower
edge. Top to bottom on the card:

- With more than one waiting, a queue row in amber: "3 waiting: 2 on build-box, 1 on your Mac" (or
  "2 waiting on your Mac"), then "‹", "2 of 3", "›" with tooltips "An older call" and "A newer
  call".
- A pulsing dot in the agent's colour, the label in callout weight, "Claude Code on your Mac" or
  "codex on build-box", then the reason in secondary ink, `why` or "is waiting on you".
- The command in a monospaced box, one line, truncated in the middle.
- "Deny", "Allow this session", "Allow once". Both allows carry the Touch ID symbol when the call
  reaches outside its session's repository (`touchID`); a call inside the repository is allowed
  with a tap.

```
━━━━━━━━━╮ ▦ ◷ ⌁       ▓▓▓▓▓▓▓▓▓▓▓▓▓▓              2 working ╭━━━━━━━━━
         │ ┌──────────────────────────────────────────────────────┐ │
         │ │        2 waiting on your Mac             ‹ 1 of 2 ›  │ │
         │ │  ◉     ● Claude Code on your Mac  wants to push to   │ │
         │ │ (56)   ┌──────────────────────────────────────────┐  │ │
         │ │        │ git push origin main                     │  │ │
         │ │        └──────────────────────────────────────────┘  │ │
         │ │        [ Deny ] [⊛ Allow this session] [⊛ Allow once]│ │
         │ └──────────────────────────────────────────────────────┘ │
         ╰──────────────────────────────────────────────────────────╯
```

Actions. "Deny" answers at once with no signature. Either allow raises the Touch ID sheet with
"allow Claude Code on your Mac once: git push origin main" or "allow Claude Code on your Mac for
this session: …", and the answers dim to 55 percent so a second press is not invited. Stepping
through the queue is locked while one is being signed. Answered here, the card goes and the next
newest call comes up. Cancelled Touch ID leaves the card up. A failed answer shakes the island.

States. Answered somewhere else first: the veil turns green and the reason line becomes a green
tick with the settled line for 2.8 seconds, then the card goes. The daemon's own `settled` event
says nothing about who, so it reads "No longer waiting"; an answer that lost a race reads
"Allowed once elsewhere" or "Denied elsewhere". A server's call is labelled with the server's name.
A call that arrives while one is being answered joins the queue without moving the card.

**What gets in the way.**

- The answer words differ from every other door: "Allow this session" here, "Allow for this
  session" in the shared shape, and the three always answers ("Always allow this agent", "Allow
  once, always ask", "Always deny") are not offered at all. [Consistency]
- The island cannot become key, so a held call cannot be answered from the keyboard and VoiceOver
  cannot reach its buttons without the pointer. [Accessibility]
- "Allow this session" and "Deny" are the same grey pill; deny is told apart from a yes only by
  position and the lack of a fill. [Contrast]
- The settled line almost never names a person or a door, so "Allowed once by Ana on iPhone." from
  the shared shape never appears here. [Consistency]
- The command is one line; a long `curl … | sh` is cut in the middle, exactly where the risky part
  usually is, and there is no way to see it whole. [Proximity]
- The rule that asked is not on the card, though user-flows draws "Rule: pushes to main ask first"
  beside the question. [Proximity]

**Improved.**

```
━━━━━━━━━╮ ▦ ◷ ⌁       ▓▓▓▓▓▓▓▓▓▓▓▓▓▓              2 working ╭━━━━━━━━━
         │ ┌──────────────────────────────────────────────────────┐ │
         │ │        2 waiting on your Mac             ‹ 1 of 2 ›  │ │
         │ │  ◉     ● Claude Code on Maya's Mac wants to push to  │ │
         │ │        main                                          │ │
         │ │        Rule: pushes to main ask first                │ │
         │ │        ┌──────────────────────────────────────────┐  │ │
         │ │        │ git push origin main                  ⤢  │  │ │
         │ │        └──────────────────────────────────────────┘  │ │
         │ │        [ Deny ]   More ▾   [⊛ Allow once]            │ │
         │ │                   Allow for this session             │ │
         │ │                   Always allow this agent            │ │
         │ │                   Allow once, always ask             │ │
         │ │                   Always deny                        │ │
         │ └──────────────────────────────────────────────────────┘ │
         ╰──────────────────────────────────────────────────────────╯
```

- Two answers first, "Deny" and "Allow once", and the rest behind "More", using the shared words.
- "Deny" in a red outline so a no never looks like the dimmed option.
- The rule line under the label, from the event's rule when the daemon sends one.
- "⤢" opens the command whole in a tooltip sized box.
- When opened from the keyboard (Option Space while a call waits), the card takes focus: Tab moves
  between answers, Space presses, Escape closes the card without answering, and Return does
  nothing, keeping the rule that a stray key never allows.
- Settled lines carry the person and the door once the daemon sends them: "Allowed once by Ana on
  iPhone."

### Team question

`Island/IslandModel.swift`, `HeldCard(team:)`; `App/AppDelegate.swift`, `readInbox` · reached from:
the workspace routing a teammate's call to the person, read every 20 seconds while signed in and
at once when the Mac wakes

**Job.** Whose agent is this, and is it mine to answer?

**Today.** The same card as **Held call**, joining the same queue. The label carries the team:
"Hermes on build-box, from Ana's team" (or "from your team" when the workspace did not say whose).
Every allow asks for Touch ID, whatever the call. The voice announces it after whatever is being
said, unless a phone holds the voice. Answered here, the answer goes through the workspace and
never through a daemon. Answered elsewhere, the card shows the workspace's line (for example
"Allowed once by Ana in the console") for 2.8 seconds. Signed out by the team, the calls go quietly
and the Team page says "Your team signed this Mac out. Sign in again to answer its calls."

**What gets in the way.**

- A teammate's call and the person's own look the same apart from the suffix at the end of a
  truncated line, so "is it mine?" is answered last. [Hierarchy]
- A 20 second poll means a teammate's call can sit unseen for up to 20 seconds. [Hierarchy]

**Improved.**

```
         │ │        From Ana's team                                │ │
         │ │        ● Hermes on build-box wants to run the build   │ │
```

- A small "From Ana's team" line above the label, so whose it is reads first.

### Finished

`Island/IslandCalls.swift`, `IslandFinished` in `.finished` · reached from: a daemon `finished`
notice

**Job.** What did that agent just finish?

**Today.** 640 by 170, green glow, the island swells once. A green tick, the agent name and
"finished", the summary in two lines, then "Open" (when the session is known) and a white "OK". It
folds back on its own after 5.2 seconds.

```
━━━━━━━━━╮ ▦ ◷ ⌁       ▓▓▓▓▓▓▓▓▓▓▓▓▓▓              1 working ╭━━━━━━━━━
         │ ┌──────────────────────────────────────────────────────┐ │
         │ │  ◉     ✓ Codex  finished                             │ │
         │ │        The flaky checkout test is fixed and the      │ │
         │ │        suite passes.                                 │ │
         │ │        [ Open ]  [ OK ]                              │ │
         │ └──────────────────────────────────────────────────────┘ │
         ╰──────────────────────────────────────────────────────────╯
```

**What gets in the way.**

- "OK" is the primary white pill on a card that closes itself, while the useful action, "Open", is
  secondary. [Hierarchy]
- The label is "Codex", not "Codex on your Mac", unlike the held card. [Consistency]
- 5.2 seconds is too short to read two lines and reach "Open" from across the screen, and no
  countdown says it is leaving. [Accessibility]

**Improved.**

- "Codex on your Mac finished", "Watch what changed" as the primary (the live window), "Open in
  Terminal" secondary, no "OK" since it folds itself, and the countdown line the open island
  already draws.

### Overview (the open island)

`Island/IslandOverview.swift`, `IslandOverview` in `.overview`; `Island/IslandView.swift`,
`IslandHeader` · reached from: a rest on the right of the notch, the "▦" tab

**Job.** What are my agents doing right now?

**Today.** 640 by 196. A header row along the notch: round tabs "▦" (tooltip "All sessions"), "◷"
(tooltip "History, sessions and what needs you", toggles the history panel), "‹" (tooltip "Back",
in session and answer only) and "⌁" (tooltip "Talk to Memnox"), and on the right "2 working". Under
it two cards:

- On the left, 322 wide, the session in focus, with the orb over its left side at 70 points: a dot
  in the agent's colour and the title (the task, else the repository, else the agent), the subtitle
  ("Claude Code · shop · Working", or how long ago), and a roll of its last three meaningful steps,
  the newest bright and shimmering while it thinks, or "Thinking" / "Nothing done yet". The glow is
  amber while a call waits, else the agent's colour while it works. Tooltip "See what it is
  changing"; a click opens **Session up close**.
- On the right, up to four sessions as rows: logo disc, title, subtitle, and an arrow on the
  focused row or a pulsing sky dot on a working one. Rows rise in one after another. Resting the
  pointer on a row focuses it; clicking it brings its own window forward (tooltip "Go to this
  session").

```
━━━━━━━━━╮ ▦ ◷ ⌁       ▓▓▓▓▓▓▓▓▓▓▓▓▓▓              2 working ╭━━━━━━━━━
         │ ┌─────────────────────────┐ ┌──────────────────────────┐ │
         │ │      ● add VAT to       │ │ ◐ add VAT to invoices  ↗ │ │
         │ │  ◉     invoices         │ │   Claude Code · shop     │ │
         │ │ (70) Claude Code · shop │ │ ◑ fix the flaky test   ● │ │
         │ │  ✎ Edited invoice.ts    │ │   Codex · api · Working  │ │
         │ │  ⌘ Ran npm test         │ │ ◒ landing copy           │ │
         │ │  ✎ Edited invoice.ts ✦  │ │   Cursor · site · 4m ago │ │
         │ └─────────────────────────┘ └──────────────────────────┘ │
         │                     ──────── (closing in 10 s)           │
         ╰──────────────────────────────────────────────────────────╯
```

Actions. Untouched for 60 seconds the island puts itself away; the last ten seconds show as a
shrinking white line at the bottom. A click anywhere outside closes it.

**What gets in the way.**

- A fifth session is silently cut; there is no "3 more". [Hierarchy]
- Hover changes focus and click leaves the app, so moving the pointer down the list to reach a
  row's window changes the left card on the way. [Consistency]
- The header shows "2 working" but not how many wait on the person, the one number that matters
  most. [Hierarchy]
- The four header tabs are icons only, with tooltips that need a hover the island barely allows.
  [Accessibility]
- Rows name the task and the agent but not the machine, unlike the held card. [Consistency]

**Improved.**

```
━━━━━━━━━╮ ▦ ◷ ⌁       ▓▓▓▓▓▓▓▓▓▓▓▓▓▓      1 waits · 2 working ╭━━━━━━━━━
         │  … rows as today …                    + 3 more in History │
```

- "1 waits" in amber beside the working count, a click opening the held card.
- "+ 3 more in History" opens the history panel on "Working".
- Rows focus on click and open their window from the arrow, so hover never changes what is shown.

### Session up close

`Island/IslandSessionDetail.swift`, `IslandSessionDetail` in `.session` · reached from: a click on
the focus card in **Overview**

**Job.** What is this session changing, line by line?

**Today.** 640 by 256, the orb shrunk into the header row and the "‹" tab shown. Two cards:

- Left, 236 wide: the agent's logo disc, the name with a status badge ("Working", "Thinking",
  "Needs you", "Waiting on you", "Paused", "Ended", "Quiet" or "Quiet, 4m ago"), the place
  ("shop · Terminal"), a round "↗" button (tooltip "Open this session in Terminal"), the task in
  curly quotes, and "RECENT ACTIVITY" with the last three steps, newest first, each with its age;
  the newest spins while it thinks.
- Right, the code panel: a tab with the file's extension badge ("TS"), the file name, its folders
  and "+3 −1"; up to seven changed lines marked "+" green or "−" red and struck through; a footer
  "4 more lines here · 2 other files changed". With no excerpt, "CHANGED FILES" and up to six
  files with counts. With none, "No files changed yet", or "Memnox sees only where this session
  connects, not the files it changes" for a session seen only on the network.

```
━━━━━━━━━╮ ◉ ▦ ◷ ‹ ⌁    ▓▓▓▓▓▓▓▓▓▓▓▓▓▓              2 working ╭━━━━━━━━━
         │ ┌──────────────────────┐ ┌───────────────────────────────┐ │
         │ │ ◐ Claude Code        │ │ TS invoice.ts      +3 −1      │ │
         │ │   [● Working]     ↗  │ │    src/billing                │ │
         │ │   shop · Terminal    │ │ − const TVA = 0.2             │ │
         │ │ "add VAT to invoices"│ │ + const TVA = 0.196           │ │
         │ │ RECENT ACTIVITY      │ │ + export function total(…) {  │ │
         │ │ ⟳ Edited invoice.ts  │ │ +   return sum * (1 + TVA)    │ │
         │ │ ⌘ Ran npm test   1m  │ │                               │ │
         │ │ ✎ Edited inv…    2m  │ │ 1 other file changed          │ │
         │ └──────────────────────┘ └───────────────────────────────┘ │
         ╰────────────────────────────────────────────────────────────╯
```

**What gets in the way.**

- The open button is a bare arrow in a 24 point circle with no words. [Accessibility]
- There is no way to answer a call this session holds from here, though the badge can read "Needs
  you". [Proximity]

**Improved.**

- "Open in Terminal" as a labelled pill, and "Watch live" beside it.
- When the badge reads "Needs you", the held strip (`HeldStrip`) docks under the left card, as the
  live window already does.

### Nothing running

`Island/IslandSessionDetail.swift`, `IslandEmpty` in `.empty` · reached from: opening the island
with no sessions

**Job.** Is anything happening, and what can I do?

**Today.** 640 by 150, indigo glow, orb at 62 points: "Nothing is running right now." and a white
pill with a waveform, "Talk to Memnox".

```
━━━━━━━━━╮ ▦ ◷ ⌁       ▓▓▓▓▓▓▓▓▓▓▓▓▓▓              0 working ╭━━━━━━━━━
         │ ┌──────────────────────────────────────────────────────┐ │
         │ │   ◉      Nothing is running right now.               │ │
         │ │          [ ⌁ Talk to Memnox ]                         │ │
         │ └──────────────────────────────────────────────────────┘ │
         ╰──────────────────────────────────────────────────────────╯
```

**What gets in the way.**

- Nothing says whether agents exist but are not under Memnox, which the home knows ("1 agent here
  runs outside Memnox."). [Hierarchy]

**Improved.**

- "Nothing is running right now. 1 agent here runs outside Memnox." with "Protect my agents" beside
  "Talk to Memnox", from the same `DaemonHome`.

### Answer opened from history

`Island/IslandConversation.swift`, `AnswerCard` in `.answer` · reached from: a row in the history
panel

**Job.** What did it say, in full?

**Today.** 640 by 560, the orb in the header row with "‹". The question in a soft bubble, three
lines at most, then the answer card: a blue disc and "Memnox", "Working" shimmering or a green
"Done", and a stopwatch "0:06". The reply is laid out as markdown (headings, lists, code), fading
into the footer when long. Proof rows follow when an action was checked: a 44 point screenshot
thumbnail (tooltip "Open the screenshot taken after it landed") or a green eye, and the evidence
line. Footer: "Copy" and a white "Open answer", which puts it in a **Summary card**.

**What gets in the way.**

- "Copy" gives no sign it worked. [Accessibility]
- There is no "Ask again" here for a failed answer, only on the history row under a hover.
  [Proximity]

**Improved.**

- "Copy" turns to "Copied" for two seconds. A failed exchange shows its failure line and "Ask
  again" in the footer.

### Drive pill

`Island/IslandView.swift`, `IslandPhonePill` · reached from: a paired iPhone given "Let it drive
this Mac" starting a drive

**Job.** Is somebody else acting on this Mac right now?

**Today.** A black capsule with an amber edge, 6 points under the island in every mode, an amber
`iphone.radiowaves.left.and.right` symbol and "Driven from Maya's iPhone" (or "Driven from your
phone"). It stays for the whole grant and goes when its time runs out, even if no notice says so.
It takes no clicks.

```
━━━━━━━━━━━━━━━━━━━━━━━━╮ ●  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓    ╭━━━━━━━━━━━━━━━━━━━━━━━━
                        ╰──────────────────────╯
                     ( 📱 Driven from Maya's iPhone )
```

**What gets in the way.**

- The person at the Mac cannot stop the drive from where it is shown; the only off switch is in
  Settings, Phones. [Proximity]
- No time left is shown, though the grant has an end (`until`). [Hierarchy]

**Improved.**

```
                ( 📱 Driven from Maya's iPhone · 12 min left · Stop )
```

- "Stop" calls the same unsigned `ungrant(.mac)` the Phones switch uses, since narrowing needs no
  Touch ID.

### Phone voice pill

`Island/IslandView.swift`, `IslandPhonePill` · reached from: a paired phone taking the voice

**Job.** Why is the Mac silent?

**Today.** The same capsule with an amber `iphone` symbol and "Talking on Maya's iPhone" (or
"Talking on your phone"). While it shows, the Mac stops listening for its name, held calls are
shown on the island without a sound, and proposals are left for the phone.

**What gets in the way.**

- Two pills can stack under the island with the same colour and shape, telling apart two very
  different states (acting on the Mac, talking on the phone) by a small icon only. [Contrast]

**Improved.**

- Talking stays amber; driving turns red outline with "Stop", since it is the one that acts.

### Phone turn mirror

`Island/IslandConversation.swift`, `IslandConversation(from:)` in `.conversation` · reached from: a
paired phone asking Memnox something

**Job.** What is my phone asking Memnox right now?

**Today.** 580 by 372, silent. A small `iphone` label "From Maya's iPhone", the question in a
bubble (left out when its start was missed), and the answer card as it streams, "Working" then
"Done". It stays 8 seconds after the turn ends. The person's own talking always takes the island
first.

```
━━━━━━━━━━━━━╮ ◉  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓                         ╭━━━━━━━━━━━━━
             │ 📱 From Maya's iPhone                       │
             │ ╭────────────────────────────────────────╮ │
             │ │ what is Hermes doing                   │ │
             │ ╰────────────────────────────────────────╯ │
             │ ┌ ● Memnox                 Working  0:03 ┐ │
             │ │ Hermes is running the build on         │ │
             │ │ build-box, step 4 of 7.                │ │
             │ │                   [ Copy ] [Open answer]│ │
             │ └────────────────────────────────────────┘ │
             ╰────────────────────────────────────────────╯
```

**What gets in the way.**

- The orb sits in the header row with no header around it, so the tabs vanish and the only way back
  is to wait 8 seconds or click outside. [Consistency]

**Improved.**

- The header row stays, with the phone label in place of the working count.

### Draft card (switched off)

`Island/IslandDraft.swift`, `IslandDraftCard` in `.draft` · reached from: nothing today, since
`IslandPanel.showsDrafts` is false

**Job.** Is this email right before my finger sends it?

**Today.** Built and unreachable. When on: a mail mark, "Reply" or "New Message", a close cross
(tooltip "Close without sending"), "View thread (1)", "To" and "Cc" chips, the subject, the body
typing itself in over about a second, a copy button (tooltip "Copy the message") and a blue "Send"
with Touch ID, reason "send the reply to sam@example.com".

**What gets in the way.** Nothing a person meets today. When it returns, "Send" in Gmail blue is
the only answer on the island in a brand colour, unlike every other yes. [Consistency]

**Improved.** Keep it off until mail is in scope, then use the island's white primary for "Send".

### History panel

`Presentation/Side/SidePanel.swift`, `SideView.swift`, `SideFilter.swift` · reached from: a rest
of 0.25 seconds on the thin tab at the middle of the left screen edge, a rest on the orb's side of
the notch, or the "◷" tab in the island's header

**Job.** What needs me, what is working, and what did Memnox tell me earlier?

**Today.** A black panel 330 wide and up to 700 tall, flush with the left edge with the same
concave flare as the notch. At rest it is a 6 by 64 point sliver with a faint hairline; under the
pointer it swells to 12 by 96. Top to bottom:

- A search field "Search" with a clear button ("Clear search"), and a pin (tooltip "Keep it open
  while you work" or "Let it close when you click elsewhere").
- Filter chips, each only when its section has something: "All", "Needs you 2", "Working 3",
  "History".
- "Needs you" with an amber dot and a count: every held call, newest first, as a **Held strip**,
  answered in place.
- "Working now" with a green dot and a count: rows with the agent's logo tile, the title, the
  subtitle (shimmering while it thinks) and an arrow on hover; a click brings its window forward
  (tooltip "Bring its window forward").
- History by day: "Today, 14:32", "Yesterday", or "Monday 5 Oct". Each row: a blue Memnox disc or
  a red "!" disc, the question, then "Answering, 0:04", the failure in red, or "Answered in 0:06 ·
  14:32"; a red dot for a failure, with "Ask again" on hover. A click opens the answer tall under
  the notch.
- Footer: keycaps "⌥" "Space" and "to ask"; "Clear history", which becomes a red "Clear all?" for
  three seconds and clears on a second click.

```
╭━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╮
┃ ⌕ Search                   📌 ┃
┃ (All) Needs you 1  Working 2  ┃
┃   History                     ┃
┃ ● Needs you 1                 ┃
┃ ┌───────────────────────────┐ ┃
┃ │ ◐ Claude Code on your Mac │ ┃
┃ │   wants to push to main   │ ┃
┃ │ git push origin main      │ ┃
┃ │ [ Deny ] [⊛ Allow once]   │ ┃
┃ └───────────────────────────┘ ┃
┃ ● Working now 2               ┃
┃ ◑ fix the flaky test        ↗ ┃
┃   Codex · api · Working       ┃
┃ Today, 14:32                  ┃
┃ ● what is cursor doing        ┃
┃   Answered in 0:06 · 14:32    ┃
┃ ! is the api build green      ┃
┃   Memnox could not be reached ┃
┃   on this Mac               ● ┃
┃ ⌥ Space to ask  Clear history ┃
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯
```

Actions. It never takes the keyboard until the search is clicked. Unpinned, it folds 0.45 seconds
after the pointer leaves, or on a click in another app; Escape closes it once it has the keyboard.

States. Empty: a speech bubble symbol, "Nothing asked yet" and "Press Option Space and ask
anything. Every answer stays here, on this Mac." Searching with no match: "Nothing mentions
“deploy”". A chosen filter whose section empties falls back to "All".

**What gets in the way.**

- The held strip here offers only "Deny" and "Allow once", while the island offers a session allow
  too, so the same call has different answers on two surfaces a few centimetres apart.
  [Consistency]
- The panel folds 0.45 seconds after the pointer leaves, so moving to the island to read more
  closes it unless pinned. [Progressive disclosure]
- "Working now" rows bring a window forward rather than opening the live window, while the home's
  "Working now" rows open the live window. Same label, two outcomes. [Consistency]
- "Ask again" appears only on hover; VoiceOver has it as an action, a pointer user may never find
  it. [Accessibility]

**Improved.**

- The held strip uses the island's answers (see **Held call**).
- "Working now" rows open the live window, with the arrow bringing the agent's own window forward,
  matching the home.
- A visible "Ask again" on every failed row.

### Touch ID sheet and system prompts

`MemnoxVoiceCore/Infrastructure/Security/SecureEnclaveConfirmKey.swift`; `Setup.swift` ·
reached from: any signed yes; the permission steps in setup

**Job.** Am I signing exactly what I think?

**Today.** The app has no alerts of its own; every sheet is the system's. The Touch ID sheet
carries Memnox's reason:

| What               | Reason given to the sheet                                       |
| ------------------ | --------------------------------------------------------------- |
| Allow once         | "allow Claude Code on your Mac once: git push origin main"      |
| Allow this session | "allow Claude Code on your Mac for this session: git push …"    |
| Enforce a rule     | "<summary> in shop", for example "ask git.push on main in shop" |
| Approve a phone    | "pair Maya's iPhone, showing 482913"                            |
| Connect a server   | "pair this Mac with your server"                                |
| Let a phone drive  | signed by `Pairing.grant(.mac)`                                 |
| Send a draft (off) | "send the reply to sam@example.com"                             |

A Mac with no Secure Enclave or keychain gets a `RefusingKey`: every allow is declined and the log
says "no confirmation key, so allows stay in the terminal".

macOS's own prompts come from "Allow" on Profile: Microphone and Speech Recognition, then
Accessibility and Screen Recording. After the first time only System Settings can change them.

**What gets in the way.**

- A Mac that cannot sign never says so on screen; every allow quietly fails. [Accessibility]

**Improved.**

- The Connection page's Touch ID row reads "This Mac cannot sign, so allows stay in the terminal"
  in amber when the key is a `RefusingKey`.

---

## Menu bar

### Menu bar icon

`Presentation/MenuBar.swift`, `MenuBarPanel` · reached from: always in the menu bar

**Job.** Where is Memnox when the notch is busy or hidden?

**Today.** The Memnox logo (`MemnoxLogo.menuBar`), or `waveform.circle` when the bundled logo is
missing, with the tooltip "Memnox" and the accessibility description "Memnox". A click toggles the
panel. It never changes with state.

**What gets in the way.**

- The icon carries no state, so on an external display without the island in view a waiting call
  has no sign in the menu bar. [Hierarchy]

**Improved.**

- An amber dot on the icon while a call waits, and the accessibility description "Memnox, 1 call
  waits".

### Menu bar panel

`Presentation/MenuBar.swift`, `MenuView` · reached from: a click on the menu bar icon

**Job.** Talk to Memnox, see the two numbers that matter, and get to Settings.

**Today.** A black panel 300 wide with 22 point corners and a hairline edge, under the icon, kept
inside the visible screen. Sections settle in one after another each time it opens:

- Header: logo, "Memnox" in display type, and a capsule with a dot: green "Listening" when the wake
  word is on (tooltip "Memnox wakes when you say its name"), grey "Here when you call" otherwise
  (tooltip "Press Option Space to talk").
- A blue tinted card: waveform in a blue disc, "Talk to Memnox", keycaps "⌥" "Space"; tooltip "Talk
  to Memnox with Option Space".
- A glance row: an amber or grey dot, "1 needs you" (or "2 need you"), a green or grey dot, "3
  working", and a chevron; tooltip "See the overview in Settings".
- Rows: shield "Say a rule", clipboard "Copy what happened", gear "Settings", and a dimmed power
  "Quit Memnox".

```
            ╭──────────────────────────────────╮
            │ ◉ Memnox      ( ● Here when you   │
            │                     call )        │
            │ ┌──────────────────────────────┐  │
            │ │ ⌁  Talk to Memnox   [⌥][Space]│  │
            │ └──────────────────────────────┘  │
            │ ┌──────────────────────────────┐  │
            │ │ ● 1 needs you  ● 3 working  ›│  │
            │ └──────────────────────────────┘  │
            │ ⛨  Say a rule                     │
            │ ⎘  Copy what happened             │
            │ ⚙  Settings                       │
            │ ⏻  Quit Memnox                    │
            ╰──────────────────────────────────╯
```

Actions. "Talk to Memnox" closes the panel and talks. The glance row opens the window on Overview.
"Say a rule" closes the panel and the orb says "Hold Control and Option, say the rule, then let go.
I will ask where it should hold." (or, without Accessibility, "To hear the rule keys I need
Accessibility. Switch Memnox on in System Settings, then hold Control and Option to say a rule.").
"Copy what happened" puts the app's diary on the clipboard ("Nothing has happened yet." when
empty). "Settings" opens the window on the page last shown. A click elsewhere or Escape closes it.

States. Counts are read fresh on every open. "need you" counts held calls including team calls;
"working" counts live sessions that are active.

**What gets in the way.**

- "1 needs you" opens Settings, not the call; the one number that blocks work leads away from where
  it is answered. [Hierarchy]
- "Copy what happened" closes the panel and copies with no sign it worked. [Accessibility]
- The header's "Listening" reads as "the microphone is on", while it means only that the wake word
  is armed. [Consistency]
- user-flows says a phone is revoked "from the Mac's menu bar under Phones", but the panel has no
  Phones row; it moved to Settings. [Consistency]
- "Quit Memnox" sits one row under "Settings" with no confirmation, and quitting silently ends
  every held call's door on this Mac. [Proximity]

**Improved.**

```
            ╭──────────────────────────────────╮
            │ ◉ Memnox      ( ● Wakes on name ) │
            │ ┌──────────────────────────────┐  │
            │ │ ⌁  Talk to Memnox   [⌥][Space]│  │
            │ └──────────────────────────────┘  │
            │ ┌ amber ───────────────────────┐  │
            │ │ ● 1 waits on you     Answer › │  │
            │ └──────────────────────────────┘  │
            │   ● 3 working              Home › │
            │ ⛨  Say a rule        hold ⌃⌥      │
            │ ⎘  Copy what happened   Copied ✓  │
            │ ⚙  Settings                       │
            │ ─────────────────────────────     │
            │ ⏻  Quit Memnox                    │
            ╰──────────────────────────────────╯
```

- A waiting call gets its own amber row whose "Answer" opens the island's held card; working opens
  the home.
- "Wakes on name" in place of "Listening".
- "Say a rule" shows the chord; "Copy what happened" confirms in place.
- A divider before "Quit Memnox".

---

## Settings window

### The window

`Presentation/Settings/SettingsWindow.swift`, `SettingsView.swift`, `SettingsPage.swift` · reached
from: first launch, "Settings" and the glance row in the menu, "Pair a phone" from code paths

**Job.** Where do I set Memnox up and see where things stand?

**Today.** One ordinary window titled "Memnox", 820 by 600 at least, dark, painted black, with the
traffic lights over a transparent title bar and the whole background draggable. A 210 point
sidebar with groups: "Overview" alone at the top; "You": "Profile", "Team"; "This Mac":
"Connection", "Phones"; "Voice": "Voice", "Listening"; "Support": "Help". The chosen row is lit.
Every page but Overview opens with its title at 26 points and a subtitle:

| Page       | Subtitle                                                           |
| ---------- | ------------------------------------------------------------------ |
| Profile    | "Who you are, and what this Mac lets Memnox hear and see."         |
| Team       | "Your Memnox Cloud workspace, and the calls it routes to you."     |
| Connection | "The daemon your agents talk to, and the key Touch ID signs with." |
| Phones     | "Phones paired with this Mac and what each may do."                |
| Voice      | "Who thinks for the voice, and the voice it answers in."           |
| Listening  | "When Memnox listens and how it speaks up."                        |
| Help       | "Rules, a quick test, and what happened for support."              |

Pages sit in a column 560 wide. Escape closes the window. Every opening re-reads the voice, the
phones, the counts and the home; the setup checks run whenever setup hands the window a new model.

States. Before setup hands its model over, a small spinner fills the page.

**What gets in the way.**

- The window is called Settings in the menu but holds the home, which is the Mac's main screen.
  [Consistency]
- "This Mac" holds "Phones", which also holds the server connection, while "Connection" holds only
  the daemon and Touch ID. [Consistency]
- Profile and Connection are one short card each; seven sidebar rows for about twelve controls.
  [Progressive disclosure]

**Improved.**

```
┌ ● ● ●  ───────────────────────────────────────────────────────────┐
│ ⌂ Home          │ Home                                            │
│                 │                                                 │
│ YOU             │                                                 │
│ ◯ Profile       │                                                 │
│ ⚇ Team          │                                                 │
│ THIS MAC        │                                                 │
│ ⚡ Connection    │  (daemon, Touch ID, servers)                    │
│ 📱 Phones        │  (phones only)                                  │
│ VOICE           │                                                 │
│ ◍ Voice         │  (one picker)                                   │
│ 👂 Listening     │  (switches and keys)                            │
│ SUPPORT         │                                                 │
│ ? Help          │  (tests, diary, check setup again)              │
└─────────────────┴─────────────────────────────────────────────────┘
```

- "Overview" renamed "Home", and the menu row "Settings" opens Home with the sidebar beside it.
- "Connect to a server" moves to Connection, so This Mac reads as "what this Mac talks to" and
  "who can reach this Mac".

### Overview

`Presentation/Settings/OverviewPage.swift` · reached from: the sidebar, the menu's glance row, first
launch

**Job.** What waits on me, what are my agents doing, and what could run on its own?

**Today.** Once setup is finished, top to bottom: "Overview", "Hi Maya", "What waits on you, what
your agents are doing, and what could run on its own.", the "Talk to Memnox ⌥ Space" quiet button,
the **Home blocks**, then the **Do this next** card reading "Set up", "7 of 7", "Everything is
ready. Press Option Space from anywhere and ask about your agents." with the full checklist. When
the daemon gives no home (away, or older than the home), a single line of numbers stands in:
"Need you 1", "Working 2", "Agents 2", "Repositories 2".

```
┌──────────────────────────────────────────────────────────────┐
│ Overview                                                     │
│ Hi Maya                                                      │
│ What waits on you, what your agents are doing, and what      │
│ could run on its own.                                        │
│ [ ⌁ Talk to Memnox ⌥ Space ]                                 │
│                                                              │
│ WAITING ON YOU                                               │
│ ┌ amber ─────────────────────────────────────────────────┐   │
│ │ 1   1 call waits on you.                    [ Answer ] │   │
│ └────────────────────────────────────────────────────────┘   │
│ WORKING NOW                                                  │
│ ┌────────────────────────────────────────────────────────┐   │
│ │ ● Claude Code                                         › │   │
│ │   add VAT to invoices in shop                          │   │
│ │ ● Cursor                                              › │   │
│ │   landing copy in site                                 │   │
│ └────────────────────────────────────────────────────────┘   │
│ TODAY                                                        │
│ ┌────────────────────────────────────────────────────────┐   │
│ │ 41 actions, 6 asked you, 5 allowed, 1 refused          │   │
│ └────────────────────────────────────────────────────────┘   │
│ READY TO HAND OVER  …                                        │
│ NOT COVERED  …                                               │
│ ┌ SET UP ─────────────────────────────────────── 7 of 7 ┐    │
│ │ Everything is ready. Press Option Space from anywhere │    │
│ │ and ask about your agents.                            │    │
│ │ ●✓ Tell Memnox your name … (seven rows)               │    │
│ └───────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────┘
```

**What gets in the way.**

- A greeting, a line of description and a talk button stand above "Waiting on you", so the block
  that blocks work starts a third of the way down. [Hierarchy]
- The finished setup card stays at the foot forever. [Progressive disclosure]
- Signed in to a team, there is no "Your team" block, which the shared shape puts last.
  [Consistency]
- The fallback numbers use different words ("Need you", "Agents", "Repositories") from the blocks
  they replace. [Consistency]

**Improved.**

```
┌──────────────────────────────────────────────────────────────┐
│ Hi Maya                                  [ ⌁ Talk  ⌥ Space ] │
│                                                              │
│ WAITING ON YOU · WORKING NOW · TODAY ·                       │
│ READY TO HAND OVER · NOT COVERED ·                           │
│ YOUR TEAM                                                    │
│ ┌────────────────────────────────────────────────────────┐   │
│ │ 2 calls wait for Ana's team.             [ Answer ]    │   │
│ │ 1 rule waits on a second admin.          [ Review ]    │   │
│ └────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

- The greeting and the talk button share one row, and "Waiting on you" is the first block.
- The setup card leaves Overview once finished.
- "Your team" under "Not covered" when signed in, built from the workspace inbox the app already
  polls.

### Home blocks

`Presentation/Home/HomeBlocks.swift`, `HomeModel.swift`; `MemnoxVoiceCore/Domain/Home/HomeLines.swift`
· reached from: Overview

**Job.** The five answers the home owes on every surface, in counts.

**Today.** Five blocks in the shared order, each a small capital heading over a card. They are read
when the window comes forward and 1.5 seconds after a burst of stream events while it is showing,
never on a timer. A failed read keeps the last home, so a daemon restarting does not blank it.

- **"Waiting on you"**: the count large (amber when above zero, with an amber card edge) and
  "Nothing waits on you.", "1 call waits on you." or "3 calls wait on you."; "Answer" (tooltip
  "Open the waiting calls on the island") when above zero, which opens the island.
- **"Working now"**: per session a green dot, the agent name, "<task> in <repository>" (or the
  task, "Working in <repository>", "Working"), and a chevron; tooltip "Watch Claude Code live"; a
  click opens the **Live session window**. Empty: "Nothing is working right now."
- **"Today"**: "41 actions, 6 asked you, 5 allowed, 1 refused", or "Nothing has run today."
- **"Ready to hand over"**, only when the daemon has one, with a blue ring: "You have said yes to
  git.push 6 times, for Claude Code. Let it run on its own?" ("once", "twice", "N times"; the
  agent named only when every yes came from one), the targets in monospace, the `because` line, and
  a blue "Let it run on its own" (tooltip "Proposes an allow rule for exactly these; nothing
  changes until you confirm it with Touch ID"). Pressed, it reads "Proposing the rule" and the
  **Rule card** comes up on the island; the note under it says "Pick where it holds on the island,
  then confirm with Touch ID.", the refusal, or "Memnox did not answer. Check that it is running,
  then try again."
- **"Not covered"**, amber edged when an agent runs outside: "1 agent here runs outside Memnox.",
  "2 agents have been quiet for a month and still hold their reach.", or "Every agent here is
  under Memnox." Then a blue "Protect my agents" (tooltip "Hooks every agent found on this Mac into
  Memnox, the way setup does"), "Protecting your agents" while it runs, and the failure line
  ("Memnox could not put them under it. In a terminal: memnox setup" or "Memnox is still starting
  up. Try again in a moment."). Talking to a server, the button gives way to "Run memnox setup on
  that server to put them under Memnox."

**What gets in the way.**

- "Working now" names the agent alone, "Claude Code", not "Claude Code on your Mac" or "Hermes on
  build-box" when a server is the target. [Consistency]
- "Ready to hand over" disappears when there is nothing ready, so the home is sometimes four blocks
  and the eye loses its place. [Alignment]
- "Let it run on its own" sends the person to the notch to finish, away from the card they read.
  [Proximity]
- "Answer" is a quiet button while "Let it run on its own" and "Protect my agents" are blue, so the
  one block that blocks work has the weakest action. [Contrast]

**Improved.**

```
│ WAITING ON YOU                                                 │
│ ┌ amber ───────────────────────────────────────────────────┐   │
│ │ 1  Claude Code on your Mac wants to push to main          │   │
│ │    [ Deny ]                         [⊛ Allow once]  More ▾│   │
│ └───────────────────────────────────────────────────────────┘   │
│ WORKING NOW                                                    │
│ │ ● Claude Code on your Mac · add VAT to invoices in shop  › │ │
│ READY TO HAND OVER                                             │
│ │ Nothing is ready yet. Six yeses to one action make it ready.│ │
```

- With one call waiting, the block holds its **Held strip** and answers in place; with several, a
  blue "Answer 3" opens the island.
- "<agent> on <machine>" on every Working row.
- "Ready to hand over" always present, saying what makes something ready.

### Profile

`Setup.swift`, `SetupYouCard` · reached from: the sidebar, checklist steps 1 to 3

**Job.** Who am I to Memnox, and what may it hear and see?

**Today.** One card of three rows, each a mark, a title, a detail and a control, an amber wash
behind a row that needs the person:

- "Your name", "What I call you.", a text field with placeholder "Your name" (blue ring on focus).
  Saved on Return, and as it is typed once setup is finished.
- "Hear you", "Microphone and speech recognition, on this Mac only.", white "Allow" until granted.
  Refused: "Turn on Memnox in System Settings, Privacy and Security, Microphone and Speech
  Recognition".
- "See and act", "Read your screen when you ask, and check that what it sent landed.", white
  "Allow" until both are granted. Missing Accessibility: "Turn on Memnox in System Settings,
  Privacy and Security, Accessibility". Missing Screen Recording: "Turn on Memnox in System
  Settings, Privacy and Security, Screen Recording, then reopen Memnox".

**What gets in the way.**

- "See and act" asks for two permissions behind one button; the second sheet only appears once
  the first is granted, and the row never says which one it is waiting on until it fails.
  [Progressive disclosure]
- The instructions are text with no button that opens the right System Settings pane. [Proximity]
- "What I call you." is in Memnox's voice while every other line is about the person. [Consistency]

**Improved.**

```
│ ● Your name           What Memnox calls you.     [ Maya        ] │
│ ● Hear you            Microphone and speech, on this Mac.   ✓    │
│ ! See and act         2 permissions                              │
│     ✓ Accessibility   lets Memnox type into your agents          │
│     ! Screen Recording  checks what it sent landed               │
│                                     [ Open System Settings ]     │
```

- Each permission its own line with what it is for, and a button that opens its pane.

### Team

`Presentation/Settings/TeamPage.swift` · reached from: the sidebar, "Join your team" on first run

**Job.** Am I signed in to my team, so its calls reach me here?

**Today.** One card: a mark, "Sign in to your team" (or "Signed in to your team"), a detail line,
and a button.

| Step         | Detail                                                                                                                                            | Button     |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Signed out   | "Answer the calls your teammates' agents route to you, on the island beside your own. Every allow asks for Touch ID."                             | "Sign in"  |
| Starting     | "Asking Memnox Cloud for a code."                                                                                                                 | spinner    |
| Code showing | "The console is open in your browser. Approve this Mac there." plus the code large and "Approve this Mac in the console with the code ABCD-1234." | "Cancel"   |
| Signed in    | "As Maya Chen, in one workspace. Signing out removes this Mac from your team."                                                                    | "Sign out" |
| Failed       | the same detail as signed out, with the reason in amber                                                                                           | "Sign in"  |

Failure reasons: "Memnox Cloud did not answer. Check the connection and try again.", "The code ran
out before it was approved. Start again for a new one.", "The sign in was declined in the
console.", "That code was already used. Start again for a new one.", "Your account reaches no
workspace yet, so there is nothing to answer.", "This Mac has no Touch ID key, so it cannot answer
for your team.", "Your team signed this Mac out. Sign in again to answer its calls."

**What gets in the way.**

- Signed in, the page says nothing about the team: no workspace name, no count of calls waiting
  for the team, no link to the console. [Hierarchy]
- "Sign out" has no confirmation and is a destructive act on the team's side ("removes this Mac
  from your team"). [Proximity]

**Improved.**

```
│ ● Signed in to your team                         [ Sign out ]   │
│   As Maya Chen, in Acme. Every allow asks for Touch ID.         │
│   2 calls wait for the team · last read 12 s ago                │
│   Open the console ›                                            │
```

- The workspace name and the inbox's last read, and "Sign out" asks once.

### Connection

`Setup.swift`, `SetupMacCard` · reached from: the sidebar, checklist steps 4 and 5

**Job.** Is the daemon running, and can my finger sign?

**Today.** One card of two rows:

- "Memnox daemon", detail from the runtime: "Installing Memnox…", "Installing Node.js…", "Starting
  the Memnox daemon…", "Setting Memnox up on this Mac…", "Updating Memnox…", "Linking the local
  Memnox runtime…", or "What your agents already talk to. Installed, started and updated for
  you." A grey "Check again" until it is ready.
- "Touch ID", "Your finger approves anything outside a session's repository. Saying no needs only
  your voice.", "Check again" until the key is registered.

Failure lines appear in amber with selectable text, for example "This Memnox is older than the app
and would not update. In a terminal: memnox update".

**What gets in the way.**

- The daemon's version and whether this Mac or a server is the target are nowhere on the page.
  [Hierarchy]
- "Saying no needs only your voice." is true but reads as if a no can only be spoken, while "Deny"
  is a button everywhere. [Consistency]

**Improved.**

```
│ ● Memnox daemon     Running, memnox 0.21.3, on this Mac          │
│ ● Touch ID          Your finger signs every yes outside a        │
│                     session's repository. A no is free.          │
│ SERVERS                                                          │
│ ● This Mac                                       Talking to it   │
│ ○ build-box                          [ Talk to it ] [ Forget ]   │
│ [ memnox://pair?d=...                    ] [ Connect ]           │
```

- The server card moves here from Phones.

### Phones

`Settings/SettingsView.swift`, `PhonesPage`; `Setup.swift`, `SetupPhoneCard`, `SetupServerCard`;
`MenuBar.swift`, `DeviceRow` · reached from: the sidebar

**Job.** Which phones can reach this Mac, and what may each do?

**Today.** Three cards:

1. **"Pair a phone"**, "Optional. Answer your agents and talk to Memnox from your iPhone.", grey
   "Pair". Pressed: a spinner, then a 148 point QR on white, "Scan this with the Memnox app on your
   iPhone." and "Copy link", with "Cancel" in place of "Pair". Once the phone reaches it: the
   phone's name, the six digits grouped "482 913", "Approve if your iPhone shows the same digits.",
   a white "Approve" and a grey "Decline" (no Return shortcut on purpose). Approve raises Touch ID
   ("pair Maya's iPhone, showing 482913"). Paired: "Your iPhone is paired." in green (or "Maya's
   iPhone is paired."), said aloud too. Failures: "The phone was not paired.", "The code ran out
   before a phone used it. Pair again when your phone is ready.", "Memnox on this Mac is not
   answering, so a phone cannot pair yet.", "Memnox would not open a pairing just now.", with "Try
   again".
2. **Paired phones**, when there are any: per phone an iPhone symbol, the name, "Paired" or "Can
   see, ask, answer, steer, rules, rewind, mac", a grey "Revoke", and a switch "Let it drive this
   Mac" with "Touch ID to turn on" or "Turn off to stop it". On asks for Touch ID; off and Revoke go
   unsigned.
3. **"Connect to a server"**, "Optional. Talk to Memnox on a Linux server through the relay. Run
   memnox pair there and paste the link it prints.", a field "memnox://pair?d=...", "Connect"
   (disabled while empty, Return submits). Then "Meeting the server through the relay.", the six
   digits and "Type these six digits into memnox pair on the server.", then "Connected to
   build-box." Below, "This Mac" and each server with "Talking to it" in green or "Talk to it",
   and "Forget" for a server. Failures include "That is not a Memnox pairing link. Paste the
   memnox://pair link that memnox pair printed." and "The relay could not be reached, or the server
   stopped answering. Check the connection and try again."

```
│ ● Pair a phone                                          [ Pair ] │
│   Optional. Answer your agents and talk to Memnox from your      │
│   iPhone.                                                        │
│   Maya's iPhone                                                  │
│   482 913                                                        │
│   Approve if your iPhone shows the same digits.                  │
│   [ Approve ] [ Decline ]                                        │
│ ┌──────────────────────────────────────────────────────────────┐ │
│ │ 📱 Maya's iPhone                                [ Revoke ]   │ │
│ │    Can see, ask, answer, steer, rules, rewind, mac           │ │
│ │ ⇢  Let it drive this Mac                              (○  ) │ │
│ │    Touch ID to turn on                                       │ │
│ └──────────────────────────────────────────────────────────────┘ │
│ ○ Connect to a server …                                          │
```

**What gets in the way.**

- The capability list prints raw enum words, "Can see, ask, answer, steer, rules, rewind, mac",
  which nobody outside the codebase can read. [Accessibility]
- "Revoke" and "Forget" take a phone or a server away at once with no confirmation, beside a
  switch that does ask. [Consistency]
- A server lives on the Phones page. [Consistency]
- The pairing card's mark shows grey "waiting" even when phones are already paired, because its
  state is only the current pairing. [Hierarchy]

**Improved.**

```
│ 📱 Maya's iPhone                                   [ Revoke… ]   │
│    Sees sessions, answers calls, steers agents, changes rules    │
│    from this Mac, rewinds. Paired 3 Oct.                          │
│ ⇢  Let it drive this Mac       Touch ID to turn on      (○  )    │
```

- Capabilities in sentences, "Revoke…" asks once, the server card moves to Connection, and the
  pairing mark is green when any phone is paired.

### Voice

`Settings/SettingsView.swift`, `VoicePage`; `Setup.swift`, `SetupVoiceCard`, `AgentRows`,
`VoicePicker`; `MenuBar.swift`, `VoiceMenuRow` · reached from: the sidebar, checklist steps 6 and 7

**Job.** Which agent thinks for the voice, and what does the voice sound like?

**Today.** Two cards.

The first holds two rows:

- **"Who answers for you"** with a detail: "Claude Code, kept to reading, so it never edits a file
  or runs a command.", "Codex can run shell commands without asking, used because no agent kept to
  reading answered.", "Asking each of your agents one question to see which answers." or "The
  agent you already use thinks for the voice." When it is done, a "Details" / "Hide" button.
  Otherwise, or when shown, a row per installed agent: name, status ("Asking", "Not asked yet",
  the reason or "Did not answer" in amber, "Answers, kept to reading", "Answers, but can run
  ordinary shell commands"), and green "In use" or a "Use" button; then "Also answers through
  Hermes or OpenClaw once installed and logged in." and "Check again".
- **"Voice"**, detail "Kokoro, a natural voice running on this Mac.", "The Mac's own voice, as
  picked in the menu bar.", "Installing Kokoro, about 340 MB once: getting ready. The Mac voice
  speaks until then." or "Kokoro installs itself the first time. The Mac voice speaks until then."
  A menu of eleven Kokoro voices from "Default (American Female)" to "Lewis (British Male)"
  (tooltip "Choose the Kokoro voice, which speaks once picked"), and a play button (tooltip and
  label "Hear it") that says "Hi Maya, I am Memnox. Press Option Space whenever you want me."
  Picking a voice says "This is how I will sound." Installing: a spinner. Failed: "Try again" and,
  without a Premium or Enhanced Mac voice, "Get a Mac voice instead" (opens Spoken Content).

The second card is one row, "Voice", with the current voice under it and a menu: "Mac voice", then
a section "Kokoro, free and on this Mac" with the same eleven voices (tooltip "Choose the voice
Memnox speaks with"). A pick is said on the island: "Good evening. This is how I sound now." or
"That voice is not available, so I will keep using this one."

**What gets in the way.**

- Two pickers for one choice, both titled "Voice", one with the Kokoro voices only and one with the
  Mac voice as well. [Consistency]
- The voice detail says "as picked in the menu bar", but the menu bar has no voice picker any more.
  [Consistency]
- The confirmation always says "Good evening", at any hour. [Consistency]
- "can run shell commands without asking" is the most important safety fact on the page and sits in
  secondary ink inside a detail line. [Contrast]

**Improved.**

```
│ ● Who answers for you        Claude Code, kept to reading.   ⌄  │
│ ● Voice                                                         │
│   ( Mac voice | Kokoro )   [ Bella (American Female)   ⇕ ] [▶] │
│   Kokoro, a natural voice running on this Mac.                  │
│ ! Codex can run shell commands without asking. Choose an agent  │
│   kept to reading if one answers.                               │
```

- One picker with the engine as a segmented choice; the confirmation greets for the hour, through
  `WakeLines`; the shell warning in amber when it applies.

### Listening

`Settings/SettingsView.swift`, `ListeningPage`; `Setup.swift`, `SetupCatchUpRow` · reached from:
the sidebar

**Job.** When does Memnox listen, and when does it speak up?

**Today.** One card of seven switches in the console blue, each an icon, a title and a detail.
Defaults in brackets.

| Switch                     | Detail                                             | Default |
| -------------------------- | -------------------------------------------------- | ------- |
| "Wake when I say “Memnox”" | "On this Mac only"                                 | off     |
| "Speak up on its own"      | "When work finishes or ships"                      | off     |
| "Talk over it"             | "Cut in just by speaking"                          | on      |
| "Sounds"                   | "A chime when something happens"                   | on      |
| "Live words"               | "See what you say in the notch"                    | on      |
| "Stay where I am"          | "Agents get your words without taking your window" | on      |
| "Catch me up"              | "What my agents did while I was away"              | on      |

Turning the wake word on asks for the microphone if needed; on a Mac that cannot recognise speech
on device it turns itself back off and the orb says "This Mac cannot recognise speech on its own,
so I will not listen for my name. Option Space still works."

**What gets in the way.**

- The keys are not on the page: Option Space and the Control Option hold are only discoverable from
  keycaps elsewhere and a spoken line. [Progressive disclosure]
- The wake word's cost (the microphone open whenever the orb is idle) is not said, only "On this
  Mac only". [Accessibility]
- "Catch me up" does not say it waits for ten minutes away, or that it needs a locked screen.
  [Accessibility]

**Improved.**

```
│ KEYS                                                             │
│ ⌥ Space        Talk, or stop Memnox talking                      │
│ ⌃ ⌥ hold       Say a rule              ! needs Accessibility ›   │
│ LISTENING                                                        │
│ Wake when I say “Memnox”   Keeps the microphone open while idle, │
│                            heard on this Mac only.        (○  )  │
│ …                                                                │
│ Catch me up    After 10 minutes with the screen locked.   ( ●)   │
```

- A Keys section with the permission state of the hold, and plain costs on each switch.

### Help

`Settings/SettingsView.swift`, `HelpPage` · reached from: the sidebar

**Job.** How do I check it works, and what do I send support?

**Today.** One card of three rows: shield "Say a rule", speaker "Say something" (the orb says "This
is Memnox. If you can hear me, my voice works.", caption "Testing my voice"), clipboard "Copy what
happened".

**What gets in the way.**

- "Say a rule" here only speaks an instruction; it does not start a rule. [Consistency]
- "Copy what happened" gives no sign it worked and does not say it is for support. [Accessibility]
- There is no way back into the setup checklist once it is gone from Overview (under **Improved**
  above). [Progressive disclosure]

**Improved.**

```
│ ▶ Test the voice         Plays a short line through the orb      │
│ ✓ Check setup again      7 of 7 ready                         ›  │
│ ⎘ Copy what happened     For support. Copied ✓                   │
│ ⛨ How to say a rule      Hold ⌃ ⌥, say it, let go                │
```

---

## Live session window

### Live session window

`Presentation/LiveSession.swift`, `LivePanel`, `LiveSessionView` · reached from: a "Working now" row
on the home, "Watch live" on a summary or wall card, or the voice

**Job.** What is this agent doing right now, and is it waiting on me?

**Today.** Before it opens, if more than one session is listed, the **Switcher** turns to this one
(about one second). Then a black panel 540 wide and up to 820 tall swings in at the middle of the
screen, rounded 28 points, with a 3 point band along its top in the session's status colour (green
working or thinking, amber waiting on the person, red paused, grey otherwise). Sections rise into
place one after another:

- Header: the agent's logo tile, the name in display type, the meta line "shop · Terminal ·
  active 2m ago", a state pill with a breathing dot ("Working", "Thinking", "Needs you", "Waiting
  on you", "Paused", "Ended", "Quiet"), and the close cross (Escape). The task under it in two
  lines.
- "CONVERSATION", when there is one: the person's words in blue bubbles on the right, the agent's
  on the left with its newest reply typing itself out, each tool as a quiet monospaced line with a
  gear, and three rising dots while it thinks. Up to 380 tall, kept scrolled to the bottom.
- The now line: "Paused: <reason>", "Thinking through its answer", the last step, or "Nothing
  recorded yet".
- Folding sections, folded when a conversation is shown and open otherwise: "LATEST STEPS 12",
  "HELPERS 2", "CHANGED 4", each with a chevron (tooltip "Show latest steps" or "Fold latest
  steps"). Steps are monospaced with a surface icon and their age, amber when refused, red when
  failed; 4 shown beside a conversation, 8 alone.
- The dock: when this session holds a call, its **Held strip** slides up above the footer.
- Footer: "Close" and a white "Open in Terminal" (or "Open its window").

```
            ╭━━━━━━━━━━━━━━━━━ green band ━━━━━━━━━━━━━━━━━━━━╮
            │ ◐ Claude Code                    (● Working)  ✕ │
            │   shop  ·  Terminal  ·  active 1m ago           │
            │   add VAT to invoices                           │
            │ CONVERSATION                                    │
            │ ┌─────────────────────────────────────────────┐ │
            │ │                 ╭ use 19.6 for France ╮     │ │
            │ │ I changed the rate and the total now        │ │
            │ │ includes VAT.                               │ │
            │ │ ⚙ npm test                                  │ │
            │ │ • • •                                       │ │
            │ └─────────────────────────────────────────────┘ │
            │ ✦ Thinking through its answer                   │
            │ LATEST STEPS 12                               › │
            │ CHANGED 2                                     › │
            │ ┌ amber ──────────────────────────────────────┐ │
            │ │ ◐ Claude Code on your Mac wants to push      │ │
            │ │ git push origin main                         │ │
            │ │ [ Deny ] [⊛ Allow once]                      │ │
            │ └─────────────────────────────────────────────┘ │
            │                     [ ✕ Close ] [↗ Open in Terminal]│
            ╰─────────────────────────────────────────────────╯
```

Actions. It refreshes every 2 seconds and closes itself after 5 minutes. "Open in …" brings the
session's own tab, editor terminal or agent panel forward (through iTerm or Terminal scripting, the
Claude Code extension's link, or the Memnox extension) and closes the window.

States. No record: "This session is not on the record yet." with the footer, whose "Close" answers
Escape. Talking to a server: "Open in …" does nothing, since a server's session has no tab here.

**What gets in the way.**

- It closes after 5 minutes even while the pointer is on it, unlike the cards, which wait while
  hovered. [Accessibility]
- The switcher plays for about a second before the window the person clicked for. [Hierarchy]
- On a server, "Open in Terminal" stays and silently does nothing. [Consistency]
- The header names the agent but not the machine. [Consistency]
- The dock's strip has no session answer, unlike the island. [Consistency]

**Improved.**

- "Claude Code on your Mac" in the header; the 5 minute close waits while hovered; the switcher
  plays only when the voice asked for the session; "Open in …" hidden for a server's session; the
  dock uses the island's answers.

### Held strip

`Presentation/Components/HeldStrip.swift` · reached from: the history panel's "Needs you" and the
live window's dock

**Job.** Answer this call where I am reading about it.

**Today.** A card with an amber edge: the agent's logo tile, the label ("Claude Code on your Mac"),
the reason or "is waiting on you", the command in a monospaced box (two lines, cut in the middle),
then "Deny" and a white "Allow once" with the Touch ID symbol when signed. Both dim while signing.
No Return shortcut. It answers through the island's path, so it is signed the same way.

**What gets in the way.** The answers are a subset of the island's, and "Deny" and "Allow once"
differ by fill alone. [Consistency] [Contrast]

**Improved.** "Deny" in a red outline, "Allow once" white, and "More ▾" with the four other shared
answers.

### Summary card

`Presentation/Cards/CardView.swift`, `CardPanel.swift`, `CardHeader.swift` · reached from: "Open
answer" on the island, or a summary the voice reads

**Job.** Let me read what the voice is saying, with the files it means.

**Today.** A card 440 wide in the top left corner, 20 points in: the Memnox mark, the title (the
question, or the voice's title), the app as subtitle, the close cross (Escape), the markdown text,
the changed files with counts rolling up from zero, a code excerpt, and, when the session is known,
"Watch live" and a white "Open in Terminal" (or "Open session"). It stays 60 seconds, never while
the pointer is on it, and 15 seconds after the pointer leaves.

**What gets in the way.**

- "Open answer" from the island makes a card with no session, so neither button shows, though the
  answer was about a session. [Proximity]

**Improved.** Carry the session id from the exchange when the answer named one, so "Watch live"
appears.

### Session wall

`Presentation/Cards/CardWall.swift`, `SessionPopupView.swift` · reached from: the voice ("show me
all my sessions")

**Job.** Show me every session at once.

**Today.** Up to eight cards in columns from the top left, sliding in 0.09 seconds apart, each
refreshed every 2 seconds: the agent's logo, its name, "shop · Terminal · active 2m ago", a
status tag; the task; the now line; the last two conversation lines; "LATEST STEPS" (3);
"CHANGED" (3); "Watch live" and "Open in Terminal" (or "Open its window"). Empty: "Nothing recorded
for this session yet".

**What gets in the way.** A ninth session is dropped with no sign, and each card closes on its own
timer. [Hierarchy]

**Improved.** A ninth card reading "+3 more, say ‘show the rest’" and one "Close all".

### Walk card

`Presentation/Cards/WalkView.swift` · reached from: the voice walking through a change

**Job.** Take me through what changed, file by file.

**Today.** The card with "1 of 3" beside the title, a page per file (its name and counts, the note,
the changed lines), page dots, "Back", "Next" and "Open". Pages turn on their own at the voice's
pace (about 14 characters a second, 4 seconds at least) until the person turns one.

**What gets in the way.** Nothing ties the page to the sentence being spoken. [Proximity]

**Improved.** The note's words highlight as they are said, from the voice's own word callbacks.

### Trace card

`Presentation/Cards/TraceView.swift` · reached from: the voice showing how long something took

**Job.** Where did the time go?

**Today.** The card with the title, "12 steps", the total in blue monospace, and a row per step:
name indented by depth, a bar on the trace's clock (blue top level, green nested, red error, amber
refused), and the duration.

**What gets in the way.** Colour alone tells an error from a refusal. [Accessibility]

**Improved.** A "failed" or "refused" word after the name on those rows.

### Switcher

`Presentation/Switcher.swift` · reached from: the live window or a focus, with more than one
session

**Job.** Show which session Memnox is about to bring up.

**Today.** The screen dims to 38 percent black and session tiles stand on a shelf at an angle with
reflections: the logo, the agent name, where it runs or "Somewhere unknown", the task or "No task
recorded", a status dot and word, the repository. The row turns to the one asked for, it comes
forward, and the row leaves. It takes no input.

**What gets in the way.** It plays even when the person clicked the exact session they wanted.
[Hierarchy]

**Improved.** Only when the voice chose the session.

### Scan

`Presentation/ScanOverlay.swift` · reached from: the voice ("what can my agents reach?")

**Job.** Show me every agent on this Mac and what it reaches.

**Today.** Full screen over a dark blur and a dot grid. A badge "Scanning this Mac" (then "Scan
complete"), a count "4 agents on this Mac" rolling up, the orb in the middle sending out rings, and
each agent springing out to a ring: its logo tile, name, "2 MCP servers · shell · files", "mcp
github 26 · linear 12 +1", "cli gh · vercel", and "1 working" or "1 waiting on you". A dotted line
in the agent's colour runs to each, with a light travelling along it while it works. Along the
bottom a pill: "4 agents", "38 MCP tools", "9 can change things" (amber), "2 working" (green), and
"esc or click to close". It goes after 25 seconds.

**What gets in the way.** No agent card can be clicked, though each is the place to say "protect
this one". [Proximity]

**Improved.** A click on an agent opens its **Not covered** step or `explain` in a summary card.

### Flight

`Presentation/Flight.swift` · reached from: every delivery to an agent's app

**Job.** Show where my words just went.

**Today.** A glowing comet arcs from the orb to the window of the app the words went to (or the
middle of the screen), lands at 85 percent of its 0.9 second flight, and rings out. It never takes
the pointer.

**What gets in the way.** Nothing; under Reduce Motion it still flies. [Accessibility]

**Improved.** A short ring at the destination only, under Reduce Motion.

---

## Voice and keys

Everything here is read from `Platform/Hotkey.swift`, `Platform/HoldKeys.swift`,
`Platform/Wake.swift`, `Platform/Barge.swift` and `App/AppDelegate.swift`.

| Input                                 | Needs                                                                  | What it does, exactly                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Option Space**                      | nothing (a Carbon hot key, no Accessibility)                           | When nothing is being said: queue a turn, open the orb, chime, listen. While talking: interrupt, which stops the voice and the brain; it does not close the orb. The same `talk()` runs from the menu, the window and a click on the resting island.                                                                                                                                                                                                                                                                 |
| **Control and Option held**           | Accessibility, to see keys in other apps                               | Counts only when exactly those two modifiers are down (Command or Shift beside them is another shortcut) and a letter is not pressed with them, after 0.3 seconds. Any listen in progress is cut and the voice stops. The turn listens for as long as both are held, then sends the words with the rule intent. Let go before the turn began, nothing happens. Without Accessibility the hold is never seen.                                                                                                         |
| **“Memnox”** (wake word)              | the switch on, on device recognition, microphone and speech permission | Listened for only when the switch is on, no turn is queued or running, and no phone holds the voice. Recognition runs on this Mac only (`requiresOnDeviceRecognition`), in rounds of 50 seconds. The name alone waits 1 second for more, then opens with a greeting ("Good evening, Maya. How shall we proceed?" for a first call in three hours, else "At your service." or similar, never "Yes"). The name with words opens with those words as the question. Its own voice of the last 15 seconds never wakes it. |
| **Speaking over the voice**           | "Talk over it" on (default)                                            | While Memnox speaks, words that are not its own pause the voice for 1.5 seconds; more words stop it and the brain, and the whole sentence becomes the next question. Silence lets it carry on.                                                                                                                                                                                                                                                                                                                       |
| **A pause in speech**                 | nothing                                                                | Ends what was said. The first word is waited for 10 seconds; after an answer the microphone stays open 15 seconds for a follow up; if the brain thinks the person stopped mid thought it waits 6 seconds (2.5 for a request of eight words or more).                                                                                                                                                                                                                                                                 |
| **Click on the resting island**       | nothing                                                                | Same as Option Space.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Click on the open island, talking** | nothing                                                                | Hides the island (`panel.dismiss()`); the listening loop is not stopped.                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Click outside the island**          | nothing                                                                | Closes the open island (not while talking).                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Escape**                            | the surface has the keyboard                                           | Closes the Memnox window, the menu panel, the history panel once its search was clicked, the scan, a card's close cross, the live window's cross. The island never takes the keyboard, so Escape does nothing there.                                                                                                                                                                                                                                                                                                 |
| **Return**                            | nothing                                                                | Never allows a call, approves a phone or sends: those buttons have no Return shortcut on purpose. Return submits the name field and the server link field.                                                                                                                                                                                                                                                                                                                                                           |
| **Screen unlocked after 10 minutes**  | "Catch me up" on (default)                                             | The orb opens and Memnox says what happened while the person was away; if nothing waits, it goes back to sleep unheard.                                                                                                                                                                                                                                                                                                                                                                                              |
| **A phone taking the voice**          | a paired phone                                                         | The wake word stops, held calls show on the island without a sound, and the **Phone voice pill** shows until the phone gives it back.                                                                                                                                                                                                                                                                                                                                                                                |

Chimes, when "Sounds" is on: one when listening starts, one when the orb closes, one when a call is
held.

**What gets in the way.**

- Option Space interrupts while talking but never closes the orb, and a click closes the orb but
  never stops listening. The two ways out do opposite halves of the job. [Consistency]
- The rule chord fails silently without Accessibility, with no sign anywhere but a spoken line.
  [Accessibility]
- No key answers a held call. Voice is the only hands free door, and voice is the one door the
  product says must never be the only one. [Accessibility]
- The wake word's greetings are spoken only; with "Live words" off, a person who said "Memnox" and
  was not heard has no sign either way. [Accessibility]

**Improved.**

| Input                             | Proposed behaviour                                                                                       |
| --------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Option Space while talking        | First press interrupts the voice, a second within 1 second ends the turn and closes the orb              |
| Click on the open island, talking | Ends the turn: interrupt, stop the microphone, close                                                     |
| Option Space while a call waits   | Opens the held card with keyboard focus; Tab between answers, Space to press, Escape to close unanswered |
| Control Option without permission | The island opens on "Memnox needs Accessibility to hear the rule keys" with "Open System Settings"       |
| Wake word heard                   | The caption line shows the greeting as it is said                                                        |

---

## Across the Mac app

Top 10 improvements, in priority order.

1. Draw `model.caption` as one line under the orb in every talking mode, so permission problems,
   "Sorry, say that again?" and every Touch ID reason are read as well as heard (Listening,
   Thinking, Speaking, Proposals and Touch ID, Voice and keys).
2. Use the shared answer words on every held surface, "Deny" and "Allow once" first and "Allow for
   this session", "Always allow this agent", "Allow once, always ask", "Always deny" behind "More",
   with "Deny" in a red outline (Held call, Team question, Held strip, History panel, Live session
   window, Home blocks).
3. Let a held call be answered from the keyboard: Option Space while a call waits opens the card
   with focus, Tab and Space answer, Escape closes, Return never allows (Held call, Voice and keys).
4. Put "Waiting on you" first on the home, answer a single call in place, drop the finished setup
   card from Overview and add "Your team" when signed in (Overview, Home blocks, Do this next,
   Team).
5. Make a click on the open island end the turn and stop the microphone, and a second Option Space
   close it, so what the shape shows is what the microphone does (Listening, Speaking, Voice and
   keys).
6. Name the machine everywhere, "<agent> on <machine>" on Working rows, the live window header, the
   finished card and the island's session rows, and show "Allowed once by <person> on <door>." once
   the daemon reports it (Home blocks, Live session window, Finished, Overview, Held call).
7. Show the rule beside the question and the whole command on demand, so the reason sits with the
   ask (Held call, Held strip, Team question).
8. Split the setup checklist into "Get started" and "When you are ready", add phone, server and team
   as optional rows, and make "Finish setup" wait on the first five (Start here, Do this next,
   Profile, Connection).
9. Tidy Settings: servers to Connection, one voice picker, capabilities in sentences, confirmation
   on "Revoke", "Forget" and "Sign out", and a Keys section with the rule chord's permission state
   (Phones, Connection, Voice, Listening, Team, Help).
10. Give the menu bar a waiting state and an "Answer" row that opens the held card, confirm "Copy
    what happened" in place, and put a "Stop" on the drive pill (Menu bar icon, Menu bar panel,
    Help, Drive pill).
