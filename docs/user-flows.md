# Memnox user flows

How each person meets Memnox, screen by screen, from signing up in the console to answering
an agent from wherever they are. Every label in quotes is the label on screen today, taken from
the working tree of `memnox-client`, `memnox-macos` and `memnox-ios`. Where the product should
change, the change is written under **Fix** so it never reads as something already shipped.

Every page these journeys pass through is specified one by one in [ux/](ux/README.md), with its content, actions, states and an improved version.

The flows follow Figma's seven UI design principles
([ui-design-principles](https://www.figma.com/resource-library/ui-design-principles)). Each step
names the principle that decides how it looks, so a reviewer can argue with the reason and not
only the pixels.

## The seven principles, as Memnox uses them

| Principle                  | What it means here                                                                                                                                              |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Hierarchy**              | What waits on the person is always first and largest. A held agent is blocked; everything else can wait.                                                        |
| **Progressive disclosure** | One choice per screen during setup. The six answer choices show two first ("Allow once", "Deny"), the rest behind them.                                         |
| **Consistency**            | The same five blocks, the same answer words and the same label "<agent> on <machine>" on every door: console, Mac, iPhone, chat, terminal.                      |
| **Contrast**               | Only a waiting question gets the accent colour. A yes and a no never look alike, and a deny is never the dimmed one.                                            |
| **Accessibility**          | Every answer works without colour, without sound and without a pointer: words on every button, VoiceOver labels, voice as an extra door and never the only one. |
| **Proximity**              | The reason sits beside the question: the rule, the agent, the machine and what it wants are one card, never a link away.                                        |
| **Alignment**              | One grid for the home on every surface, so the eye finds "Waiting on you" in the same corner on a phone and in a browser.                                       |

## The shape every surface shares

**The home, in five blocks, in this order.** Hierarchy puts the person's work first and the
record last:

1. **Waiting on you**: how many questions, and the way to answer them.
2. **Working now**: which agent, on which machine, doing what.
3. **Today**: "41 actions, 6 asked you, 5 allowed, 1 refused". Counts, never scores.
4. **Ready to hand over**: the one action people keep allowing. "You have said yes to git.push
   6 times. Let it run on its own?"
5. **Not covered**: agents nothing governs yet, each with the step that fixes it.

On a team, a sixth block, **Your team**, sits under the five.

**One question, many doors, one answer.** A held call is a single object. It shows on the Mac
island, the iPhone, the browser, a chat DM and the terminal at once. The first answer wins
everywhere, and every other door turns into "Allowed once by Ana on iPhone."

**A yes is signed, a no is free.** Touch ID on the Mac, Face ID on the iPhone, a passkey in the
browser, the person's own linked chat account, or their own terminal. Saying no never asks for
proof, because no can do no harm.

> **Fix (consistency).** The blocks are not yet in the same order everywhere. The Mac puts
> "Today" first, and the console and the iPhone add "Your team" in different places. Use the
> order above on all three, with "Your team" last.

## Who this document follows

| Person                                  | Agents run on                        | Answers from                                                |
| --------------------------------------- | ------------------------------------ | ----------------------------------------------------------- |
| **Maya, solo with a Mac and an iPhone** | Claude Code and Cursor on her Mac    | Mac island, iPhone, voice                                   |
| **Sam, solo with a server**             | Hermes on a VPS                      | iPhone, browser                                             |
| **Lin, no Apple device**                | Codex on Linux, or in WSL on Windows | Browser, Discord or Slack or Telegram or Teams DM, terminal |
| **Ana, a team admin**                   | Mac and a VPS                        | Everything above                                            |
| **Bo, Ana's teammate**                  | Linux laptop                         | Discord and the browser                                     |

---

## 1. Sign up in the console

Everyone starts here, whatever they own. The console is the one door every device can open.

### Step 1. Sign up

- **Screen** `/signup`: "Know what your agents can do, and decide what they may". Buttons
  "Continue with Google" and "Continue with GitHub". The line under them: "your account is
  created on the spot. No card, no setup call."
- **Why it looks like this.** _Hierarchy_: one promise, two buttons, nothing else. _Progressive
  disclosure_: no form, no plan picker, no workspace question yet.
- **Value seen.** None yet, and the page says so honestly: nothing to pay, nothing to install.

A teammate arrives through an invite link at `/invite`: "Create your account to join". The same
two buttons, and they land inside the team's workspace.

### Step 2. Three questions

**Screen** `/onboarding`, one question per screen (_progressive disclosure_):

1. "What we should call this": the workspace name.
2. "What comes to you": the person's role, which decides what reaches them first.
3. "Where your team decides things": connect chat tools, read only.

### Step 3. Home, empty, and saying what to do

**Screen** `/dashboard`, "Where things stand". Every block is empty, and each empty block names
its next step instead of a blank (_hierarchy_: the next step is the biggest thing on the page):

- "Nothing is waiting on you." with **"Pair your phone"**.
- "No agent is working right now." with **"Add a server"**.
- "Nothing was recorded today."

> **Fix (hierarchy).** The empty home should lead with one primary action chosen from what the
> person said in onboarding. "Install the Mac app" for a Mac, "Add a server" for a server,
> "Install Memnox on this computer" for Linux and Windows. Today the three empty blocks offer
> their own steps with equal weight.

From here the flows split by what the person owns.

---

## 2. Maya: solo, Mac and iPhone

### 2.1 The Mac app, first launch

The app opens a checklist (`Setup.swift`), one row per step, each with its own button. Rows
already done are ticked, so a relaunch never repeats work (_progressive disclosure_,
_consistency_).

| #   | Row                   | Button    | What Maya sees happen                                                            |
| --- | --------------------- | --------- | -------------------------------------------------------------------------------- |
| 1   | "Your name"           |           | What Memnox calls her aloud.                                                     |
| 2   | "Hear you"            | "Allow"   | macOS asks for the microphone and speech recognition.                            |
| 3   | "See and act"         | "Allow"   | Accessibility and Screen Recording, so the voice can act in the agent's own app. |
| 4   | "Memnox daemon"       |           | "Installed, started and updated for you." No terminal.                           |
| 5   | "Touch ID"            |           | "Your finger approves anything outside a session's repository."                  |
| 6   | "Pair a phone"        | "Pair"    | Optional. A QR, then the digits check. See 2.3.                                  |
| 7   | "Connect to a server" | "Connect" | Optional. See section 3.                                                         |
| 8   | "Who answers for you" |           | Claude Code, Codex, Cursor, Hermes or OpenClaw.                                  |
| 9   | "Voice"               | "Hear it" | Kokoro (about 340 MB) or the Mac voice.                                          |
| 10  | "Catch me up"         | toggle    | Whether Memnox speaks up on its own.                                             |

"Check again" at the bottom re-reads everything.

**Value seen at row 4.** The daemon finds the agents already on the Mac. The Overview page then
shows them, and if any run outside Memnox, **Not covered** says how many with **"Protect my
agents"**. One press puts them under Memnox. That is the first moment Maya sees something she
did not know: what her agents can reach.

> **Fix (progressive disclosure).** Ten rows is a lot for one screen. Show rows 1 to 5 as
> "Get started" and rows 6 to 10 as "When you are ready", collapsed until 1 to 5 are ticked.

> **Fix (consistency).** The Mac has no sign in during first launch. Joining the workspace from
> section 1 happens later, on Settings > Team ("Sign in to your team"). Add it as a row after
> "Memnox daemon", so the Mac shows up in the console's Machines straight away. Skippable,
> because a solo user can use the Mac alone.

### 2.2 The Mac, every day

**Overview** (Settings > Overview) is the Mac's home: "Talk to Memnox" (Option+Space), then the
five blocks (`HomeBlocks.swift`):

- **Waiting on you**, "Answer": opens the island.
- **Working now**, "Watch Claude Code live": opens the live window with "Latest steps",
  "Helpers", "Changed", "Conversation".
- **Today**, as a sentence of counts.
- **Ready to hand over**, "Let it run on its own".
- **Not covered**, "Protect my agents".

**When an agent asks.** Claude Code wants to push to `main`. The island drops from the notch:

```
┌──────────────────────────────────────────────────────┐
│  Claude Code on Maya's Mac wants to push to main     │
│  Rule: pushes to main ask first                      │
│                                                      │
│  [ Deny ]   [ Allow this session ]   [ Allow once ]  │
└──────────────────────────────────────────────────────┘
```

_Proximity_: who, what and the rule are one card. _Contrast_: the question is the only bright
thing on screen. "Allow once" asks for Touch ID; "Deny" does not. With several waiting,
"Older call" and "Newer call" step through them, never a stack of popups.

**Talking.** Maya says "Memnox" or presses Option+Space and asks "what is Cursor doing?" The
answer is spoken and shown as live words on the island. "Allow it" by voice still ends in Touch
ID, because a spoken yes is a proposal and her finger is the signature.

**Handing over.** After six allowed pushes, **Ready to hand over** shows "You have said yes to
git.push 6 times. Let it run on its own?" with the branches it covered. "Let it run on its own"
opens the same rule card the island uses: where the rule holds, then Touch ID. Next time, Claude
Code just pushes, and **Today** counts one fewer question. That is the product's promise made
visible: less asking, earned from her own record.

### 2.3 Pairing the iPhone

1. **Mac**, row "Pair a phone", "Pair": a QR and "Scan this with the Memnox app on your iPhone."
2. **iPhone**, first screen "Welcome to Memnox": two choices side by side (_proximity_,
   _hierarchy_): **"Pair a computer"** and **"Join your team"**. She taps "Pair a computer".
3. "Pair with a computer": the camera scans the QR. Without a camera, "Paste pairing link".
4. "Reaching the computer", then "Your pairing code", six digits, "482193".
5. **Mac**: "Approve if your iPhone shows the same digits." "Approve".
6. **iPhone**: "You are set".

Nothing about the phone holds a key to anything but this Mac, and Maya can revoke it from the
Mac's menu bar under Phones, "Revoke".

### 2.4 The iPhone, every day

**Home**: header "Memnox", "Choose a computer" when several are paired, then the blocks:
"Waiting on you", "Working now", "Today", "Ready to hand over" ("Let it run"), "Not covered".
Below them, "Needs you" and "Sessions" (All, Waiting, Working).

**When an agent asks while she is out.** A push wakes the phone. The Live Activity reads
"Memnox needs you on Maya's Mac" with "Deny" and "Allow". Allow asks for Face ID. The Mac
island then says who answered, so nobody answers twice.

**Talking.** "Tap the orb to talk", or "Hey Siri, talk to Memnox", the Action Button or Control
Center. States on the island: "Listening", "Thinking", "Speaking", "Waiting on you".

**Driving the Mac.** "Drive my Mac": "One Face ID lets this iPhone act on the Mac for a while",
at most fifteen minutes. The Mac island shows "Driven from Maya's iPhone" the whole time.

**Handing over from the phone.** Changing rules is off on a phone until the Mac turns it on.
So "Let it run" on the phone says "Confirm on your Mac, or let this phone change rules from your
Mac." instead of offering a Face ID that would be refused (_accessibility_ of the truth: never a
button that cannot work).

---

## 3. Sam: solo, agents on a VPS

Sam's agents live on a server he reaches over SSH. He never needs a terminal on his phone.

### 3.1 Add the server from the console

1. **Console** `/machines` (or **"Add a server"** on the empty home): dialog "Add a server".
2. "What to call it": `build-box`. "What it is": **Server**.
3. "Get the command". Panel "Run this on the server":
   - "Install Memnox, if it is not there yet": `npm i -g memnox`
   - "Join this workspace": `memnox login --token mjt_…`, with a copy button and a countdown.
     It works once.
4. "Done". The unused command waits under "Waiting to be used" with "Revoke".

### 3.2 On the server, three lines

```
npm i -g memnox
memnox login --token mjt_…     # joins, no browser
memnox setup                   # finds Hermes, puts it under Memnox
```

`memnox daemon --install` keeps it running after he logs out. In the console, **Machines** now
lists `build-box` as a server, and the home's **Working now** shows "Hermes on build-box".

### 3.3 Reach it from the iPhone

On the server, `memnox pair` prints a QR in the terminal. On the iPhone: "Pair a computer", scan,
then type the digits the phone shows into the server's prompt (there is no Mac to approve it).
From then on:

- Hermes asks at 2am, and the phone wakes with "Memnox needs you on build-box".
- Face ID allows it; the server carries on.
- "What is Hermes doing?" works by voice, and "tell it to retry the build" is delivered to the
  Hermes session.

If the server goes quiet for longer than the workspace's "Minutes before a server counts as
quiet", the console tells Sam once, and once more when it is back.

### 3.4 Reach it from the Mac, if he has one

Mac checklist row "Connect to a server", "Connect": paste the link `memnox pair` printed.
"Meeting the server through the relay." Then the server appears with "Talk to it" and "Forget".
Hermes's questions rise on the Mac island labelled "Hermes on build-box".

---

## 4. Lin: no Apple device

Linux, Windows with WSL, an Android phone or no phone. Lin gets every answer and every view at
full strength, through the browser, chat and the terminal. Nothing here is a lesser copy.

### 4.1 Install on the computer

From the console home, **"Add a server"** with "What it is": **Workstation**, then the same two
lines on the laptop. On Windows, Memnox runs inside WSL and governs the agents there;
`memnox doctor` says plainly that agents on the Windows side are not governed yet.

### 4.2 Make the questions find Lin

**Console, Settings > Account**, four cards stacked in the order they matter (_hierarchy_):

1. **DM approvals**: "Also ask me in my DM". "Whichever answer arrives first, in the session or
   in your DM, is the one kept."
2. **Chat accounts**: Slack is "Found by your address". Discord, Telegram and Microsoft Teams:
   "Get a link code", then "Link your Discord account" (or Telegram, or Teams), and send the
   words to the Memnox bot. The card turns to "Linked".
3. **Passkeys**: "Add a passkey". Without one: "None yet. Add one to allow agents from this
   browser."
4. **Notifications**: "Wake this browser". The notification says only "Memnox needs you", and
   opening it lands on the inbox.

**Install the console as an app.** On Android or desktop Chrome, "Install" turns the console
into an app with its own icon that opens straight on "Waiting on you", and its notifications
look native.

### 4.3 When an agent asks

Three doors light up at once, and Lin uses whichever is in front of them:

- **The terminal**, if the session is in front of Lin: the in-place prompt.
- **The DM**: "Codex on lin-laptop wants to run the migration", with "Allow once", "Deny",
  "Always allow this agent", "Allow once, always ask", "Always deny".
- **The browser**: the notification opens **Waiting on you**, with "Allow once", "Allow for
  this session", "Deny" and the always answers. Allowing asks for the passkey.

The first answer wins; the other two turn into "Allowed once by Lin on Discord."

### 4.4 Watching and telling

- **Browser**: Agents (`/fleet`) and each agent's live page; the home's **Working now**.
- **Chat**: `/memnox waiting`, `/memnox why`, `/memnox tell <agent> <words>`, `/memnox freeze`.
- **Terminal**: `memnox status` shows what is waiting, working now and ready to hand over, `memnox inbox` answers in place,
  `memnox timeline --follow` streams what happens.

> **Fix (consistency).** Voice is Apple only today. A "Talk" button on the console's live agent
> page, using the browser's microphone and the same brain, would close the last gap for Lin.

---

## 5. Ana and Bo: a team

### 5.1 Ana builds the team

1. **Console**, Organization > **People**: invite Bo by address.
2. **Govern > Autonomy**: "What your agents may do". Ana proposes "pushes to main ask first".
   The note says "A rule is proposed, never granted: a second admin approves it". It waits in
   **Waiting on you** under "Rule changes waiting on a second admin" until another admin says
   yes. Then every machine pulls it within a minute, servers and laptops alike, and a rule can
   say "servers only".
3. Ana's Mac: Settings > **Team**, "Sign in to your team", "Sign in". The console opens; "The
   console is open in your browser. Approve this Mac there." Then "Signed in to your team".
4. Ana's iPhone: "Join your team", "Approve this code in your browser", "Open the page". The
   console's `/apps/connect`: "Enter the code shown in the app", "Continue", "Approve". "Phone
   signed in".

### 5.2 Bo joins

Bo opens the invite, "Create your account to join", "Continue with GitHub". He lands on a home
that already shows the team's rules in force. He installs Memnox on his Linux laptop with a
workstation command, links Discord in Settings > Account, and turns on "Wake this browser".

### 5.3 The right person answers

- Ana's agent asks: **Ana first**, on her island, her phone and her DM.
- Ana does not answer for five minutes: the question widens to the rule's approvers or the
  team's reviewers, Bo included, each on their own doors. The label tells Bo whose it is:
  "Hermes on build-box, from Ana's team".
- Bo allows it from Discord. Ana's phone turns into "Allowed once by Bo on Discord." The agent
  carries on.
- Afterwards, `memnox why` on the server and the console both say which rule asked, who decided
  that rule, and who released this call.

Nobody's device ever holds a key to a teammate's machine. Bo answered through the signed
workspace inbox, never through a pairing with Ana's Mac.

### 5.4 The team home

The console and the iPhone add **Your team** under the five blocks: how many questions wait for
the team, rules waiting on a second admin ("Review"), and, in **Not covered**, unowned agents,
quiet servers and MCP servers nothing governs. Each count links to the page that fixes it.

---

## 6. The value, minute by minute

| When       | What the person sees                                                      | Why it matters                                          |
| ---------- | ------------------------------------------------------------------------- | ------------------------------------------------------- |
| Minute 1   | An account, no card, a home that says what to do next                     | No commitment asked before value                        |
| Minute 3   | Their own agents listed, and how many run outside Memnox                  | Something true they did not know                        |
| Minute 4   | "Protect my agents", one press                                            | The gap closed                                          |
| First hour | An agent asks; they answer from the island, the phone or a DM in a second | Control without watching                                |
| First day  | **Today**: "41 actions, 6 asked you, 5 allowed, 1 refused"                | Proof, in counts they can check                         |
| First week | **Ready to hand over**: "You have said yes to git.push 6 times"           | The agent earns more freedom from their own record      |
| Ongoing    | Fewer questions, same safety                                              | The promise: safely letting agents do more on their own |

## 7. Fixes this walk found, in order

1. **Consistency**: one block order on every surface (Waiting, Working, Today, Ready, Not
   covered, then Your team).
2. **Hierarchy**: the empty console home leads with one primary step chosen from onboarding.
3. **Consistency**: a "Join your team" row in the Mac's first launch checklist, skippable.
4. **Progressive disclosure**: split the Mac checklist into "Get started" and "When you are
   ready".
5. **Accessibility**: every answer button carries words and a VoiceOver label; the accent colour
   never carries meaning alone; yes and no differ in shape and position as well as colour.
6. **Consistency**: browser voice on the live agent page, so people without Apple can talk too.
7. **Sign in**: offer passkey sign in to the console beside Google and GitHub, since the same
   passkey already signs a yes.
