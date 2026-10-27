# The Memnox iPhone app, screen by screen

This is the page by page spec of the iPhone app in `memnox-ios`, read from its working tree
(committed, uncommitted and untracked files alike) on 7 October 2026. Every entry follows
[TEMPLATE.md](TEMPLATE.md): what the page is for, what is on it today with every label quoted
from the code, what gets in the way, and what it should look like. The people are the ones in
[user-flows.md](../user-flows.md): Maya with a Mac and an iPhone, Sam with Hermes on a VPS, and
Ana and Bo on a team.

The iPhone does four things for them. It answers agents, with Face ID on every yes and nothing
on a no. It talks to them by voice. It watches several machines at once, Macs and servers alike.
And it answers the questions the team routes to its person.

Paths are relative to `memnox-ios/`. Labels the core computes (in `Sources/MemnoxPhoneCore`)
are quoted with the file they come from. The app runs in dark mode only
(`preferredColorScheme(.dark)` in `RootView.swift`), on a near black backdrop (`#030303`), with
cards on `#141518`, the Memnox blue `#1E86EE`, the sky `#8CC8FF`, and amber `#F5A524` for
anything that waits.

Two facts shape everything below and are worth knowing first.

1. **The phone talks to one machine at a time.** `AppModel.mac` is "the machine the phone talks
   to now". Every other paired machine gets a quiet watch that counts what waits there and reads
   its home blocks, but its questions are only listed, and its sessions only shown, once the
   person switches to it.
2. **A yes is signed, a no is free.** Allow, Drive my Mac, Let it run and pairing all go through
   the Secure Enclave key behind Face ID. Deny, No, Stop and Cancel never ask for proof.

---

## Screen map

```
Launch (RootView)
├── no machine paired and not signed in to a team
│   └── Welcome ("Welcome to Memnox")
│       ├── "Pair a computer" ──► Pair with a computer
│       │     ├── scanner, or "No camera here", or "Memnox cannot use the camera"
│       │     ├── "Paste pairing link"
│       │     ├── "Reaching the computer"
│       │     ├── "Your pairing code" (six digits, "Waiting for the computer")
│       │     └── "You are set" (held 1.8 s) ──► Home
│       └── "Join your team" ──► sign in rows under the two cards
│             ("Getting a code", the code, "Open the page") ──► Home (team only)
│
├── memnox://pair link opened from the Camera app ──► Pair with a computer, anywhere
│
└── Home (a machine paired, or signed in to a team)
    ├── header: "Memnox", machine picker or "Your team", "Connected", Settings ⚙
    ├── machine lines (older machine, machine not answering)
    ├── Waiting on you ──► scrolls to Needs you (switching machine first)
    ├── Working now ──► Session page (switching machine first)
    ├── Today
    ├── Ready to hand over ("Let it run" with Face ID, or "Send it to <machine>")
    ├── Not covered
    ├── Needs you (approval cards) ──► Session page via the chevron
    ├── Sessions (chips, "See all") ──► Session page, All sessions
    ├── Your computer ("Drive my Mac", or "Pair a computer")
    └── orb dock
        ├── ▢ "All sessions" ──► All sessions ──► Session page
        ├── ◉ orb ──► Voice screen (overlay)
        └── 📁 "Browse the Mac" ──► Drive and folders ──► folder ──► folder
    Over everything:
    ├── in app island and choice tray (a question over a page that does not show it)
    ├── notice banner along the top (5 s)
    └── Settings sheet ──► Pair another computer, Forget, Sign in or out of the team

Outside the app
├── Live Activity on the Lock Screen
├── Dynamic Island: compact, minimal, expanded (rest, voice, waiting, settled)
├── alerts the Live Activity raises (new question, Memnox called from another app)
├── Siri: "Talk to Memnox", "Allow in Memnox", "Deny in Memnox"
├── Action Button and Back Tap: Talk to Memnox
└── Control Center and Lock Screen control: "Talk to Memnox"
```

The root has three states and nothing else (`RootView.swift`): `.pairing` while a pairing is
under way or for 1.8 seconds after it succeeds, `.welcome` while there is no machine and no team
person, and `.home` otherwise. The home grows in from 97 percent scale; with Reduce Motion it
simply appears.

---

## First run

## Welcome

`App/Presentation/WelcomeView.swift` · reached from: first launch with nothing paired and nobody
signed in; also after forgetting the last machine while signed out of the team.

**Job.** Which way in is mine: my own computer, or my team?

**Today.** Top to bottom, centred in a column at most 460 points wide:

- The particle orb at rest (170 points) with the white Memnox mark on it, hidden from VoiceOver.
- Title "Welcome to Memnox" (34 point display face).
- Body "Answer your agents from your iPhone. Pair your own computer, or join your team to answer
  what its agents ask."
- Two cards side by side at the same height, each the whole card one button:
  1. QR symbol, "Pair a computer", "Talk to your Mac or a server, and answer what its agents ask."
  2. Two people symbol, "Join your team", "Answer what your teammates' agents ask, with no computer
     of your own."
- Once a team sign in has started, a card under them holds the team sign in rows (see Join your
  team).

Actions. "Pair a computer" calls `pairAnother()`, which opens Pair with a computer with a
"Cancel" that comes back here. "Join your team" calls `signInToTeam()`, which asks Memnox Cloud
for a code and opens the console page in Safari. The "Join your team" card is disabled while a
sign in runs and enabled again once it fails.

States. There is no loading, empty or error state of its own; a failed team sign in shows its
reason inside the rows card. Nothing here mentions Face ID, the camera or the microphone before
they are asked for.

**What gets in the way.**

- Both cards use the same sky symbol on the same card, and nothing says which one a solo person
  with a Mac should pick first, while user-flows.md has most people pairing. [Hierarchy]
- On the narrowest iPhones the two cards squeeze to about 150 points each, and the detail lines
  wrap to four or five lines, so the cards grow tall and the page scrolls on a first screen.
  [Alignment]
- "Join your team" leaves the person on this screen with a code in a card while Safari opens on
  top, and nothing here says the browser opened or why. [Proximity]
- The orb sits under the mark as decoration and does nothing when tapped, though on every other
  screen the orb is the button for talking. [Consistency]

**Improved.**

```
┌──────────────────────────────────────┐
│                                      │
│               ( ◉ M )                │
│                                      │
│         Welcome to Memnox            │
│   Answer your agents from your       │
│   iPhone, with Face ID on every yes. │
│                                      │
│ ┌──────────────────────────────────┐ │
│ │ ⌗  Pair a computer               │ │
│ │    Your Mac, or a server running │ │
│ │    memnox pair. Talk to it and   │ │
│ │    answer what its agents ask. › │ │
│ └──────────────────────────────────┘ │
│ ┌──────────────────────────────────┐ │
│ │ 👥 Join your team                │ │
│ │    Answer your teammates' agents │ │
│ │    with no computer of your own. │ │
│ │    Opens Memnox Cloud in Safari. │ │
│ └──────────────────────────────────┘ │
│                                      │
│   You can do the other one later in  │
│   Settings.                          │
└──────────────────────────────────────┘
```

- Stack the two ways in rather than setting them side by side, so each detail fits in three
  lines at any width, and keep both at the same weight, because neither is the lesser way in.
- Say on the team card that Safari opens, so leaving the app is expected rather than a surprise.
- Say "You can do the other one later in Settings", which is true today (Settings has both "Pair
  a computer" and "Sign in to your team") and takes the weight off the choice.
- Keep the orb still and decorative here, and give it no ring, so it never reads as a button
  that does nothing.

---

## Pair with a computer

`App/Presentation/PairView.swift` (stage `.scan`), `App/Presentation/QRScannerView.swift` ·
reached from: "Pair a computer" on Welcome, "Pair a computer" on a team only Home, "Pair a
computer" or "Pair another computer" in Settings, or a `memnox://pair` link opened from the Camera
app.

**Job.** Point the phone at the code my computer shows, or paste its link.

**Today.** One column, at most 420 points wide, with no navigation bar:

- The orb (170 points) breathing behind the Memnox mark.
- Title "Pair with a computer".
- Body "On a Mac, open Memnox and choose Pair a phone. On a server, run memnox pair. Then scan the
  code it shows."
- The camera in a square frame up to 300 points, rounded 32 points, with four white corner
  brackets that breathe and a sky line that sweeps up and down (both still under Reduce Motion).
  VoiceOver reads "Camera, looking for the pairing code".
- A pill button "Paste pairing link" with a clipboard symbol. It is the white primary button only
  when the phone has no camera; otherwise it is the faint secondary pill.
- A red line with an exclamation symbol, when there is something to say (see states).
- "Cancel", a secondary pill, whenever the pairing was opened over something (`addingMachine`),
  which is always the case today because every door in calls `pairAnother()`.

Actions. A QR seen by the camera starts pairing at once with no button. "Paste pairing link"
reads the clipboard. "Cancel" returns to where pairing started with nothing changed. A link that
was already tried is not tried again. Both buttons are disabled while a scan is being handled.

States.

- **No camera** (the Simulator, or an iPad without one): a video slash symbol, "No camera here",
  and "Copy the pairing link on the Mac or from memnox pair, then paste it below."
- **Camera denied** or restricted by a profile: a camera symbol, "Memnox cannot use the camera",
  "Allow the camera in Settings to scan, or paste the link instead.", and an "Open Settings"
  pill that opens the app's page in iOS Settings.
- **First use of the camera**: iOS asks with "Memnox reads the pairing code your computer
  shows." (`Support/Info.plist`).
- **Clipboard empty**: "Nothing to paste yet. Copy the pairing link first, from the Mac or from
  memnox pair."
- **Same code seen again after a failure**: "That code was already used. Show a new one and scan
  it."
- **The code is wrong** (`PairingLines.refused` in `Domain/Pairing/PairingLines.swift`): "That
  code is not a Memnox pairing code.", "That pairing code could not be read. Show a new one and
  scan it.", "That computer runs a newer Memnox than this app. Update the app, then pair again.",
  or "That code ran out. Show a new one and scan it."
- **Pairing failed later** and came back here: "The computer did not pair this phone.", "The
  computer that answered is not the one in the code, so this phone stopped. Show a new code.",
  "Face ID was cancelled, so this phone did not pair.", or "The relay could not be reached. Check
  the connection and try again."

**What gets in the way.**

- Every failure is red text under the buttons, below the fold on smaller phones once the camera
  frame is drawn, so a person looking at the camera may not see why nothing happens. [Proximity]
- "Paste pairing link" is the faint pill beside a camera that already works, which is right, but
  when the camera is denied it stays faint while it is the only way forward. Only the no camera
  case promotes it. [Hierarchy]
- The body names "Pair a phone" on the Mac and `memnox pair` on a server but not where the person
  is now, and it does not say that Face ID will be asked for during pairing (the pairer signs with
  "Pair this iPhone with your Mac"). [Progressive disclosure]
- The scan reason "Pair this iPhone with your Mac" says Mac even when Sam pairs with build-box.
  [Consistency]

**Improved.**

```
┌──────────────────────────────────────┐
│ Cancel                               │
│                                      │
│        Pair with a computer          │
│  Scan the code your Mac shows under  │
│  Pair a phone, or the one memnox     │
│  pair prints on a server.            │
│                                      │
│   ┌────────────────────────────┐     │
│   │ ⌜                        ⌝ │     │
│   │                            │     │
│   │        (camera view)       │     │
│   │                            │     │
│   │ ⌞                        ⌟ │     │
│   └────────────────────────────┘     │
│  ⚠ That code ran out. Show a new     │
│    one and scan it.                  │
│                                      │
│  ( ⧉ Paste pairing link )            │
│                                      │
│  You approve with Face ID once the   │
│  computer answers.                   │
└──────────────────────────────────────┘
```

- Put the failure line directly under the camera frame, so it is read where the eyes already are.
- Move "Cancel" to the top leading corner, the place a sheet's cancel lives on iOS, and keep the
  bottom for the one way forward.
- Make "Paste pairing link" primary whenever the camera cannot be used, denied included.
- Say up front that Face ID is part of pairing, and change the Face ID reason to name the machine
  kind it has: "Pair this iPhone with build-box".

---

## Reaching the computer

`App/Presentation/PairView.swift` (stage `.reaching`) · reached from: a scanned or pasted link
that parsed.

**Job.** Is anything happening?

**Today.** The orb in its thinking state, then "Reaching the computer", "This takes a moment,
through the Memnox relay.", and a sky spinner. There is no button. If the relay never answers,
the pairer gives up and the screen returns to the scanner with "The relay could not be reached.
Check the connection and try again."

**What gets in the way.**

- No way out while it waits: no "Cancel", and the system back gesture is hidden with the
  navigation bar. [Accessibility]
- "the Memnox relay" is a word the person has not met yet and does not need. [Progressive
  disclosure]

**Improved.**

```
┌──────────────────────────────────────┐
│                                      │
│               ( ◉ )                  │
│                                      │
│        Reaching the computer         │
│     This takes a few seconds.        │
│               ◌                      │
│                                      │
│            ( Cancel )                │
└──────────────────────────────────────┘
```

- A "Cancel" that ends the attempt and returns to the scanner.
- Plain words, and keep the relay for the failure line, where it explains something.

---

## Your pairing code

`App/Presentation/PairView.swift` (stage `.code`) · reached from: the relay reaching the
computer.

**Job.** Do these digits match what my computer shows, and what do I do with them?

**Today.** The orb grows to 220 points in its needs you state, with a larger mark, and a medium
haptic plays. Then:

- Title "Your pairing code".
- Body from `PairingLines.checkCode("")`: "Type these six digits where your computer asks for
  them. On a Mac, check it shows the same and approve with Touch ID."
- Six digits in two groups of three, 40 point monospaced, each turning over from "0" in turn with
  a sky underline once it is in. VoiceOver reads "Code 482193".
- A small spinner and "Waiting for the computer".

The phone waits for the Mac to approve or the server to receive the digits. Face ID shows during
this step to prove the phone's key. Outcomes land on You are set, or back on the scanner with a
failure line.

**What gets in the way.**

- The body is two instructions for two kinds of machine in one sentence, and the person must
  work out which half is theirs. The machine is known by kind only after pairing, so it says
  "your computer". [Progressive disclosure]
- There is no way out while waiting, and a Mac that never approves leaves the person on this
  screen until the pairer's timeout. [Accessibility]
- VoiceOver reads the six digits as one number ("four hundred eighty two thousand"), which is
  hard to compare. [Accessibility]

**Improved.**

```
┌──────────────────────────────────────┐
│                                      │
│             ( ◉ M )                  │
│                                      │
│         Your pairing code            │
│                                      │
│       4 8 2   1 9 3                  │
│       ‾ ‾ ‾   ‾ ‾ ‾                  │
│                                      │
│  On a Mac: check it shows these six  │
│  digits, then approve with Touch ID. │
│  On a server: type them where        │
│  memnox pair asks.                   │
│                                      │
│  ◌ Waiting for the computer          │
│                                      │
│            ( Cancel )                │
└──────────────────────────────────────┘
```

- Two short lines, one per machine kind, so each person reads only their own.
- A "Cancel" that ends the attempt.
- VoiceOver reads the code digit by digit: "Code 4 8 2, 1 9 3".
- Fix user-flows.md to six digits.

---

## You are set

`App/Presentation/PairView.swift` (stage `.paired`) · reached from: the computer approving.

**Job.** Did it work, and with which machine?

**Today.** A green tick draws itself in a ring over the orb, the orb bursts and a success haptic
plays. Title "You are set", body "Paired with build-box." (or "Paired with your computer." when
the name is empty). After 1.8 seconds the home grows in. The phone then starts fetching the
Kokoro voice in the background.

**What gets in the way.**

- The one moment that could say what the phone can now do (answer, talk, watch) shows only the
  machine's name, and goes by itself. [Progressive disclosure]
- Nothing says that iOS will ask for the microphone and speech recognition soon, which it does
  once a launch "so nobody has to find the orb first". [Proximity]

**Improved.**

```
┌──────────────────────────────────────┐
│                                      │
│              (  ✓  )                 │
│                                      │
│            You are set               │
│       Paired with build-box.         │
│                                      │
│   Questions from build-box reach     │
│   this iPhone. A yes asks for        │
│   Face ID, a no never does.          │
│                                      │
└──────────────────────────────────────┘
```

- One line on what pairing gave, in the product's own promise, held the same 1.8 seconds.

---

## Join your team

`App/Presentation/TeamSignInRows.swift`, shown on Welcome and in Settings > "Team" ·
reached from: "Join your team" on Welcome, or "Sign in to your team" in Settings.

**Job.** Get this iPhone onto my team's workspace so its questions reach me.

**Today.** One row that changes through four states (`AppModel.TeamSignIn`):

- **Idle**: a row "Sign in to your team" with a two people symbol and the subtitle "Answer
  questions from your teammates' agents" (or the subtitle passed in).
- **Starting**: a spinner and "Getting a code".
- **Code**: "Approve this code in your browser", the code in large monospaced type (selectable,
  read as "Code ABCD-1234"), then either "Open the page" (primary, Safari symbol) and "Cancel"
  (secondary), or, when the cloud sent no page, "Enter it where your team signs in to Memnox
  Cloud." with "Cancel" alone. Safari opens on the page by itself as the code arrives.
- **Failed**: the idle row again, with the reason as its subtitle: "The sign in was declined.",
  "That code is no longer valid. Start again.", "The code ran out before it was approved. Try
  again.", "Memnox Cloud did not answer. Try again in a moment.", "Your account reaches no
  workspace yet.", "This iPhone has no key to sign with, so it cannot answer for your team.", or
  "This iPhone could not keep the sign in."

On success the notice "Signed in to your team as Ana." slides in along the top, the orb bursts,
and the Welcome screen gives way to Home. Signing out lives in Settings.

**What gets in the way.**

- A failure is shown as the subtitle of a row whose title still says "Sign in to your team", in
  the same grey as the idle subtitle, so it reads as a description rather than an error.
  [Contrast]
- The code is shown here while Safari covers it; coming back, the person sees the code with no
  word on whether the browser is still waiting. [Proximity]
- On Welcome the rows appear in a card under two cards that look like the same kind of thing, so
  the state of the sign in is the least prominent thing on screen. [Hierarchy]

**Improved.**

```
┌──────────────────────────────────────┐
│  Join your team                      │
│ ┌──────────────────────────────────┐ │
│ │ Approve this code in Memnox      │ │
│ │ Cloud. Safari opened it for you. │ │
│ │                                  │ │
│ │        KQ7M 4XPD                 │ │
│ │                                  │ │
│ │ ◌ Waiting for your approval      │ │
│ │                                  │ │
│ │ ( Open the page )  ( Cancel )    │ │
│ └──────────────────────────────────┘ │
│                                      │
│  ⚠ That code ran out before it was   │
│    approved.  ( Try again )          │
└──────────────────────────────────────┘
```

- A waiting line under the code, so returning from Safari says what is still pending.
- A failure is its own line in the warning colour with "Try again" beside it, not a subtitle.
- On Welcome, the code card replaces the two way in cards while it runs, so it is the one thing on
  screen.

---

## Home

## Home header

`App/Presentation/Home/HomeHeader.swift` · reached from: Home, at the top.

**Job.** Which machine am I looking at, is it reachable, and how do things stand?

**Today.**

- The Memnox mark (36 points), then "Memnox" in bold.
- Under it, one of:
  1. With one machine: a desktop symbol and its name, such as "Maya's MacBook Pro".
  2. With several: the same label with a chevron, a menu read as "Choose a computer". The menu
     lists every paired machine; the one talked to now has a tick, and another with questions
     reads "build-box, 2 waiting". The chevron turns into a red filled chevron circle whenever any
     other machine has something waiting.
  3. Signed in to a team with no machine: a two people symbol and "Your team".
- Beside it, when a machine is paired, the connection: a green dot and "Connected", a pulsing
  amber dot and "Connecting", or a grey dot and "Offline" (VoiceOver "Cannot be reached"), or
  "Not paired".
- On the right, a round gear button "Settings", which opens the Settings sheet.
- Under all of it, one sentence (`SessionsGlance.headline`): "One thing needs you.", "3 things
  need you.", "No agents are running yet.", "Your agents are resting.", "One agent is working, and
  nothing needs you.", or "4 agents are working, and nothing needs you."

Choosing another machine closes the tunnel to the current one, opens one to the chosen one, and
redraws everything; the questions on the machine left keep being counted.

**What gets in the way.**

- The headline counts the sessions of the one machine talked to now and the questions on it plus
  the team, while "Waiting on you" right under it counts every machine. Maya can read "Your agents
  are resting." over "Waiting on you 2". [Consistency]
- A question waiting on another machine is marked by a red chevron the size of a caption, and red
  elsewhere in the app means failure or deny. [Contrast]
- "Memnox" in bold repeats the app name on the one line that could hold the machine's name.
  [Hierarchy]
- The connection label sits on the same line as the machine name at caption size, so "Offline"
  is easy to miss on a home that otherwise still shows old blocks. [Hierarchy]

**Improved.**

```
┌──────────────────────────────────────┐
│ M  Maya's MacBook Pro ▾          ⚙   │
│    ● Connected · build-box 2 waiting │
│                                      │
│ 3 things need you, on 2 machines.    │
└──────────────────────────────────────┘
```

- The machine name is the title and the picker; the mark stays as the app's sign.
- The second line carries the connection and, in amber with words, what waits elsewhere.
- One headline counted from the same numbers as "Waiting on you", across every machine.
- Offline turns the second line into "● Offline. What you see is from 14:02." in amber.

---

## Home blocks

`App/Presentation/Home/HomeBlocks.swift`, `Sources/MemnoxPhoneCore/Domain/Home/HomeBoard.swift` ·
reached from: Home, under the header.

**Job.** Across every machine I have paired: what waits on me, what is working, how today went,
what I could hand over, and what nothing covers.

**Today.** The blocks are summed across every paired machine (`HomeBoard`), read once as the home
appears and then on each daemon event. Pull to refresh reads them again. Top to bottom:

1. **Machine lines**, a card shown only when a machine could not say:
   1. Older machine: a download arrow and "Update Memnox on build-box to see this"
      (`HomeBoard.updateLine`), for a runtime that answered without a home.
   2. Machine not answering: a wifi slash and "build-box is not answering right now."
2. **"Waiting on you"**, with the total as a grey count after the title.
   1. Nothing: a quiet card "Nothing is waiting on you."
   2. Otherwise one row per machine with something waiting, an amber desktop symbol, its name and
      "2 waiting", then, when signed in to a team, a row with an indigo two people symbol, "Your
      team" and "1 waiting". Tapping a machine switches to it if needed and scrolls to Needs you;
      tapping "Your team" scrolls to Needs you.
3. **"Working now"**, with a count.
   1. Nothing: "No agent is working right now."
   2. Otherwise one row per working session: the agent's logo (32 points), "Claude Code on
      Maya's MacBook Pro", and the task or the repository folder under it, with a chevron. Tapping
      switches machine if needed and opens the Session page.
4. **"Today"**, once any machine has answered: one sentence, such as "Agents took 41 actions
   today. 6 asked you first, you said yes to 5, and 1 was refused." or "Nothing has run on your
   machines today."
5. **"Ready to hand over"**, at most one card per machine (see Ready to hand over card).
6. **"Not covered"**, once any machine has answered, with the sum as its count. Two rows that do
   not open anything: a shield slash and "2 outside Memnox", "Agents found that Memnox does not
   govern yet" (red when above zero, green at zero), and a moon and "1 dormant", "Quiet for a
   month and still holding reach" (amber above zero, green at zero).

There is no separate "Your team" block; the team appears as a row inside "Waiting on you".

**What gets in the way.**

- The order follows the shared shape for the five blocks, but "Your team" is a row inside
  "Waiting on you" rather than its own block last, so a team's rule changes and unowned agents
  have no place on the phone. [Consistency]
- "Not covered" names a gap and offers no step: its rows have no chevron and no action, while the
  product's rule is that every count links to what fixes it. [Hierarchy]
- A zero in "Not covered" is green and a zero in "Waiting on you" is a quiet sentence, so the
  same nothing looks two ways. [Consistency]
- "Waiting on you" rows only scroll the page, and on another machine they first switch the whole
  app to it, which closes the tunnel to the machine Maya was on. A tap meant as "show me" does
  something heavier. [Progressive disclosure]
- An older machine and a machine not answering share one grey card above everything, in caption
  type, so a server that has gone quiet reads as a footnote. [Contrast]
- The Today sentence has four numbers in one line of body type with nothing to scan by.
  [Hierarchy]

**Improved.**

```
┌──────────────────────────────────────┐
│ ⚠ build-box is not answering. Last   │
│   heard 12 minutes ago.              │
│ ⤓ Update Memnox on studio-mini to    │
│   see it here.                       │
│                                      │
│ Waiting on you                    3  │
│ ┌──────────────────────────────────┐ │
│ │ ▣ Maya's MacBook Pro   2 waiting›│ │
│ │ ▣ build-box            1 waiting›│ │
│ └──────────────────────────────────┘ │
│                                      │
│ Working now                       2  │
│ ┌──────────────────────────────────┐ │
│ │ ✳ Claude Code on Maya's MacBook  │ │
│ │   Pro · fix the login redirect  ›│ │
│ │ ◎ Hermes on build-box            │ │
│ │   nightly build                 ›│ │
│ └──────────────────────────────────┘ │
│                                      │
│ Today                                │
│ ┌──────────────────────────────────┐ │
│ │ 41 actions   6 asked you         │ │
│ │ 5 allowed    1 refused           │ │
│ └──────────────────────────────────┘ │
│                                      │
│ Ready to hand over                   │
│  (card, see below)                   │
│                                      │
│ Not covered                       3  │
│ ┌──────────────────────────────────┐ │
│ │ 2 agents outside Memnox          │ │
│ │ Protect them on the Mac        › │ │
│ │ 1 dormant agent                  │ │
│ │ Quiet a month, still has reach › │ │
│ └──────────────────────────────────┘ │
│                                      │
│ Your team                            │
│ ┌──────────────────────────────────┐ │
│ │ 1 question waiting for you     › │ │
│ └──────────────────────────────────┘ │
└──────────────────────────────────────┘
```

- Machine lines become warnings with a time, in amber, above the blocks, since a quiet server is
  the thing most likely to matter.
- "Your team" becomes its own last block, as the shared shape asks. Today it can hold the count
  of team questions; rule changes and unowned agents come when the cloud sends them.
- Today becomes four counts on a two by two grid with words, never a score.
- Each "Not covered" row says the next step and where it happens. The phone cannot protect an
  agent, so the step says "on the Mac" and the row opens Settings' machine entry where that is
  said again.
- A zero block is one quiet sentence everywhere, never a green number.

---

## Ready to hand over card

`App/Presentation/Home/HomeBlocks.swift` (`ReadyCardView`) · reached from: Home, in "Ready to
hand over", when a machine reports an action the person keeps allowing.

**Job.** Should I let this run on its own from now on?

**Today.** One card per machine:

- A desktop symbol and the machine name, such as "Maya's MacBook Pro".
- The question (`HomeBoard.ReadyCard.question`): "You have said yes to git.push 6 times. Let it
  run on its own?" (or "once").
- When the machine named targets, in monospaced footnote: "Only for main, release/*".
- The machine's reason (`because`), in grey.
- Then one of two endings:
  1. **The phone holds the rules capability** on that machine: a white primary pill "Let it run"
     with a Face ID symbol. Face ID reads "Let git.push run on its own on Maya's MacBook Pro for
     main". After it: "Done. git.push runs on its own on Maya's MacBook Pro now." as a notice,
     and the orb bursts.
  2. **Phone without the rules capability** (the default set is see, ask, answer and steer): the
     sky line "Confirm on your Mac, or let this phone change rules from your Mac." and a secondary
     pill "Send it to Maya's MacBook Pro". Sending makes the proposal and leaves it on the Mac,
     and the notice repeats the same sentence.

While a hand over runs, the card is disabled with a spinner in its corner. Other outcomes are
notices: "Face ID was cancelled, so nothing changed and it waits on build-box.", "build-box did
not answer.", the machine's refusal (by default "That is not ready to hand over."), or "That was
already answered elsewhere: it was confirmed."

**What gets in the way.**

- The words say "your Mac" when the machine is build-box, a server with no screen to confirm on.
  Sam is told to go somewhere that does not exist. [Consistency]
- Without rules, the card offers a button whose only result is a notice repeating the line above
  it, so the person taps and sees the same sentence again. [Progressive disclosure]
- The outcome is a five second notice at the top of the screen, far from the card the thumb is
  on. [Proximity]
- The question is headline weight while the machine name is above it in a smaller label, so on a
  phone with three machines the cards look alike until read. [Hierarchy]

**Improved.**

```
┌──────────────────────────────────────┐
│ Ready to hand over                   │
│ ┌──────────────────────────────────┐ │
│ │ Claude Code on Maya's MacBook Pro│ │
│ │ You have said yes to git.push    │ │
│ │ 6 times. Let it run on its own?  │ │
│ │ Only for main, release/*         │ │
│ │ Every push in the last 14 days   │ │
│ │ went through and none was undone.│ │
│ │                                  │ │
│ │ (   Let it run   ⓕ   )           │ │
│ │  Not now                         │ │
│ └──────────────────────────────────┘ │
│                                      │
│ ┌──────────────────────────────────┐ │
│ │ Hermes on build-box              │ │
│ │ You have said yes to npm.publish │ │
│ │ 3 times. Let it run on its own?  │ │
│ │                                  │ │
│ │ This iPhone cannot change rules  │ │
│ │ on build-box. Run memnox rules   │ │
│ │ there, or give this phone rules  │ │
│ │ with memnox devices.             │ │
│ │ ( Ask build-box to propose it )  │ │
│ │ ✓ Proposed. It waits on build-box│ │
│ └──────────────────────────────────┘ │
└──────────────────────────────────────┘
```

- Lead with "<agent> on <machine>" when the yeses came from one agent (`agentName` is already in
  `HomeReady`), so the card reads like every other label.
- Name the machine and its kind in the no rules case: a Mac gets "Confirm on the Mac", a server
  gets the command. The machine kind is not stored on `PairedMachine` today, so this needs the
  ping to carry it.
- Show the outcome inside the card, under the button, as the last line.

---

## Your computer and the orb dock

`App/Presentation/Home/HomeView.swift`, `App/Presentation/Home/QuickActions.swift`,
`App/Presentation/DesignSystem/OrbDock.swift`, `OrbButton.swift` · reached from: Home, at the
bottom of the page and pinned under it.

**Job.** What can I do on my computer from here, and how do I talk to Memnox?

**Today.**

- Section "Your computer":
  1. With a machine paired: one row on a card, a steering wheel symbol (sky while driving),
     "Drive my Mac", "One Face ID lets this iPhone act on the Mac for a while", and a Memnox
     switch. Turning it on puts the orb in its needs you state and asks for Face ID ("Let this
     iPhone drive your Mac"); off sends an unsigned stop. A refusal is a notice, by default "Your
     Mac would not let this phone drive it."
  2. Signed in to a team with no machine: a row "Pair a computer", "Talk to your Mac or a server
     from here", which opens pairing.
- The orb dock, pinned at the bottom over the page background: on the left a round "All
  sessions" button (stack symbol), in the middle the orb (76 points in a ring), on the right a
  round "Browse the Mac" button (folder symbol) only when a machine is paired.
- The orb's ring is grey at rest, amber when something waits or Face ID is up, and sky while
  listening, thinking or speaking. VoiceOver names it by what a tap does next: "Talk to Memnox",
  "Send", "Stop", or "Waiting for Face ID", with the hint "Memnox listens on this iPhone and asks
  your computer". It is disabled while Face ID is up.

**What gets in the way.**

- "Drive my Mac" and "Browse the Mac" show for any paired machine, so Sam sees them for build-box,
  a server with no screen to drive. [Consistency]
- The orb sits in the dock on a team only phone, where every tap ends in the notice "Pair a
  computer to talk to it. Your team's questions still reach you here." A button that cannot work
  is offered. [Accessibility]
- On the home the drive row never says until when, while the same row on Drive and folders says
  "Until 14:32". [Consistency]
- The section is titled "Your computer" while the header may be showing a server and there may be
  four machines. [Consistency]

**Improved.**

```
┌──────────────────────────────────────┐
│ On Maya's MacBook Pro                │
│ ┌──────────────────────────────────┐ │
│ │ ⎈  Drive my Mac            ( ●) │ │
│ │    On until 14:32                │ │
│ └──────────────────────────────────┘ │
│                                      │
│  ▢              ( ◉ )             📁 │
│ All sessions                 Folders │
└──────────────────────────────────────┘
```

- Title the section by the machine talked to now, and show Drive and Folders only for a Mac.
- On a team only phone, replace the orb with the pair row, or keep the orb and give it one honest
  state, "Pair a computer to talk", rather than a tap that fails.
- Under the two side buttons, a one word caption, since an icon alone does not say "All
  sessions".

---

## Notice banner

`App/Presentation/RootView.swift` (`NoticeOverlay`, `NoticeBanner`) · reached from: anything that
sets `AppModel.notice`.

**Job.** Tell me, once, what just happened.

**Today.** A strip along the top edge on a blurred dark material, an info symbol and one line in
white footnote. A tap clears it; it goes by itself after five seconds. The lines it carries
include: "build-box has something waiting on you. Switch to it to answer.", "Signed in to your
team as Ana.", "Signed out of your team.", "You were signed out of your team. Sign in again in
Settings.", "Nothing the voice asked about is waiting now.", "Pair a computer to talk to it. Your
team's questions still reach you here.", "Memnox needs the microphone and speech recognition,
which you can allow in Settings.", "Speech recognition on this iPhone is not available just
now.", "The microphone could not be opened just now.", "That folder could not be read from the
computer.", every hand over outcome, every drive refusal, "That was already answered elsewhere: it
was denied.", and every failed answer, such as "Face ID could not sign that." or "The computer
would not take that answer."

**What gets in the way.**

- Successes, failures and invitations to act all wear the same info symbol and colour. [Contrast]
- Five seconds is too short for the longer lines and for VoiceOver to finish, and the strip is
  not announced. [Accessibility]
- "Switch to it to answer" is an instruction with no button, on a banner that disappears.
  [Proximity]
- The banner sits under the Dynamic Island, in the area the in app island also uses. [Alignment]

**Improved.**

```
┌──────────────────────────────────────┐
│ ⚠ Face ID could not sign that.       │
│   Nothing was sent.         Dismiss  │
└──────────────────────────────────────┘
┌──────────────────────────────────────┐
│ ● build-box has 1 question for you.  │
│                          Switch to it│
└──────────────────────────────────────┘
```

- Three kinds: done (tick, green), failed (warning, amber), and needs you (amber dot with one
  action). Words carry the meaning, the colour only repeats it.
- Posted as a VoiceOver announcement, and kept for eight seconds when it has an action.

---

## Needs you and answering

## Needs you and the approval card

`App/Presentation/Home/NeedsYouSection.swift`, `App/Presentation/DesignSystem/ApprovalCard.swift` ·
reached from: Home, under the blocks; "Waiting on you" scrolls here.

**Job.** Answer each question waiting on me, here, without opening anything.

**Today.** Shown only when something waits on the machine talked to now or on the team:

- Title "Needs you" with the count.
- With more than one, a grey line (`WaitingGroups.line`): "3 waiting on build-box" or "3 waiting:
  2 on build-box, 1 on your computer".
- One card per question, newest first, on the card surface with an amber hairline edge:
  1. Header: the agent's logo (32 points); the label (`WaitingItem.label`), such as "Claude Code
     on Maya's MacBook Pro" or "Codex on build-box, from Ana's team"; under it the asking session's
     task or repository folder (never for a team question); on the right a sky "On the computer"
     badge when only the computer can do it; and a chevron button "Open session" when the question
     names a session.
  2. The question in headline type, or "Something on your computer is waiting" when it is empty.
  3. The answers: "Deny" (secondary, xmark) and "Allow" (white primary, Face ID symbol). For a
     proposal the voice made, "No" and "Yes".
  4. **Phone without the rules capability**, for a proposal that changes a rule: the sky line
     "Confirm on your Mac, or let this phone change rules from your Mac." and only "No". The yes is
     never offered.
  5. **Answered elsewhere**: the buttons give way to a grey tick line for 2.5 seconds, then the
     card goes. From the Mac's daemon the line is "No longer waiting" (it names nobody); from the
     team it is "Allowed by Bo on Discord", "Denied by Bo on their iPhone", or "Allowed elsewhere".

Answering. "Allow" asks Face ID with a reason built by `QuestionLabel.faceIDReason`, such as
"Allow Claude Code on Maya's MacBook Pro: Claude Code wants to push to main", then sends a signed "once".
Success removes the card, plays the allowed orb gesture and a success haptic, and the Live
Activity shows a green tick for 1.2 seconds. "Deny" sends an unsigned no at once, with a rigid
haptic and a red cross in the island. Both buttons are disabled while an answer is under way.
Cancelling Face ID changes nothing. Failures are notices. A question already answered elsewhere
before the tap ends in "That was already answered elsewhere: it was allowed once." or "That was
settled before your answer arrived, so nothing changed."

**What gets in the way.**

- The answer words are "Allow" and "Deny" only, and Allow always sends "once". "Allow for this
  session" and the three standing answers behind them do not exist on the phone, so the shared
  answer words are broken on the most used door. [Consistency]
- "Deny" is the faint pill and "Allow" the white one, so the no is the dimmed button, against the
  rule that a deny is never the dimmed one. [Contrast]
- "Needs you" duplicates "Waiting on you" with a different title and a different count: the block
  counts every machine, the section only the one talked to now and the team. [Consistency]
- The answered elsewhere line from a Mac says "No longer waiting", and from the team "Allowed by
  Bo on Discord", while the shared form is "Allowed once by Bo on Discord." [Consistency]
- "On the computer" says where the action runs but not what it means for the answer, and it
  crowds the header beside the label on a narrow phone. [Proximity]
- "Something on your computer is waiting" gives no agent and no action, yet offers Allow.
  [Hierarchy]

**Improved.**

```
┌──────────────────────────────────────┐
│ Waiting on you                    3  │
│ 2 on Maya's MacBook Pro, 1 from team │
│ ┌──────────────────────────────────┐ │
│ │ ✳ Claude Code on Maya's MacBook  │ │
│ │   Pro · fix the login redirect › │ │
│ │                                  │ │
│ │ Push to main                     │ │
│ │ git push origin main             │ │
│ │ Rule: pushes to main ask first   │ │
│ │                                  │ │
│ │ ( ✕ Deny )   ( Allow once  ⓕ )   │ │
│ │ More answers ▾                   │ │
│ └──────────────────────────────────┘ │
│ ┌──────────────────────────────────┐ │
│ │ ◎ Codex on build-box, from       │ │
│ │   Ana's team                     │ │
│ │ Run the migration on staging     │ │
│ │ ✓ Allowed once by Bo on Discord. │ │
│ └──────────────────────────────────┘ │
└──────────────────────────────────────┘

More answers ▾ opens:
│ ( Allow for this session  ⓕ )        │
│ ( Always allow this agent ⓕ )        │
│ ( Allow once, always ask  ⓕ )        │
│ ( Always deny )                      │
```

- One section, "Waiting on you", that lists every question on every machine and the team, so the
  block and the list are one thing and there is one count. Another machine's question is
  answered through its quiet watch, which already holds a tunnel (`elsewhereLinks`).
- "Allow once" and "Deny" first, the rest behind "More answers", in the shared words. Every yes
  keeps Face ID; "Always deny" needs none.
- Deny and Allow at equal weight: same size, both outlined in white, Allow filled. They already
  differ by word, symbol and position.
- The rule that asked sits on the card, beside the question, when the daemon sends it.
- Answered elsewhere always reads "Allowed once by Bo on Discord." and, with no name, "Answered
  somewhere else."

---

## In app island and choice tray

`App/Presentation/PhoneIsland.swift`, `App/Presentation/IslandFaces.swift` · reached from: a new
question arriving while the person is on a page that does not show it (a session page of another
session, All sessions, Drive and folders); a tap on the resting pill.

**Job.** Something just asked for me while I was elsewhere in the app. Answer it without leaving.

**Today.** A black shape grown out of the Dynamic Island (or hanging from the notch, or at the top
of a phone with neither):

- **At rest**, shown only when "Keep Memnox in the island" is on: a pill around the hardware with
  a small orb on the left and, on the right, the waiting count in amber or a Face ID symbol while
  Face ID is up. VoiceOver: "Memnox, tap to talk", "2 waiting, tap to answer", or "3 waiting: 2 on
  build-box, 1 on your computer, tap to answer". A tap talks, or with something waiting and the
  voice idle, opens the question.
- **Open on a question**: the island grows to the screen's width less 10 points a side, with a 58
  point orb on the left, the label in white headline beside it, and under it a pulsing amber
  "Waiting on you", or the grouped line with a chevron (VoiceOver hint "Shows every question
  waiting"), or the green answered elsewhere line.
- **The choice tray** comes up from the bottom at the same time: the grouped line in amber with a
  chevron when several wait; the agent logo, label and "On the computer" when it applies; the
  question in 22 point semibold; then "Deny" and "Allow" (or "No" and "Yes"); a tab with a down
  chevron on its top edge, read as "Later".

A drag down on the tray, the tab, or the VoiceOver action "Later" puts it away and folds the
island to its pill. A drag up on the island folds it too. Tapping the island while open starts
talking. The grouped line returns to the home and its list. Answering works as on the card.

**What gets in the way.**

- Unlike the card, the tray shows "Allow" even for a rule proposal on a phone without the rules
  capability; the tap then ends in the notice "Confirm on your Mac, or let this phone change rules
  from your Mac." [Consistency]
- Tapping the open island starts the microphone, which is not what a person tapping a question
  expects. [Progressive disclosure]
- With several waiting, only the newest is in the tray, and the only way to the others is back to
  the home. [Hierarchy]
- The same answer is split across two places, who asks at the top and what to do at the bottom,
  with the page between. [Proximity]

**Improved.**

```
┌──────────────────────────────────────┐
│ ╭──────────────────────────────────╮ │
│ │ ◉  Hermes on build-box           │ │
│ │    ● 1 of 3 waiting  ‹ ›         │ │
│ ╰──────────────────────────────────╯ │
│                                      │
│          (page underneath)           │
│                                      │
│ ╭──────────────── ⌄ ───────────────╮ │
│ │ Retry the failed deploy           │ │
│ │ npm run deploy -- --prod          │ │
│ │                                   │ │
│ │ ( ✕ Deny )   ( Allow once  ⓕ )    │ │
│ │ More answers ▾                    │ │
│ ╰───────────────────────────────────╯ │
└──────────────────────────────────────┘
```

- "1 of 3" with older and newer arrows, as the Mac island steps through calls rather than
  stacking them.
- A tap on the open island opens the tray if it is down, and only the orb talks.
- The tray follows the card exactly: the same answers, and the same rules capability check.

---

## Face ID and what an answer ends as

`Sources/MemnoxPhoneCore/Domain/Waiting/QuestionLabel.swift`, `Application/Answering.swift`,
`App/App/AppModel.swift` (`allow`, `settled`) · reached from: "Allow", "Yes", "Let it run", "Drive
my Mac", pairing, the Live Activity's "Allow", and "Hey Siri, allow in Memnox".

**Job.** Prove it is me saying yes, and tell me what happened.

**Today.** The system Face ID sheet, under the usage line "Memnox asks for Face ID before your
iPhone says yes to your computer." Its reason line is:

- For a question: "Allow Claude Code on Maya's MacBook Pro: Claude Code wants to push to main", "Allow
  <label>" with no question, "Allow: <question>" with no place, or "Allow this".
- For driving: "Let this iPhone drive your Mac".
- For pairing: "Pair this iPhone with your Mac".
- For a hand over: "Allow: Let git.push run on its own on build-box for main", since the proposer
  "memnox" carries no machine of its own.

While the sheet is up the orb is in its needs you state, its ring amber, the voice hint "Confirm
with Face ID", and a listening turn is paused and resumed after. Outcomes: done (orb gesture,
haptic, island tick); cancelled (nothing, no notice); already answered elsewhere (a notice with
the earlier answer); failed (a notice and the orb stumbles). A key that cannot sign leaves the
phone unable to allow anything, which only "Copy What Happened" reveals.

**What gets in the way.**

- The hand over reason reads "Allow: Let git.push run on its own on build-box", two verbs of
  permission in a row. [Consistency]
- The pairing and driving reasons say "your Mac" for a server. [Consistency]
- A phone whose Secure Enclave key could not be made gives no sign on screen; every Allow simply
  fails. [Accessibility]

**Improved.**

```
┌──────────────────────────────────────┐
│            ┌──────────┐              │
│            │  Face ID │              │
│            └──────────┘              │
│  Allow once: Claude Code on Maya's   │
│  MacBook Pro wants to push to main   │
└──────────────────────────────────────┘
```

- Name the answer in the reason ("Allow once", "Allow for this session"), so the signature reads
  the same as the button.
- "Let git.push run on its own on build-box" for a hand over, without the proposer.
- A Settings line "This iPhone cannot sign a yes. Answers here can only deny." when no key exists.

---

## Sessions

## Sessions on the home

`App/Presentation/Home/SessionsSection.swift`, `SessionList.swift`, `SessionFilter.swift`,
`App/Presentation/DesignSystem/SessionRow.swift` · reached from: Home, under Needs you.

**Job.** Which sessions on this computer matter now, and which one do I open?

**Today.**

- Title "Sessions" with the count, and "See all" on the right once the chosen chip keeps more than
  five.
- A row of chips, scrolling sideways: "All", "Waiting" with its count, "Working" with its count,
  then one per agent with its logo, such as "Claude Code", "Codex", "Cursor". The chosen chip is
  filled blue.
- Up to five rows on one card, waiting first, then working, then the rest. Each row: the agent's
  logo (40 points), the task (or the agent's name) in two lines at most, a status dot and word,
  and a quiet line "Claude Code in memnox-runtime" or the repository folder. Status words: a
  pulsing sky "Thinking" or "Working", amber "Waiting on you", grey "Quiet", indigo "Paused",
  faded "Ended", or the raw state.
- Empty: a content unavailable view, "No sessions yet", "Start Claude Code, Codex or Cursor on
  your computer and its sessions show here."
- A chip that keeps nothing: "No session here right now."

The list follows the machine on a four second beat while the app is in front, and on events.

**What gets in the way.**

- Sessions are the machine talked to now only, while "Working now" above lists every machine, so
  a Hermes session on build-box is in one and missing from the other. [Consistency]
- A session's "Waiting on you" means its state is open, not that a question waits, so the chip can
  count sessions where nothing asks the person. [Consistency]
- The empty state names three agents and leaves out Hermes, Sam's only one. [Accessibility]
- "See all" appears only for the chip's own overflow, so with "All" at four rows there is no way
  to the full list's search except the dock button. [Progressive disclosure]

**Improved.**

```
┌──────────────────────────────────────┐
│ Sessions on Maya's MacBook Pro  See all│
│ (All) (Asking 1) (Working 2) (✳ Claude)│
│ ┌──────────────────────────────────┐ │
│ │ ✳ fix the login redirect       › │ │
│ │   ● Asking you · memnox-client   │ │
│ │ ✳ write the release notes      › │ │
│ │   ● Working · memnox-runtime     │ │
│ │ ⬡ refactor the parser          › │ │
│ │   ● Quiet · memnox-cloud         │ │
│ └──────────────────────────────────┘ │
└──────────────────────────────────────┘
```

- Title with the machine, since the list is one machine's.
- "Asking" only for a session with a held question (the waiting list already carries
  `sessionId`), and "Waiting on you" kept for the block above.
- "See all" always, as the way to search.
- Empty: "No sessions yet. They show here as soon as an agent runs on Maya's MacBook Pro."

---

## All sessions

`App/Presentation/Home/AllSessionsView.swift` · reached from: "See all" on the home, or the "All
sessions" button in the dock.

**Job.** Find any session on this computer.

**Today.** A pushed page with the large title "Sessions" and a search field "Search sessions".
Three groups, each with a count, shown only when not empty: "Waiting on you", "Working",
"Earlier". Rows as on the home. Empty with no search: "No sessions yet", "Sessions from your
agents show here as soon as they run." Empty with a search: the system's search empty view.
Search matches the task or the agent's name, never what was said.

**What gets in the way.**

- "Earlier" holds both quiet sessions and ended ones with no way to tell them apart but the dot.
  [Hierarchy]
- No machine is named, and there is no way to see another machine's sessions without leaving and
  switching. [Proximity]

**Improved.**

```
┌──────────────────────────────────────┐
│ ‹ Home                               │
│ Sessions                             │
│ Maya's MacBook Pro ▾                 │
│ ┌ 🔍 Search sessions ──────────────┐ │
│                                      │
│ Asking you                        1  │
│  (rows)                              │
│ Working                           2  │
│  (rows)                              │
│ Quiet                             3  │
│  (rows)                              │
│ Ended today                       5  │
│  (rows)                              │
└──────────────────────────────────────┘
```

- The machine under the title, with the same picker as the header.
- "Quiet" and "Ended today" as two groups.

---

## Session page

`App/Presentation/Session/SessionPage.swift`, `SessionSummary.swift`, `SessionFooter.swift`,
`DesignSystem/ChatBubble.swift`, `ActivityLine.swift`, `TypingIndicator.swift` · reached from: a
session row, a "Working now" row, the chevron on an approval card, or a spoken ask that opened a
session on the Mac (the home flies to it).

**Job.** What is this agent doing, what did it say, and does it need me?

**Today.**

- Navigation bar: in the middle the agent's logo, its name and the status dot and word.
- Summary card: the task (or the agent's name) in bold; a folder line "memnox-runtime in
  ~/work" or the folder alone; when files changed, a disclosure "3 files changed, +42 −7" that
  opens to one line per file with green "+12" and red "−3", and an excerpt in monospaced type
  that scrolls sideways.
- The feed, oldest first, the newest 80 lines: the person's words in blue bubbles on the right
  ("You said ..."), the agent's on the left with its logo ("Claude Code said ..."), and the
  agent's steps as quiet monospaced lines with a symbol per surface (terminal, branch, document,
  network, puzzle piece, question bubble, gear). A refused step has an orange hand and reads
  "Refused: ..."; a failed one a red triangle and "Failed: ...".
- While it works, three dots beside its logo and the step under way: "Claude Code is working: npm
  test".
- Empty, once read: "Nothing to show yet", "What this session says and does appears here as it
  happens." Before the first read, a spinner.
- The footer, pinned: when this session waits on the person, "1 of 2 waiting on you" in amber
  (only with more than one) and the approval card for the first; then the orb dock with the orb
  alone.

Opening the page makes asks follow up on this session until the page is left. The page reads the
session again every two seconds while it works and every four otherwise, and scrolls to each new
line.

**What gets in the way.**

- With two questions waiting, the footer shows "1 of 2" and no way to reach the second until the
  first is answered. [Hierarchy]
- The task shows twice, as the navigation title's fallback and as the summary's title.
  [Consistency]
- There is no way to write to the agent except the orb; a person in a quiet meeting cannot tell
  it to stop. [Accessibility]
- The status in the navigation bar is caption sized grey beside a 26 point logo. [Contrast]
- The machine is not named anywhere on the page. [Proximity]

**Improved.**

```
┌──────────────────────────────────────┐
│ ‹      ✳ Claude Code                 │
│          ● Working · Maya's MacBook  │
│ ┌──────────────────────────────────┐ │
│ │ fix the login redirect           │ │
│ │ 📁 memnox-client in ~/work       │ │
│ │ ▸ 3 files changed, +42 −7        │ │
│ └──────────────────────────────────┘ │
│                                      │
│ ( You ) make the redirect keep the  ◀│
│         query string                 │
│ ✳ I'll start with the router test.   │
│   ⌘ npm test src/router              │
│   ✋ Refused: git push origin main   │
│ ✳ ··· running npm test               │
│──────────────────────────────────────│
│ 1 of 2 waiting on you        ‹  ›    │
│ Push to main                         │
│ ( ✕ Deny )   ( Allow once  ⓕ )       │
│                                      │
│  ⌨           ( ◉ )                   │
└──────────────────────────────────────┘
```

- Older and newer arrows on the footer, so every question this session waits on is reachable.
- The machine beside the status, in the shared label.
- A keyboard button left of the orb that sends typed words through the same ask the voice uses.
- The summary title is the task; the bar carries the agent.

---

## Voice

## Voice screen and orb states

`App/Presentation/Voice/VoiceScreen.swift`, `VoiceGreeting.swift`, `VoiceLine.swift`,
`DesignSystem/TalkingAboutChip.swift`, `SessionPickerMenu.swift`, `OrbView.swift`,
`OrbRenderer.swift` · reached from: the orb on any screen, saying "Memnox" with the app open
("Listen for Memnox"), Siri, the Action Button, Control Center, the island, or a question said
aloud that waits for an answer.

**Job.** Talk to my computer and its agents, and see what was heard and answered.

**Today.** A full screen over the home, rising from the bottom (fading under Reduce Motion), and
open from the first turn until closed:

- At the top, when asks follow a session: a chip with the agent's logo and "About fix the login
  redirect" (or "About this session"), with an x, "Stop asking about this session".
- The greeting, large: "Hi, I'm Memnox." in sky, then "What should your agents do next?" in
  white.
- When "Show the words" is on: "You" with a person mark and what was heard, then "Memnox" with
  the mark and the reply, both selectable.
- A hint over the dock: "Tap the orb to talk", "Listening", "Pause when you are done" (hands free
  once words are heard), "Tap the orb to send" (tap to send), "Asking your computer", "Tap the
  orb to stop", or "Confirm with Face ID".
- The dock: a round "Ask about a session" menu on the left ("Any session", then every session by
  task, the chosen one ticked), the orb at 96 points, a round "Close" on the right.

The orb has five states, the Mac's own: idle (a slow sphere), listening (ripples with the voice's
loudness), thinking (the points rebuilding into a knot), speaking (rings climbing with each
syllable), and needs you (Face ID is up; the orb is disabled). Gestures play over them: a burst
on pairing and on a session opened by voice, an allowed ring, a refused jolt, a stumble on
failure, a glance when a question is about to be listened for. Haptics follow: success, rigid
impact, error.

Turns. Hands free, a pause sends; a turn waits ten seconds for a first word and fifteen for a
follow up, then closes. Saying yes to a question by voice makes the Mac propose it to this phone,
which puts up Face ID once the read back is said and then says "Done, that is confirmed." or
"Face ID was cancelled, so nothing was confirmed and it still waits." A failed turn says its
reason aloud: "The computer had no answer for that." or "The computer could not be reached just
now." Closing stops listening and speaking at once.

States. First use asks for the microphone ("Memnox listens when you talk to your computer.") and
speech recognition ("Memnox turns what you say into words on this iPhone, then sends them to your
computer."). Refused: the notice "Memnox needs the microphone and speech recognition, which you
can allow in Settings." No on device recognition: "Speech recognition on this iPhone is not
available just now." Team only phone: no voice screen; the notice "Pair a computer to talk to it.
Your team's questions still reach you here."

**What gets in the way.**

- The greeting stays at the top through the whole conversation, in large title type, pushing the
  answer down. [Hierarchy]
- Only the last thing heard and the last reply are shown; earlier turns of the same conversation
  vanish. [Progressive disclosure]
- With "Show the words" off, the screen is a greeting and an orb, and a deaf or hard of hearing
  person has no answer at all. [Accessibility]
- The hint is subheadline grey at 50 percent white, the one line that says what a tap does.
  [Contrast]
- The machine being asked is not named on the screen. [Proximity]

**Improved.**

```
┌──────────────────────────────────────┐
│ (✳ About fix the login redirect ✕)   │
│ Asking Maya's MacBook Pro            │
│                                      │
│ You                                  │
│ what is Cursor doing                 │
│                                      │
│ M Memnox                             │
│ Cursor is running the tests in       │
│ memnox-client. Two have failed so    │
│ far.                                 │
│                                      │
│ You                                  │
│ tell it to stop after this run       │
│                                      │
│ M Memnox                             │
│ ···                                  │
│                                      │
│        Pause when you are done       │
│  ▢             ( ◉ )              ✕  │
└──────────────────────────────────────┘
```

- The greeting shows only before the first turn, then gives way to the conversation.
- The whole conversation stays on screen until closed.
- "Show the words" governs what is spoken over the screen, never whether the answer is written;
  the answer is always written here.
- The machine asked is named under the chip.
- The hint at primary ink.

---

## Driving the Mac

## Drive and folders

`App/Presentation/MacView.swift` · reached from: the "Browse the Mac" button in the home's dock.

**Job.** Let the phone act on my Mac for a while, and look at what is in its folders.

**Today.** A pushed page titled "Drive and folders":

- Card "Drive": the steering wheel row, "Drive my Mac", and the caption "Until 14:32" while
  driving or "Off, so every action on the Mac asks for Face ID". Footer: "One Face ID lets this
  iPhone open, type and click on your Mac for up to 15 minutes. Deleting files, sending anything
  off the Mac, rules and pairing still ask." Turning it on asks Face ID ("Let this iPhone drive
  your Mac") for the whole fifteen minutes. Refusals are notices: "Face ID could not sign that.",
  "Your Mac gave no end to the grant.", "Your Mac would not let this phone drive it.", or the
  runtime's reason, most often that the mac capability is off until the Mac turns it on with
  Touch ID. A Mac that does not answer leaves the switch off with no word.
- "Folders" title, with a spinner while a listing is read.
- Breadcrumbs that scroll sideways: a house and "Home", then each folder, the current one white
  and the rest sky buttons.
- The listing on one card: folders as sky folder rows with a chevron and "3 days ago"; files as
  rows with a symbol by extension (code, braces, text, rich text, table, slides, photo, film,
  waveform, archive, app, or a dashed question mark for an unknown kind), their size and date,
  and no chevron. A file is never opened or read.
- A swipe right on the card goes up a folder, the card following the finger. Pull to refresh reads
  the folder again. A new listing slides in from the side it came from and the old one dims while
  it loads.
- States: "Your Mac kept this folder to itself" with a lock and the Mac's reason (by default "Your
  Mac would not show that folder."); "This folder is empty"; before the first read, "Show my home
  folder"; a failed read, the notice "That folder could not be read from the computer."

**What gets in the way.**

- The dock button is "Browse the Mac" and the page is "Drive and folders", while the Drive switch
  is also on the home. Two switches for one grant. [Consistency]
- The page shows for a server, where driving is meaningless and the folder words say "Mac".
  [Consistency]
- Driving says until when but not how long is left, and nothing on the home or the island shows
  the phone is driving. The Mac shows "Driven from Maya's iPhone"; the phone shows nothing.
  [Proximity]
- The page offers no way to open a file the person found, which is the reason most people browse.
  The rule against reading contents is right, so the page should say it rather than leave rows
  that look tappable but are not. [Progressive disclosure]
- Files and folders share one card with only the chevron and colour to tell them apart.
  [Contrast]

**Improved.**

```
┌──────────────────────────────────────┐
│ ‹ Home        Maya's MacBook Pro     │
│                                      │
│ Drive                                │
│ ┌──────────────────────────────────┐ │
│ │ ⎈ Drive my Mac              ( ●) │ │
│ │   11 minutes left, until 14:32   │ │
│ └──────────────────────────────────┘ │
│ Opens, types and clicks without      │
│ asking. Deleting, sending off the    │
│ Mac, rules and pairing still ask.    │
│                                      │
│ Folders                              │
│ ⌂ Home › work › memnox-client        │
│ ┌──────────────────────────────────┐ │
│ │ 📁 src            2 hours ago  › │ │
│ │ 📁 test           yesterday    › │ │
│ │ ── Files ──────────────────────  │ │
│ │ {} package.json   2 KB, today    │ │
│ │ ≡ README.md       6 KB, Monday   │ │
│ └──────────────────────────────────┘ │
│ Names and sizes only. Ask Memnox to  │
│ open a file on the Mac.              │
└──────────────────────────────────────┘
```

- Title the page by the machine, and offer it only for a Mac.
- Time left as well as the end, and a sky "Driving until 14:32" line on the home header and the
  resting island while the grant holds.
- Folders, then a "Files" divider, then files.
- One line saying names and sizes only, and pointing at the voice to open a file on the Mac.
- One Drive switch, here, with the home row becoming a link to it.

---

## Team

## The team's questions on this iPhone

`App/App/AppModel.swift` (`refreshTeam`, `hearTeam`, `say`), `Sources/MemnoxPhoneCore/Domain/Team/TeamQuestion.swift`,
`Application/TeamAnswering.swift` · reached from: Home's "Waiting on you" > "Your team",
Needs you, the island, the Live Activity, and the voice.

**Job.** Answer what my teammates' agents ask me, and know it is theirs and not mine.

**Today.** There is no team inbox page. Team questions join the same list as the person's own:

- Read from Memnox Cloud every 30 seconds while the app is in front, and on every content free
  push.
- Each becomes a card labelled "Codex on build-box, from Ana's team" (or "asked of your team" when
  the question was widened, or the machine's kind when it has no name). The question is the
  machine's summary or "Codex wants to run db.migrate on staging".
- Allow asks Face ID and sends a signed answer to the workspace; Deny sends an unsigned no. The
  card never shows a session line or an "Open session" chevron.
- Answered by somebody else: "Allowed by Bo on Discord", "Denied by Ana on their iPhone",
  "Allowed elsewhere", or "No longer waiting", for 2.5 seconds.
- Said aloud once each, while the app is in front or this phone holds the Mac's voice: "Codex on
  build-box, from Ana's team, wants to push to main. Allow?" Then the phone listens for the answer
  if a machine is paired; a spoken yes still ends in Face ID, and the answer goes to the workspace
  and to the Mac in one Face ID.
- Errors: "Your team would not take that answer from this iPhone.", "This iPhone is signed out of
  your team. Sign in again in Settings.", "Your team would not take that answer.", "Memnox Cloud
  did not answer.", "That answer could not be carried out from this iPhone.", "This iPhone is
  signed out of your team, so that answer was not sent."
- Signed out by the workspace: everything team goes, and the notice "You were signed out of your
  team. Sign in again in Settings."

**What gets in the way.**

- "Your team" is a row in "Waiting on you" that scrolls to a mixed list, so Bo cannot see only the
  team's questions. [Progressive disclosure]
- A team question shows the same amber card and the same "Allow" as Ana's own, told apart only by
  the end of the label, which truncates at two lines on a narrow phone. [Contrast]
- A question that waits on Ana first and reaches Bo after five minutes does not say how long it
  has waited or that Ana did not answer. [Proximity]
- Rule changes waiting on a second admin, which user-flows.md puts in "Your team", do not reach
  the phone at all. [Consistency]

**Improved.**

```
┌──────────────────────────────────────┐
│ Your team                         2  │
│ ┌──────────────────────────────────┐ │
│ │ 👥 From Ana's team · 6 min       │ │
│ │ ◎ Codex on build-box             │ │
│ │ Run the migration on staging     │ │
│ │ Ana has not answered.            │ │
│ │ ( ✕ Deny )   ( Allow once  ⓕ )   │ │
│ └──────────────────────────────────┘ │
│ ┌──────────────────────────────────┐ │
│ │ 👥 Asked of your team · 2 min    │ │
│ │ ✳ Claude Code on studio-mini     │ │
│ │ Publish memnox-client 0.14.2     │ │
│ │ ( ✕ Deny )   ( Allow once  ⓕ )   │ │
│ └──────────────────────────────────┘ │
│ Rule changes waiting on a second     │
│ admin: 1                 Review ›    │
└──────────────────────────────────────┘
```

- A team block, last on the home, whose cards lead with whose team and how long, in indigo, then
  the agent on its machine in the shared label.
- "Review" opens the console page for rule changes, until the phone can sign those itself.

---

## Settings

## Settings sheet

`App/Presentation/SettingsView.swift`, `DesignSystem/VoicePicker.swift`, `TeamSignInRows.swift`
· reached from: the gear "Settings" on the home header.

**Job.** Which machine and team this iPhone answers for, how talking works, and how to call
Memnox from anywhere.

**Today.** A sheet with a drag indicator, rounded 48 points, on the near black background:

- A round "Close" button and "Settings".
- **Machine card**, untitled: the Memnox mark, the machine talked to now or "No computer paired",
  "Paired 7 Oct 2026 at 09:14", and the connection label.
- **"Team"**: signed in, a row "Signed in as Ana", "Your team can ask you from here", then a red
  "Sign out of your team", which asks "Sign out of your team?" with "This iPhone is removed from
  your devices and stops getting your team's questions." and "Sign out". Signed out, the team
  sign in rows. Footer: "Questions your team sends you wait here beside your own, each saying
  which agent and machine it is from. Allow asks for Face ID."
- **"Talking"**: two choice rows, "Hands free", "A pause sends what you said" (default) and "Tap to
  send", "Tap Send when you are done"; then "Listen for Memnox", "Say Memnox while the app is open
  to start talking" (on by default; turning it off releases the microphone at once).
- **"Voice"**: "Voice", "Plays a sample when you pick one", with a menu: "Same as my Mac" (default),
  then each Kokoro voice. A new pick says "Hi, this is how I will sound when I answer you." Then
  "Show the words", "What you say and the answer, on screen while you talk" (on).
- **"Dynamic Island"**: "Keep Memnox in the island", "Show the orb beside the Dynamic Island while
  the app is open" (off). Footer: "The island opens by itself when an agent asks for you and while
  you talk from another app. This keeps the orb there in between."
- **"Call Memnox"**, three rows that do not open anything: "Siri", "Say Hey Siri, talk to Memnox";
  "Action Button", "Settings, Action Button, Controls, then Talk to Memnox"; "Control Center and
  Lock Screen", "Add the Talk to Memnox control". Footer: "Each of these wakes Memnox over
  whatever app is open. It listens on this iPhone and answers in the island, without opening the
  app."
- **"Support"**: "Copy What Happened", "The app's recent steps, for when something goes quiet"
  (copies the diary, with a success haptic); "Pair a computer", "A Mac, or a server running memnox
  pair" or, with one paired, "Pair another computer", "A Mac, or a server running memnox pair; the
  ones paired stay" (closes the sheet and opens pairing); and, with a machine paired, a red
  "Forget Maya's MacBook Pro", which asks "Forget Maya's MacBook Pro?" with "This iPhone stops
  reaching Maya's MacBook Pro. Revoke it there too, with memnox devices revoke or on the Mac, so
  its key is refused." and "Forget". Footer: "Memnox 1.4.0".

**What gets in the way.**

- Only the machine talked to now is shown. Other paired machines cannot be seen, forgotten or
  checked here, and forgetting one needs switching to it first. [Progressive disclosure]
- What this phone may do on each machine (the capabilities see, ask, answer, steer, rules, rewind,
  mac) is never shown, yet it decides whether "Let it run", rule proposals and driving work. A
  phone without the rules capability learns it only from refusals. [Proximity]
- Pairing and forgetting live under "Support", beside a diagnostics row. [Hierarchy]
- "Call Memnox" rows look like rows that open something (symbol tiles on a card) but do nothing.
  [Consistency]
- "Copy What Happened" is in title case where every other label is in sentence case.
  [Consistency]
- Nothing tells the person when Live Activities or the microphone are turned off for Memnox in iOS
  Settings, though without Live Activities nothing on the phone alerts at all. [Accessibility]
- The "Dynamic Island" section shows on phones without one. [Consistency]

**Improved.**

```
┌──────────────────────────────────────┐
│ ✕  Settings                          │
│                                      │
│ Machines                             │
│ ┌──────────────────────────────────┐ │
│ │ ▣ Maya's MacBook Pro  ● Connected│ │
│ │   Talking to it now              │ │
│ │   Answers, steers, changes rules,│ │
│ │   drives                       › │ │
│ │ ▣ build-box           ● Offline  │ │
│ │   Answers and steers. Rules are  │ │
│ │   changed on build-box.        › │ │
│ │ ⌗ Pair another computer        › │ │
│ └──────────────────────────────────┘ │
│                                      │
│ Team                                 │
│ ┌──────────────────────────────────┐ │
│ │ 👥 Signed in as Ana              │ │
│ │ Sign out of your team            │ │
│ └──────────────────────────────────┘ │
│                                      │
│ Alerts                               │
│ ┌──────────────────────────────────┐ │
│ │ ⚠ Live Activities are off for    │ │
│ │   Memnox, so nothing alerts you. │ │
│ │   Open iOS Settings            › │ │
│ └──────────────────────────────────┘ │
│                                      │
│ Talking · Voice · Call Memnox ·      │
│ Support (as today)                   │
│ Memnox 1.4.0                         │
└──────────────────────────────────────┘

Machine page (› on a machine):
│ build-box                            │
│ Paired 7 Oct 2026 at 09:14           │
│ This iPhone may see, ask, answer and │
│ steer. Changing rules and driving    │
│ are off; turn them on with memnox    │
│ devices on build-box.                │
│ ( Talk to build-box )                │
│ Forget build-box                     │
```

- A "Machines" section first, with every paired machine, its connection and what this phone may
  do there in words, each opening a page with "Forget".
- An "Alerts" row that appears only when Live Activities or the microphone are off, with the way
  to turn them on.
- "Call Memnox" rows as plain text with no tiles, or each opening the iOS page it names.
- "Copy what happened", in sentence case.
- The "Dynamic Island" section only on a phone that has one; on a notch phone it reads "Banner at
  the top".

---

## Live Activity, Dynamic Island, notifications, Siri and controls

## Live Activity on the Lock Screen

`Widget/MemnoxLiveActivity.swift` (`LockScreen`), `App/Platform/LiveActivityController.swift`,
`App/Shared/MemnoxActivity.swift` · reached from: something waiting while the phone is locked or
the app is away; talking from another app; or "Keep Memnox in the island" with the app open.

**Job.** See and answer what waits without unlocking into the app.

**Today.** A black card on the Lock Screen (and, on a phone with a notch, the banner that drops
from the top):

- A header row: the white Memnox mark (sky while the voice runs) and the status word ("Waiting
  on you", "Listening", "Listening, tap send when done", "Thinking", "Speaking", or "Memnox"),
  then the machine's name in grey, then on the right the count in amber, a waveform or an
  ellipsis while the voice runs, or the faint mark.
- Under it, one of the expanded island's faces (see Dynamic Island).

The activity starts on the phone itself with no push type, so a question never crosses Apple's
or Memnox's servers. A content free push to start can begin one from afar with the generic state:
count 1 and no question, which reads "Memnox needs you on Maya's MacBook Pro" until the app wakes
and reads the detail. It ends when nothing waits, no voice runs and "Keep Memnox in the island" is
off.

**What gets in the way.**

- The machine is fixed for the activity's life, so after switching machines, or with only team
  questions ("your team"), the header names the wrong place. [Consistency]
- With Live Activities turned off for Memnox, the controller returns quietly and the phone alerts
  nothing at all. [Accessibility]
- "Allow" opens the app and puts up Face ID, while "Deny" acts in place; the difference is right
  but unexplained, and the Allow pill gives no hint it will open the app. [Progressive
  disclosure]

**Improved.**

```
┌──────────────────────────────────────┐
│ M Waiting on you                  2  │
│ ◉ Claude Code on Maya's MacBook Pro  │
│   Push to main                       │
│ ( ✕ Deny )  ( Allow once  ⓕ ↗ )      │
│ Allow opens Memnox for Face ID.      │
└──────────────────────────────────────┘
```

- Drop the fixed machine from the header; the label in each question already names it.
- An arrow on Allow and one quiet line saying it opens the app for Face ID.

---

## Dynamic Island

`Widget/MemnoxLiveActivity.swift`, `Widget/IslandOrbFace.swift`, `App/Shared/IslandIntents.swift`
· reached from: the same Live Activity, on a phone with a Dynamic Island.

**Job.** Glance at what Memnox is doing, and answer or talk without opening the app.

**Today.** The orb is drawn without Metal: 72 dots on a sphere in the Memnox blues, turned to a
different angle per state and swelling a step with each of three loudness levels; amber glow when
something waits. Every state:

- **Compact**: on the leading side the orb's glow alone (22 points), or a green tick for 1.2
  seconds after an allow, or a red cross after a deny; on the trailing side the amber count
  (VoiceOver "2 waiting"), a sky waveform while listening or speaking, an ellipsis while thinking,
  or the faint mark at rest.
- **Minimal** (when another app's activity shares the island): the same leading orb, tick or
  cross.
- **Expanded at rest** (kept in the island, nothing waits): a 50 point orb, "Talk to Maya's
  MacBook Pro", and "Tap, or say Hey Siri, talk to Memnox"; the whole face is a button that starts
  listening.
- **Expanded while talking**: a round xmark "Stop" on the left, the orb at 76 points in the
  middle, and on the right a white round arrow "Send to your computer" only while listening with
  tap to send; under it, two lines of what was heard or the answer (when "Show the words" is on),
  or the status word.
- **Expanded waiting**: a 46 point amber orb; beside it the grouped line ("3 waiting: 2 on
  build-box, 1 on your computer") or the label; the question in two lines, or "Memnox needs you on
  Maya's MacBook Pro" before the app has read it. Then "Deny" (faint pill, xmark) and "Allow"
  (white pill, Face ID symbol), or "No" and "Yes" for a proposal. Deny runs in the background,
  unsigned, and never opens the app. Allow opens the app, which puts up Face ID at once and leaves
  the question on the home if Face ID is cancelled.
- **Expanded, answered elsewhere**: the buttons give way to a grey tick line such as "Allowed by
  Bo on Discord".
- **Settled**: the tick or cross in the compact orb for 1.2 seconds, then the next state.

The heading in the expanded leading region is the mark and the status word. The keyline is sky.

**What gets in the way.**

- The phone never checks the rules capability here: a rule proposal on a phone without it shows
  "Yes", opens the app, and ends in a notice. [Consistency]
- Before the app reads the detail, the island offers Allow and Deny for a question it cannot name.
  [Hierarchy]
- The answer words are "Allow" and "Deny" only. [Consistency]
- The answered elsewhere line uses "Allowed by" and never the answer's kind ("once", "for this
  session"). [Consistency]
- The amber count and the amber orb are the only signs something waits in compact; without colour
  it is a number beside a dot. [Accessibility]

**Improved.**

```
Compact:   ( ◉ )  ▬▬▬▬▬▬▬▬  ✋2

Expanded waiting:
╭──────────────────────────────────────╮
│ M Waiting on you                  2  │
│ ◉  Claude Code on Maya's MacBook Pro │
│    Push to main                      │
│ ( ✕ Deny )        ( Allow once ⓕ )   │
╰──────────────────────────────────────╯

Expanded before the detail is read:
╭──────────────────────────────────────╮
│ M Waiting on you                  1  │
│ ◉  Something waits on Maya's         │
│    MacBook Pro. Open to see it.      │
│ (      Open Memnox      )            │
╰──────────────────────────────────────╯
```

- A raised hand beside the compact count, so waiting reads without colour.
- No answers until the question is known; one "Open Memnox" instead.
- The rules capability check before "Yes".
- "Allow once" as the word, and the shared answered elsewhere line.

---

## Alerts and notifications

`App/Platform/LiveActivityController.swift`, `App/App/MemnoxPhoneApp.swift` (`PhoneDelegate`),
`App/App/AppModel.swift` (`showIsland`, `talkFromIsland`) · reached from: a new question while the
app is not in front; Memnox called from another app.

**Job.** Make sure I know something waits, wherever I am.

**Today.** The app posts no notifications of its own; there is no `UNUserNotificationCenter` in
the code. The relay sends content free pushes that only wake the app, which opens the tunnel,
reads the detail and the team inbox, and updates the Live Activity. What the person sees is the
Live Activity's alert:

- A new question while the app is away: an alert with the sound, titled with the label ("Codex on
  build-box, from Ana's team") and the question as its body. It opens the Dynamic Island by itself,
  or drops as a banner on a notch phone. One alert per question.
- Memnox called from another app and listening: an alert titled "Memnox" with "Listening. Say what
  you need."
- A push to start while the app was not running: the generic island, "Memnox needs you on
  <machine>".
- With the app in front, no alert; the in app island and the home show the question.
- Another machine with something new while the app is open: the notice "build-box has something
  waiting on you. Switch to it to answer."

The actions are the island's: "Deny" and "Allow". There is no notification permission prompt,
because nothing asks for one.

**What gets in the way.**

- A person who turned Live Activities off, or whose activity iOS ended after eight hours, gets
  nothing at all for a question waiting at 2am, which is Sam's whole use of the app.
  [Accessibility]
- There is no history: a question answered on the Mac while the phone was in a pocket leaves no
  trace on the phone. [Progressive disclosure]
- The alert's title is the label and its body the question, so the Lock Screen preview carries the
  question's words, which some people will not want on a locked screen. [Proximity]

**Improved.**

```
┌──────────────────────────────────────┐
│ MEMNOX                          now  │
│ Memnox needs you on build-box        │
│ Hermes asks to run a deploy.         │
│ ──────────────────────────────────── │
│  Deny                                │
│  Allow once (opens Memnox)           │
└──────────────────────────────────────┘
```

- A plain notification as the fallback whenever the Live Activity cannot be shown, with "Deny"
  (background, unsigned) and "Allow once (opens Memnox)" as its actions, both built on the
  existing intents.
- A Settings choice "Show the question on the Lock Screen", on by default, off showing only
  "Memnox needs you on build-box".

---

## Siri, Action Button and Control Center

`App/App/MemnoxShortcuts.swift`, `App/App/SpokenAnswerIntents.swift`, `Widget/TalkControl.swift`,
`App/Shared/IslandIntents.swift` · reached from: Siri, the Action Button, Back Tap through
Shortcuts, Control Center, the Lock Screen controls.

**Job.** Call Memnox, or answer what it just said, without touching the app.

**Today.**

- **Talk to Memnox** (`ListenIntent`), known to Siri with no setup by "Talk to Memnox", "Wake
  Memnox", "Ask Memnox", "Hey Memnox", short title "Talk to Memnox", a waveform symbol, navy tile.
  Description: "Wake Memnox and talk to your computer from any app, without opening Memnox." It
  starts listening in the background and opens the island with the orb; called again it sends,
  and called while answering it stops.
- **Allow what Memnox asked** (`AllowSaidIntent`), "Allow in Memnox", "Allow it in Memnox",
  "Approve in Memnox", Face ID symbol. Description: "Allow the question Memnox just said aloud,
  after Face ID." It opens the app straight into Face ID for the question the voice said last.
- **Deny what Memnox asked** (`DenySaidIntent`), "Deny in Memnox", "Deny it in Memnox", "Refuse in
  Memnox", xmark symbol. Description: "Deny the question Memnox just said aloud." Unsigned, in the
  background.
- Neither answers anything unless the voice said a question that still waits; otherwise the
  notice "Nothing the voice asked about is waiting now."
- **Control** (`TalkControl`, kind `com.memnox.phone.talk`): a button "Talk to Memnox" with a
  waveform, display name "Talk to Memnox", description "Wake Memnox and talk to your computer from
  any app." Usable in Control Center, on the Lock Screen and on the Action Button.
- Settings > "Call Memnox" says how to set up each.

Team only phone: Talk to Memnox ends in the notice "Pair a computer to talk to it. Your team's
questions still reach you here.", which is only seen once the app is opened.

**What gets in the way.**

- "Allow in Memnox" answers the question said last, not the one on screen or the newest, and
  nothing on the island says which one that is. [Proximity]
- On a team only phone the control and Siri start nothing and say nothing where the person is.
  [Accessibility]
- The Allow intent sends "once" with no way to say "for this session". [Consistency]
- Both "Hey Memnox" and the in app name listener exist, and a person cannot tell which one works
  where. [Consistency]

**Improved.**

```
Siri, after "Allow in Memnox":
┌──────────────────────────────────────┐
│ Allow once: Codex on build-box,      │
│ from Ana's team, run the migration?  │
│ Memnox opens for Face ID.            │
└──────────────────────────────────────┘

Siri on a team only phone:
┌──────────────────────────────────────┐
│ Memnox has no computer to talk to.   │
│ 1 team question waits for you.       │
│ ( Open Memnox )                      │
└──────────────────────────────────────┘
```

- Siri's reply names the question it is about to allow before the app opens, as an intent
  dialog.
- A team only phone answers out loud, through the intent's dialog, rather than failing silently.
- Settings explains in one line that "Hey Memnox" works through Siri anywhere and "Memnox" alone
  only with the app open.

---

## Across the iPhone app

Top 10 improvements, in priority order:

1. **A fallback notification with Deny and Allow once** whenever the Live Activity cannot show, so
   a question at 2am always reaches the person: Alerts and notifications, Live Activity, Settings.
2. **One "Waiting on you" with one count, answerable across every machine** through the quiet
   watches the app already keeps: Home header, Home blocks, Needs you, machine picker, in app
   island.
3. **The shared answer words**, "Allow once", "Allow for this session" and "Deny" first with the
   always answers behind "More answers": approval card, choice tray, session footer, Dynamic
   Island, Live Activity, Siri.
4. **Words that know a server from a Mac**: "Confirm on build-box" or the command, and no Drive or
   Folders for a server: Ready to hand over card, approval card, Your computer, Drive and folders,
   Face ID reasons, Pair with a computer.
5. **A Machines section in Settings** that lists every paired machine with what this phone may do
   there in words, so a phone without the rules capability knows before it is refused: Settings,
   Ready to hand over card, approval card.
6. **Deny never the dimmed button**: equal weight, different word, symbol and position: approval
   card, choice tray, Dynamic Island, Live Activity, session footer.
7. **"Your team" as its own last block** with whose team and how long each question has waited:
   Home blocks, the team's questions, Needs you.
8. **The shared answered elsewhere line**, "Allowed once by Bo on Discord.", everywhere a settled
   question lingers: approval card, choice tray, Dynamic Island, Live Activity.
9. **A team only phone with no button that cannot work**: no orb, voice or Siri dead ends, and an
   honest line instead: Home dock, Voice screen, Siri, Control Center, Settings.
10. **Every "Not covered" count with its next step**, and machine warnings with a time in amber
    above the blocks: Home blocks, Settings machine page.
