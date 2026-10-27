# The Memnox console, page by page

The console is the web app in `memnox-client/apps/app`, served at the workspace's own address.
It is the one door every person has: Maya on a Mac, Sam with a server, Lin with no Apple device
at all, Ana running a team and Bo on her team all reach it from any browser. Everything else
(the Mac island, the iPhone, a chat DM, the terminal) is an extra door onto the same questions.
So the console has to carry the whole promise on its own: show what is waiting, let a person
answer it with a signed yes or a free no, and show which actions the record has earned the
right to stop asking about.

Every entry below follows `docs/ux/TEMPLATE.md`. Labels in quotes are taken from the working
tree of `memnox-client` as of 2026-10-07, uncommitted files included. **Today** is what the code
does now; anything new is written under **Improved** only. The people are the ones in
`docs/user-flows.md`.

The order follows the sidebar: the app shell first, then Auth and Onboarding, Home, the five
nav groups (Fleet, Govern, Record, Inputs, Organization), and finally the routes that live off
the tree. The console has 31 routes with a `page.tsx` plus the root redirect; all of them are
covered here.

---

## The app shell

`app/layout.tsx`, `app/(workspace)/layout.tsx`, `components/app-shell.tsx`, `components/app-sidebar.tsx`, `components/app-topbar.tsx`, `components/app-nav.ts`, `components/shell/*`, `components/tour/*`, `app/manifest.ts`, `public/sw.js` · reached from: every signed in page; `/` redirects to `/dashboard`

**Job.** Where am I, what is waiting on me, and how do I get to the page that answers it?

**Today.**

### Frame

Every workspace route is wrapped in `SessionGate requireOnboarded` and then `AppShell`. The frame is pinned to the viewport (`fixed inset-0`), so only the `main` column scrolls. The sidebar is 256px wide on large screens, a 64px icon rail when collapsed, and a 288px drawer over a scrim on small screens. The document title is "%s · Memnox", defaulting to "Memnox". Pages are not indexed (`robots: noindex`). Fonts are Inter and Instrument Serif; the theme script runs before paint and the browser theme colour is `#fbfbfb` light and `#030303` dark.

### Sidebar, top to bottom

1. The Memnox lockup, a link labelled "Memnox home" to `/dashboard`. It names the product, never the organization.
2. A search button "Quick search" with the key hint "⌘K". It opens the command palette.
3. "Home", alone above the groups, to `/dashboard`.
4. Five groups, each with a small muted heading, in this order:
   - **Fleet**: "Machines" (`/machines`), "Agents" (`/fleet`), "Map" (`/map`).
   - **Govern**: "Waiting on you" (`/inbox`), "Autonomy" (`/autonomy`), "Memory" (`/memory`).
   - **Record**: "What was caught" (`/findings`).
   - **Inputs**: "Connectors" (`/connectors`), "Files" (`/files`), "Meetings" (`/meetings`).
   - **Organization**: "People" (`/members`), "Billing" (`/settings/billing`), "Settings" (`/settings`).
5. At the foot, on large screens only, an icon button "Collapse sidebar".

The active row is the longest `href` the path starts with, drawn with a filled background and `aria-current="page"`. A row marked `planned` would render dimmed with "Soon" and no link; none is marked today. No row carries a count, so "Waiting on you" looks the same with zero questions as with nine.

Off the tree, on purpose: "File locks" (`/leases`, which the nav comment says is linked from Machines, though no component links to it and `offNavLinks` is never rendered) and "Usage" (`/usage`, linked from Billing). `/sources` is reachable only from the palette and from tabs on Connectors and Files. `/admin` is reachable only from the account menu.

**Collapsed rail.** The Memnox mark (link "Home"), a "Quick search" icon, then the same groups as icons separated by rules, each with a `title` tooltip, and "Expand sidebar" at the foot. The collapsed state is component state only, so a reload always opens the wide sidebar.

**Small screens.** The sidebar is hidden; a menu button in the top bar ("Open navigation" or "Close navigation") opens it as a drawer, and tapping the scrim ("Close navigation") or any row closes it.

### Top bar, left to right

- The menu button (small screens only).
- The organization chip: the organization's logo (or the Memnox mark), its name (or "Memnox" before it loads), and the plan name as a small uppercase badge. With one membership it is plain text. With two or more it is a button ("Organization, <name>. Open another") with an up and down chevron.
- Right side, four 36px icon controls:
  - "Ask", a sparkle icon. It opens the same command palette as "Quick search", which only navigates to pages.
  - "Documentation", a book icon, a full page link to the docs site.
  - "Open incidents", a bell, a link to `/findings`. It carries a red count badge (open plus acknowledged incidents, "9+" past nine) and a screen reader text "<n> unresolved".
  - The account button.

### Organization switcher

Opened from the chip when the person holds two or more memberships. A panel titled for screen readers "Your organizations":

- A search field "Search organizations"; no match says "Nothing here is called that."
- One row per organization: logo, name, a check and "Open now" (screen reader) on the current one, the person's role below the name in capitals as stored, and the plan badge on the right. The current row is disabled.
- A refusal, if switching failed, in red: the API message or "That organization was not opened."
- Footer: "<n> organizations" and a link "Organization settings" to `/settings`.

Choosing a row sets the session's organization, empties the cache and sends the person to `/dashboard` (never the page they were on, since its ids belong to the old organization). A full screen cover "Opening <name>" with "Loading what this organization knows." holds for at least two seconds, filling a bar; past that it pulses and reads "Still loading what this organization knows."; at ten seconds it leaves whatever has answered.

### Account menu

The avatar (picture or initials, "?" before the session loads) with a green dot once the session has answered. Its label is "Account, <name>". The panel:

- The name and, when different, the email.
- "Account": "Profile" (`/settings/account`), "Appearance" (`/settings/appearance`).
- "Support": "Help" (docs site).
- "Deployment": "Platform admin" (`/admin`), drawn only when `session.platformAdmin` is true.
- Footer: a sign out button in red that returns to `/login`.

Escape or a click outside closes it.

### Command palette

Opened by "Quick search", "Ask", or Command K / Control K anywhere (the shortcut is bound on `window` and fires even inside a field). A dialog "Search and navigate" 12vh from the top:

- Field "Go to a page" with an "esc" key hint.
- Two scope pills "All" and "Pages". Both list the same thing, pages.
- Rows under the group heading "Navigate to": every nav row plus "Home" and "Sources", each with its icon and its group on the right ("Fleet", "Govern", "Inputs").
- Empty: "Nothing matches that. Try the name of a page." (All) or "No page matches that." (Pages).
- Footer hints: "enter open", "up down navigate", "tab scope".

It does not search agents, machines, people, rules or findings. A `useChord` two key shortcut helper exists in `components/shell/use-chord.ts` and nothing calls it.

### First run tour

Mounted with the shell, shown once on `/dashboard` to the person who just created the organization (armed by `lib/tour`, spent on arrival). A dark scrim with a spotlight on the anchored control and a card with "1 / 6", a step bar, a close button "Close the tour", "Skip tour", "Back" and "Next" (last step "Done"). The steps:

1. "You are set up": "Memnox knows what your agents can reach, records what they do, and holds them to rules you approve. Here is where each part of that lives."
2. "Home is where you land" on Home.
3. "Start by enrolling a machine" on Machines.
4. "Autonomy" on Autonomy.
5. "Connect where the work already happens" on Connectors.
6. "One box for every screen" on Quick search: "Command K opens it from anywhere, Control K on Windows."

There is no step for "Waiting on you". On a small screen the sidebar is closed, so steps 2 to 6 have no anchor drawn and the card sits centred describing a sidebar nobody can see.

### Feedback and toasts

There is no toast system: a search for "toast" and "sonner" finds nothing. Every confirmation and refusal is written inline beside the control that caused it (`RefusalText`, which can append "Upgrade the plan" linking to `/settings/billing#change-plan`). Destructive steps use `ConfirmDialog`: a title, a description, a warning mark, "Cancel" and a red confirm button whose label the caller passes; it can stay disabled until a name is typed.

### Plan wall

Where a plan cannot express something, `PlanWall` sits under the empty thing in muted type: the plan's sentence (`wall.changes`) and a link "What changes on <next plan>" to `/settings/billing`. Used on Connectors, File locks and Billing.

### Global states

- **Checking the session.** A centred spinner labelled "Checking your session". It also stays up while a session is on its way to `/onboarding`.
- **Signed out.** Replaced with `/login`. Not yet onboarded: replaced with `/onboarding`.
- **Cloud unreachable.** "Cannot reach Memnox Cloud", the API message or "Your session could not be checked.", and "Try again". This is the only offline state; the console has no offline cache and the service worker caches nothing.
- **No workspace.** `WorkspacePage` renders `NoWorkspace` when the session resolves with no workspace: "Memory is made with the organization, so this failed rather than needing setup. Sign out and back in, then tell whoever runs this Memnox." The same copy appears on every page, Machines and Billing included.
- **A page throws.** Inside the shell: "This page did not load", "The rest of the workspace is fine. Try it again, or move on and come back.", "Reference <digest>" when there is one, and "Try again".
- **The whole app throws.** "The workspace hit a problem", "Nothing you were looking at was changed by this. Try again, and your session is still open.", "Try again" and "Go home".
- **404.** Eyebrow "404", "No page at this address", "Some of the console is still being built, and a page that is not ready yet is not linked. Home is where everything starts." and "Go home".

### Installed app and notifications

- **Manifest.** Name and short name "Memnox", description "Answer what your agents are waiting on, and see what they did.", `id` and `start_url` `/inbox`, `display: standalone`, background and theme `#fbfbfb` (light only), icons 192, 512 and a maskable 512. So the installed app opens on "Waiting on you", not Home.
- **Service worker** (`/sw.js`). Registered only when the person turns on notifications in Settings > Account ("Wake this browser"). It only shows pushes: title "Memnox needs you", body "An agent is waiting on your answer.", tag `memnox-held` so a new one replaces the last, and a click focuses an open console tab and navigates it to `/inbox` (or opens one). It refuses any URL on another origin. Nothing about the call is in the payload.

**What gets in the way.**

- [Hierarchy] Nothing in the shell says how many questions are waiting. The one badge in the bar counts incidents and links to "What was caught", so the loudest signal on every page points at the record rather than at the person's work, and the sidebar row "Waiting on you" has no count at all.
- [Consistency] The bell means "open incidents" here but the push notification, the manifest `start_url` and the product promise all mean "waiting on you". Two doors to two different queues with the same alarm iconography.
- [Consistency] "Ask" with a sparkle promises a question box and opens a page jumper titled "Go to a page". The palette's "All" and "Pages" scopes list exactly the same rows, so the "tab scope" hint teaches a control that does nothing.
- [Progressive disclosure] The palette cannot find an agent, a machine, a person or a rule by name, which is what someone typing "cursor" or "build-box" expects. Navigation by page title duplicates the sidebar one key away.
- [Hierarchy] The tour skips "Waiting on you", the page the installed app opens on, and step 3 tells everyone to "Start by enrolling a machine" even when onboarding said they run a Mac with the app.
- [Accessibility] On small screens the tour spotlights controls inside a closed drawer, so five of six steps float centred with nothing highlighted. The ⌘K hint is shown on Windows and Linux, where the key is Control.
- [Accessibility] Command K is bound globally without the typing guard `useChord` already has, so it steals the shortcut inside text fields (for example a rule editor).
- [Consistency] The no workspace notice talks about "Memory" on every page, Billing and Machines included, which reads as a bug rather than a state.
- [Contrast] The account dot is always green once the session answered, so it carries no news; the colour alone is the only signal and it never changes.
- [Proximity] Signing out is the only item in the footer and it is red at the same weight as a destructive confirm, while the organization's switcher and settings live on the opposite side of the bar from the person's own menu.
- [Consistency] The manifest has one light theme colour, so an installed console in dark mode opens with a light title bar.
- [Accessibility] Without a toast or live region, an answer given on another page (or by a teammate on another door) changes nothing in the shell until a query refetches; there is no "Allowed once by Bo on Discord." moment at shell level.

**Improved.**

```
┌──────────────────────────┬──────────────────────────────────────────────────────────────┐
│ ◆ Memnox                 │ [Acme ▾ TEAM]                 [⌕ Search agents, pages ⌘K] (?) (AN)│
│                          ├──────────────────────────────────────────────────────────────┤
│ ⌕ Search         Ctrl K  │ ┌──────────────────────────────────────────────────────────┐ │
│                          │ │ 2 agents are waiting on you                 Answer now → │ │
│ ⌂ Home                   │ │ Codex on lin-laptop wants to run the migration · 1m      │ │
│ ● Waiting on you      2  │ └──────────────────────────────────────────────────────────┘ │
│                          │                                                              │
│ FLEET                    │   (page content)                                             │
│   Machines               │                                                              │
│   Agents                 │                                                              │
│   Map                    │                                                              │
│ GOVERN                   │                                                              │
│   Autonomy               │                                                              │
│   Memory                 │                                                              │
│ RECORD                   │                                                              │
│   What was caught     1  │                                                              │
│ INPUTS                   │                                                              │
│   Connectors · Files ·   │                                                              │
│   Meetings               │                                                              │
│ ORGANIZATION             │                                                              │
│   People · Billing ·     │                                                              │
│   Settings               │                                                              │
│                          │  ┌──────────────────────────────────────┐                    │
│ [«]                      │  │ Allowed once by Bo on Discord.  Undo? │  (live region)    │
└──────────────────────────┴──┴──────────────────────────────────────┴────────────────────┘

Search panel (Ctrl K)
┌──────────────────────────────────────────────────────────────┐
│ ⌕ cursor                                               esc   │
│ AGENTS                                                       │
│   Cursor on Maya's Mac                     Working now       │
│ MACHINES                                                     │
│   maya-mbp                                 Mac · online      │
│ WAITING ON YOU                                               │
│   Cursor on Maya's Mac wants to push to main      1m         │
│ PAGES                                                        │
│   Agents                                   Fleet             │
│ enter open   up down move                                    │
└──────────────────────────────────────────────────────────────┘
```

- Put "Waiting on you" directly under "Home", above the groups, with a count, because it is the one row that is someone's work, and the installed app already opens there. Keep it in Govern only in the palette's group label.
- A slim bar at the top of `main` whenever anything waits, in the accent colour and nowhere else: "<n> agents are waiting on you", the oldest as "<agent> on <machine> wants to <action>", and "Answer now". It is the same object the push opens, so the shell, the notification and the inbox agree.
- Retire the bell. Incidents keep their count on the "What was caught" row. One alarm, one meaning.
- Replace "Ask" and the duplicate "Quick search" with one search field in the bar that finds agents, machines, people, rules and held calls as well as pages, grouped "Agents", "Machines", "Waiting on you", "Pages". Drop the "All" and "Pages" pills. Everything it needs is already in the queries the pages use.
- Show "Ctrl K" off a Mac and guard the shortcut with the same `isTyping` check `useChord` has.
- Add a live region for answers that land while the page is open, using the shared wording "Allowed once by <person> on <door>.", which is the console's half of "first answer wins".
- Tour: add "Waiting on you" as step 2 ("When an agent needs a yes, it waits here. A yes asks for your passkey; a no never does."), choose the machine step from the onboarding answer, and open the drawer on small screens before spotlighting.
- No workspace copy that names no page: "This organization has no workspace yet, which is a setup fault rather than something you did. Sign out and back in; if it stays, tell whoever runs this Memnox."
- Manifest: add a dark `theme_color` through the media aware `<meta>` already in the root layout, and register the service worker on first load so "Install" works before anyone visits Settings.
- Remember the collapsed sidebar per window in `sessionStorage`, so a reload does not undo a choice made a second ago.

---

## Auth

Every signed out screen shares one frame, `app/(auth)/layout.tsx`. On a wide viewport the left
half is the canvas (`AuthCanvas`) and the right half is the panel; below the `lg` breakpoint the
canvas is dropped and the panel is one centred column. The panel column always carries:

- A header with the Memnox lockup (link "Memnox home" to the marketing site) and a bordered
  "Docs" link with an outward arrow, to the docs origin.
- A footer: "By continuing you agree to the Memnox Terms and the security practices they run
  under.", where "Terms" and "security practices" link to the marketing site.

The canvas, top to bottom: a dimmed ASCII portrait as the ground, a caption pair
"READ_OFF_YOUR_OWN_DISK" and "NOTHING IS TRANSMITTED" (the second in the accent), the heading
"Your agents can already do more than you think.", the body "They arrived with installs, seats
and pipelines, each handed access by somebody who has moved on. Memnox holds them to rules you
wrote.", a row of seven agent marks (Claude Code, Cursor, Codex CLI, Cline, Hermes, OpenClaw,
Any MCP client) dropping dots onto a hairline gate, the three effect words "Allow", "Ask" (in
the accent) and "Deny" under it, then three ticked lines: "What every agent can reach, read off
your own machines", "What each one actually did, and under whose authority", "The calls that
matter still reach a person, and nothing is untraceable". All pages here are `noindex`.

### Sign up

`/signup` · reached from: the marketing site's "Start free", the "Start free" link on Sign in,
and an invitation link opened while signed out (`/signup?invite=<token>`).

**Job.** Can I get an account right now without a card or a call?

**Today.** In its plain mode (`authCopy.signUp`):

- Eyebrow "Start free", heading "Know what your agents can do, and decide what they may",
  subtitle "Sign in with Google or GitHub and your account is created on the spot. No card, no
  setup call."
- A refusal notice when `?error=` is present (see Sign in for the sentences).
- Two full width bordered anchors: "Continue with Google" and "Continue with GitHub", each with
  its mark. They are document navigations to the cloud, which answers with a redirect to the
  provider, so the page works without JavaScript.
- Note: "You will pick where your agents already reach, name your workspaces, and say who they
  act for. Bringing other people in comes later."
- Footer link line: "Already have an account?" "Sign in" to `/login`.

In its invited mode (`?invite=<token>`, `authCopy.invited`): eyebrow "Invitation", heading
"Create your account to join", subtitle "Continue with Google or GitHub, then accept the
invitation. Your account is made in the organization that invited you, and no other one is
created for you.", the same two buttons with the token appended to their URLs, note "Use the
account you want to work in. The address it proves is the one you sign in with from then on.",
and "Already on Memnox?" "Sign in". The page silently remembers `/invite?token=<token>` in
session storage so the callback returns there.

Actions: either provider button leaves for the provider's consent screen and returns to
`/auth/callback`. States: no loading state on this page because nothing is fetched; refusal
notice as above; on a phone the canvas is gone and only the panel shows.

**What gets in the way.**

- The note promises steps onboarding does not have: "pick where your agents already reach" and
  "name your workspaces" (plural), while onboarding asks for one name and never asks about
  reach. [Consistency]
- Two equal outlined buttons and no primary. Nothing says which provider a team uses, and a
  person with both may create an account under the wrong address, which then cannot join the
  team by invitation without a second account. [Hierarchy]
- No passkey door, although the console already registers passkeys to sign a yes. A person
  without Google or GitHub (common for Lin on a company address) has no way in. [Accessibility]
- The left canvas carries the only explanation of what Memnox is, and it disappears below the
  `lg` breakpoint, so a phone visitor reads a heading and two buttons with no context.
  [Progressive disclosure]
- The footer legal line sits at the bottom of a tall column, far from the buttons it governs.
  [Proximity]

**Improved.**

```
┌─────────────────────────────────────────────┐
│ MEMNOX                               Docs ↗ │
│                                             │
│ START FREE                                  │
│ Know what your agents can do,               │
│ and decide what they may                    │
│                                             │
│ Your account is created on the spot.        │
│ No card, no setup call.                     │
│                                             │
│ [ G  Continue with Google               ]   │
│ [ ⌘  Continue with GitHub               ]   │
│ [ 🔑 Continue with a passkey            ]   │
│                                             │
│ Use the address your team uses, so an       │
│ invitation finds you.                       │
│ By continuing you agree to the Terms.       │
│                                             │
│ Next: name your workspace, say what you     │
│ run agents on, then put one machine under   │
│ Memnox.                                     │
│                                             │
│ Already have an account? Sign in            │
└─────────────────────────────────────────────┘
```

- Rewrite the note to the three steps onboarding actually has, so the promise matches the next
  screen.
- Add "Continue with a passkey" as a third door, built on the passkey registration that
  Settings already has, as the user flows doc asks.
- Move the legal line directly under the buttons.
- On narrow screens, keep the canvas heading and its three ticked lines as a short block under
  the buttons rather than dropping them.

### Sign in

`/login` · reached from: "Sign in" on Sign up, any signed in page when the session is gone
(`SessionGate` redirects here), `/device` and `/apps/connect` when signed out, and the cloud's
`/v1/auth/cli` when `memnox login` opens a signed out browser (`?next=`).

**Job.** Get me back to where I was going.

**Today.** Eyebrow "Sign in", heading "Welcome back", subtitle "Pick up where you left off: what
your agents reached, what they did, and what is waiting on you.", then a refusal notice when
`?error=` is set, the same two buttons "Continue with Google" and "Continue with GitHub", and
"No account yet?" "Start free" to `/signup`. A `?next=` path is kept in session storage (only
same origin paths are accepted) so the callback lands there instead of Home.

Refusal sentences, shown in a red bordered `role="alert"` box, keyed by the cloud's code:

- "That sign-in attempt expired before it finished. Start again."
- "That address could not be signed in. Try again, or use a different account."
- "That account has been disabled."
- "Google sign-in is not configured on this Memnox instance yet." and the same for GitHub.
- "Google could not complete the sign-in. Start again." and the same for GitHub.
- "Verify your email address with Google, then sign in again."
- "Set a verified primary email address on your GitHub account, then sign in again."
- Anything else: "That sign-in did not complete. Start again."

States: no loading; the refusal notice; phone layout without the canvas.

**What gets in the way.**

- When somebody arrives with `?next=` from `memnox login` or an app code, nothing on the page
  says so. They see "Welcome back" and may think the terminal step failed. [Hierarchy]
- The refusal box is the same red as a security alert for benign cases such as an expired
  attempt. [Contrast]
- A refusal like "Google sign-in is not configured" still shows the Google button active right
  under it. [Consistency]
- No passkey door. [Accessibility]

**Improved.**

```
┌─────────────────────────────────────────────┐
│ SIGN IN                                     │
│ Welcome back                                │
│                                             │
│ ┌─────────────────────────────────────────┐ │
│ │ After you sign in, you will approve the │ │
│ │ machine that ran memnox login.          │ │
│ └─────────────────────────────────────────┘ │
│                                             │
│ [ G  Continue with Google               ]   │
│ [ ⌘  Continue with GitHub               ]   │
│ [ 🔑 Continue with a passkey            ]   │
│                                             │
│ No account yet? Start free                  │
└─────────────────────────────────────────────┘
```

- When `next` points at `/device`, `/apps/connect` or `/invite`, say what comes after sign in
  ("approve the machine", "approve your iPhone", "answer the invitation"), read from the path
  already stored.
- Use a neutral notice for "start again" cases and keep red for disabled accounts.
- Hide or disable a provider button whose refusal says it is not configured.
- Add the passkey door, as on Sign up.

### Accept an invite

`/invite?token=<token>` · reached from: the link in an invitation email; the return from Sign
up as `/invite?token=<token>&signed_up=1`.

**Job.** Do I want to join this organization, and as which address?

**Today.** One panel with eyebrow "Invitation" and a large heading. It can show five screens:

1. Checking: heading "You have been invited to Memnox", spinner and "Checking who is signed
   in…". Shown while the session is read, and while a signed out visitor is redirected to
   `/signup?invite=<token>`.
2. Join: heading "Join <organization>?" once the cloud has read the token, or "Join this
   organization?" until then. Line: "<invitedBy> invited <email> to join <organization> on
   Memnox." or, without a preview, "<email> has been invited to join this organization on
   Memnox." or "You have been invited to join this organization on Memnox." when signed up but
   without a session. A reserved error line, then "Decline" (muted text button) and "Join"
   (primary, full width, "Joining…" while busy).
3. Declined: heading "Invitation left as it was", body "Nothing was spent. The link in your
   email still works until it expires, so you can accept it later or ignore it entirely.", link
   "Already a member? Sign in".
4. Arriving: heading "You have been invited to Memnox", spinner and "You are in. Opening your
   workspace…", then a redirect to `/dashboard`.
5. Broken link (no token): red notice "This link is missing its invitation token. Open the link
   in the email itself, or ask for a new invitation." and "Already a member? Sign in".

Actions: "Join" calls the accept endpoint and, on success, goes to `/dashboard` (skipping
onboarding, since the organization exists). A failure shows "That invitation could not be
accepted. Try again, or ask for a new one." or the cloud's message. "Decline" changes only the
screen; nothing is sent. Nothing is spent on load, so a mail scanner cannot burn the link.

**What gets in the way.**

- A signed in person whose address differs from the invited one is not warned. The line names
  their own email but never the address the invitation was sent to, so somebody signed in with
  a personal Google account joins as the wrong identity. [Proximity]
- "Decline" is a faint text button beside a bright primary. Declining is safe and free, and
  should read as an equal choice rather than a hidden one. [Contrast]
- The expired or revoked case is only discovered after pressing "Join", because the preview
  failing silently falls back to "this organization". [Progressive disclosure]
- The arrival screen does not say what the team already has (rules in force, machines), which
  is the value Bo is promised in the user flows. [Hierarchy]

**Improved.**

```
┌─────────────────────────────────────────────┐
│ INVITATION                                  │
│ Join Northwind Labs?                        │
│                                             │
│ Ana Ruiz invited bo@northwind.dev.          │
│ You are signed in as bo@northwind.dev.      │
│                                             │
│ Northwind Labs has 4 people, 3 machines     │
│ and 12 rules in force.                      │
│                                             │
│ [ Decline ]        [ Join Northwind Labs ]  │
│                                             │
│ Not you? Sign in with another account       │
└─────────────────────────────────────────────┘
```

- Show the invited address beside the signed in one, and when they differ say "This invitation
  was sent to bo@northwind.dev. You are signed in as bo@gmail.com." with "Sign in as
  bo@northwind.dev" as the primary.
- When the preview reads the token as expired or revoked, show that before any button.
- Give "Decline" a bordered button of equal height.
- Add counts the preview could carry (people, machines, rules), counts never scores.

### Approve a machine

`/device?code=<code>` · reached from: the URL `memnox login` prints or opens; typing the
address by hand; the return from Sign in when signed out.

**Job.** Is this the machine I just ran `memnox login` on, and should it get a credential?

**Today.** Eyebrow "Machine enrolment" on every screen. The screens:

- Loading: heading "Approve this machine?", spinner and "Looking for the machine waiting on that
  code…". Also shown while a signed out visitor is redirected to `/login`, with the code
  remembered for the return.
- No workspace: heading "No workspace to enrol into", red notice "This account is not a member
  of a workspace yet, and a machine is always enrolled into one.", link "Go to your workspace".
- Code entry (no code in the URL): heading "Enter the code shown in your terminal", body
  "`memnox login` prints an eight-character code. Type it here to see which machine is
  asking.", field "Code" (placeholder "CDFG-HJKM", label "Enrolment code").
- Unknown code: heading "That code is not waiting on anything", red notice "It may be mistyped,
  already answered, or older than ten minutes. Run `memnox login` again for a fresh one." (or
  "That machine could not be answered." on a network failure), link "Go to your workspace".
- Approval: heading "Approve this machine?", line "Approving issues this machine a credential
  for <workspaceId>. It can be revoked later without touching your own access.", then a
  bordered list: "Machine" (hostname), "Code", "Asking to run as" (when the machine said),
  "Runtime" (version, when sent), "Code expires" ("in 7 minutes", "in a minute", or "expired"
  in red). A reserved error line, then "Refuse" (muted text) and "Approve" (primary, full
  width, "Approving…").
- Answered: "Machine approved" with "The machine is collecting its credential now. You can
  close this tab; the terminal you started from will say where it landed." or "Machine refused"
  with "Nothing was issued. The machine is told no and stops waiting, and the code cannot be
  used again." After an approval, when the workspace decides in Discord and this member is not
  linked: a section "One more step: link your Discord, so your agents' questions reach you
  there" with the Discord explanation, "Get a link code", then the words to paste with a copy
  button and "Type @ and pick the Memnox bot, then paste this, within N minutes. It works
  once." Finally "Go to your workspace".

Actions: "Approve" and "Refuse" both post the answer, so a no is recorded. The workspace is the
first one on the session; there is no picker.

**What gets in the way.**

- Typing in the code field breaks the page. The field's value is the same state the lookup
  reads, so the first character typed starts a lookup, the field is replaced by the loading
  panel, and the partial code then lands on "That code is not waiting on anything" with no way
  back to the field except reloading. `/apps/connect` fixed this with a "Continue" submit; this
  page did not. [Consistency]
- The approval line shows the raw workspace id rather than the workspace name, so the one fact
  being checked is unreadable. [Proximity]
- "Refuse" is the dimmed one, which breaks "a deny is never the dimmed one". [Contrast]
- A yes issues a long lived credential with one click and no passkey, while the product rule is
  "a yes is signed". [Consistency]
- "Code expires" is computed once per render and never ticks, so a tab left open still says "in
  7 minutes" after the code died. [Accessibility]
- The unknown code screen offers only "Go to your workspace", not "Enter a different code".
  [Progressive disclosure]
- "Asking to run as" shows the raw mode word in monospace with no explanation. [Hierarchy]

**Improved.**

```
┌─────────────────────────────────────────────┐
│ MACHINE ENROLMENT                           │
│ Approve build-box?                          │
│                                             │
│ It joins Northwind Labs and its agents'     │
│ questions come to you. You can revoke it    │
│ from Machines without touching your access. │
│                                             │
│ Machine        build-box                    │
│ Code           CDFG-HJKM                    │
│ Runs as        Enforce: rules apply         │
│ Runtime        0.42.1                       │
│ Code expires   in 7 minutes                 │
│                                             │
│ [ Refuse ]         [ Approve with passkey ] │
│                                             │
│ Wrong code? Enter a different code          │
└─────────────────────────────────────────────┘
```

- Use the same submit form as `/apps/connect`: a field, "Continue", and only then a lookup.
- Name the workspace, and say that whoever approves owns the machine's questions.
- Make "Refuse" a bordered button the same height as "Approve".
- Ask for the passkey on "Approve" where one is registered, and fall back to a plain approve
  otherwise.
- Re-render the expiry each minute and disable "Approve" once it reads "expired".
- Add "Enter a different code" to the unknown screen, as `/apps/connect` has.

### Sign in an app

`/apps/connect?code=<code>` · reached from: the iPhone's "Join your team" ("Open the page") and
the Mac's Settings > Team "Sign in to your team"; typing the address by hand.

**Job.** Is this my own phone or Mac, and should it answer my agents' questions as me?

**Today.** Eyebrow "App sign in". The screens:

- Loading: heading "Sign in an app", spinner, "Looking for the app waiting on that code…". Also
  shown while a signed out visitor is redirected to Sign in with the code remembered.
- Code entry: heading "Enter the code shown in the app", body "The Memnox app on your iPhone or
  Mac shows an eight character code. Type it here to see which device is asking.", field "Code"
  (placeholder "ABCD-EFGH", label "Sign in code"), primary "Continue", disabled while empty.
- Unknown: heading "That code is not waiting on anything", red notice "It may be mistyped,
  already answered, or older than ten minutes. Ask the app for a fresh code and try again." (or
  "That code could not be checked."), and the link button "Enter a different code".
- Approval: heading "Sign in this phone?" or "Sign in this Mac?", line "<name> wants to answer
  your agents' questions for you.", grant line "Approving signs this phone in as you. It sees
  and answers only the questions that reach you, and it can be signed out again without
  touching your own access.", a list "Device", "Kind" ("Phone" or "Mac"), "Code", "Code
  expires", then "Deny" (muted text) and "Approve" (primary, "Approving…"). Failure: "That app
  could not be answered."
- Answered: "Phone signed in" or "Mac signed in" with "You can go back to the app.", or "App
  not signed in" with "Nothing was issued. The app is told no and stops waiting, and the code
  cannot be used again.", then "Go to your workspace".

**What gets in the way.**

- "Deny" is dimmed beside a bright "Approve". [Contrast]
- The device approves a credential that answers as the person, with no passkey. [Consistency]
- The expiry never ticks, as on `/device`. [Accessibility]
- The answered screen does not say where to manage the device later (which page signs it out).
  [Progressive disclosure]
- The eyebrow says "App sign in" and the code entry says "eight character code" while `/device`
  says "eight-character code", two spellings for one idea on twin screens. [Consistency]

**Improved.**

```
┌─────────────────────────────────────────────┐
│ APP SIGN IN                                 │
│ Sign in Ana's iPhone?                       │
│                                             │
│ It will answer only the questions that      │
│ reach you, as you.                          │
│                                             │
│ Device         Ana's iPhone                 │
│ Kind           Phone                        │
│ Code           ABCD-EFGH                    │
│ Code expires   in 9 minutes                 │
│                                             │
│ [ Deny ]           [ Approve with passkey ] │
└─────────────────────────────────────────────┘

Answered:
  Phone signed in
  Go back to the app. To sign it out later,
  open Settings > Account > Signed in apps.
```

- Equal weight for "Deny", passkey on "Approve", ticking expiry, as on `/device`.
- Put the device name in the heading so the fact being checked is the largest thing.
- Say where the device can be signed out afterwards.

### Signing in (callback)

`/auth/callback` · reached from: the cloud, after Google or GitHub.

**Job.** None for the person; it decides where they land.

**Today.** A full screen with the pulsing Memnox mark and "Signing in as <name>…" (or "Signing
you in…" before the session loads). It then routes: a refusal (`?error=`) is redirected on the
server to `/login?error=<code>`; a sign up from an invitation (`?signed_up=1`) goes back to the
remembered `/invite?…&signed_up=1`, or to `/login`; no session cookie (Safari over plain http)
goes to `/login`; a remembered invitation goes there before onboarding; an account not yet
onboarded goes to `/onboarding`; otherwise the remembered `next` path or `/dashboard`.

**What gets in the way.**

- When the cookie never arrives, the person is put back on Sign in with no message, which reads
  as the button not working and invites a loop. [Accessibility]
- No timeout: if the organization query never settles, the pulse runs forever. [Progressive
  disclosure]

**Improved.**

```
          ◉
   Signing in as Ana Ruiz…

(after 10 seconds)
   This is taking longer than it should.
   [ Try again ]   Back to sign in
```

- Send the cookie failure to `/login?error=cookie_blocked` with "Your browser did not keep the
  sign in. Allow cookies for memnox and try again."
- Show "Try again" after ten seconds.

### Connecting (connector callback)

`/connect/callback` · reached from: the provider consent screen a connector opens in a popup.

**Job.** None for the person; it hands the result back to the page that opened it.

**Today.** The Memnox mark and "Finishing up, one moment." It posts the result to the opener
window and closes itself. If the browser refuses to close it, the line becomes "You can close
this window." Opened as a normal tab (blocked popup, copied link), it redirects to
`/connectors?status=…&toolkit=…`. Anything but an explicit success counts as failed.

**What gets in the way.**

- "You can close this window." does not say whether the connection worked, so a person closing
  it has to go back and look. [Proximity]

**Improved.**

```
          ◉
   GitHub is connected.
   You can close this window.
```

- Say the outcome ("GitHub is connected." or "GitHub was not connected.") with the toolkit name
  read from the same parameters, before "You can close this window."

## Onboarding

`/onboarding` is one route with three screens, inside `SessionGate` and without the sidebar. It
is reached from the sign in callback when the organization has no `onboardedAt`, and from any
workspace page that requires onboarding. Every screen shares one frame:

- A progress bar of three segments (filled up to the current step), each with a screen reader
  title.
- Eyebrow "Step N of 3", a heading with an accent icon, and a lead sentence.
- The step's fields.
- A reserved error line: "Your setup could not be saved, so nothing changed." or the cloud's
  message.
- "Back" (hidden on step one) and a primary "Continue" with an arrow, which reads "Finish setup"
  on step three and shows a spinner while saving.

Session states from `SessionGate`: a spinner labelled "Checking your session"; on a network
failure "Cannot reach Memnox Cloud", the cloud's message or "Your session could not be
checked.", and "Try again"; signed out redirects to `/login`.

Nothing is saved until "Finish setup". Then the organization (name, kind of work, size) and the
member (name, title, department) are saved together, the connector picks are kept in local
storage for the Connectors page, the shell tour is armed, and the browser goes to `/dashboard`.
Leaving mid way loses every answer.

### Step 1. What we should call this

`/onboarding`, step 1 · reached from: the first sign in.

**Job.** What is this account called, and how big is it?

**Today.** Heading "What we should call this" with a shield icon. Lead "One name covers the
whole account: the people in it, the systems it reads, and the record of what your agents did.
Nothing else here has to be named." Fields:

- "What should we call this?" text field. Placeholder is the cloud's guess from the email
  domain, or "Northwind Labs". Hint "Your company, your team, or whatever you call the work. It
  names everything here, and you can change it later." Required: "Continue" stays disabled
  until it has text.
- "What kind of work" select, placeholder "Select the closest", options "A product team",
  "Infrastructure or platform", "Data or analytics", "Security", "An agency or consultancy",
  "Solo or side project", "Other". Hint "Decides what the first rules are about, so you are
  editing them rather than writing them."
- "How many of you", three stacked choice cards: "Just me" ("Everything on your own machine. No
  approvals, because there is nobody else to ask."), "A few of us" ("A shared record, and the
  first rule somebody other than its author approves."), "A whole team" ("Roles, chains no
  single machine can see, and readiness per agent."). Hint "Approval is only a control when
  somebody else can give it. On one seat every escalation names you."

**What gets in the way.**

- The domain guess is only a placeholder, so a person who agrees with it must retype it; the
  disabled "Continue" gives no reason why it is disabled. [Accessibility]
- Three questions on one screen while the frame promises one question per screen. [Progressive
  disclosure]
- "How many of you" maps to plan names (Free, Pro, Team) without saying so, so a person picking
  "A whole team" does not learn it is a paid plan until Billing. [Consistency]
- Field labels are small uppercase mono, quieter than their hints. [Hierarchy]

**Improved.**

```
━━━━━━━━━━━━  ────────────  ────────────
STEP 1 OF 3
What we should call this

Name
[ Northwind Labs                       ]
  [ Use "Northwind Labs" ]
It names everything here. You can change it later.

How many of you
( ) Just me          Free. Nobody else to ask.
( ) A few of us      Pro. A second person can approve.
( ) A whole team     Team. Roles and approvers.

What kind of work (optional)
[ Select the closest                 ▾ ]

                               [ Continue → ]
```

- Offer the guess as a one tap "Use" chip rather than only a placeholder, and say "Name it to
  continue" under a disabled button.
- Name the plan beside each size, read from the same `SEAT_BANDS`.
- Mark the kind of work optional and move it last.
- Sentence case labels at body size.

### Step 2. What comes to you

`/onboarding`, step 2 · reached from: "Continue" on step 1.

**Job.** Which questions should reach me rather than somebody else?

**Today.** Heading "What comes to you" with a person icon. Lead "What an agent may not decide
alone comes to a person. Your role is how Memnox knows which of those are yours to answer."
Fields:

- "Your name", prefilled from the session.
- "Your title", placeholder "Engineering Manager", hint "However you say it where you work.",
  with suggestions "Engineer", "Engineering Manager", "Platform Lead", "Security Engineer",
  "Founder".
- "Where you sit", a two column grid: "Engineering", "Platform", "Security", "Data", "Product",
  "Leadership". Hint "Decides which refusals come to you rather than to somebody else."

None are required.

**What gets in the way.**

- On "Just me" every question comes to this person anyway, so the whole step is moot for Maya,
  Sam and Lin, yet it is never skipped. [Progressive disclosure]
- The step never asks the question that actually decides what reaches someone: where they want
  to be asked (browser, phone, chat DM). That lives in Settings > Account and is never mentioned
  here. [Hierarchy]
- The hint says "refusals" while the product's word for what comes to a person is a question
  waiting on you. [Consistency]

**Improved.**

```
━━━━━━━━━━━━  ━━━━━━━━━━━━  ────────────
STEP 2 OF 3
What comes to you

Your name
[ Lin Park                             ]

Where should questions find you?
[✓] This browser       Wake this browser
[ ] My chat DM         Slack, Discord, Telegram, Teams
[ ] My phone           Install the Memnox app

Where you sit (on a team)
[ Engineering ] [ Platform ] [ Security ]
[ Data ] [ Product ] [ Leadership ]

[ ← Back ]                     [ Continue → ]
```

- Skip title and department on "Just me".
- Ask where questions should find the person, and route the choice to the existing
  notification and chat link cards after setup.
- Say "questions" rather than "refusals".

### Step 3. Where your team decides things

`/onboarding`, step 3 · reached from: "Continue" on step 2.

**Job.** Which systems should Memnox read to learn what we already settled?

**Today.** Heading "Where your team decides things" with a chat icon. Lead "Memnox reads these
to learn what your team settled, so it can propose a rule rather than ask you to write one.
Reading only: no agent acts through them." A two column grid of toggle cards with marks:
"GitHub" ("Where a change is argued out and approved"), "Slack" ("Where it was decided, in the
team's own words"), "Linear" ("What was agreed to be done, and by whom"), "Jira" ("The same,
where delivery is tracked there"), "Notion" ("Rules and policies somebody wrote down"),
"Confluence" ("The handbook, where that is where it lives"). A picked card gets the accent
border and a tick. Two closing lines: "Nothing is connected yet, and picking one grants nothing:
each system needs its own approval and Memnox only reads it. Your picks are waiting in
Connectors." and "None of this governs an agent. That starts on the next screen, by putting one
machine under Memnox, which needs no connector at all." Then "Back" and "Finish setup".

**What gets in the way.**

- The step that governs nothing is the last thing before Home, and the step that does (what the
  person runs agents on) is never asked. `agentsInUse` exists in the data file and no screen
  uses it. So Home cannot lead with one chosen next step, which is the first fix in the user
  flows. [Hierarchy]
- The closing line promises "the next screen" puts a machine under Memnox, but the next screen
  is Home with several equal blocks. [Consistency]
- Picks are kept only in this browser's local storage, so finishing on a phone and opening
  Connectors on a laptop loses them silently. [Consistency]
- Two paragraphs of disclaimers under a grid of choices that grant nothing. [Progressive
  disclosure]

**Improved.**

```
━━━━━━━━━━━━  ━━━━━━━━━━━━  ━━━━━━━━━━━━
STEP 3 OF 3
Where do your agents run?

( ) On this Mac            Install the Mac app
( ) On a server            Add a server
( ) On Linux or Windows    Install Memnox on this computer
( ) I am not sure yet

Later, in Connectors: let Memnox read GitHub,
Slack or Linear to learn what your team settled.

[ ← Back ]                  [ Finish setup ]
```

- Replace the connector grid with "Where do your agents run?", whose answer picks the one
  primary step Home leads with. The connector picks move to Connectors, where they can actually
  be granted.
- If the connector question stays, save the picks with the organization rather than in one
  browser.
- Make the closing promise name exactly what Home will show first.

---

## Home

### Home

`/dashboard` (`app/(workspace)/dashboard/page.tsx`, `components/dashboard/dashboard-view.tsx`) · reached from: the "Home" launcher above the sidebar tree, the logo, the end of onboarding, and every sign in that has no return address.

**Job.** What needs me, what are my agents doing, and what is the next step that lets them do more on their own?

**Today.** The browser tab reads "Dashboard" (page metadata), the sidebar row reads "Home" and the page's own eyebrow reads "Overview". The page is one client view that fires ten queries (`/home`, `/setup`, timeline of 500 rows, pending approvals, machines, open incidents, pending suggestions, findings, connected toolkits, `autonomy/next`). Top to bottom:

1. **Header** (`home/page-header.tsx`). Eyebrow "Overview". Title is the workspace label (the same name the shell shows), or "Your workspace" while unresolved. Standing line: "What the agents in this workspace are allowed to do, and what they did with it." When no machine is enrolled it becomes "One command on the machine your agent runs on, and this fills in." Two pill buttons: "Ask what the team knows" with a `⌘K` key cap (opens the command palette), and "Read the quickstart" with an outward arrow (opens `docs/quickstart` on the docs origin).

2. **Setup ladder** (`setup-ladder.tsx`, from `GET :ws/setup`), section labelled "What to do next". Draws nothing until the route answers and nothing once there is no next step and nothing waiting. Heading is the stage label, one of "Nothing governed yet", "Observing", "Enforcing", "Delegating", with a mono counter "{completed} of {total}" at the right, and the stage's meaning under it (for example "Nothing is enrolled, so Memnox decides nothing anywhere. One host takes minutes and needs no plan."). Then:
   - A highlighted **"Do this next"** card: the step title, its `value` sentence, its `how` sentence, then command lines (an install command if sent, the command, and an unattended command with the note "The first opens a browser on that machine. Use the second on a server or a CI runner: it prints a code somebody approves from anywhere."). A primary button whose label comes from the step's API route: "Enrol a machine", "See your machines", "Open the record", "Answer a blocked machine", "Choose a machine", "Connect a system", "See what Memnox reads", "Read the queue", "Open the queue", "See what they may do", "Set up chat", or "Open" for an unknown route (always to `/machines`). When the install panel below is on screen and the step is `enrol_machine`, the commands and button are dropped and the card says "Below: a machine you control, or a URL for an agent you cannot install into."
   - Zero or more quiet **waiting** cards with a clock: "Waiting on your machine" ("It pulls on its own, about once a minute. Nothing here makes it sooner."), "Waiting on an agent" ("This closes the first time an agent on one of your machines does something. Use one as you normally would."), "Walking your history" ("The sweep started on its own and runs in the background, bounded by what your plan keeps.").
   - Two track lists side by side: "The machines your agents run on" ("Where a verdict is reached. Any plan, no model spend, minutes.") and "Where your team decides things" ("Read-only, as evidence. What the team settled is what a rule is made of, and no agent acts through it."), each step with a tick or an empty circle.
   - A footer of non zero counts: "Machines", "Enforcing", "Actions recorded", "Answered remotely", "Sources linked", "Evidence held", "Decisions approved", "Rule sets in force".

3. **Agent install** (`agent-install.tsx`), only while no machine is enrolled. Two cards: "On a machine you control" with pill "Interposed", body "A laptop, a VPS, a CI runner. The runtime sits in the path of every tool call and credential, so no agent goes around it.", three copyable commands `npm install -g memnox`, `memnox login`, `memnox setup`, and "One pass covers every client on the machine. Nothing to run per agent."; and "Hosted, over MCP" with pill "Advisory", body "For an agent running somewhere you cannot install into. It is governed only to the extent it asks, so use the runtime wherever you can reach the host.", with buttons "Hermes" and "OpenClaw". Then a card "Which agents are you running?" ("These are the products Memnox can put itself in front of today. Pick one for the exact sequence and where its config lives.") listing eight rows: "Claude Code", "Cursor", "Codex CLI", "Claude Desktop", "Cline", "Hermes", "OpenClaw", "Ruflo", each with its `gives` line (for example "Every tool call and every command checked before it runs.") and an "or hosted" chip on Hermes and OpenClaw. Every row and hosted button opens the Agent setup drawer.

4. **The brief** (`brief/home-brief.tsx`, from `GET :ws/home`, polled every 60 seconds), a single bordered card with section label "Where things stand" (screen readers only, no visible heading). Rows, each "title, sentence, link":
   - "Waiting on you": "1 thing is waiting on you" or "{n} things are waiting on you", plus "· {n} more for your team" on a team. Link "Open" to `/inbox`. Empty: "Nothing is waiting on you. **Pair your phone** to answer from anywhere when something does." (to `/apps/connect`).
   - "Working now": up to four rows "Claude Code on build-box" (on a team "Claude Code on build-box, Ana's"), with "· {task}" in grey when sent, then "and {n} more". Link "Agents" to `/fleet`. Empty: "No agent is working right now. **Add a server** so an agent can run on its own while you are away." (to `/machines#add-server`).
   - "Today": "41 actions, 6 asked you, 5 allowed, 1 refused", built only from parts the cloud counted. Link "What was caught" to `/findings`. Empty or all zero: "Nothing was recorded today."
   - "Ready to hand over": "You have said yes to git.push 6 times for Claude Code on Maya's Mac. Let it run on its own?" (once, twice, n times) with the note "A rule is proposed, never granted: a second admin approves it before it is in force." Link "Propose a rule" to `/autonomy`. Empty: "Nothing is ready yet. This fills in as you say yes to the same thing again and again."
   - "Not covered": one line per non zero gap, each with its own link: "{n} agents have nobody who owns them" ("Give each an owner", `/fleet`), "{n} servers have stopped reporting" ("See which", `/machines`), "{n} MCP servers run with no rule in front of them" ("Review them", `/inbox`). Empty: "Everything Memnox can see has an owner, is reporting and has a rule in front of it."
   - "Your team": drawn only on a team with rules pending, "1 rule waits on a second admin" or "{n} rules wait on a second admin", link "Review" to `/inbox`. Never drawn on a team with nothing pending, and the `team.members` count it receives is not shown anywhere.
   - Loading: five skeleton rows with "Loading where things stand". Error with no data: a form note "This summary could not be read, so the panels below are the record for now."

5. **Quick row** (`home/quick-row.tsx`), three cards of fixed height:
   - "Sources" (links to `/sources`): up to three linked sources with provider mark and label. Empty: "Memnox reads your repositories and channels to learn what your team settled. Reading only: it never acts in them." with link "Link the first one".
   - "Autonomy" (links to `/autonomy`): one tile "What agents may do".
   - "Recents" (no link): three newest timeline rows, operation in mono, then the verdict word (or "recorded") and a time or day. Empty: "Nothing decided yet. Every action an agent checks before doing it lands here."

6. **Wide column** (two thirds on large screens):
   - **Analytics band**, section "Analytics". A radio group "Window" with "24 hours", "7 days" (default), "30 days"; the resolved dates in mono caps ("1 October to 7 October"); a picker button reading "Custom" (or the window's label when not one of the three tabs); a refresh icon "Refresh the readings" that spins while fetching. With nothing enrolled, an amber notice: "No machine is enrolled, so nothing has been decided anywhere and there is nothing to count for this window." Then four full width metric rows, each a whole row link with a "Actions for {label}" overflow menu holding its link and "Refresh":
     - "Governed actions", with a percent arrow against the previous window and, when the 500 row page was cut, "The most recent in the window". Link "Open the record".
     - "Denied", plotted in the bad colour. Link "Open what was denied".
     - "Asked", plotted amber, note "{n} still waiting on somebody". Link "Open the approval queue" (`/inbox`).
     - "Let through anyway", plotted amber, note "The rules said stop and the machine was only watching". Link "See which machines are watching" (`/machines`).
     - While loading or with nothing enrolled each value is a long dash glyph rather than a zero, and the plot is a skeleton or blank.
   - **"Approvals waiting"** ("View all" to `/inbox`): up to four cards titled with the plain action phrase, pill "Waiting" (amber) or "Lapsed" (red), summary "Held until the people accountable for it sign off." or "Partly signed off, and still short of what the rule asks for." or "It ran out of time before enough people signed off.", a bar "{granted} of {needed} sign-offs" with a percent, and a time. Each card opens `/inbox?id=…`. Empty: "Nothing is waiting on a person. Anything an agent cannot do on its own appears here, routed to whoever owns it."
   - **"Open incidents"** ("View all" to `/findings`), only while one is open: cards with pill "Critical", "High" or "Acknowledged".
   - **"To confirm"** ("View all" to `/inbox`): suggestion cards with pill "In review", the statement, and a "Confidence" bar in percent. Empty: "Nothing to confirm. Once a system is connected, the patterns Memnox reads out of the work land here for someone to approve."

7. **Rail** (one third):
   - "Could be handed over" (more: "Autonomy"): "{x} of the {y} approvals answered in the last {d} days were for something nobody has ever refused." then two operations with pill "unasked" (green) or "watch" (amber), and "and {n} more". Empty: "Nothing to read yet. This fills in as your team answers the approval queue, and it counts rather than guesses." or "Nothing repeats often enough yet to be a habit rather than a coincidence."
   - "Machines" (more: "Machines"): "{live} of {n} connections are reporting." plus "{w} of the runtimes record only what a rule would have done." and "{a} are agents that ask over MCP rather than being gated.", then four machine names with a pill "silent", "advisory", "enforce", "observe" or "off". Empty: "Nothing is enrolled, so nothing is being decided. Rules are applied by a runtime on the machine an agent runs on."
   - "What was caught" (more: "Everything caught"): four findings with a severity pill. Empty: "Nothing outstanding. Machines report what their scanners find, so an empty list means they are reporting and finding nothing."
   - "Connected systems" (action: "Connectors"): connector rows with kind and a reading dot, footer "{live} of {n} reading". Empty: a drawn wiring ornament, "Nothing connected", "The graph stays empty until one system of record and one system of conversation are switched on." and button "Connect a system".

**States.**

- Loading: until the session resolves and machines answer, the header plus a page skeleton ("Loading the workspace") of three quick cards, four metric bars, two card pairs ("Loading what is waiting", "Loading what needs confirming") and four rail blocks. The skeleton has no slot for the ladder, the install panel or the brief, so all three push the page down when they arrive.
- No workspace: header, quick row, then a notice "Memory is made with the organization, so this failed rather than needing setup. Sign out and back in, then tell whoever runs this Memnox." The brief, ladder and readings are hidden.
- Nothing enrolled: header line changes, ladder at "Nothing governed yet", install panel, brief, amber analytics notice, dashes.
- Error: only the brief has an error state. Approvals, suggestions, findings, autonomy and connections treat a failed read as empty and show their reassuring empty sentence. `RuntimeDownNotice` ("Part of this page is unavailable") exists in `dashboard-notices.tsx` and is never rendered.
- Partial: the timeline is one page of 500; a wider window shows "The most recent in the window".
- Plan: nothing on Home is gated by plan; the ladder's sweep step mentions "what your plan keeps".
- Offline or stream: Home does not use the live stream; the brief polls every 60 seconds and the rest fetch once with a manual refresh on the analytics band only.
- Unused in tree: `review-cta.tsx`, `charts/stacked-bars.tsx`, `charts/ranked-bars.tsx` and the A to F `GRADES` in `series.ts` are not rendered.

**What gets in the way.**

- [Hierarchy] On an empty workspace the ladder card, two install cards and an eight row agent picker sit above "Waiting on you", so the five blocks start more than a screen down; and the first steps offered compete: "Do this next", three commands, eight agent rows, "Pair your phone", "Add a server", "Link the first one" and "Connect a system". user-flows asks for one primary step.
- [Hierarchy] The same question is answered three or four times. Waiting appears as the brief row, the "Asked" note "still waiting on somebody", and the "Approvals waiting" section. Ready to hand over appears as the brief row, the "Autonomy" quick card and the "Could be handed over" panel. Today is a sentence in the brief and four metric rows over a different window.
- [Consistency] One page, three names: "Home" in the nav, "Dashboard" in the tab, "Overview" on the page, and the brief's name "Where things stand" is never visible.
- [Consistency] Team label reads "Claude Code on build-box, Ana's" where the shared shape is "Claude Code on build-box, from Ana's team".
- [Consistency] "Your team" is drawn only when a rule waits, so on most team days it vanishes, and the member count the route sends is dropped.
- [Consistency] Two windows on one page: the brief's "Today" and the analytics default "7 days", with no label telling them apart.
- [Consistency] "Today" links to "What was caught" while the same counts in the band link to "Open the record"; "Recents" has no link at all.
- [Proximity] "Waiting on you" only says how many and links "Open". The answer words ("Allow once", "Allow for this session", "Deny") live a page away, so the block that should be the fastest is a hop.
- [Contrast] The only red and amber on the page belong to history ("Denied", "Asked", "Let through anyway" plots and pills), while a waiting question gets a grey link. The accent goes to the past rather than to what is waiting.
- [Accessibility] The empty reading is a long dash glyph that a screen reader announces as punctuation; "⌘K" is shown to people on Linux and Windows; the "silent", "unasked" and "watch" pills lean on colour beside words that are themselves jargon.
- [Accessibility] Errors read as good news: a failed approvals or findings read prints "Nothing is waiting on a person" or "Nothing outstanding".
- [Progressive disclosure] Percent confidence bars and percent movement arrows on a product that promises counts never scores.
- [Alignment] The loading skeleton has no slot for the ladder, install panel or brief, so the page jumps twice after first paint, against the view's own stated intent.
- [Consistency] The no workspace notice talks about "Memory" on Home, and the "Sources" quick card leads to `/sources`, a page with no row in the nav.

**Improved.**

```
Home                                                    Acme · Ana
─────────────────────────────────────────────────────────────────────
Where things stand
What your agents may do, what they did, and what waits on you.

┌ Waiting on you ─────────────────────────────────────────── accent ┐
│ 2 things are waiting on you · 1 more for your team               │
│ Claude Code on build-box wants to push to main                   │
│ Rule: pushes to main ask first                     waiting 4 min │
│ [ Allow once ]  [ Allow for this session ]  [ Deny ]   More ▾    │
│ and 1 more                                         Open all  >   │
├ Working now ──────────────────────────────────────────────────────┤
│ Claude Code on build-box · fixing the billing test               │
│ Hermes on build-box, from Ana's team · nightly import            │
│                                                       Agents  >   │
├ Today ────────────────────────────────────────────────────────────┤
│ 41 actions, 6 asked you, 5 allowed, 1 refused    Open the record >│
├ Ready to hand over ───────────────────────────────────────────────┤
│ You have said yes to git.push 6 times for Claude Code on         │
│ build-box. Let it run on its own?                                │
│ Proposed, never granted: a second admin approves it.             │
│                                                Propose a rule  >  │
├ Not covered ──────────────────────────────────────────────────────┤
│ 1 server has stopped reporting                       See which >  │
│ 3 MCP servers run with no rule in front of them    Review them >  │
├ Your team ────────────────────────────────────────────────────────┤
│ 4 people · 1 rule waits on a second admin · 1 question waits      │
│                                                         Review >  │
└───────────────────────────────────────────────────────────────────┘

The last 7 days        [24 hours] [7 days] [30 days]  Custom  ↻
┌ Governed actions  312   ▁▂▃▅▃▂▆   Open the record              ┐
┌ Denied              9   ▁ ▁  ▂                                  ┐
┌ Asked              38   2 still waiting                         ┐
┌ Let through anyway  4   rules said stop, machine was watching   ┐

To confirm (3)                              Machines   2 of 3 reporting
[ card ] [ card ]                           What was caught   1 high
                                            Connected systems 2 reading
```

Empty workspace, chosen from onboarding ("Workstation" picked):

```
Home
Nothing is governed yet. One command on the machine your agent
runs on, and this fills in.

┌ Do this next ─────────────────────────────────────────────────────┐
│ Install Memnox on this computer                                  │
│ $ npm install -g memnox        [Copy]                            │
│ $ memnox login                 [Copy]                            │
│ $ memnox setup                 [Copy]                            │
│ Then this page lists your agents.   Other ways in: a server,     │
│ the Mac app, a hosted agent over MCP  ▾                          │
└───────────────────────────────────────────────────────────────────┘
Waiting on you    Nothing is waiting on you.
Working now       No agent is working right now.
Today             Nothing was recorded today.
Ready to hand over  Fills in as you say yes to the same thing.
Not covered       Nothing is enrolled, so nothing is covered yet.
```

- One name, "Home", in the nav, tab and page, with "Where things stand" as the visible heading, because three names read as three pages.
- The five blocks first and always, then "Your team" with the member count every day on a team, because the shared shape is only a shape if it never moves.
- The oldest waiting question is answered in place with the three answer words, a yes signed by passkey and a no free, and the waiting block is the only accent on the page, because the person's work comes before the record.
- One "Do this next" card on an empty workspace, chosen from the onboarding answer, with the other ways in folded under it; the eight agent rows move into the drawer, because one first step beats nine.
- Remove the duplicates: the "Autonomy" quick card, "Could be handed over" panel and "Approvals waiting" section fold into the blocks they repeat; the quick row keeps only "Recents" as "Latest decisions" with a link to the record.
- Every block that cannot read says so ("Could not read the approvals. Retry"), using the existing `RuntimeDownNotice`, because an error must never look like a quiet day.
- The window is named above the band ("The last 7 days") so it cannot be confused with "Today"; Today links to the record like the band does.
- Agent labels read "<agent> on <machine>, from <person>'s team".
- Show "Not counted" in place of the dash glyph, show `Ctrl K` off a Mac, drop percent confidence bars for "seen in 4 threads", and draw the skeleton with the brief's five rows in place.

---

### Agent setup drawer

`components/dashboard/agent-setup-drawer.tsx` · reached from: any row in "Which agents are you running?" or the "Hermes" and "OpenClaw" buttons under "Hosted, over MCP", on Home while nothing is enrolled.

**Job.** Exactly what do I run, and where, to put this one agent behind Memnox?

**Today.** A right hand drawer labelled "Set up {agent}". Header: the agent mark, its name and tagline (for example "Long-running autonomous worker, usually a container on a server."). For Hermes and OpenClaw a tab strip "How to connect" with "On the machine" (note "Interposed") and "Hosted, over MCP" (note "Advisory"); the first is selected.

- **On the machine.** "Three commands. {agent}'s tool calls, MCP servers and shell commands then meet your rules, watching until you turn on enforce." A tinted bar "Or hand them to {agent} as one prompt." with primary "Copy prompt" (copies a numbered prompt that runs `memnox setup --yes` and says "Step 2 prints a code for me to approve: show it to me and wait until I say it is approved."). Then a numbered rail: 1 "Install it", "Once per machine.", `npm install -g memnox`; 2 "Connect this machine", "Approve the code it prints. This is the one step that talks to the workspace.", `memnox login` (with `--url` off the default cloud); 3 "Put it under Memnox", "Say yes to {agent}. Its tool calls, MCP servers and shell commands then meet your rules, watching rather than stopping until you turn on enforce.", `memnox setup`. Each command line has its own copy control.
- **Hosted, over MCP.** "Two minutes, no install. {agent} reads your rules before it acts, can **stop and ask a person** instead of guessing, and records everything it did in your ledger." and "It only covers what {agent} asks about. Where you can reach the host, the runtime there covers everything instead." Steps: "1. Create the connection" ("Give it a name, and you get the finished config with its token in it. It is shown once, so copy it then.") with primary "Create the connection", which opens the Connect a hosted agent dialog; "2. Paste it into {agent}" with where it goes (for example "~/.hermes/config.yaml, under mcp_servers."); "3. Reload its tools" with a command (`/reload-mcp`, `openclaw gateway restart`) and "{agent} should now list tools beginning `memnox_`, and it shows up under Machines."

Close with the drawer's close control or Escape. No network call except from the dialog in step 1. No state for "it worked": the drawer never learns that the machine enrolled.

**What gets in the way.**

- [Progressive disclosure] The drawer repeats the three commands Home already shows above it, so a person reads the same instruction twice before choosing an agent.
- [Hierarchy] "Copy prompt" is the primary button on a page whose safe path is three commands the person runs; handing setup to the agent being governed is the bolder act and it looks like the default.
- [Proximity] Nothing confirms success here: after `memnox setup` the person must close the drawer and look for the machine elsewhere.
- [Consistency] The tab says "On the machine" while Home says "On a machine you control", for the same path.

**Improved.**

```
┌ Set up Hermes ────────────────────────────────────────── ✕ ┐
│ Hermes  Long-running autonomous worker, usually a container │
│ [ On the machine · Interposed ] [ Hosted, over MCP · Advisory ]
│                                                              │
│ 1  Install it                 $ npm install -g memnox  Copy  │
│ 2  Connect this machine       $ memnox login           Copy  │
│    Approve the code it prints.                               │
│ 3  Put it under Memnox        $ memnox setup           Copy  │
│                                                              │
│ ○ Waiting for build-box to report…                           │
│ ✓ build-box joined. Hermes on build-box is watching.  Open > │
│                                                              │
│ Rather let Hermes run these?  Copy as a prompt               │
└──────────────────────────────────────────────────────────────┘
```

- Live confirmation by watching the machines list the drawer already has access to, so the person sees "Hermes on build-box" without leaving.
- The three commands are primary and the prompt is a secondary link, because the person should run their own login.
- Tab words match Home: "On a machine you control" and "Hosted, over MCP".

---

### Connect a hosted agent dialog

`components/machines/connect-remote-agent.tsx` · reached from: "Create the connection" in the Agent setup drawer's "Hosted, over MCP" tab (also from Machines, covered there).

**Job.** Give this hosted agent a token and the exact config to paste.

**Today.** Opened from Home it starts with the agent and path already chosen, so it skips "Which agent are you connecting?" and "How can you reach the host running {agent}?". Step "Name this connection" ("How it appears in your fleet and in the ledger. Name it after the server it runs on.") with a name field and "Create connection" (busy "Creating"). A refusal shows "That connection was not created." or the API's reason. On success, "Paste this into {agent}" shows the finished config block (`AgentConfigBlock`) with the token written in, "Add it to {where}, keeping what is already there.", a copy button, "Then reload:" and the reload command. The token is shown once.

**What gets in the way.**

- [Hierarchy] A dialog opened over a drawer over Home is three layers; closing the dialog leaves the person in the drawer's step 2 with no sign that step 1 is done.
- [Accessibility] The once only token has no warning beside the copy button itself, only in the drawer text behind the dialog.

**Improved.** Keep it one layer: run the name field and the config block inside the drawer's step 1, tick step 1 when created, and put "Shown once. Copy it now." beside the copy button.

---

### Window picker

`components/dashboard/home/range-picker.tsx` · reached from: the "Custom" button beside the window tabs on Home.

**Job.** Read the counts over a window I choose.

**Today.** A popover dialog "Choose the window": a text field "Custom range" with placeholder "Custom range: 3h, 45m, 7 days" (Enter applies), a month grid with "Previous month" and "Next month" and day initials "Su" to "Sa", a list of presets "Last 30 minutes", "Last 1 hour", "Last 6 hours", "Last 12 hours", "Last 24 hours", "Last 7 days", "Last 30 days", "Start" and "End" stamps, the reader's time zone, and primary "Apply". Choosing a preset applies at once.

**What gets in the way.**

- [Consistency] Presets apply on click while a typed or drawn window needs "Apply" or Enter, so the same panel has two commit rules.
- [Progressive disclosure] Seven presets, a free text field, a calendar and two stamps for a band whose readings come from at most 500 rows, so most long windows end in "The most recent in the window".

**Improved.** Keep the three tabs, and behind "Custom" only the calendar with "Apply"; say how many rows the window holds ("312 actions, all counted") so a cut window is never silent.

---

## Fleet

The first group in the sidebar, because nothing under Govern decides anything until a runtime
has enrolled. Three rows: "Machines", "Agents", "Map". None of the three pages polls on a timer
(`useMachines` and `useFleet` are plain workspace queries), so a list changes when the browser
tab regains focus or the page is reloaded, except the live sections of one agent's page, which
stream.

### Machines

`/machines` (`components/machines/machines-view.tsx`) · reached from: sidebar Fleet > "Machines";
the home's "Add a server" (`/machines#add-server`); the "Revoke it on Machines" link on an
advisory agent's page; the hint inside the Freeze and Enforce everywhere dialogs.

**Job.** Which machines hold a credential from this workspace, is each one reporting, and what
is each one actually doing with a verdict?

**Today.**

Header: title "Machines", description "Every runtime enrolled here. Each pulls the rules and
applies them where the action happens, so this is what is actually governed." Beside the title,
once any host is listed, a pill "<live> of <total> reporting", green when at least one reports
and red when none do. Only hosts are counted; agents enrolled from a laptop are not rows here.

Table, four columns:

1. "Machine" (`MachineRow`). A status dot (green live, amber quiet, grey revoked; colour only,
   `aria-hidden`). Then the label a person typed, with a small copy icon ("Copy this machine's
   id"), or, for an unnamed machine, the first eight characters of its id as a dotted underlined
   button that copies the whole id (screen reader: "Copy the full id of machine <id>", then
   "Full id copied"). Chips after the name: "over MCP" for an advisory connection; "Server" or
   "Workstation" from the machine class; for a server in an open outage, an amber chip
   "Quiet since <when>". Second line: "Revoked <when>", or "Never reported", or "Last heard
   <when>", followed by " · runtime <version>", " · asks Memnox; not in the path of what it
   does" for MCP, and " · <n> agents, revoked with it" (or "1 agent") when agents were enrolled
   from it.
2. "Rules applied", 9rem wide: "none yet", or the first twelve characters of the applied bundle
   hash in monospace.
3. "Mode", 17rem wide (`MachineModeCell`):
   - MCP connection: a neutral pill "advisory", no control.
   - Not an admin, or revoked: a read only pill of the running mode, green "enforcing", red "not
     governing", amber "watching only" or "advising only", and "<mode> asked" beside it while
     the asked mode differs from what the machine reports.
   - Admin: the mode menu (see "Mode menu" below).
4. Unlabelled action column, admin only: red text button "Revoke" on a live row, which revokes
   at once with no confirmation; on a revoked row, grey "Remove", which deletes the row from the
   listing.

Under the table, one reserved live line in red for a refusal: "That machine was not revoked.",
"That row was not removed, so it is still listed." or "That machine's mode was not changed, so
it is still running what it was." A change that worked has no confirmation line; the row's
"<mode> asked" note is the confirmation.

Section "Add a server" (admin only, anchor `#add-server`): heading "Add a server", body "For a
machine you reach over SSH rather than sit at: a VPS, a CI runner, a box that runs overnight.
You get one command to run on it, and it joins with no browser.", primary button "+ Add a
server" (opens the Add a server dialog). When unused join commands exist, a sub heading
"Waiting to be used" and a table: "Name" (label or "Not named"), "Kind" ("Server" or
"Workstation"), "Made by", "Works for" ("<time> left" or "Expired"), and a red "Revoke" button
that reads "Revoking" while busy. Failures: "The commands waiting to be used could not be read."
and "That command was not revoked, so it still works until it expires."

Install panel (`AgentInstall`, shown to everyone):

- Card "On a machine you control" with a badge "Interposed": "A laptop, a VPS, a CI runner. The
  runtime sits in the path of every tool call and credential, so no agent goes around it." Three
  copyable command lines: `npm install -g memnox`, `memnox login`, `memnox setup`. Footer: "One
  pass covers every client on the machine. Nothing to run per agent."
- Card "Hosted, over MCP" with a grey badge "Advisory": "For an agent running somewhere you
  cannot install into. It is governed only to the extent it asks, so use the runtime wherever
  you can reach the host." A row of product buttons (Hermes, OpenClaw and the others that offer
  MCP), each opening the setup drawer.
- Card "Which agents are you running?": "These are the products Memnox can put itself in front
  of today. Pick one for the exact sequence and where its config lives." A two column list of
  products ("Claude Code", "Cursor", "Codex CLI", "Claude Desktop", "Cline", "Hermes",
  "OpenClaw", "Ruflo"), each with its one line promise (for example "Every tool call and every
  command checked before it runs.") and an "or hosted" chip where both paths exist. A row opens
  the setup drawer.

Setup drawer (`AgentSetupDrawer`), labelled "Set up <product>": product mark, name and tagline.
Where both paths exist, a tab strip "On the machine" ("Interposed") and "Hosted, over MCP"
("Advisory"), the runtime tab first.

- On the machine: "Three commands. <product>'s tool calls, MCP servers and shell commands then
  meet your rules, watching until you turn on enforce." A box "Or hand them to <product> as one
  prompt." with a primary "Copy prompt". Numbered steps: "1 Install it", "Once per machine.",
  `npm install -g memnox`; "2 Connect this machine", "Approve the code it prints. This is the one
  step that talks to the workspace.", `memnox login` (with `--url` where the console knows its
  API); "3 Put it under Memnox", "Say yes to <product>. Its tool calls, MCP servers and shell
  commands then meet your rules, watching rather than stopping until you turn on enforce.",
  `memnox setup`.
- Hosted, over MCP: "Two minutes, no install. <product> reads your rules before it acts, can
  **stop and ask a person** instead of guessing, and records everything it did in your ledger."
  then "It only covers what <product> asks about. Where you can reach the host, the runtime there
  covers everything instead." Steps "1. Create the connection" with button "Create the
  connection" (opens Connect a remote agent at its naming step), "2. Paste it into <product>"
  with where its config lives (for Hermes "~/.hermes/config.yaml, under mcp_servers"), "3. Reload
  its tools" with the reload command (for Hermes `/reload-mcp`) and "<product> should now list
  tools beginning `memnox_`, and it shows up under Machines."

Foot note: "Click an id to copy it. Memnox never keeps a machine's hostname, so a machine shows
the name you gave it or its id. Revoking cuts a machine off for good; `memnox logout` only signs
it out on the machine itself, so a lost laptop is cut off here."

States:

- Loading: a three row table skeleton; the add server section and install panel are not drawn
  until the list arrives.
- Empty: icon and title "Nothing is enrolled", body "No runtime has enrolled, so no verdict is
  being reached anywhere. A connector gives Memnox evidence to read; a runtime holds an agent to
  it." The install panel follows, far below the fold of the empty table.
- Error reading machines: nothing distinguishes it. `machines.data` is undefined, so the table
  draws the same "Nothing is enrolled" empty state.
- Not an admin: no "Revoke" or "Remove", a read only mode pill, no "Add a server" section. The
  install panel stays.
- Older machine: a runtime that never reports `modeApplied` shows only the asked mode with no
  "asked" note, and "Rules applied" stays "none yet".
- Offline: no banner; mutations fail into the reserved refusal line.

**What gets in the way.**

- [Hierarchy] "Revoke" fires on one click with no confirmation, although the foot note says it
  "cuts a machine off for good" and the row says its agents are "revoked with it". The single
  most destructive act in Fleet is the lightest control on the page.
- [Hierarchy] On an empty workspace the first thing on screen is an empty table, then a section
  only admins see, then three install cards that all say "connect" in different words. The one
  next step is not the largest thing.
- [Consistency] Two install commands for one thing: the dialog says `npm i -g memnox`, the
  install cards say `npm install -g memnox`. Two enrol stories: the cards use `memnox login`
  then `memnox setup`; Connect a remote agent uses `npx memnox login --url`, `npx memnox agents
discover`, `npx memnox agents onboard`.
- [Consistency] The mode is said three ways across Fleet: "watching only" here, the raw wire
  word "observe" on the Map card ("observe asked, enforce running"), and "watching until you turn
  on enforce" in the setup drawer.
- [Progressive disclosure] "Rules applied" shows a twelve character hash. Nobody can act on a
  hash; the question is whether the machine runs the rules in force now, which the Map card
  already answers as "pulled and applied".
- [Contrast] "watching only", "advising only" and the quiet dot all use the same amber, so a
  machine that is fine but observing and one that has gone silent look alike at a glance.
- [Accessibility] The live, quiet and revoked dot is colour only, and for a workstation nothing
  in words says it is quiet (only servers get "Quiet since").
- [Accessibility] An error and an empty fleet render identically, so a failed read tells an
  admin they have no machines.
- [Proximity] The page does not refresh while open, so after "Get the command" a server that
  joins never appears until the tab is refocused, and "enforcing asked" never turns into
  "enforcing" while somebody watches it.

**Improved.**

```
Machines                                                   3 of 4 reporting
Every runtime enrolled here. Each pulls the rules and applies them where
the action happens.                                         [ + Add a server ]

Machine                                   Rules          Mode
● build-box  Server  [⧉]                  current        [ enforcing ▾ ]        [ Revoke… ]
  Last heard 1 min ago · runtime 0.14.2 · 1 agent, revoked with it
● Maya's Mac  Workstation  [⧉]            current        [ watching only ▾ ]    [ Revoke… ]
  Last heard 3 min ago · runtime 0.14.2 · 2 agents, revoked with it
◐ ci-runner  Server  Quiet since 2:14 am  2 versions     [ enforcing ▾ ]        [ Revoke… ]
  Last heard 6 h ago · runtime 0.13.8                    behind
○ hermes-vps  over MCP  [⧉]               n/a            advisory               [ Revoke… ]
  Asks Memnox; not in the path of what it does

Waiting to be used
Name        Kind     Made by   Works for
gpu-box     Server   Ana       42:10 left      [ Revoke ]

──────────────────────────────────────────────────────────────────
Put another machine under Memnox
On a machine you control (Interposed)        Hosted, over MCP (Advisory)
npm i -g memnox                               Pick the product: [Hermes] [OpenClaw]
memnox login
memnox setup
```

Revoke confirmation:

```
┌ Revoke build-box? ─────────────────────────────────────┐
│ It stops pulling rules now and cannot rejoin with this │
│ credential. 1 agent goes with it: Hermes on build-box. │
│                                                        │
│ [ Cancel ]                       [ Revoke build-box ]  │
└────────────────────────────────────────────────────────┘
```

Empty state, with one primary step chosen from what onboarding said the person owns:

```
Nothing is enrolled yet
No runtime has enrolled, so no verdict is being reached anywhere.

[ Add a server ]   or on this computer:  npm i -g memnox  ·  memnox login  ·  memnox setup
```

- Confirm before "Revoke", naming the agents that go with it as "<agent> on <machine>", because
  it cannot be undone and the page itself says so.
- "+ Add a server" moves into the header beside the count, so it is the first action on the page
  for an admin rather than a section below the table.
- "Rules applied" says "current" or "<n> versions behind" from the hash compared with the bundle
  in force, and keeps the hash in a tooltip.
- A hollow dot plus the word "Quiet" for any machine past the quiet threshold, servers and
  workstations both, so state never rides on colour alone.
- One install line everywhere (`npm i -g memnox`) and one mode vocabulary ("not governing",
  "watching only", "advising only", "enforcing") on Machines, Map and the drawer.
- Poll `/machines` every 15 seconds while the page is open, and stop when it is hidden, so a join
  and an "asked" mode settle in front of the person.
- An error reads "Machines could not be read. Nothing has changed on them." with "Try again",
  never the empty state.

### Add a server

Dialog (`components/machines/add-server-dialog.tsx`) · reached from: Machines > "+ Add a
server"; the home's "Add a server".

**Job.** Give me one command that joins a machine I reach over SSH, with no browser on it.

**Today.**

Step one, dialog with a server icon. Title "Add a server", description "Name it, and you get one
command to run on it. The server joins this workspace under the same rules as everything else
here."

- Field "What to call it", placeholder "build-box", autofocused, up to 80 characters, optional.
- Fieldset "What it is", two radio cards: "Server", "Always on. You are told when it stops
  reporting." (default) and "Workstation", "Somebody's machine. Asleep is not an outage."
- Footer primary "Get the command", reading "Making it" while the token is minted.
- Failure line: "No command was made, so nothing can join with one."

Step two, title "Run this on the server", wider dialog:

- A red bordered warning: "Copy it now. It is shown once and it works once; if it is lost,
  revoke it and make another."
- "Install Memnox, if it is not there yet" with `npm i -g memnox` and a copy button.
- "Join this workspace" with the command the cloud sent (or `memnox login --token <token>`) and a
  copy button (screen reader "Copy: Join this workspace").
- A countdown "Works for <time> more." which turns red as "This command has expired. Close this
  and make another." and blanks the command.
- Footer "Done". Closing resets the mutation so nothing keeps the token; the command then shows
  under "Waiting to be used" by name and expiry only.

States: no workspace yet disables "Get the command"; offline or a refusal shows the failure line.
Not offered to anyone who is not an admin.

**What gets in the way.**

- [Progressive disclosure] Nothing after "Done" says what comes next on the server. The user flow
  has a third line, `memnox setup`, which is what puts Hermes under Memnox; the dialog stops at
  joining, so the server enrols and its agent stays ungoverned.
- [Proximity] The dialog closes before the server joins and nothing in it waits for the join, so
  the person has to go back to the table, which does not refresh, to learn whether it worked.
- [Consistency] "Run this on the server" is also the title when "Workstation" was chosen.
- [Contrast] The "shown once" warning uses the destructive red, the same colour as a failure,
  for what is ordinary guidance.

**Improved.**

```
┌ Run this on build-box ────────────────────────────────────────┐
│ Copy it now. It works once, for 59:12 more.                   │
│                                                               │
│ 1  Install Memnox, if it is not there yet                     │
│    npm i -g memnox                                    [ Copy ]│
│ 2  Join this workspace                                        │
│    memnox login --token mjt_…                         [ Copy ]│
│ 3  Put its agents under Memnox                                │
│    memnox setup                                       [ Copy ]│
│                                                               │
│ ◌ Waiting for build-box to join…                              │
│   (turns into ● build-box joined. Hermes found.)              │
│                                                  [ Done ]     │
└───────────────────────────────────────────────────────────────┘
```

- The machine's own name in the title, and "on the workstation" wording for the other class.
- A third step, `memnox setup`, because joining without it governs nothing.
- The dialog polls `/machines` and the join tokens while open and says "build-box joined" the
  moment the token is used, so success is seen where the person is looking.
- The once only note in the neutral callout style; red is kept for expiry.

### Connect a remote agent

Dialog sequence (`components/machines/connect-remote-agent.tsx`) · reached from: the setup
drawer's "Create the connection" (Machines install panel and the home's setup drawer).

**Job.** Put an agent that runs on a host I may not control under Memnox, and tell me how much of
it that covers.

**Today.**

A stepped dialog with a progress bar.

1. "Which agent are you connecting?", "The one running on the server. Everything after this is
   written for the product you pick." A grid of products.
2. "How can you reach the host running <product>?", "This decides how much of what the agent
   does is covered, so it is the one choice worth making deliberately." Two cards: "I can run
   commands on it", a green badge, "Install the Memnox runtime on the server. Its seams sit in
   <product>'s path, so every action is covered rather than only the declared ones." and, where
   the product supports it, "I cannot install into it", an amber badge, "A managed runner, or a
   container you do not control. Paste a URL and a token into <product>'s settings; what it does
   without asking is not covered." Footer "Back".
3. Runtime path: "Install the runtime alongside <product>", "Run these on the server, in this
   order. It dials out to Memnox, so no port has to be opened." Three numbered runs, each with a
   green tick "you should see" line: "Connect the host to this workspace", `npx memnox login
--url <api>`, "A short code in the terminal. Approve it here and the host is enrolled."; "Report
   what is running there", `npx memnox agents discover`, "<product> appears on the Agents page,
   and anything else on that host with it."; "Put <product> behind the gate", `npx memnox agents
onboard <id>`, "Its config is backed up first, then rewritten. Its page here starts saying
   interposed." A note: "A server has no browser, so step 1 prints a code instead of opening one.
   Approve it on the device page, which shows what is being granted before you grant it. To look
   at a host before enrolling it, `<scan command>` reads it and sends nothing." Footer "Back",
   "Done".
4. MCP path: "Name this connection", "How it appears in your fleet and in the ledger. Name it
   after the server it runs on." Field "What to call it", placeholder "<product id>-vps". Footer
   "Back", "Create connection" ("Creating"), disabled until a name is typed. Failure "That
   connection was not created."
5. Issued: "Paste this into <product>", red callout "Copy it now. It is shown once; if it is lost,
   create a new connection.", the finished config block with URL and token, and where the
   browser's own address is local: "That is the address this browser reaches Memnox on, and a
   server elsewhere will not reach it. Set this deployment's public address so the URL is the one
   your agents can use, and paste that host in place of `<host>` meanwhile." Then "<product>
   should then list tools beginning `memnox_`, and it shows up under Machines once it calls one."
   Footer "Done".

**What gets in the way.**

- [Consistency] The runtime path here is a different three commands, all through `npx`, from the
  setup drawer's `npm install`, `memnox login`, `memnox setup` for the very same act.
- [Proximity] Step 3 says "Approve it here", but the approval happens on `/device`, linked only
  in the note at the bottom.
- [Hierarchy] When the drawer's "Create the connection" opens this dialog it starts on the naming
  step, so the deliberate choice in step 2 is skipped for exactly the people the drawer already
  steered to the weaker path.

**Improved.**

- One runtime sequence across the console: `npm i -g memnox`, `memnox login`, `memnox setup`,
  with the "you should see" line kept under each.
- "Approve the code at console/device" sits on step 1 itself, as a link with the code format
  ("Your code looks like ABCD-EFGH").
- The issued step ends with the same "Waiting for <name> to call Memnox…" line as Add a server,
  flipping to "hermes-vps called Memnox" when the first MCP call lands.

### Mode menu

Popover (`components/machines/machine-mode-menu.tsx`) · reached from: the "Mode" cell on
Machines, admins only.

**Job.** Move one machine along the ramp from not governing to enforcing, knowing what each rung
costs.

**Today.** The trigger is a pill with a dot, the running word and a chevron, drawn at the width
of the longest word (screen reader "Mode for machine <id8>, <word>"). Beside it, a note
"<word> asked" that holds its space invisibly when there is nothing to say. The portalled menu,
300px wide, is titled "What this machine does with a verdict" and lists four radio items, the
asked one ticked and focused:

- "not governing": "Nothing is evaluated and nothing is recorded here."
- "watching only": "Every rule is matched and the verdict recorded. Nothing an agent does is
  stopped."
- "advising only": "The agent is told what the verdict was and carries on regardless."
- "enforcing": "Denials stop the action and asks wait for an answer. Read a week of watching
  first."

Footer: "The machine applies a change on its next heartbeat, about a minute. Until it reports
back this row says asked." Picking a different rung closes the menu and saves at once; the
trigger dims while saving. Escape, a click outside, scroll or resize close it.

**What gets in the way.**

- [Hierarchy] Moving to "not governing" is one click with no confirmation, which turns off
  governance and recording on that machine.
- [Proximity] "Read a week of watching first" names evidence the menu does not show; how many
  times the rules would have refused in the last week is not on the page.
- [Contrast] "watching only" and "advising only" share one amber with no other difference.

**Improved.**

```
What build-box does with a verdict
  ○ not governing    Nothing is evaluated and nothing is recorded here.
  ● watching only    Every rule is matched and recorded. Nothing is stopped.
                     Last 7 days: 212 matched, 4 would have been refused, 9 would have asked.
  ○ advising only    The agent is told the verdict and carries on.
  ○ enforcing        Denials stop the action and asks wait for an answer.
──────────────────────────────────────────────
Applied on its next heartbeat, about a minute.
```

- Show the week of would have counts under "watching only" from the ledger, so the advice to read
  a week first is answered in place.
- Choosing "not governing" opens a small confirm: "Stop governing build-box? Nothing it does will
  be evaluated or recorded."
- Give each rung its own glyph (open circle, eye, speech mark, shield) beside the colour.

### Enforce everywhere

Button and confirm (`components/machines/enforce-everywhere.tsx`) · reached from: an open
incident's detail; not on Machines itself.

**Job.** Contain an incident by moving every active machine to enforce at once.

**Today.** Admin only. Bordered button with a shield "Enforce everywhere" (label overridable),
"Moving machines" while busy. It opens a confirm: title "Enforce on every machine", description
"Every active machine on your team moves to enforce, so the rules refuse what they deny rather
than only recording it.", body "Each machine applies it at its next heartbeat, about a minute.
You can move any of them back one at a time from Machines.", confirm "Enforce everywhere". After:
"<moved> moved to enforce, <alreadyEnforcing> already were. Each applies it at its next
heartbeat." or, in red, "No machine was moved to enforce."

**What gets in the way.**

- [Proximity] The confirm does not say how many machines will move or which are only watching, so
  the person cannot see the blast radius before pressing.
- [Consistency] The fleet wide brake exists only inside an incident, while the page that lists
  the machines has none.

**Improved.** The confirm reads "3 machines move to enforcing: Maya's Mac, ci-runner, gpu-box. 1
already enforces." Machines gets the same button in its header beside "+ Add a server", shown
only while at least one live machine is below enforcing.

### Agents

`/fleet` (`components/agents/fleet-view.tsx`) · reached from: sidebar Fleet > "Agents"; "All
agents" on an agent's page.

**Job.** Which agents does this workspace know about, how does each reach Memnox, and which ones
still need somebody to accept them?

**Today.**

Header: title "Agents", description "Every agent holding a credential from this workspace, or
seen running on a machine here. What each may do is decided by the rules its machine pulled."
Pill, once any agent exists: red "<n> to approve", else amber "<n> not onboarded", else green
"all approved".

Census band, only where a directory census was pushed and counts are above zero: "<governed>
governed, of <total> this workspace knows about." then four counts: "Interposed", "Seams in the
path, and nothing skips them."; "Advisory", "Asks over MCP. Governed while it keeps asking."
(amber when above zero); "Silent", "Holds one, silent a week." (amber); "Ungoverned", "Nothing
here decides for it." (red when above zero).

Table:

1. "Agent": the product mark (or its initial), the agent's name as a link to `/fleet/<id>`, and
   under it the product kind and version, or "agent".
2. "Reaches Memnox": pill "through a runtime", "by asking, over MCP" (blue) or "not through us".
3. "Runs on": the machine's label or short id, or a bare dash character.
4. "Owners": comma separated names, a tooltip with each basis ("assigned", "owns its machine"),
   or "nobody yet".
5. "Last seen": relative time, or a bare dash character.
6. "Standing", right aligned: "revoked", "approved", "enrolled, not approved", "not onboarded",
   "left alone on its machine" or "nobody approved this". For an admin, where the ledger knows the
   agent and it needs approval, a primary "Approve" beside it (tooltip "Records that your team
   runs this agent on purpose. It grants nothing."), showing "…" while saving.

Foot note under a populated table: "Enrolling an agent is not approving it. The credential is cut
on the machine's own authority, because a person already approved that machine; accepting the
agent into the estate is their act, here or in chat. An agent left alone was offered on its
machine and refused there, so it is listed as part of the estate and not as a question. The map
draws which machine each of these hangs off."

States: loading, a four row skeleton; empty, "No agent yet", "Agents appear once one is put under
Memnox from the machine it runs on, or once a machine reports what ran there. Memnox does not go
looking for them."; error, indistinguishable from empty; approve failure, silent (no refusal line
on this page); not an admin, no "Approve" buttons.

**What gets in the way.**

- [Consistency] The shared label is "<agent> on <machine>", but here the name and the machine sit
  in separate columns, so the same Claude Code on two laptops reads as two identical "Claude
  Code" rows until the eye crosses to "Runs on".
- [Hierarchy] The red pill counts agents to approve, but the rows are not ordered by it; the
  agents needing a decision are scattered through the list.
- [Consistency] One standing has three names: "enrolled, not approved" here, "waiting on you" on
  the Map card and "not approved" in the agent header. "nobody approved this" here is "nothing
  governs it" on the Map.
- [Accessibility] "Approve" shows "…" while busy, which a screen reader reads as nothing, and a
  failed approve says nothing at all.
- [Progressive disclosure] The foot note is a five line paragraph explaining the model, shown to
  every visitor on every visit, under the table where it explains nothing in time.
- [Accessibility] An error reading the fleet tells the person they have no agents.

**Improved.**

```
Agents                                                        2 to approve
Every agent this workspace knows about. What each may do is decided by the
rules its machine pulled.

Needs a decision
[CC] Claude Code on ci-runner        through a runtime   nobody yet   2 min ago
     enrolled, not approved                                         [ Approve ]
[Cx] Codex on lin-laptop             through a runtime   Lin          now
     enrolled, not approved                                         [ Approve ]

Everything else
[CC] Claude Code on Maya's Mac       through a runtime   Maya         now        approved
[Cu] Cursor on Maya's Mac            through a runtime   Maya         1 h ago    approved
[He] Hermes on build-box, from Ana's team
                                     by asking, over MCP Ana          5 min ago  approved
[OC] OpenClaw on build-box           not through us      nobody yet   3 d ago    not onboarded
     Put it under Memnox: memnox agents onboard openclaw              [ Copy ]

Enrolling is not approving. Approving records that your team runs it on purpose. (Why?)
```

- Every row reads "<agent> on <machine>", plus "from <person>'s team" when it came through the
  team, so the label matches the inbox, the home and chat.
- A "Needs a decision" group first, because the header count points at it.
- One standing vocabulary across Agents, Map and the agent page: "approved", "enrolled, not
  approved", "not onboarded", "left alone on its machine", "nothing governs it", "revoked".
- "Not onboarded" rows carry their fix inline, the onboard command with a copy button.
- "Approving" as the busy word and a refusal line under the table.
- The model note collapses to one line with "Why?" disclosing the rest.

### Agent detail

`/fleet/[agentId]` (`components/agents/agent-detail.tsx`) · reached from: a row on Agents;
"Everything recorded about it" on the Map card; links from the home and the inbox.

**Job.** What is this agent doing right now, what did it do today, what could it reach, and how do
I stop it or tell it something?

**Today.**

Header (`AgentHeader`): eyebrow "Agent" with a bot glyph; the name as the title (machine label,
else the ledger label, else kind, else the id). One line under it: "On <machine>" or "Not seen on
any machine", " · ", "owned by <names>" or "owned by nobody yet", an admin link "Change", " · ",
and "approved", "left alone on its machine", "not onboarded" or "not approved". Buttons on the
right: "← All agents"; the freeze control; for an unapproved agent that is not declined and not
listed only, a primary "Approve" ("Recording" while busy; tooltip "Records that the team runs this
agent on purpose. It grants nothing.").

"Change" opens an inline owner picker: "Pick up to <max>. Choosing nobody hands it back to whoever
owns its machine.", a scrolling checklist of active members (name, and email where it differs),
disabled once full, a refusal line "Those owners were not saved.", buttons "Save owners"
("Saving") and "Cancel".

Freeze control (`FreezeAgent`), in the header, scoped to the agent on its machine when the host is
known:

- Not frozen, admin: red outlined "Freeze" (or "Freeze everywhere" with no machine). It opens a
  dialog "Freeze <name>" with "It stops on the machine it runs on within about a minute, until
  the time runs out or somebody lifts it." (or "Freeze <name> everywhere", "Every machine stops
  this agent within about a minute, until the time runs out or somebody lifts it."). Field "Why
  (shown to anyone who sees the freeze)", placeholder "Say why", required. "For how long": "1
  hour" (default), "4 hours", "24 hours". Optional "Recorded against <reference>.". Footer
  "Cancel" and a red "Freeze it" ("Freezing"), disabled until a reason is typed. Failure "That
  agent was not frozen."
- Frozen: red pill with a snowflake "frozen until <when>" (or "frozen everywhere until <when>"),
  the reason beside it, and for an admin "Lift" ("Lifting"), which lifts at once. Failure "That
  freeze was not lifted."
- Not an admin and not frozen: nothing.

A failed read: a card with the refusal message, for example "That agent could not be read."

Sections follow, each drawn only when it has something to say:

1. "Waiting on you" (`AgentWaiting`), polled from the inbox: one row per held call for this
   agent, the cloud's summary or the plain action phrase, "Read aloud" (where the browser can
   speak; it reads the question and the reason), and a link "Answer it" to `/inbox`.
2. "Working now" while the session holds leases, else "Working in the last minutes"
   (`WorkingNow`, streamed): "<repository>" or "A repository it did not name", ", started
   <when>", ", last action <when>"; a list headed "Holds" or "Touched" of file paths in
   monospace; and amber collision lines with a warning glyph, such as "Cursor on Maya's Mac is
   also editing src/billing/invoice.ts" or "Another Claude Code session holds src/billing in the
   same repository".
3. "What it did today" (`WhatItDidToday`, streamed): one row per repository ("Outside a named
   repository" when unnamed) with counts such as "12 edits, 40 reads, 6 commands, 1 refusal" or
   "<n> actions"; then notable actions with a plain phrase, the resource in monospace, a pill
   "Refused", "Asked" or "Destructive" and the time; then the link "Every action it took" to the
   record filtered to this agent.
4. "Tell this agent" (`TellAgent`), only for a reviewer, an admin or one of its owners: a hidden
   label "What to tell <name>", a three row textarea with placeholder "finish the migration and
   stop", a primary "Send" ("Sending"), and where the browser supports it "Dictate" ("Listening",
   with a mic glyph), which fills the box and never sends. Note under it: "Recorded with your name
   before the agent is given it. It changes no rule." then after a send "Recorded, and the agent
   reads it at its next step." Failure "That message was not recorded."
5. "What it could reach" (`WhatItCouldReach`): ability lines such as "Run any command you can",
   "Commit and push with your git credentials", "Reach the internet", "Read and write your files",
   "Drive a web browser", "Use 3 MCP servers: github (4 can write), stripe (2 can write, not
   through Memnox), linear"; then groups "Secrets and credentials", "Databases", "Sockets",
   "Network", "Other sensitive", each naming up to four references and "and <n> more".
6. Take it out: for a runtime agent "Take it out:" and `memnox agents offboard <id>`; for one
   nothing governs "Nothing governs it yet. Put it under Memnox:" and the onboard command; for an
   MCP agent "It asks rather than being routed through Memnox." and "Revoke it on Machines".

States: loading, nothing but the page frame until the agent arrives (no skeleton); not found, the
refusal card; a quiet agent, the header, reach and take it out only; stream failed, the live
sections fall back to polling with no notice; no speech support, no "Read aloud" or "Dictate";
not allowed to tell, no "Tell this agent".

**What gets in the way.**

- [Consistency] The title is the agent's name alone and the machine sits in a grey sub line, so
  the page does not say "Claude Code on Maya's Mac", which is how the inbox, the island and chat
  name the same agent.
- [Proximity] "Waiting on you" shows the question and sends the person to `/inbox` to answer it,
  one page away, although the answer words and the passkey step already exist as a held call card.
- [Hierarchy] With nothing waiting and nothing live, the most prominent thing under the header is
  "What it could reach", and "Tell this agent" sits below the day summary, so the page's two acts
  (tell, freeze) are split between the top right corner and the middle.
- [Accessibility] No loading state: the page is blank until the agent arrives, and the live
  sections disappear and reappear as the stream connects, with no word that the view is live or
  that it fell back to polling.
- [Hierarchy] "Lift" acts on one click while "Freeze" asks for a reason; lifting a brake somebody
  else pulled deserves at least the reason it was pulled shown beside the button, which the
  compact header hides.
- [Consistency] The freeze is invisible to a non admin until one exists, so a reviewer who can
  tell the agent to stop cannot see that a harder stop exists or who to ask.
- [Progressive disclosure] An empty agent page has no sentence saying it is quiet; sections simply
  do not render.

**Improved.**

```
← All agents
Claude Code on Maya's Mac                                 [ Freeze ]
owned by Maya (Change) · approved · ● live

Waiting on you (1)
┌─────────────────────────────────────────────────────────────┐
│ Claude Code on Maya's Mac wants to push to main             │
│ Rule: pushes to main ask first                              │
│ [ Deny ]  [ Allow for this session ]  [ Allow once ]  More ▾│
│ [ Read aloud ]                                              │
└─────────────────────────────────────────────────────────────┘

Working now · live
memnox-runtime, started 25 min ago, last action 12 s ago
Holds  packages/core/src/coordination/lease.ts
⚠ Cursor on Maya's Mac is also editing packages/core/src/index.ts

Tell this agent
[ finish the migration and stop                           ]
[ Send ]  [ Dictate ]   Recorded with your name. It changes no rule.

Today
memnox-runtime   41 actions: 12 edits, 22 reads, 6 commands, 1 refusal
git push --force   origin/main   Refused   10:42
Every action it took →

What it could reach
Run any command you can · Commit and push with your git credentials
Secrets and credentials   ~/.aws/credentials, ~/.npmrc and 2 more

Take it out   memnox agents offboard claude-code              [ Copy ]
```

- Title is "<agent> on <machine>", with "from <person>'s team" where it came through the team.
- The held call card answers in place with the shared words ("Allow once", "Allow for this
  session", "Deny", and behind "More" the three always answers for an admin), with the passkey
  asked on a yes and never on a no; after an answer elsewhere the card reads "Allowed once by Ana
  on iPhone."
- "Tell this agent" moves up beside Working now, because telling and freezing are what somebody
  opens this page to do while it works.
- A "live" marker on Working now and "updating every 30 s" when the stream failed, so the person
  knows how fresh the view is.
- A skeleton while loading, and on a quiet day one line: "Quiet today. Nothing waiting, nothing
  running."
- "Lift" shows the reason and who froze it, and asks "Lift the freeze Ana set at 10:42?"; a non
  admin sees "Ask an admin to freeze it" in place of the button.

### Map

`/map` (`components/fleet/fleet-map-view.tsx`) · reached from: sidebar Fleet > "Map"; the "The
map" link in the Agents foot note.

**Job.** What hangs off what: which agents ride on which machine, which are in the path and which
only ask, and what revoking one thing takes with it.

**Today.**

The page fills the frame with no header. A drawing, 3D by default (`SurfaceCanvas3D`), with a
breathing workspace node at the centre (the workspace logo, or Memnox's mark), machine nodes
(drive glyph), agent nodes (the product's mark or initial) and, where connectors exist, smaller
source nodes (the system's logo or a plug). A corner dot on each node is green live, amber quiet,
grey revoked; revoked nodes are faded. Lines: solid for a runtime in the path, dashed for
advisory, dotted and fainter for a system Memnox reads. Each node is a button with its label
under it; hovering or focusing lights its lines and fades unrelated nodes; dragging moves a node;
clicking selects it.

Controls in a corner panel (`CanvasControls`): verbs "Fit" (key F) and "Center" (key C);
readouts with step buttons "Zoom" and "Size" as percentages ("<label> down", "<label> up"); an
action "Flat" (or "Depth" when flat) switching between 3D and 2D; a folding panel "Forces" with
"Repel" ("How far apart the marks push each other"), "Link length" ("How long a line wants to
be") and "Gather" ("How tightly the whole drawing is held in"); a folding "Legend": "A runtime in
the path, which an agent cannot skip", "Advisory: it asks, and one that stops asking is not
governed", and when systems are connected "A system Memnox reads, which governs nothing".

Selecting a node anchors a card (`FleetInspector`) to it, with "Close":

- Workspace: title the organization's name, "this workspace", rows "Credentials" "<n> in force",
  "Agents" "<n> known here", "Waiting on you" "nothing to approve" or "<n> to approve", and a note
  "Everything drawn from here holds something this workspace issued. A solid line is a runtime
  with the seams in the path; a dashed one is an agent that reaches Memnox by asking, and one that
  stops asking is not governed."
- Source: its name, "a system Memnox reads", a note "Connecting a system gives Memnox evidence to
  read. It is never a way for an agent to act in it, and nothing on this line governs anything:
  what an agent may do is decided on the machine it runs on.", and a link "What it reads" to
  `/sources`.
- Machine: its name, "over MCP" or "a runtime", a pill "reporting", "quiet" or "revoked"; for an
  admin a pencil "Rename this machine" that opens an inline field ("What this workspace calls this
  machine") with "Save". Rows "Mode" (the raw mode word, or "<asked> asked, <applied> running"),
  "Rules" ("none pulled yet" or "pulled and applied"), "Last heard" ("revoked <when>", "never
  reported" or a time), "Agents" (names, or "none enrolled from here"), a note "That credential
  goes with this machine: revoking it revokes them in the same act." (plural "Those credentials
  go"), and for an admin a red "Revoke this machine" or, once revoked, "Remove it from the fleet".
- Agent: its name, its kind or "agent", a pill "approved", "waiting on you", "not onboarded",
  "nothing governs it" or "revoked"; rows "Reaches Memnox" ("through a runtime in the path", "by
  asking, over MCP", "not through anything here"), "Runs on" (machine name or "no machine of
  ours"), "Last seen" (time or "nothing recorded yet"). Where nothing governs it: "Nothing here
  decides for it. Put it behind Memnox with `memnox agents onboard` on the machine it runs on."
  Where its machine never reported which agent it is, a how to titled "To approve this one":
  "<machine> has not reported which agent this is, so there is nothing here to accept it against
  yet.", "On that machine, tell Memnox what it is running:" `memnox sync`, "Then approve it here.
  It appears within a minute." Actions for an admin: "Approve this agent" ("Approving"), "Revoke
  its credential" or "Remove it from the fleet"; for everyone the link "Everything recorded about
  it".

A refusal floats over the top of the drawing in red: "That was not revoked.", "That row was not
removed.", "That was not renamed." or "That agent was not approved."

States: loading, a five row table skeleton; empty, "Nothing to draw yet", "This is what holds a
credential from this workspace and what runs on it. Enrol a machine and the shape appears.";
error, falls to the empty state; reduced motion, the ping and pulse stop but the 3D settle and
camera moves still animate.

**What gets in the way.**

- [Hierarchy] "Revoke this machine" and "Revoke its credential" fire on one click from a small
  floating card, the same irreversible act as on Machines, with even less around it.
- [Accessibility] The drawing is the only form of this page. There is no list alternative, the
  3D view is the default, nodes are reachable by Tab only in drawing order, and nothing announces
  what a line between two nodes means to a screen reader.
- [Consistency] The machine card's "Mode" row prints the wire words ("observe", "enforce")
  where Machines says "watching only" and "enforcing"; the agent pill says "waiting on you",
  which across the console means a held question, for an agent that merely needs approving.
- [Consistency] "What it reads" goes to `/sources`, which is not a sidebar row; the nav calls that
  area "Connectors".
- [Progressive disclosure] Six numeric knobs (Zoom, Size, Repel, Link length, Gather, plus Flat)
  sit beside a legend that is folded away, so the one panel that explains the drawing is the one
  closed by default.
- [Accessibility] The live, quiet and revoked dot is colour only on the drawing; the card says it
  in words only after a click.
- [Hierarchy] With no header, nothing on the page says what it answers; a newcomer lands on a
  floating constellation.

**Improved.**

```
Map                                   [ Drawing | List ]   Fit  Center   Legend ▾
What hangs off what. Solid: in the path. Dashed: asks. Dotted: read only.

            ┌──────────┐
            │ Acme     │
            └────┬─────┘
       ┌─────────┼───────────────┐
  [ Maya's Mac ] [ build-box ]  ┄┄ [ hermes-vps ]
     │     │         │                 ┊
  [CC]   [Cu]      [OC]              [He]
 Claude  Cursor   OpenClaw          Hermes
 Code             not onboarded     advisory

┌ build-box ── a runtime · ● reporting ───────────────┐
│ Mode        enforcing                               │
│ Rules       current                                 │
│ Last heard  1 min ago                               │
│ Agents      OpenClaw on build-box                   │
│ Revoking build-box revokes OpenClaw with it.        │
│                                    [ Revoke… ]      │
└─────────────────────────────────────────────────────┘
```

List view, the same estate as an indented tree that is a real list for keyboard and screen
reader:

```
Acme
  Maya's Mac · Workstation · reporting · watching only
    Claude Code on Maya's Mac · approved
    Cursor on Maya's Mac · approved
  build-box · Server · reporting · enforcing
    OpenClaw on build-box · not onboarded
  hermes-vps · over MCP · advisory
    Hermes on hermes-vps · approved
```

- Revoke from the card opens the same confirm as Machines, naming everything that goes with it.
- A "Drawing | List" switch, with the list as the accessible equivalent, and the flat drawing as
  the default when the person asked for reduced motion.
- A one line header with the legend in words, because the three line styles are the whole point
  of the page; the knobs (Zoom, Size, Forces) fold under one "Adjust" control.
- One vocabulary with Machines and Agents: "watching only" and "enforcing", and "enrolled, not
  approved" rather than "waiting on you", which stays reserved for held questions.
- "What it reads" links to the connector's own page under Connectors.
- A hollow or slashed dot glyph for quiet and revoked on the drawing, so state survives without
  colour.

---

## Govern

Three rows under the heading "Govern" in the sidebar, in this order: "Waiting on you", "Autonomy",
"Memory". The first is everything a person owes right now; the second is what agents may do and
what could stop being asked; the third is what agents are told.

### Waiting on you

`/inbox` (`app/(workspace)/inbox/page.tsx`, `components/inbox/inbox-view.tsx`) · reached from:
the sidebar row "Waiting on you", the home block "Waiting on you", a browser notification ("Memnox
needs you" opens here), a chat message link, and deep links with `?id=` that mark one row and
scroll to it.

**Job.** What do I owe right now, and can I answer it here?

**Today.** The browser tab reads "Inbox" (the page metadata) while the page heading reads "Waiting
on you". There are no tabs. Each section renders only while it has something in it, in this order:

1. **Held calls.** Heading computed by `waitingLine`: "3 waiting: 2 on build-box, 1 on Ana's Mac",
   machines ordered by count. When nothing waits but something was answered in the last hour, the
   heading is "No agent is blocked on a question". Under the heading, the line "You can also answer
   with the buttons on the chat message about it, from the iPhone or Mac app, or on the machine
   itself." with a chat glyph, then one card per question (see **Held call card**), then the shared
   note under the list, then "Answered in the last hour".
2. **"Approvals"** with a count. Description is either "Each agent is held until somebody answers
   it where it runs." or, when every row shares the same asker and approver, "<agentId> asked. Held
   until <name> signs off. Each agent waits until it is answered where it runs." Rows, oldest
   first: a coloured bar down the left for age (border colour under 4 hours, chart amber from 4
   hours, destructive red from 24 hours), the wait as "2h", the action in plain words
   (`actionPhrase`), "×3" when identical holds fold together, an environment pill ("production" in
   red, anything else neutral), the shortened target in mono, the asker line when rows differ
   ("codex asked. Held until 2 of Ana, Bo sign off.", or "An agent asked.", or "Held with nobody
   named to sign it off."), and "1/2" sign offs on the right with the label "1 of 2 sign-offs".
   After eight rows: "Show 4 more" / "Show fewer". The rows carry no button at all.
3. **"Changes to check against a decision"** with a count (reviewers only). See **Other inbox
   sections**.
4. **"Rule changes waiting on a second admin"** with a count. See its own entry.
5. **"Decisions to confirm"** with a count. See **Other inbox sections**.
6. **"Facts to settle"** with a count. See **Other inbox sections**.
7. **Also waiting** (`AlsoWaiting`): "MCP servers nobody approved" and "Exceptions to approve",
   each only while one is owed.
8. **"Conditions in force"**, freezes and the like, last.

Actions: answering a held call (passkey for a yes), "Approve" or "Retry publish" and "Reject" on a
rule change, "Matches" and "Off course" on a decision check, "Reject" and "Make this a rule" on a
draft decision, "Confirm" and "Reject" on a fact, "Approve" and "Block for the team" on an MCP
server, "Approve" and "Reject" on an exception, "Lift" on a condition (admins only). Each is a
network call; failures show inline in a form note under the section.

Live updates: the page opens a server stream (`/me/stream`). "held.raised" and "held.escalated"
reread the inbox; "held.settled" moves the card into "Answered in the last hour" at once with the
answerer's name and door. While the stream is closed the inbox polls every 10 seconds.

States:

- Loading with nothing yet counted: a three row table skeleton.
- Partial: as soon as any one source has rows, the sections that have loaded render and the rest
  appear as they land, so the order can shift under the reader.
- Empty: one card, inbox icon, "Nothing needs you. Memnox is running." When something was answered
  in the last hour, "Answered in the last hour" still shows under it.
- Error: no section reads its error. A failed read leaves its count at zero, so a cloud that cannot
  be reached shows "Nothing needs you. Memnox is running."
- Offline: the stream drops and polling fails silently, with the same calm empty state.
- Permission: the "always" answers only show to admins; "Changes to check against a decision" and
  the "Confirm" and "Reject" on facts only show to reviewers; "Lift" only to admins.

**What gets in the way.**

- A failed read renders "Nothing needs you. Memnox is running.", which is the one false sentence
  this page must never say: an agent can be blocked while the page reports calm. [Hierarchy]
- The tab title "Inbox" and the heading "Waiting on you" name the page twice, so a pinned tab and
  the nav row disagree. [Consistency]
- "Approvals" lists holds with no button and only says "answered where it runs", so the page
  called Waiting on you holds rows that cannot be answered on it, with no link to the machine or
  the agent that could. [Proximity]
- Eight sections of four different shapes (cards, dense rows, list rows, pills) with no summary at
  the top. A reader with twenty items cannot see what kind they owe before scrolling.
  [Hierarchy] [Consistency]
- The sections arrive in whatever order the queries settle, so a card the reader is about to press
  can move down when a section above it loads. [Alignment]
- The age bar on "Approvals" is colour only; the duration text sits beside it, but nothing says 24
  hours is overdue in words. [Accessibility] [Contrast]
- Held call questions and "Approvals" are two lists of agents waiting on a person, in different
  shapes, a screen apart. [Consistency]

**Improved.**

```
Waiting on you                                     6 things, oldest 2h
┌───────────────────────────────────────────────────────────────────────┐
│ 3 agents blocked · 1 rule change · 1 decision to check · 1 fact      │
└───────────────────────────────────────────────────────────────────────┘

Agents blocked on you                                  3 waiting
  ┌ Push to main ───────────────────────────────────────────────────┐
  │ codex on build-box, from Ana's team                              │
  │ Rule: pushes to main ask first                                   │
  │ Asked 14:02. Declined at 14:32 if nobody answers.                │
  │ [ Allow once ]  [ Deny ]   More answers ▾                        │
  └──────────────────────────────────────────────────────────────────┘
  Held where it runs, 1                                 answer there
  · Deploy to production, claude-code on ana-mac, 2h, 0 of 2 sign offs
    Open the agent →

Rule changes waiting on a second admin                    1
Changes to check against a decision                       1
Facts to settle                                           1
Conditions in force                                       1

Answered in the last hour
  Push to main · codex on build-box
  Allowed once by Ana on iPhone. 13:51
```

- A failed read says so in its own section: "Could not read what is waiting, so something may
  be. Try again", never the calm empty line.
- A one line summary of counts by kind at the top, so the reader knows what is owed before
  reading it.
- Sections keep a fixed order and reserve their place while loading, with a skeleton row each.
- "Approvals" folds into the blocked agents section as "Held where it runs", each row linking to
  the agent page, so there is one list of waiting agents.
- The tab title becomes "Waiting on you".
- The age bar gains a word at 24 hours: "overdue".

### Held call card

`components/machines/held-card.tsx`, with words from `held-words.ts`, grouping from
`held-groups.ts` · reached from: "Waiting on you", the home block "Waiting on you", and an agent's
own page where it is blocked.

**Job.** One agent is stopped on a question: what does it want, why was it stopped, and what do I
say?

**Today.** Top to bottom:

- The action in plain words (`actionPhrase` of the operation), with a warning pill "Widened past
  its owners" when the question escalated past the agent's owner.
- The label line: "<agent> on <machine>" where machine is the given label or the first 8 characters
  of its id, plus ", from <owner>'s agents" when somebody owns it, then " · " and the reason (the
  cloud's `why` sentence, else the raw `reason`).
- The cloud's summary sentence, when there is one.
- The target in mono, truncated.
- The timing line, computed: "Asked 14:02. Declined at 14:32 if nobody answers." or, when the same
  question arrived several times, "Asked 15 times since 14:02, and one answer covers them all. The
  first is declined at 14:32 if nobody answers." Then, when a quorum is set, " It needs 2 people to
  say yes." or, after this person said yes, " You said yes, and it waits on 1 more."
- The answer buttons, in the chat order, each with a hover `title`:
- Answer: "Allow once" (title "It proceeds, and the next one asks again."), filled accent.
- Answer: "Allow for this session" ("It stops asking until the run ends."), filled accent.
- Answer: "Deny" ("It does not run."), outlined in muted text.
- Answer, admins only, outlined: "Always allow this agent" ("Allowed now, and a rule allowing it from now
  on waits on a second admin."), "Allow once, always ask" ("Allowed now, and a rule that always
  asks waits on a second admin."), "Always deny" ("Denied now, and a rule denying it from now on
  waits on a second admin.").
- While sending, the pressed button reads "Sending" and all buttons disable.

Grouping: calls with the same machine, agent, operation, target and reason become one card; one
press answers each in turn (one passkey prompt per call).

The passkey step. Any answer but "Deny" and "Always deny" is a yes and must be signed:

1. The browser asks the cloud for options bound to this call and answer, then shows the system
   passkey prompt (Touch ID, Windows Hello, a security key or a phone).
2. Closing the prompt: "Nothing was sent, because the passkey prompt was closed."
3. No passkey registered (known up front, or the cloud answers 409): an inline panel with a key
   icon, "A yes from a browser is signed with a passkey, and you have none yet. Set one up here in
   one press, or under Settings, Account, Passkeys. Deny works without one." and a button "Set up a
   passkey" ("Waiting" while the system prompt is open). After it succeeds: "Your passkey is added,
   so press your answer again to sign it."
4. A browser that cannot hold a passkey: every yes button is disabled and the note reads "This
   browser cannot hold a passkey, so allow from the iPhone or Mac app, from chat or at the machine.
   Deny works here."
5. After this person's yes on a quorum call, the yes buttons disable.

After an answer the card leaves the list and one note sits under the list (`answeredNote`):
"Answered. The machine hears it on its next heartbeat.", or "Your yes is counted, and it still
needs one more." (or "needs 2 more"), or "Answered, and the rule it proposes waits on a second
admin.", or "Answered, and no rule was proposed: <reason>". A failure reads "That answer did not
reach the machine." or the cloud's refusal.

Answered in the last hour: one row per settled call, newest first, "Push to main · codex on
build-box" then `settledLine` and the time: "Allowed once by Ana on iPhone. 14:05". The answer words
are "Allowed once", "Allowed for this session", "Denied", or "Answered" for anything else; the door
words are "iPhone", "Mac", "the web", "Slack", "Discord", "Telegram", "Microsoft Teams", "the
console", "the terminal", "Memnox".

States: no waiting and nothing settled renders the empty card "Nothing is holding" with "When an
agent on a machine nobody is sitting at needs you, the question arrives here and the answer travels
back on the next heartbeat." (used on pages other than the inbox); passkey list still loading
leaves `hasPasskey` unknown, so a yes goes straight to the cloud and the 409 path catches it.

**What gets in the way.**

- "Deny" is the dimmed button, outlined in muted grey between two filled accents, which is the one
  thing the shared principles forbid: a no is never the dimmed one. [Contrast]
- Two yes buttons share the same filled accent, so the eye cannot tell the narrow yes from the wide
  one. [Contrast] [Hierarchy]
- An admin sees all six answers at once in one row; the three that propose a rule look the same as
  each other, yes or no. [Progressive disclosure] [Contrast]
- What each answer does lives in a `title` tooltip, which never shows on touch and is not read
  reliably by screen readers. [Accessibility]
- The label reads ", from Ana's agents" where the shared shape says "from Ana's team".
  [Consistency]
- A browser answer is reported as "on the web" while a console answer is "on the console"; both
  are this page. [Consistency]
- The note after an answer appears once under the whole list, far from the card that vanished, so
  a person who answered the third of five cards sees a sentence with no anchor. [Proximity]
- The reason and the rule are joined on the label line after a dot, in muted text, so the "why"
  reads as metadata rather than the reason it was stopped. [Hierarchy] [Proximity]
- The group key includes the reason, so the same habit with two reason strings shows as two cards.
- The timing line says "Declined at 14:32" with no countdown; a card about to lapse looks the same
  as a fresh one. [Hierarchy]

**Improved.**

```
┌──────────────────────────────────────────────────────────────────┐
│ Push to main                              Widened past its owners│
│ codex on build-box, from Ana's team                              │
│ Rule: pushes to main ask first                                   │
│ git push origin main                                             │
│ Asked 15 times since 14:02. Declined in 6 minutes.               │
│                                                                  │
│ [ Deny ]          [ Allow for this session ]   [ Allow once ]    │
│ It does not run.  Until the run ends.           Asks again next. │
│                                                                  │
│ More answers ▾  (admins)                                         │
│   Always allow this agent · Allow once, always ask · Always deny │
│   Each also proposes a rule a second admin approves.             │
└──────────────────────────────────────────────────────────────────┘
  ✓ Allowed once by you on the console. The machine hears it on its
    next heartbeat.
```

- "Deny" is a full weight outlined button on the left, set apart in position and shape; "Allow
  once" is the only filled accent, on the right; "Allow for this session" outlined.
- Each answer carries its effect as visible small text under it, not a tooltip.
- The three always answers fold behind "More answers", with one sentence saying they propose a
  rule.
- The rule gets its own line, "Rule: pushes to main ask first", above the target.
- "from Ana's team" and one door word for this page, "the console".
- The answered note replaces the card in place for five seconds before it moves to "Answered in
  the last hour".
- The timing line counts down once under 10 minutes.

### Rule changes waiting on a second admin

Section of `/inbox` (`components/policies/proposal-list.tsx`) · reached from: "Waiting on you",
`/autonomy?tab=proposed` (redirects here), an always answer on a held call, "Stop asking" on
Autonomy, "Block for the team" on an MCP server, and the chat announcement of a proposal.

**Job.** Somebody wants to change what agents may do; do I let it in?

**Today.** Heading "Rule changes waiting on a second admin" with a count. A muted paragraph: "None
of these is in force. A rule set is approved by somebody other than whoever proposed it, so a
colleague has to let yours in." One bordered card per proposal:

- The change line, computed: "2 added, 1 changed: deny-force-push, ask-deploy-prod, allow-git-push"
  (counts of added, changed, removed, then the first three rule names), or "No rule changes."
- "<proposedBy> proposed this <local date and time>".
- When the rule came from a decision: "<source line>: <the decision's statement>".
- A status pill on the right: "waiting" (amber), "approved", "in force" (green), "not published"
  (red), "rejected" (neutral).
- On a failed publish: "Approved, and the publish did not land: <reason>. Approving again retries
  it." in red.
- When resolved: "<name> resolved it from the team's chat." or "... in the console."
- Buttons unless rejected: "Approve" (or "Retry publish" when failed), filled; "Reject", outlined.
- Failures: "That was not approved." or "That was not rejected." or the cloud's refusal.

States: an empty list says "Nothing is waiting. A rule set written here is proposed rather than
published, and comes into force once somebody other than its author approves it.", though the inbox
hides the section when empty. The author of a proposal sees "Approve" on their own proposal; the
cloud refuses it, and the reason arrives only after pressing. Non admins see the buttons too.

**What gets in the way.**

- The change line names at most three rules by their machine names ("deny-force-push") and never
  says what any rule does, where it holds, or what it replaces. An approver is asked to sign a
  rule set they cannot read here. [Proximity] [Progressive disclosure]
- The author and non admins are offered "Approve", and learn only after pressing that they may not.
  [Accessibility] (a button that cannot work)
- The proposer and time sit in muted metadata while the rule names are the headline, so "who wants
  this" is the faintest line. [Hierarchy]
- "Approve" is not signed with a passkey while a yes on a held call is, though widening a rule
  widens every future call. [Consistency]
- The status pill "waiting" on every row of a list titled "waiting" says nothing. [Hierarchy]

**Improved.**

```
Rule changes waiting on a second admin                          2

┌──────────────────────────────────────────────────────────────────┐
│ Ana wants pushes to main to go ahead without asking              │
│ for codex, on servers only                                       │
│ From her answer "Always allow this agent" on build-box, 14:05    │
│                                                                  │
│ Adds   Pushing in main            goes ahead                     │
│ Keeps  Force-pushing              refused                        │
│ Show the whole rule set ▸                                        │
│                                                                  │
│ [ Reject ]                                 [ Approve with passkey ]│
└──────────────────────────────────────────────────────────────────┘
  You proposed this, so another admin approves it.   (on your own)
```

- Each card leads with who wants what, in the boundary's own words (`plainRule`), and where it
  holds.
- The diff lists each rule with its effect; the full set folds behind "Show the whole rule set".
- The author sees a sentence instead of an "Approve" that will be refused; a non admin sees no
  buttons and "An admin approves this".
- Approving is signed with the passkey, like any other yes.
- The pill shows only for states that differ from waiting: "not published", "in force".

### Other inbox sections

Sections of `/inbox`: "Changes to check against a decision" (`decisions-to-check.tsx`), "Decisions
to confirm" (`decisions-to-confirm.tsx`, `decisions/suggestion-card.tsx`), "Facts to settle"
(`facts-to-settle.tsx`, `organization/fact-row.tsx`), "MCP servers nobody approved" and "Exceptions
to approve" (`approvals/also-waiting.tsx`), "Conditions in force" (`conditions-in-force.tsx`) ·
reached from: "Waiting on you"; dashboard cards deep link to a draft with `?id=`.

**Job.** Something the team said or did needs a person to agree before it counts.

**Today.**

**"Changes to check against a decision"** (reviewers only), count, description "An agent wrote
where the team had decided something. Say whether it is in line; if it is not, the agent is told
the decision." Then the chat line "You can also answer with the buttons on the message Memnox sent
you." Each card: the decision in quotes ("“Billing writes go through the ledger service”"), or "A
decision you cannot read here: replaced since, or above your clearance"; "About <subject>, settled
by <name>"; the first three paths in mono and "and 4 more"; "<agentId> wrote this 14:02." (or "An
agent"). Buttons "Matches" (filled, title "The change is in line with what was decided.") and "Off
course" (outlined muted, title "The agent is handed the decision at its next step."). Failure:
"That answer could not be recorded, so the check is still waiting."

**"Decisions to confirm"**, count, "Drafted from what your systems said. Nothing here governs an
agent until it is made a rule." Each card: the statement; a confidence pill "82%" (green from 75,
amber below); an effect pill (the enforcement word); the actions in mono; "in production"; "owned
by <owner>"; "from 3 events". A repeat warns in amber "Says the same as <title> above, so confirming
both would make two rules of one decision." Footer: the rule name in mono (title "The name the rule
would carry") and buttons "Reject" (outlined) then "Make this a rule" (filled). A resolved draft
reads "<status> by <name>". Failure: "That draft could not be recorded, so it is still waiting."

**"Facts to settle"**, count, "Read out of a conversation by a model. None of them counts until
somebody confirms it." Each row: the statement; meta "<kind> · read out of a conversation · <who> ·
up to <limit> · version 2"; a status pill ("candidate", "verified", "superseded", "rejected"); for
reviewers "Confirm" (filled) and "Reject". Facts already raised behind a draft decision are left
out, so one act is not asked twice. Failure: "That could not be saved, so nothing changed."

**"MCP servers nobody approved"**, "Configured on a machine and not going through Memnox. Approving
it keeps it; blocking it proposes a rule a second admin lets in." Each row: server name in mono, "On
2 machines, first seen 14:02"; "Approve" (filled) and "Block for the team" (outlined). After
blocking: "Proposed. A second admin lets the block in before any machine holds it." Failure: "That
did not go through. Try again in a moment."

**"Exceptions to approve"**, "A rule bent for one place, with an owner and an end date. It ends by
itself on that date." Each row: "Relax <rule>" or "Tighten <rule>"; "<reason>. Owned by <owner>,
ends <date>, proposed by <name>"; "Approve" and "Reject".

**"Conditions in force"**: each row the value ("Payments freeze"), then "freeze on the whole
workspace, until Oct 9" (kind with underscores as spaces; scope as "environment production" or "the
whole workspace"); the kind's meaning only as a hover title ("Nothing ships. The commonest one, and
the one people forget to lift."). Admins see "Lift". Failure: "That condition was not lifted."

States: each section is absent when empty; no section has its own loading or error state.

**What gets in the way.**

- "82%" is the extractor's score on a page whose product voice is counts never scores, and a
  green 82 reads as a recommendation to confirm. [Consistency] [Hierarchy]
- "Approve" on an MCP server keeps an ungoverned server with one unsigned press and no note of what
  it can reach. [Proximity]
- "Off course" is the dimmed button, though it is the answer that matters most to the agent.
  [Contrast]
- Answer meanings live only in `title` tooltips on "Matches", "Off course" and the condition kind.
  [Accessibility]
- Conditions say "freeze on the whole workspace" in lowercase metadata under the value, so the
  thing stopping all work right now is the quietest row on the page and sits last. [Hierarchy]
- "Lift" ends a freeze in one press with no confirmation. [Progressive disclosure]
- Facts show raw kinds in mono ("approval_limit") and pills in raw status words ("candidate").
  [Consistency]
- Five list styles for five sections: rounded cards, dense rows, bordered rows. [Consistency]

**Improved.**

```
Conditions in force                                              1
┌──────────────────────────────────────────────────────────────────┐
│ ❄ Payments freeze                         until Thu 9 Oct, 18:00 │
│ Nothing ships on production. Set by Ana from Slack.              │
│                                              [ Lift the freeze ] │
└──────────────────────────────────────────────────────────────────┘

Decisions to confirm                                             1
┌──────────────────────────────────────────────────────────────────┐
│ "Deploys to production need two approvers"                       │
│ Would ask a person first for deploy.production, owned by Lin     │
│ Read from 3 messages in #releases ▸                              │
│ [ Not a decision ]                           [ Make this a rule ]│
└──────────────────────────────────────────────────────────────────┘
```

- Conditions move up, under blocked agents, because a freeze stops work; "Lift the freeze" asks
  "Lift Payments freeze now? Agents may ship again." before it acts.
- The percentage leaves the draft card; the evidence count opens the messages it was read from.
- "Matches" and "Off course" carry their effect as visible text; "Off course" is full weight.
- "Approve" on an MCP server shows the tools it carries and how many write, and becomes "Keep it
  ungoverned" so the act reads as what it is.
- One card shape for every section.

### Autonomy

`/autonomy` (`app/(workspace)/autonomy/page.tsx`, `components/autonomy/*`) · reached from: the
sidebar row "Autonomy", the home block "Ready to hand over". `?tab=proposed` redirects to `/inbox`.

**Job.** What can my agents already do on their own, and what could I safely stop being asked?

**Today.** Tab title and heading "What your agents may do". Description: "What your team's rules
let go ahead, send to a person first, or refuse. Each machine also keeps its own rules from memnox
setup, and those are not listed here."

Three columns side by side from large screens, stacked below (`BoundaryLists`):

- "Goes ahead", check icon in green, with the lead "Anything no team rule names, such as editing
  code or running tests, unless a machine's own rules stop it." then any allow rules.
- "Asks a person first", question icon in amber, with a count; empty: "No team rule asks a person
  yet."
- "Refused", ban icon in red, with a count; empty: "No team rule refuses anything yet."

Each rule reads in plain words (`plainRule`): "Pushing in main", "Reading files in .ssh, .aws and 2
more", "Force-pushing", "Reaching a host no rule names", or the raw match when no phrase exists;
under it the reason with "You chose to deny this:" removed.

Then, only while there is something to hand over, a section "What you could stop being asked
about" with a table:

- "What it keeps asking": the operation in mono ("git.push"), under it the agent id and up to two
  resources, "and 3 more".
- "Answered": "6 approved · 0 refused", the refused count red when above zero.
- "Reading": a pill "could run unasked" (green) or "watch it instead" (amber), and the cloud's reason.
- The last column: "Stop asking" (outlined; "Proposing" while busy), or "stays a question" in muted
  text when supervised or ever refused, or a pill "already proposed" when a rule in force or a
  pending proposal covers it.

Under the table: "4 of the 19 approvals answered in the last 30 days were for something nobody has
ever refused." After "Stop asking": a card "Proposed. Nothing changes until a second administrator
approves it, so your agents are still asked about this in the meantime." with "Hand over another".
Failures: "The runtime refuses this rule set, so nothing was proposed.", "That could not be
proposed, so nothing changed."

There are no dialogs on this page; "Stop asking" proposes in one press.

States: loading shows three skeleton blocks labelled "Loading the boundary"; boundary error shows a
warning notice "The rules in force could not be read, so this page cannot say what your agents may
do. What is enforced has not changed."; the hand over section is hidden while loading, on error and
when empty (its own empty text, "Nothing to hand over yet" with "Nobody has answered an approval in
the last 30 days, so there is no habit to read. This fills in as your team answers the queue.", is
therefore never shown on this page). Non admins see "Stop asking" and are refused by the cloud.

**What gets in the way.**

- The nav row says "Autonomy" and the page says "What your agents may do". [Consistency]
- The hand over table, which is the product's promise, sits under three columns of rules and is
  hidden entirely when empty, so a new workspace never learns it exists. [Hierarchy]
- Agents appear as ids ("agt_codex") with no machine, where everywhere else says "<agent> on
  <machine>". [Consistency]
- "Stop asking" proposes a rule with no preview of the rule, its scope (which agent, which
  machines) or the branches it covered; the home and the Mac show "where the rule holds" first.
  [Progressive disclosure] [Proximity]
- "Goes ahead" never has a count, so the three columns cannot be compared at a glance, and the
  operation is shown in mono ("git.push") beside plain rule words above. [Consistency]
- Non admins are offered a button the cloud refuses. [Accessibility]
- "could run unasked" and "watch it instead" are a judgement in a pill coloured like a verdict.

**Improved.**

```
Autonomy
What your agents may do, and what you could stop being asked.

Ready to hand over                                              2
┌──────────────────────────────────────────────────────────────────┐
│ Pushing to feature branches                                      │
│ codex on build-box · 6 allowed, 0 refused in 30 days             │
│ Covered: feat/billing, feat/export, fix/ci                       │
│                                          [ Let it run on its own ]│
└──────────────────────────────────────────────────────────────────┘
  Let it run on its own ▸ opens:
  ┌ codex may push to feat/* on build-box without asking ─────────┐
  │ Holds on: build-box only ▾   Agents: codex ▾                   │
  │ A second admin approves it before any machine holds it.        │
  │                     [ Cancel ]   [ Propose with passkey ]      │
  └────────────────────────────────────────────────────────────────┘

Stays a question                                                1
  Deploying to production · claude-code on ana-mac · 9 allowed, 1 refused

Goes ahead              Asks a person first (3)     Refused (2)
Anything no team rule   Pushing in main             Force-pushing
names, such as editing  Deleting files              Reading files in
code or running tests.  Reaching a host no rule     .ssh, .aws
                        names
```

- The heading matches the nav, "Autonomy", with the old title as its subtitle.
- "Ready to hand over" leads, with the home's wording, and when empty says how many approvals were
  read and why none is a habit yet.
- Each row uses "<agent> on <machine>" and plain action words.
- "Let it run on its own" opens a confirm sheet with the rule in words and its scope before
  proposing, signed with a passkey.
- Non admins see "Ask an admin to hand this over" instead.

### Memory

`/memory` (`app/(workspace)/memory/page.tsx`, `components/memory/*`) · reached from: the sidebar
row "Memory".

**Job.** What are my agents told, where did each piece come from, and what replaced what?

**Today.** The tab reads "Memory". There is no page heading: the page takes the whole frame for a
canvas.

**The map** (`MemoryCanvas`). Opens in depth (a 3D scene); every source, conversation, passage,
person, team, rule set and memory is a mark, with lines between them. Controls stack at the bottom
left (`CanvasControls`): "Fit" (key F), "Center" (key C), a node size readout with two steps, icon
actions "Read the list" (list icon) and "Flat" or "Depth" (labels only as `aria-label`), then
folding panels:

- "Show": rows with counts for "Memories", "Sources", "Conversations", "Passages", "People", "Teams",
  "Rules in force", "Apps", each toggleable, with all on and all off.
- "Connections": the line kinds, each toggleable: "Derives" (was read out of this), "Updates"
  (replaced the memory it points at), "Extends" (narrows it and leaves it in force), "Related"
  (proposed by comparing the two, and stated by nobody), "On", "Reports to", "Said", "Names",
  "Approved", "Links to".
- "Forces": sliders "Repel" ("How far apart the marks push each other"), "Link length" ("How long
  a line wants to be"), "Gather" ("How tightly the whole drawing is held in").
- "Legend": "Memories", "Sources", "Passages", "People and teams", and the status inks "Recent (< 24h)",
  "In force", "Expiring soon", "Forgotten".

Lines carry a word chip ("Derives", "Updates") and arrows where the claim runs one way.

**The card** (`MemoryCard`), opened by selecting a mark: eyebrow with the system mark and the kind
("Source", "Conversation", "Team", "Passage", "Person", "In force", "App", or the fact's own kind);
the label as heading; close "X" (aria "Close"); the statement verbatim; an excerpt; "12 messages
posted here with nothing read out of them yet, counted on whoever said them rather than drawn one
by one."; up to a list of messages with links and times; "Said 3 times by the same person, drawn
once."; for hubs "Nothing on this map was read out of it yet." or "4 memories were read out of it.";
for memories a version pill "v2 · latest" and the status meaning ("Settled in the last day", "Stops
being in force this week", "Replaced or ended, so no agent is told it"); the short id with a copy
button ("Copy the id"); "Open where this came from". Footer moves with key hints: "Go to the
document" (↑), "Next memory" or "Read what is in it" (→), "Previous memory" (←).

**The timeline** (`MemoryTimeline`), a strip centred across the top, only when the record has
changed at least once: a history icon, "The change before" (left arrow), a range slider "Read the
record as it stood", "The change after", and "Today". Under it, live: "Today, with 7 changes behind
it." or "As the record stood on 3 Oct, change 4 of 7. Memories and uploaded files only, since what
arrived is not dated here." plus " Loading…" while fetching.

**The list** (`MemoryList`), a drawer docked on the right after "Read the list": eyebrow "Memory",
title "What an agent is handed", "The set in force, filtered to what you are cleared for.", pills "2
withheld" (amber) and "14 in force". Table: "What was settled" (statement, then subject and scope),
"Kind" (pill), "Evidence" ("source" link or "none"). Under it: "2 more facts are in force and above
your clearance. Counted rather than hidden, so this is never a partial answer you cannot tell from a
complete one." Empty: "Nothing settled yet" with "Facts arrive when a decision is approved in the
review queue. Nothing here promotes itself."

States: loading is a five row table skeleton in the frame; empty is "Nothing here yet" with
"Connect a system or upload a file and what it says is on this map within the minute. A memory
joins it once a decision is approved in the review queue, because nothing here promotes itself.";
a past day with nothing is "Nothing stood on this day" with "No memory was in force as the record
stood then. Step forward to the next change, or back to today." Read errors are not shown; a failed
read draws an empty map with the "Nothing here yet" copy.

**What gets in the way.**

- No heading and no sentence say what this page is for; the person lands in a turning 3D scene.
  The nav promises "Memory", the list says "What an agent is handed", and nothing on the canvas
  ties the two. [Hierarchy]
- The one question most people bring, "what are my agents told?", is behind an unlabelled list icon
  in a cluster of controls at the bottom left. [Progressive disclosure] [Hierarchy]
- Icon only actions ("Read the list", "Flat", "Depth") have names only for screen readers.
  [Accessibility]
- A 3D canvas with forces and node size controls is the default for a page meant for reading
  sentences; keyboard reading works only once something is selected. [Accessibility]
- A failed read shows "Nothing here yet" and suggests connecting a system, which is wrong advice
  when systems are connected. [Hierarchy]
- The empty state's "review queue" is not a name used anywhere in the nav; it is "Waiting on you".
  [Consistency]
- Line kinds are machine words ("Derives", "Updates", "Extends") with the plain meaning one panel
  deeper. [Consistency]
- The timeline strip sits on top of the drawing at the top centre while every other control sits
  bottom left. [Alignment]

**Improved.**

```
Memory                                              [ Map | List ]
What your agents are told before they act. 14 in force, 2 withheld.

List (default)
┌──────────────────────────────────────────────────────────────────┐
│ "Deploys to production need two approvers"                       │
│ Release process · settled by Lin, 3 Oct · from #releases ↗       │
├──────────────────────────────────────────────────────────────────┤
│ "Billing writes go through the ledger service"                   │
│ Billing · settled by Ana, 28 Sep · from Handbook.pdf ↗           │
│ Replaces an older version ▸                                      │
└──────────────────────────────────────────────────────────────────┘
2 more are in force and above your clearance.

Map
  ◀ ───────●────────── ▶  Today, with 7 changes behind it.   [Today]
  (flat by default; Depth is a labelled toggle)
```

- A heading "Memory" and one sentence saying these are what agents are told, with the counts.
- A labelled "Map" and "List" switch; the list is the default view because it answers the question
  people arrive with, and the map stays one press away.
- Each list row carries who settled it, when, and a link to the source, which today only the map
  card shows.
- The map opens flat; "Depth" is a labelled toggle; every icon action has visible text.
- A read error says "Could not read the record. Nothing agents are told has changed." with "Try
  again".
- "review queue" becomes "Waiting on you"; line chips read "read out of", "replaces", "narrows".

---

## Record

### What was caught

`/findings` (`app/(workspace)/findings/page.tsx`, `components/findings/findings-view.tsx`) · reached from: sidebar Record > "What was caught"; a home incident card (`?id=<incident>`); an agent page's "every action" link and any `historyHref()` link (`/findings?record=1&agent=…`), which scrolls straight to the actions.

**Job.** What went wrong, what is still exposed, and what did every agent actually do?

**Today.** One page with no tabs, despite the nav comment and `historyHref` calling the actions "the record's tab". Browser title "What was caught". Top to bottom:

1. Page header "What was caught", description "Open incidents, what a scan found still wrong, and every action your agents took."
2. **Open incidents** (`open-incidents.tsx`), drawn only while at least one incident is open or acknowledged. Heading "Open incidents" with a count. Cases are grouped under "Critical" and "High", each with a count. A case is one card button: a coloured bar (red for critical, chart orange for high), the incident title, a status pill showing "open", "acknowledged" or "resolved", a two line summary, and a mono line built as `<trigger label> · <agent name> · <n> event(s) · last seen <Mon D>`. Trigger labels: "Ran, unverified, could not be undone", "Approval overridden by an admin", "Agent repeatedly hitting blocks", "Critical risk score"; any other trigger shows its raw key. Clicking a card opens the incident drawer (below). A `?id=` deep link opens its incident once.
3. **Still wrong** (`still-wrong.tsx`), drawn only when the machines reported findings. Heading "Still wrong" with a count of grouped rows, description "What a scan of your machines found. The matched content never leaves the machine, only what kind of thing it is and where." Two lists:
   - "No rule covers these · <n>"
   - "Already denied by a rule · <n>", drawn quieter with neutral pills.
     Each row: a severity pill (the raw severity word, toned by risk), the subject (a path in mono, shortened with the full path on hover, or "The network", or "A shell"), a plain line read off the runtime's sentence ("Readable, and no rule covers it yet.", "Readable, and <rule> denies it at the seams.", "Readable, and a rule denies it at the seams." when the rule is only a hash, "Reachable with no restriction, and nobody has decided what to do about it.", "Anything you can reach from your account, the agent can reach too."). On wide screens a right column names the agents ("not attributed" when none, "<first> and <n> more" past two) and the time the finding was first raised. Rows have no action at all.
4. **What happened** (`components/audit/timeline-panel.tsx`), the fleet timeline. Heading "What happened", description "Every action a machine reported, newest first. Repeats of one action fold into a single row. Open one to see the rule that decided it, or trace it to see what led to it and what it set off."
   - Filters (`timeline-filters.tsx`): select "Every agent" plus each agent name; select "Every machine" plus each host; text field, placeholder "Filter by repository or path", applied on Enter or blur; select "Any verdict", "Allowed", "Asked", "Denied"; select "Any time", "Last 24 hours", "Last 7 days", "Last 30 days"; and "Clear" with an X while anything is narrowed. A link can arrive pre filtered by agent, machine, session, resource, surface or verdict.
   - Table columns: "When" (Mon D, HH:MM), "What happened" (the action in plain words as a link button, a "×<n>" chip that expands a folded run into "Open this one" rows, and "<agent> on <machine>" under it), "Where" (resource or surface in mono, or "<n> places" for a run with every place on hover), "Decided" ("Allowed", "Asked", "Denied" pill or "not scored"), "Happened" ("recorded" when the machine sent nothing, "as decided" when equal, else a second pill), and an unlabelled column with "Trace" (branch icon, tooltip "What led to this action and what it set off").
   - Paging: "Newer" and "Older", 50 rows a page, shown only once there is more than one page.
   - Clicking the action opens the Why drawer; "Trace" opens the Chain drawer.

States. Loading: incidents and findings draw nothing until they arrive, so the page opens on the header and a six row table skeleton. Empty timeline with no filter: "Nothing recorded yet", "Actions appear here once a machine has enrolled and reported what ran on it. Until then there is nothing to explain." Empty with a filter: "Nothing matches", "No recorded action fits every filter above. Clear one to widen it." Error: a red line from the server's refusal, fallback "That history could not be read." With no incidents and no findings the page is only the timeline, and nothing says "no open incidents" or "nothing still wrong". The `IncidentList` empty state ("Nothing to investigate", "Detectors open an incident when the record shows something a person should look at. An empty list is the good outcome.") exists but is never reached, because the section returns nothing at zero. Permission: anyone in the workspace reads the page; containment inside the drawer is admin only.

**What gets in the way.**

- The empty page reads as a broken one. With no incident and no finding, the two good answers ("nothing open", "nothing exposed") are silent, so a person cannot tell "all clear" from "not loaded". The written empty state is dead code. [Hierarchy]
- "Still wrong" rows have no next step. A path "readable, and no rule covers it yet" is the exact moment to offer a deny rule or a link to Autonomy, and the row offers nothing, not even the agent link. [Proximity]
- Severity is shown as the raw word ("critical", "medium") in a coloured pill, while incidents use Title case headings "Critical" and "High". Two vocabularies on one page, and the findings pill carries meaning mostly through colour. [Consistency] [Contrast]
- Incident severities other than critical and high are filtered out of the grouped list, so a medium incident counted in the heading total never renders. [Consistency]
- The timeline mixes the product's answer words with lower case states ("not scored", "recorded", "as decided") in the same two columns, and "Decided" versus "Happened" is explained only in a code comment. On an observe machine a "Denied / Allowed" pair is the most important row and has no legend. [Progressive disclosure]
- The agent line is "<agent> on <machine>", which matches the shared label, but finding rows show bare agent names with the `agt_` prefix stripped and no machine. [Consistency]
- The resource filter applies on blur with no button, so a typed path that has not been committed looks applied. [Accessibility]
- "Newer" and "Older" sit at the bottom right with no page position ("page 2"), and a filter change silently resets to the newest page. [Alignment]
- The page title "What was caught" names a third of what is on it; most visits arrive for the action history. [Hierarchy]

**Improved.**

```
What was caught
Open incidents, what a scan found still wrong, and every action your agents took.

┌ Open incidents · 1 ─────────────────────────────────────────────────────┐
│ ▌ Critical                                                              │
│ ▌ Claude Code on maya-mbp kept hitting a block              [ open ]    │
│ ▌ 14 denied pushes to main in 6 minutes.                                │
│ ▌ Agent repeatedly hitting blocks · 14 events · last seen Oct 7         │
└─────────────────────────────────────────────────────────────────────────┘

Still wrong · 3
What a scan of your machines found. The matched content never leaves the machine.
 No rule covers these · 2
 ┌───────────────────────────────────────────────────────────────────────┐
 │ High   ~/.aws/credentials                 Codex on lin-laptop          │
 │        Readable, and no rule covers it.   [ Deny reading it ] [ Why ] │
 │ Medium The network                        Hermes on build-box          │
 │        Reachable with no restriction.     [ Decide on Autonomy → ]    │
 └───────────────────────────────────────────────────────────────────────┘
 ▸ Already denied by a rule · 1

What happened
[Every agent ▾] [Every machine ▾] [repository or path   ⏎] [Any verdict ▾] [Last 7 days ▾]  Clear
 Decided is what the rules said. Happened is what the machine did, which differs on a watching machine.
 When          What happened                       Where        Decided   Happened
 Oct 7 14:02   Push to main ×6 ▾                   3 places     Asked     as decided  Trace
               Claude Code on maya-mbp
 Oct 7 13:40   Read ~/.ssh/id_ed25519              ~/.ssh       Denied    Allowed     Trace
               Codex on lin-laptop                              (watching machine)
                                            Page 1 · [ Newer ] [ Older ]
```

- Both upper sections always render, with one line each at zero: "No open incidents. Detectors open one when the record shows something a person should look at." and "Nothing still wrong from the last scan of 3 machines." That makes all clear visible.
- Each uncovered finding gets one action built on what exists: "Deny reading it" proposes a rule through the same proposal path Autonomy uses, which then waits on a second admin in Waiting on you; a network or shell finding links to Autonomy.
- Finding rows use the shared "<agent> on <machine>" label and a Title case severity word with an icon, so meaning never rides on colour alone.
- Render every incident severity the cloud sends ("Critical", "High", "Medium", "Low") rather than dropping two.
- A one line legend above the table explains Decided against Happened, and a split pair carries "(watching machine)" so the most important row explains itself.
- The resource field gets an Enter affordance and shows as a chip once applied; paging shows "Page n".
- Already denied findings fold behind a disclosure, because they are a record rather than a task.

### Incident drawer

`components/incidents/incident-detail.tsx` · reached from: a case card under "Open incidents", or a home incident card via `/findings?id=<incident>`.

**Job.** What happened in this incident, can I check it, and how do I stop it and close it?

**Today.** A side drawer labelled with the incident title.

- Header: a severity pill ("critical" red, otherwise amber), a status pill ("open", "acknowledged", "resolved"), the title as a heading, the summary.
- Facts grid: "Agent" (agent name), "Opened", "Last seen", "Acknowledged" ("Not yet", or "<person>, <time>"). Dates read "Not set" when empty.
- **Contain it**, admins only and only while unresolved: "Freezing stops <agent> on every machine until it ends or is lifted. Enforcing makes every machine refuse what the rules deny rather than only record it." Then the compact Freeze agent control (`FreezeAgent`) and "Enforce on every machine" (`EnforceEverywhere`).
- **Evidence** with "<n> event(s)", an optional summary line "<count> × <action>, …" when more than one kind of action is present, and a list where consecutive alike events fold into one row: the action in plain words, the decision reason, a verdict pill ("Allowed", "Asked", "Denied") and a risk pill, a time range "<later> to <earlier>", and a "×<n>" chip that expands each event's time and target.
- Footer while unresolved: "Acknowledge" (open only), a label "Resolving writes an outcome into the record. Say what was done.", a textarea with no placeholder, "Resolve" (disabled until text is typed), and a chat note "You can also acknowledge or resolve it with the buttons on the incident message in your team's channel."
- Actions: Acknowledge and Resolve call the cloud and the list refetches; the drawer follows the incident by id. Resolved incidents disappear from the list because only open and acknowledged are fetched, so the drawer closes on resolve.

States: busy disables both buttons; there is no error text if acknowledge or resolve fails; a non admin sees no containment and still sees Acknowledge and Resolve.

**What gets in the way.**

- Acknowledge and Resolve fail silently; the mutation error is never shown. [Accessibility]
- The primary act, Resolve, sits under a textarea with no placeholder or example of a good outcome, while Acknowledge, the lesser act, is a full width button on top. [Hierarchy]
- The severity pill is lower case while the list headings are Title case. [Consistency]
- "Agent" shows a bare name with no machine, and evidence rows do not say which machine either. [Consistency]
- Freeze and Enforce sit together with one shared paragraph, though Enforce changes every machine in the workspace and Freeze one agent; the bigger blast radius has the smaller explanation. [Proximity]
- Nothing links an evidence row to its Why or Trace drawer, so checking the claim means leaving the incident. [Proximity]

**Improved.**

```
┌ Critical · Open ───────────────────────────────────────────┐
│ Claude Code on maya-mbp kept hitting a block                │
│ 14 denied pushes to main in 6 minutes.                      │
│ Agent  Claude Code on maya-mbp    Opened  Oct 7, 13:58      │
│ Last seen Oct 7, 14:04            Acknowledged  Not yet     │
├ Contain it ─────────────────────────────────────────────────┤
│ [ Freeze Claude Code ]  Stops it on 2 machines until lifted. │
│ [ Enforce on every machine ]  All 5 machines refuse what     │
│   the rules deny instead of only recording it.               │
├ Evidence · 14 events ───────────────────────────────────────┤
│ Push to main   Denied  High   ×14 ▾   [ Why ] [ Trace ]      │
├─────────────────────────────────────────────────────────────┤
│ What was done                                               │
│ [ Froze the agent, asked Maya to push to a branch      ]    │
│ [ Resolve ]                         [ Acknowledge ]          │
│ Could not resolve: you are not cleared for this workspace.   │
└─────────────────────────────────────────────────────────────┘
```

- Show failures from acknowledge and resolve in a reserved line.
- Make Resolve the primary button with a placeholder, and put Acknowledge beside it as secondary.
- Each control in Contain it carries its own sentence with a count of machines it reaches.
- Evidence rows open the Why and Chain drawers already used by the timeline.

### Why drawer

`components/audit/why-drawer.tsx` · reached from: the action name in any "What happened" row.

**Job.** Which rule decided this action, under what conditions, and against what evidence?

**Today.** A docked drawer. Header pill "Why", the raw action id as the heading, caption "The rule that decided it, the conditions it cited, and what it was decided against." Body sections:

- "The verdict": every field of the recorded decision as a label and value list, keys turned into words (`agent_session_id` becomes "Agent session id"), values in mono, objects as JSON.
- "The rule that matched": fields, or "No rule matched, so the workspace default decided it."
- "The rule set it came from": fields, or "Nothing published was in force for this action."
- "What the company was in at the time": one bordered block per condition, or "No condition was in force when this was decided. These are the conditions the decision recorded, not the ones in force now."
- "What it was decided against": evidence blocks, or "No evidence was linked to this decision.", then always "Nothing was withheld from you here." or "<n> more you are not cleared to see."
- Loading: five skeleton lines labelled "Reading the record". Error: red line, fallback "That decision could not be explained." A block with no fields reads "Nothing was recorded."

**What gets in the way.**

- The heading is an opaque action id, so the reader does not see which action they opened; the plain action phrase and "<agent> on <machine>" from the row are dropped. [Hierarchy]
- Every section is a raw key dump in mono. The one sentence a person needs ("Asked, because the rule 'pushes to main ask first' matched") has to be assembled from field names. [Progressive disclosure]
- No link from the matched rule to Autonomy or to the rule's author. [Proximity]

**Improved.**

```
Why · Push to main
Claude Code on maya-mbp · Oct 7, 14:02
Asked, because "pushes to main ask first" matched.
Allowed once by Ana on iPhone.

The rule that matched       pushes to main ask first   [ See on Autonomy → ]
The rule set it came from   workspace rules v12, approved by Ana and Bo
At the time                 No condition was in force.
Decided against             2 pieces of evidence. Nothing was withheld from you.
▸ Every recorded field
```

- Lead with one deterministic sentence built from the verdict and rule fields, then the answer line in the shared "Allowed once by <person> on <door>." form when the record carries it.
- Keep the raw fields behind "Every recorded field", which preserves the honest rendering.

### Chain drawer

`components/audit/action-chain-drawer.tsx` · reached from: "Trace" on any "What happened" row.

**Job.** What led to this action and what did it set off, across agents and machines?

**Today.** Docked drawer. Header pill "Chain", plus a red "ends outward" pill when the chain's end acted beyond its machine. Heading is the raw action id; caption "What led to this action and what it set off, on every agent and machine it crossed." A red callout when outward: "This chain ends in an outward action: its last step acted on something beyond the machine that ran it." Then an ordered list of steps: a place word ("<n> before", "this action", "<n> after"), the action in plain words, a verdict pill, an "outward" pill with an arrow, a line "<agent> on <machine>, <resource> (<classes>)", and a timestamp with seconds. The current step is outlined in the primary colour, outward ones in red. Footer note when cut: "The chain is longer than this. Only the part nearest the action is shown." Loading: "Reading the chain". Error fallback: "That chain could not be read."

**What gets in the way.**

- The heading is again the raw action id. [Hierarchy]
- Steps have no way into their own Why drawer, so tracing and explaining are separate dead ends. [Proximity]
- An agent with no id falls back to the raw session id as its name. [Consistency]

**Improved.**

```
Chain · Push to main                         [ ends outward ]
This chain ends in an outward action.
 2 before   Read package.json        Allowed   Claude Code on maya-mbp   [Why]
 1 before   Run tests                Allowed   Claude Code on maya-mbp   [Why]
 ● this     Push to main             Asked     Claude Code on maya-mbp   [Why]
 1 after    Deploy preview  ↗ outward Allowed  Hermes on build-box       [Why]
```

- Title with the action phrase, and a "Why" link per step.
- Name an unattributed step "an unnamed session on <machine>" rather than a raw id.

---

## Inputs

### Connectors

`/connectors` (`components/connectors/connectors-view.tsx`) · reached from: sidebar Inputs > "Connectors"; onboarding step "Where your team decides things" (seeds the search with `?connect=` and remembered picks); the Meetings page "Connect one"; the Sources empty state "Connect a system"; the connect popup returning (`/connect/callback` then `/connectors?status=…`).

**Job.** Which systems may Memnox read to learn how my team decides, and are they reading?

**Today.** The browser title is "Connectors" but the page header reads "Connected systems", description "What Memnox reads to learn how your team works. Connecting a system gives no agent anything new." Then, top to bottom:

1. **What connecting does** (`what-connecting-does.tsx`): "Your agents have their own connections to these systems, which is how they act: merging a pull request, sending a message. **Memnox's connection is separate.** It reads what your team decides, and its bot messages people when an answer is needed. It never acts for an agent, and no agent reaches a system through it." Two tiles: "Rules your agents are held to" ("Memnox finds what your team already settled and proposes it as a rule. An agent is held to it once two admins approve.", link "See what your agents may do" to `/autonomy`) and "Freezes and incidents" ("A freeze, an open incident or a closed release window stops actions the rules would otherwise allow. For now you declare them yourself, by asking the Memnox bot in your team's chat.").
2. **Chat setup card** (`ChatSetupCard`, owned by Settings), only while a connected chat tool lacks its bot: title "Chat", "Memnox asks each person in their own DMs, and posts a team decision back in the channel it was discussed in.", status "Your team can decide from chat" or "Not yet", rows "Add the Memnox bot to Slack" ("Add to Slack") and "Add the Memnox bot to Discord" ("Add to Discord").
3. **Allowance**, only once every slot on the plan is used: "<n> of <limit> team memory sources connected on this plan.", "Disconnect one to swap it, or move up to connect more. Your own apps are never counted.", and the plan wall pointing to "Pro" with "Read every workspace source you have into memory. Three is enough to see a decision beside the evidence for it, and your own apps were never counted."
4. **Ingestion steps** (`IngestionTabs`), shared with Sources: two linked cards with an arrow between, "1 Connected systems" ("Which systems Memnox may read at all", then "<n> systems" or "Nothing connected yet") and "2 What Memnox reads" ("Which channels and repositories inside them it walks", then "<n> sources" or "Nothing linked yet"). The current one is highlighted.
5. **Connect outcome banner**, after a consent flow: green "<Toolkit> is connected." followed by "Starting to read from it.", "<n> feeds are now reading.", "<n> feeds are now reading, and <m> more need a repository, channel or workspace named first.", "Nothing it offers reads on its own, since every feed needs a repository, channel or workspace named first." or "Nothing is being read from it yet, because switching the feed on failed. Turn it on again." Red on failure: "<Toolkit> was not connected, because the provider's screen was closed or refused. Nothing changed, so you can try again." The name is title cased from the slug.
6. **Tabs**: "All decision sources", "Fully supported", "Systems of record", "Systems of conversation", "Connected" (with count). Changing tab resets the category.
7. A line when onboarding picks were remembered: "You picked Slack and GitHub during setup. Each one needs its own approval. Connect them here." Each name is a button that searches for it.
8. **Category rail** on wide screens: "Categories", "All toolkits" with a count, the twenty commonest categories with counts, "Show <n> more" or "Show fewer". On narrow screens the same is a select beside the search.
9. **Search**: placeholder "Search every system Memnox can read from", count "<showing> of <total> loaded" (no "loaded" on the Connected tab). Search waits for typing to settle; older cards stay dimmed while the new answer arrives.
10. **Cards** in a one, two or three column grid (`connector-card.tsx`): logo, name, "Fully supported" badge (tooltip "Its history is pulled and every author is checked against your people.") or "Limited support" badge with gap lines ("Only what happens after connecting arrives, since its history is not pulled.", "Who wrote something is not checked against your people, so all of it is marked untrusted."), the kind ("System of record", "System of conversation", "Other"), the provider description or "No description from the provider.", a status line ("Not connected", the provider's status reason or "Waiting on the provider's screen", "Connected, paused", "Connected through an installed app since <date>", "Connected since <date>"), then controls:
    - Non admin: a link "Connect your own <name> on Your apps" (to `/your-apps`), since anybody on any plan connects their own account in any tool, or once it is live "An administrator can pull its history, pause it or disconnect it."
    - Admin, not live: "Connect" or "Finish connecting", plus "Cancel" for an unfinished grant (no confirm).
    - Admin, live: "Pull history" (busy "Pulling", only where history can be walked, tooltip "Pull history the provider already holds, so the graph does not wait for the next event."), an icon button "Disconnect <name>", and a switch labelled "Pause <name>" or "Enable <name>" (not for installed apps).
11. "Show more" (busy "Loading") pages in more of the catalogue, except on Connected.
12. A reserved result line: "Pulled <n> items from <name>, <m> new. The sweep keeps going from there on its own." or "Nothing new to pull from <name>: its history is already held as far back as your plan keeps." Failures: "That could not be carried out, and nothing changed." or the server message.

Disconnect confirm: title "Disconnect <name>?", description "Memnox stops reading from <name> straight away.", body "What was already read stays in the graph. Nothing new arrives from <name>, so decisions and ownership drawn from it stop being kept up to date until it is connected again." plus either "The app stays installed on <name>; only the reading ends here." or "To pause without giving the access back, use the switch instead.", buttons cancel and "Disconnect".

States. Loading: nine card skeletons "Loading the catalogue" and eight rail skeletons "Loading the categories". No workspace: "A connection is held by a workspace, and this organization has none yet. Make one under Overview, and this catalogue connects to it." Catalogue error: "This Memnox cloud has no integration provider configured, so there is no catalogue to list. Whoever administers it has to set a Composio API key.", "You do not have access to this workspace's connectors.", or "The catalogue could not be reached, so nothing is listed." Empty: "Nothing loaded so far is in that category. Show more, or pick another.", "Nothing connected yet. Switch to All and turn one on.", "None of the fully supported systems is loaded yet. Show more, or search for Slack, GitHub, GitLab, Jira, Linear, Notion or Discord.", "No system here matches that."

**What gets in the way.**

- Three names for one page: nav "Connectors", header "Connected systems", step card "Connected systems". The step strip below repeats the header in a second style. [Consistency]
- Before the catalogue a person reads a two tile explainer, a possible chat card, a possible plan wall, a step strip, a possible banner, five tabs and a picks line. The thing they came to do, find Slack, starts well below the fold. [Hierarchy] [Progressive disclosure]
- The no workspace notice points to "Overview", which is not in the nav. [Consistency]
- The "Fully supported" tab hides the seven systems that matter until they happen to be paged in, and its own empty copy tells the reader to search for them. The useful set is known in code (`sourceProviders`) and is not pinned. [Hierarchy]
- "Cancel" on an unfinished grant fires a disconnect with no confirm and no busy label, and "Pull history" with no history support is hidden rather than explained. [Accessibility]
- The connect banner title cases the slug, so "googledrive" shows as "Googledrive" while the card above says "Google Drive". [Consistency]
- The Disconnect control is an icon only button beside a text button; on touch it has no visible word. [Accessibility]
- "<n> of <total> loaded" counts only what is paged in, which reads as the size of the catalogue. [Contrast]
- The pause switch carries no visible label; its state is only in the aria label. [Accessibility]

**Improved.**

```
Connectors
What Memnox reads to learn how your team decides. Connecting gives no agent anything new.  ⓘ What connecting does

[ 1 Connectors · 2 systems ] → [ 2 What Memnox reads · Nothing linked yet ]

✓ Slack is connected. 3 feeds are now reading, and 2 more need a channel named first.  [ Name channels → ]

You picked Slack and GitHub during setup. Each needs its own approval.

Start here
┌ Slack ────────────┐ ┌ GitHub ───────────┐ ┌ Linear ───────────┐ ┌ Jira ─────────────┐
│ Fully supported   │ │ Fully supported   │ │ Fully supported   │ │ Fully supported   │
│ The decisions     │ │ Systems,          │ │ Work in flight,   │ │ Approval chains   │
│ people make.      │ │ ownership, change │ │ owners, deps      │ │ as practised      │
│ Connected since   │ │ Not connected     │ │ Not connected     │ │ Not connected     │
│ Oct 2  Reading ◉  │ │ [ Connect ]       │ │ [ Connect ]       │ │ [ Connect ]       │
│ [Pull history]    │ │                   │ │                   │ │                   │
│ [Disconnect]      │ │                   │ │                   │ │                   │
└───────────────────┘ └───────────────────┘ └───────────────────┘ └───────────────────┘

Everything else
[ Search 1,000 systems Memnox can read from ]   [ Category ▾ ]
[All] [Systems of record] [Systems of conversation] [Connected 2]
...cards...                                 [ Show more ]
```

- One name, "Connectors", in nav, header and step card.
- The explainer collapses to one line with an "ⓘ What connecting does" disclosure; first time visitors see it open.
- A "Start here" row pins the fully supported systems from `sourceProviders` so Slack, GitHub, Linear and Jira never depend on paging.
- The success banner names the next step ("Name channels", to `/sources`) when feeds need a channel.
- Disconnect becomes a labelled text button; the pause switch shows "Reading" or "Paused" beside it; "Cancel" on an unfinished grant asks once.
- The banner uses the catalogue's own name for the toolkit when it is already loaded.
- Fix "Make one under Overview" to point at the page that actually creates a workspace.

### Connect dialog

`components/connectors/connect-dialog.tsx` · reached from: "Connect" or "Finish connecting" on a connector card.

**Job.** What will this system let Memnox read, before I hand it over?

**Today.** A dialog with the Memnox mark and the system's mark joined by a line. Title "Connect with <name>", description "Confirm what <name> will let Memnox read before you continue." A heading "<name> requires:" over a checked list from `grantedAccess`, for example Slack: "Read messages in the channels you choose.", "See who is in the workspace, so people can be matched to their accounts.", "Reply where it is mentioned, and nowhere else." Unknown systems get "Read the <name> data you share with it, and nothing else." and "See who authored what, so people can be matched to their accounts." A note: "<name> opens in its own window to ask what you want to share, and you can disconnect here at any time." which turns into "Finish on <name>'s screen in the window that just opened. This stays as it is until you do." Footer: cancel and "Connect" (becomes "Waiting for <name>"). On success the dialog closes and the page shows the outcome banner. Failure lines come from `connect-failure.ts` (the popup refusing an unusable link, or the start call failing). If the popup is blocked the consent flow navigates the tab, and `/connect/callback` sends it back with the result. The callback page itself shows the Memnox mark and "Finishing up, one moment." or "You can close this window."

**What gets in the way.**

- The heading "<name> requires:" frames Memnox's own read access as the provider's demand, which inverts who is asking. [Consistency]
- There is no way to cancel the waiting state once the popup is lost behind another window; the dialog sits on "Waiting for <name>" with no "Open the window again". [Accessibility]
- The list is checkmarks in a green dot, which reads as "already granted" rather than "will be asked". [Contrast]

**Improved.**

```
        [Memnox] ──── [Slack]
Connect Slack
Memnox will ask Slack to let it:
 • Read messages in the channels you choose.
 • See who is in the workspace, to match people to accounts.
 • Reply where it is mentioned, and nowhere else.
It never acts for an agent. You can disconnect at any time.

Finish on Slack's screen in the window that just opened.
[ Open the window again ]
[ Cancel ]                                  [ Waiting for Slack… ]
```

- Reword the heading so Memnox is the one asking, and use neutral bullets.
- Offer "Open the window again" while waiting.

### Sources, what Memnox reads

`/sources` (`components/sources/org-sources-view.tsx`) · reached from: the step card "2 What Memnox reads" on Connectors or Sources; not in the sidebar.

**Job.** Which channels, repositories and spaces inside the connected systems does Memnox actually walk?

**Today.** Header "Sources", description "Step two: which channels, repositories and spaces Memnox walks inside those systems. It only reads, and governs no agent. A file that was never in one is uploaded on Files." The same ingestion step strip as Connectors, with step 2 highlighted. Then:

- The linked list, when any: each row has the source mark, its label, "<System> / <external id>" with the id in mono, a "Not connected" chip when the system behind it is gone (tooltip "<system> is not connected, so nothing is being read from this source."), and for admins an X "Remove <label>" that writes at once with no confirm.
- When nothing is linked but systems are connected: "Nothing linked yet. Until something is, the organization has no record of its own and every workspace reads only its own work."
- For admins, the add form (`add-source-form.tsx`): a select "System" listing each connected system once, a search field "Search <system>", and a scrolling list of what that system holds. Each row: mark, label, a lock for private, a meta line "<description or id> · <date>", and a button cycling "Link", "Linking", "Linked", "Unlinking". "More than fits here. Search to narrow it." when there are more pages. Search empty: "Nothing in <system> matches that." Not answering: "<system> is not answering, so what it holds cannot be listed right now. Nothing already attached has changed."
- When the system cannot list (`listing-note.tsx`): "<name> is no longer letting Memnox read it, so there is nothing here to pick from. Connect it again and what it holds comes back." with "Connect <name>"; "<name> is not answering, so what it holds cannot be listed right now. Nothing already linked has changed, and naming one by hand still works." with "Ask again"; "Memnox can see none of your <things> yet. <name> grants them one at a time in its own settings, so pick the ones to read there and they appear here." with "Choose <things>"; "<name> holds no <things> this connection can see. Name the source instead."; "<name> lists nothing to pick from here. Name the source instead."
- The typed fallback: a field named for the system's noun with an example placeholder, "Name it" marked "optional", a readout ("Reads <noun> <id>", "No <noun> in that. <how to find it>", "That one is already on the list.", or the hint), and "Add source".
- With nothing connected: "Connect a system first", "Memnox reads nothing until one of your tools is connected. Connect one, then name the channels, repositories and boards to read inside it." and "Connect a system".
- Errors: "Memnox cannot reach the part of the system that tracks connections, so it cannot say which are connected. Nothing has been lost." and save failure "That source could not be saved, so nothing changed."
- Loading: "Loading the sources", "Loading the systems". Non admins see the list only and no form, with no sentence saying why.

**What gets in the way.**

- Not in the nav, and its header "Sources" matches neither the step card "What Memnox reads" nor anything in the sidebar. [Consistency]
- Remove is an unlabelled X that writes immediately, while "Link" is a filled primary button; removing a channel that feeds decisions is the riskier act and gets the quieter, unconfirmed control. [Contrast]
- A non admin gets a bare list with no explanation of who can change it, unlike the connector cards which say so. [Consistency]
- Linked sources and the picker list are two lists of the same objects in two styles, so the "Linked" state in the picker and the row above are hard to connect. [Proximity]
- Only the first workspace's connections are consulted, so a system connected in another workspace shows "Not connected". [Accessibility]

**Improved.**

```
What Memnox reads
Step two: the channels, repositories and spaces Memnox walks. It only reads.

[ 1 Connectors · 2 systems ] → [ 2 What Memnox reads · 3 sources ]

Linked · 3
 #eng-decisions        Slack / C04ABCD         [ Unlink ]
 memnox/runtime        GitHub / memnox/runtime [ Unlink ]
 ENG board             Jira / ENG   Not connected: reconnect Jira

Add from  [ Slack ▾ ]  [ Search Slack            ]
 #eng-decisions   Engineering calls · Oct 6    ✓ Linked
 #release         Release planning · Oct 1     [ Link ]
 More than fits here. Search to narrow it.
Can't find it? Name it by hand ▸

Only an administrator can change what Memnox reads.   (non admins)
```

- Name the page "What Memnox reads" everywhere, matching the step card.
- "Unlink" as a word, with an undo line in the reserved note, rather than an X.
- "Not connected" carries the fix ("reconnect Jira") as a link to Connectors.
- Hide the typed field behind "Name it by hand" unless listing failed.
- Tell non admins who can change it.

### Files

`/files` (`components/sources/org-documents-view.tsx`) · reached from: sidebar Inputs > "Files"; the Sources header ("uploaded on Files", not a link).

**Job.** Which company documents that live in no connected system does Memnox read?

**Today.** Header "Files", description "A handbook, a policy, a board minute: whatever the company runs on that was never in a connected system. A decision drawn from one links back to it. Memnox only reads them, so uploading one governs no agent."

- Filters, only from four files up: search "Search by file name" with a clear button "Clear search", type chips starting "All" with counts per extension, and a sort select "Order documents by" with "Newest first", "Oldest first", "Name A to Z", "Largest first", and a "<shown> of <total>" count.
- The list: a file icon, file name, "<size> / <uploaded date>", a cloud icon labelled "Hosted storage" when stored remotely, then icon buttons "Open <file>" (new tab), "Download <file>", and for admins "Delete <file>".
- Delete confirm: "Delete <file>?", "The file goes, and so does the source event that carried its text into the graph.", body "If a decision or a draft was drawn from this file, the delete is refused and says which one. Withdraw that first, then remove the file.", confirm "Delete".
- Admins see a drop zone: "Drop a file here, or choose one." then "txt, md, csv, json, pdf, docx, up to 10MB"; while uploading "Reading it now." Several files upload in turn and stop at the first failure.
- Empty: "Nothing uploaded yet. What is here is read alongside every system your team is connected to." Filtered empty: "No file here matches that. Clear the search or pick another type." Loading: "Loading the documents". Error: "The files could not be loaded." Refusals: "Memnox reads txt, md, csv, json, pdf, docx. <file> is not one of them.", "That file could not be uploaded, so nothing was added.", "That file could not be removed, so nothing changed."

**What gets in the way.**

- The drop zone sits under the list, so on a long list the only way to add a file is at the bottom of the page, and on an empty page it comes after the empty sentence rather than being the empty state. [Hierarchy]
- Non admins get no drop zone and no sentence saying who can upload. [Consistency]
- A multi file upload stops silently after the first failure; the files after it are neither sent nor named. [Accessibility]
- Three icon only buttons per row, with Delete next to Download. [Accessibility] [Proximity]
- Nothing on a row says whether anything was drawn from the file, which is exactly what decides whether delete will be refused. [Proximity]

**Improved.**

```
Files                                                    [ Upload a file ]
A handbook, a policy, a board minute. Memnox only reads them.

┌ Drop files here, or choose them. txt, md, csv, json, pdf, docx, up to 10MB ┐
└────────────────────────────────────────────────────────────────────────────┘
 Engineering handbook.pdf   2.1 MB / Sep 30   2 decisions drawn   [Open] [Download] ⋯
 Release policy.md          14 KB / Sep 12    nothing drawn       [Open] [Download] ⋯
 Uploaded 2 of 3. board-minute.pages was not sent: Memnox reads txt, md, csv, json, pdf, docx.
```

- Upload as a header action, with the drop zone on top and acting as the empty state.
- Say per row how many decisions were drawn from the file, so a refused delete is foreseeable; Delete moves into a row menu.
- Report a multi upload as "Uploaded n of m" and name what was skipped.
- Non admins read "Only an administrator can add or remove files."

### Meetings

`/meetings` (`components/meetings/meetings-view.tsx`) · reached from: sidebar Inputs > "Meetings".

**Job.** Which calls was Memnox sent to, why was it entitled to be there, and what was said?

**Today.** Header "Meetings", description "What Memnox was sent to record, and why it was entitled to be there. A transcript that comes back is evidence like any other: it lands on the memory map, cut where the speaker changes, with who said which part of it." Header action "Send it to a call" (video icon), which toggles to "Never mind"; hidden when the plan has no recording hours and no bought credit.

- Invite note, when the cloud returned a notetaker address: with a calendar connected (Google Calendar, Outlook or Calendly) "Add <address> to an event on <calendars> and Memnox joins that call."; without one "Memnox joins from invitations only on a calendar connected here. Connect one to get the address to invite." with "Connect one" linking to `/connectors`.
- No hours wall: "This plan records no meetings yet", "Nothing has been spent and no month brings any back. Buy recording hours and a bot can attend on this plan, or move up to a plan that includes them every month." and the link "Buy hours, or change the plan" to `/settings/billing`.
- Join form "Send Memnox to a call": "For a call already happening. You are recorded as having authorised it, which is what makes this a stronger claim than an invitation and why it is your credential being spent rather than a link alone." Fields with screen reader labels only: "Meeting link" (placeholder "https://meet.google.com/abc-defg-hij"), "What to call it" (placeholder "Architecture sync"), and when Slack or Discord is connected a searchable select "Post decisions in" (search "Find a channel", empty "That connection lists no channels. Invite the Memnox bot to one first."). Button "Send" (busy "Sending"), disabled until a link is typed. A note: "Connect Slack or Discord to post this call's decisions in a channel. Until then they wait under Waiting on you." or "Decisions, rules and approvals from this call are posted in that channel. Without one they wait under Waiting on you."
- Table: "Meeting" (title, and the platform as a link to the call), "Where it is up to" (status pill "scheduled", "joining", "recording" in red, "ended", "transcribed" in green, "failed" in red, "cancelled" in grey, and the cloud's own sentence under it), "Why it was there" ("Invited" or "Asked for", with who), "When", "Transcript" ("Not yet" or "Read it" toggling to "Hide"), and actions "Call it out" (when cancellable) and "Forget".
- The transcript opens in a panel below the whole table: the meeting title, then the speaker turns preformatted; "What was said in this call is classified above what you are cleared for, so it is withheld rather than trimmed." or "Recall has not produced a transcript for this call yet." Loading "Loading the transcript".
- Empty: "No meeting recorded yet", "Send it to a call with the button above, or invite it from a connected calendar. Memnox never joins a call it was not asked into." Loading: three row table skeleton. Errors: "The bot could not be sent, so nothing is recording and no hours were spent.", "That bot could not be called out.", "That meeting could not be forgotten."

**What gets in the way.**

- "Forget" deletes the meeting and its record with one click and no confirm, beside the reversible "Call it out" in the same style. [Contrast]
- "Recording" and "failed" share the red pill, so a live recording and a broken one look alike; status words are lower case raw enum values. [Contrast] [Consistency]
- The transcript opens beneath the whole table, far from the row that opened it, and the only sign is the button changing to "Hide". [Proximity]
- The join form has no visible labels, only placeholders, so the second field reads as an example title rather than a field. [Accessibility]
- "Call it out" is idiom that does not say what happens (the bot leaves). "Send it to a call" has no object either. [Consistency]
- The wall hides the header action entirely, so a person on a plan with no hours never learns where the button would be. [Progressive disclosure]
- The vendor name "Recall" leaks into product copy. [Consistency]

**Improved.**

```
Meetings                                          [ Send Memnox to a call ]
What Memnox was sent to record, and why it was entitled to be there.

Invite notes@acme.memnox.app to an event on Google Calendar and Memnox joins that call.

 Meeting               Where it is up to             Why it was there     When
 Architecture sync     ● Recording now               Asked for by Ana     14:02   [ Make it leave ]
 meet.google.com       Recording since 14:02
 Release review        Transcribed                   Invited              Oct 6   [ Read transcript ▾ ] ⋯
   ┌ Ana: we ship Thursday, not Friday …                                          ┐
   └──────────────────────────────────────────────────────────────────────────────┘

Send Memnox to a call
Meeting link [ https://meet.google.com/abc-defg-hij ]
Name         [ Architecture sync ]   optional
Post decisions in [ #eng-decisions ▾ ]
You are recorded as having authorised it.                          [ Send ]
```

- Visible labels on every field.
- "Recording now" gets its own dot and word, distinct from "Failed"; Title case status words.
- The transcript expands under its own row.
- "Make it leave" replaces "Call it out"; "Forget" moves into a row menu with a confirm saying the record and transcript go.
- On a plan without hours keep the action visible, opening the hours wall in place.
- Say "the transcript service" rather than naming the vendor.

---

## Organization

The sidebar group "Organization" holds three rows in this order: "People" (`/members`), "Billing"
(`/settings/billing`) and "Settings" (`/settings`). Billing is reached twice, because it is also
a row inside the settings tree. Inviting is a page of its own under People.

### People

`/members` (`app/(workspace)/members/page.tsx`, `components/settings/members/members-view.tsx`) ·
reached from: the sidebar row "People" under "Organization"; "Back to members" after inviting;
a `?tab=` deep link (for example from chat setup, which lands on `?tab=people`).

**Job.** Who is in this organization, who has been invited and not accepted, and what each
person may do.

**Today.**

The browser tab title is "Members". The page header has the eyebrow "Organization" with a
building icon, the title "Members", and the description "Everybody in this organization, who has
been invited, and the teams they are in. Everyone reaches all of it, so a role is what they may
do with it." An administrator also sees the header action "Invite members", which goes to
`/members/invite`. Anybody else sees no action.

Under the header, a tab strip with counts:

- "All members" (count of members)
- "Invited" (count of pending invitations)
- "Teams" (count of teams)
- "Departments" (count of declared departments)
- "People in your systems" (no count)

The tab is read once from `?tab=` and then held in page state, so the address bar does not follow
later clicks.

**All members and Invited tabs (the roster).** A search field with the placeholder "Search by
email..." (screen reader label "Search members by email"); it matches email, then name, then
department. To its right, a live count: "N person" or "N people", or "N of M" while filtering.
Below, one table where members and pending invitations share rows. Columns:

1. "Name": avatar, the name with " (you)" for the signed in person, and under it the email plus
   title and department joined by " · ". An invitation shows a dashed circle with a send icon,
   the address, and "Invited by <name> · expires <Mon D>".
2. "Clearance": "Restricted" (info pill with an eye icon) when the member has organization wide
   reading, otherwise plain "Internal". Invitations always read "Internal".
3. "Role": a pill with the raw role word, "admin", "reviewer" or "viewer".
4. "Status": "pending" (warn) for an invitation, "active" (good) or "suspended" (bad) for a
   member.
5. A row menu of dots labelled "Actions for <name>". For a member: "Manage access" (admins only)
   and "Copy email address". For an invitation: "Copy email address" and, for admins, "Revoke
   invitation" in the danger tone.

Sorting puts you first, suspended people last, the rest by name. On the Invited tab the roster is
handed no members, so only invitations show.

"Revoke invitation" opens a confirm dialog: title "Revoke this invitation?", description "The
link sent to <email> stops working straight away.", body "Nobody is removed by this, because
nobody has accepted yet. You can invite the same address again whenever you like.", confirm
button "Revoke invitation".

"Manage access" opens a drawer labelled "Manage <name>". Its header repeats the avatar, name, " (you)",
email, the role pill and a "suspended" pill when it applies. The body:

- "What <name> may do", then the privilege checklist (shared with the invite page), four
  checkbox rows:
  - "Read this organization's work": "Decisions, activity, incidents and the graph." Always
    ticked and locked.
  - "Approve and confirm": "Clear the work an agent is held on, and confirm decisions."
  - "Change settings": "Create workspaces, invite people, connect systems, and billing."
  - "Read every workspace": "Sees everything here and can change none of it. For whoever has to
    answer for what the agents did."
    Ticking a higher row raises the role and locks the rows under it, whose description gains
    " Included by changing settings." Each change saves at once; a failure reads "That change
    could not be saved, so nothing changed." On your own account the role rows are a read only
    summary.
- For somebody else, two buttons: "Suspend access" (danger tone while active) or "Restore
  access", and "Remove from organization" (danger). The note under them reads "Suspending stops
  the cloud authenticating them on their very next request, and is undone here. Removing erases
  the account and frees its seat, and cannot be undone." (or "Restoring lets them sign in
  again." in place of the first sentence).
- For yourself: "You cannot suspend your own account, and you cannot lower your own access.
  Another administrator does both."

"Suspend access" confirms with "Suspend <name>?", "They keep their place in the organization, but
the cloud stops authenticating them.", body "Anything in flight under their name stops at their
next request. You can restore them here at any time, and nothing they decided is removed.", button
"Suspend access". "Restore access" acts without a dialog. "Remove from organization" confirms with
"Remove <name>?", "Their account is erased and the seat goes back to the plan. Suspending is the
reversible version of this.", body "Their credential stops working at once. What they decided or
approved stays in the audit trail under their name, and inviting them back makes a new account.",
button "Remove from organization"; the drawer closes only on success.

**Teams tab.** A panel titled "Teams" with the meta "N team" or "N teams". Lead copy: "A team
names who does the work. It changes nothing about what anybody may reach, since that is the role
on their account." Each team is a tinted block with its name, a member count and an optional
description, then a list of members (name, email when it differs from the name, a role pill
"Viewer", "Reviewer" or "Admin" with the tooltip "<Role label>. Set on their account, under
Members.", and for admins an X labelled "Take <name> off <team>"). A deleted account reads
"Somebody no longer in the organization". An empty team reads "Nobody on it yet. Add somebody
already in the organization." Admins get "Add somebody" and "Disband", with the note "A role
comes from the account, not from this team."

"Add somebody" opens an inline picker: a search field "Search the organization" (only when more
than five candidates), a radio list labelled "Who joins", then "Add to team" (busy "Adding"),
"Cancel", and the note "No seat is spent and no access changes: they keep the role their account
already holds." With nobody left to add: "Everybody in the organization is on this team already.
Somebody new joins the organization first, under Members." A search with no hits: "Nobody in the
organization matches <term>."

"Disband" confirms with "Disband <team>?", "The group goes. Nobody loses the workspace by it.",
body "Everyone on it keeps their access to this workspace, because that is a grant of its own.
Take somebody off the workspace itself to remove it.", button "Disband team".

Admins see "New team" at the foot, which turns into a field (placeholder "Reliability", label
"Name for the new team"), "Create team" (busy "Creating"), "Cancel", and the note "Name it after
what the group does, not who is in it." or "This workspace already has a team called <name>."
Enter creates, Escape cancels.

**Departments tab.** A card "Departments": "What this organization is divided into. Members are
filed under these, and an invitation can only choose one that exists here." Each department is a
chip with a count of members filed under it and, for admins, an X "Remove <department>". None:
"None yet. Add the first one and it becomes a choice on every invitation." Admins get "Add a
department" (placeholder "Customer Success"), button "Add" (busy "Saving"), and the note "Press
Enter to add. Removing one leaves the members already filed under it unchanged." or "<name> is
already here." Removing a department with members confirms "Remove <department>?", "N people are
filed under it today.", body "They keep the department written on them, and nobody loses access.
It simply stops being offered on new invitations.", button "Remove department". An empty
department is removed without asking.

**People in your systems tab.** A panel headed "People": "Who the graph knows about, and every
provider account resolved to them. Ownership and approval routing both depend on this being
right." Header action "Connect a system" goes to `/connectors`. A second tab strip: "All",
"Linked", "No account", "No email", each with a count. Four stat tiles: "People" ("Resolved from
connected systems", with an eight week sparkline), "Linked accounts" ("Provider identities
matched to a person"), "Providers" ("Systems contributing identities"), "No email" ("Cannot be
safely merged yet").

When the cloud offers likely duplicates, a section "Possibly the same person": "Merging moves
every account onto one record, and the memory map draws them as one person from then on." Each
pair reads "<A> and <B> hold the same address or account" (or "have the same name", "have one
name inside the other") with a button "Merge into <B>". It merges at once, with no confirm.

Then a paginated table, eight rows a page: "Person" (avatar, name, first email or "No email on
record"), "Accounts" (provider pills "github · handle", or "none linked" in warn), "Emails"
(count), "First seen", "Updated", and a "Link" button per row. Empty: "Nobody in this view",
"People are built from the member lists of connected systems. Connect Slack, GitHub or Jira and
they appear here."

"Link" opens the dialog "Link <name>": "Memnox joins two records when they share an address and
never on a name alone. Everything else is somebody saying so." Two sections:

- "Attach an account": an explanation of attribution going forward only, the current account
  pills "provider · id", three fields "Provider" (free text with suggestions, placeholder
  "github"), "Account id" (placeholder "maya"), "Handle, optional", and the button "Attach to
  <name>".
- "This is the same person as": "Every account and address on <name> moves onto the record you
  choose, and this one stops existing...", a select "Choose the record to keep", and the button
  "Merge into" or "Merge into <other>". Merging closes the dialog on success.
- Footer: a cancel button.

**States.** Roster loading: the search stays, the table is a six row skeleton "Loading the
roster". Roster error: "Members cannot be read with this session. An administrator sees the full
list here." Empty All members: "Nobody has been provisioned yet. Invite somebody and they hold a
credential from the moment they accept." Empty Invited: "No invitation is waiting to be accepted.
Somebody invited appears here until they do." No search match: "Nobody here matches <term>." with
"Clear the search". Teams loading: "Loading the teams"; teams error: the API message or "The
teams could not be loaded."; no teams: "No teams yet. Make the first one and add the people who
work on it." People tab loading: a six row table skeleton. Merge or link failures print the raw
error message in red. Non admins see every list and no action. The page renders with no
workspace resolved (`worksWithoutWorkspace`). No offline state of its own.

**What gets in the way.**

- The sidebar row says "People", the page title says "Members", the action says "Invite
  members", and a tab inside it says "People in your systems" with its own heading "People". One
  word names two different lists. [Consistency]
- Five tabs mix two unrelated questions: who holds a Memnox credential (members, invited, teams,
  departments) and how identities from Slack, GitHub and Jira resolve to humans. The second sits
  last and carries its own second tab strip, four stat tiles and a table, so the page is two
  pages stacked. [Progressive disclosure] [Hierarchy]
- The "Role" pill prints the raw lowercase words "admin", "reviewer", "viewer" while the team
  list prints "Admin", "Reviewer", "Viewer" and the checklist speaks of "Approve and confirm".
  The same fact appears in three vocabularies. [Consistency]
- "Clearance" with values "Internal" and "Restricted" reads as a sensitivity label of the person,
  but it is whether they hold "Read every workspace". Nothing on the roster links the column to
  that checkbox. [Consistency]
- "Approve and confirm" is the role that lets somebody answer a held agent, which is the most
  important power in the product, yet the roster never says who can answer. A team admin like
  Ana cannot see at a glance who will be asked when she is away. [Hierarchy]
- "Merge into <B>" in "Possibly the same person" ends a record with one click and no confirm,
  while removing a department with nobody in it gets a dialog. The irreversible act is the
  unguarded one. [Consistency]
- The dialog "Link <name>" puts an additive act and a destructive one under one footer with the
  same neutral button style; "Merge into" is not drawn as a danger action. [Contrast]
- Link and merge errors print `error.message` raw in red, where every other card on the page uses
  the worded refusal ("..., so nothing changed."). [Consistency]
- The tab state is not written back to the URL, so reload or back lands on "All members" again.
  [Consistency]
- The "Teams" disband dialog says "Everyone on it keeps their access to this workspace, because
  that is a grant of its own. Take somebody off the workspace itself to remove it." but the panel
  copy above says a team grants nothing and there is one workspace. The body describes a removed
  model. [Consistency]
- The roster row menu offers only "Manage access" and "Copy email address"; suspend and remove
  are two levels down, inside the drawer, inside a menu. That is deliberate, but there is no
  visible status filter, so finding the suspended people means scrolling to the bottom.
  [Progressive disclosure]

**Improved.**

```
Organization
People                                                [ Invite people ]
Everybody who can answer for this organization's agents, and what each may do.

[ Members 6 ]  [ Invited 2 ]  [ Teams 2 ]  [ Departments 3 ]
                                         Identities from your systems →

Search by name or email...                                   8 people
┌────────────────────────────────────────────────────────────────────┐
│ Name                         Can answer agents   Role      Status   │
│ Ana Ruiz (you)               Yes                 Admin     Active  ⋯│
│ ana@acme.dev · Platform                                              │
│ Bo Chen                      Yes                 Reviewer  Active  ⋯│
│ bo@acme.dev                                                          │
│ Kai Moreau                   No, reads only      Viewer    Active  ⋯│
│ lin@acme.dev  (invited by Ana · expires Oct 14) Reviewer  Invited ⋯│
└────────────────────────────────────────────────────────────────────┘
Reads every workspace: Ana. Suspended: none.
```

- One name everywhere: the row, the title and the action all say "People" and "Invite people",
  and the identity directory moves to its own link "Identities from your systems" (same
  component, its own route `/members/identities`), so the roster is one question. [Consistency]
  [Progressive disclosure]
- A column "Can answer agents" replaces "Clearance" and states the power that matters, in words,
  so Ana sees who is asked when she is away. Organization wide reading moves to a one line
  summary under the table. [Hierarchy]
- Role words are capitalised everywhere from `ROLE_OPTIONS.short`, so the roster, the team list
  and the drawer agree. [Consistency]
- "Merge into <name>" always goes through a confirm that names the record that stops existing,
  in the danger tone, and link and merge refusals use `apiRefusal` like every other card.
  [Contrast] [Consistency]
- The tab writes `?tab=` back to the URL with `router.replace`, so reload and back keep the
  place. [Consistency]
- The disband dialog body is rewritten to the current model: "Everyone on it keeps their role.
  A team only names who does the work." [Consistency]

---

### Invite people

`/members/invite` (`components/settings/members/invite/invite-view.tsx`) · reached from: "Invite
members" on People; "Invite more people" after a send.

**Job.** Who is being let into the organization, and with what they may do.

**Today.**

Top left a back link "Members" with an arrow. Header title "Invite members", description "They
receive a link, and accepting is what issues their credential. Nobody can sign themselves up, so
this is the only way in." Secondary header action "Documentation" with an outward arrow, opening
the docs page on roles.

For an administrator, three blocks:

1. Card "Add email addresses": "Everybody here receives the same invitation. Accepting is what
   issues their credential, and until then they hold nothing." One chip field (label "Email
   addresses", autofocused), placeholder "first@example.com, second@example.com" then "Add
   another". Enter, comma, space and semicolon end an address; paste splits a column; Backspace
   on an empty field removes the last chip. Each chip has an X "Remove <address>". A bad chip is
   red with a tooltip naming its problem. The note reads "Separate addresses with a comma, a space
   or a new line. A pasted column works as it is." or "N of these cannot be invited and are left
   out: <address> is malformed, <address> is already here, <address> is repeated."
2. Card "Add permissions": "Access is what they may do here, which is not the same as their job.
   It can be changed on the roster afterwards." Field "What they may do", "The three are ranked,
   so a higher one carries what is under it.", then the three role rows of the privilege checklist
   ("Read this organization's work", "Approve and confirm", "Change settings"); the default is
   viewer. Field "Department", "Which part of the organization they are filed under. Only a name
   the organization has declared can be chosen.", a select whose first option is "None declared
   yet" or "Not filed under one".
3. A send bar: the note "Add an address above and it goes out with the permissions on this page."
   or "N invitations go out, each expiring on its own if nobody accepts.", and the button "Send
   invitation" or "Send N invitations" (busy "Sending"), disabled until one address is valid.

After a send the form is replaced by an outcome card titled "Invitations sent" when all went, or
"What was sent" otherwise, with "N of M addresses now hold a link. They sit under Invited on the
roster until they accept, where the link can be revoked." Each address is a row with a green check
or a red cross and, when refused, the worded reason. Footer: "Back to members" (primary) and
"Invite more people".

**States.** Not an administrator: a single notice "Only an administrator can invite somebody into
this organization." Send failure: "The invitations could not be sent, so nobody was invited."
Partial: the outcome card lists both kinds. While members and invites are still loading, the
"already here" check silently has nothing to compare against. No offline state.

**What gets in the way.**

- The default role is viewer, which cannot answer an agent. A team admin inviting a teammate to
  share the answering, which is the reason to invite anybody in user flow 5, has to know to tick
  "Approve and confirm". The default works against the product's main job. [Hierarchy]
- The checklist describes roles but never says the plain consequence, "can answer a held agent",
  in the words the rest of the product uses. [Consistency]
- Nothing on the page says whether a seat is free. A Team plan at its seat count accepts the
  addresses and refuses them only in the outcome card. [Proximity]
- The back link reads "Members" while the sidebar row reads "People". [Consistency]
- A non administrator who follows a link here gets a dead end with no way to ask an admin and no
  link back except the small "Members" link. [Progressive disclosure]

**Improved.**

```
← People
Invite people                                              Documentation ↗
They get a link. Accepting is what lets them in; nobody can sign up alone.

Who
┌──────────────────────────────────────────────────────────────────────┐
│ [bo@acme.dev ×] [kai@acme.dev ×] Add another                         │
└──────────────────────────────────────────────────────────────────────┘
2 addresses ready.

What they may do
( ) Read only           Sees agents, rules and the record.
(•) Answer agents       Allow or deny a held call, confirm decisions.
( ) Run the organization  Also invites people, connects systems, pays.

Department   [ Not filed under one ▾ ]

Seats: 4 of 5 used. These 2 need 1 more seat.      [ Add 1 seat ]
                                      [ Send 2 invitations ]
```

- Roles become one radio group with the default "Answer agents", because inviting somebody is
  almost always asking them to share the answering. [Hierarchy]
- The seat line reads `useBilling` (already used on Billing) and states the shortfall before the
  send, with the seat change from Billing one press away. [Proximity]
- Names match the sidebar: "People", "Invite people". [Consistency]
- For a non administrator, the notice names the admins from `useOrgUsers` ("Ask Ana or Kai to
  invite them") and links back. [Progressive disclosure]

---

### Billing

`/settings/billing` (`components/settings/billing-settings.tsx`) · reached from: the sidebar row
"Billing" under "Organization"; the settings tree row "Billing" under "Organization"; every
"What changes on <plan>" link a plan wall draws across the console.

**Job.** Which plan this organization is on, how much of it has been used this month, and how to
get more.

**Today.**

Inside the settings frame (see Settings below), so the pane opens with "Organization", the title
"Billing" and "The plan this organization is on, and what it has used this month."

1. Card "Plan": "What this organization is subscribed to, and the allowances that come with it.
   One plan covers every workspace." The plan name large, then the price ("$19/mo", or
   "$18/person/mo · 5 seats · $90/mo" on a per seat plan, nothing on Free), and a pill "in good
   standing" (good) or "quota spent" (bad) when governed actions are used up. Seven fact tiles:
   "Agents" (for example "3 of 5", "3 of 5 + 10", "Unlimited" or "3, no limit"), "Machines",
   "Team memory sources", "Your own apps" ("Any tool, unlimited" on every plan, since no plan counts
   them), "Seats" ("N bought" or the plan count), "Recording" ("N hrs/mo", "None",
   "Unlimited"), "Memory" ("90 days", "6 months", "1 year", "Forever"). Agents and Machines are left
   out when the cloud does not send them. Footer "Billing period <month>".
2. Card "This month": "What the organization has used against its allowance, pooled across every
   workspace. They all reset when the billing period does." Three meters, each label, "used of
   limit" in mono (plus " · N bought" for credit), a bar that turns red when spent, and a note:
   - "Governed actions", "Every action an agent checked against the rules."
   - "Extraction runs", "Each pass Memnox made over your events to read decisions out of them."
   - "Recording hours", "Hours of meeting actually recorded, counted when a recording ends."
     A spent meter adds "This allowance is spent for the period." and, for the last two, a plan
     wall: a sentence on what the next plan changes and the link "What changes on <plan>", which
     points back at this same page. Under the meters: "Usage over time breaks the same allowances
     down by day and by workspace." with "Usage over time" linking to `/usage`.
3. Admins only, the top up cards, each present only when the catalogue offers it:
   - "Extra agents": "Raise how many agents may hold a credential at once, pooled across every
     workspace this account owns. $N an agent a month, on top of what your plan already gives.
     Cancelling drops back to the plan's own and revokes nothing: what you already enrolled keeps
     working." Preset buttons "+5", "+10" and so on, and a number field. Footer: a sentence such
     as "3 enrolled against 5 agents on this plan, and none bought" and the action "N extra ·
     $X/mo" (disabled, nothing changed) or "Set to N · $X/mo".
   - "Recording hours, every month": tier tiles ("+$N/mo", or "current" on the held tier), footer
     "No pack on this account" or "Adding N hours a month", action "Choose a pack" or "Add Nh a
     month · +$N/mo".
   - "Meeting recording hours": "$N an hour, paid once, and spent only after the plan's own hours
     are gone.", presets "+5h" and so on, a number field, footer "N hours = $X once", action "Buy
     Nh · $X".
   - "Memory window": "Extend how far back Memnox can recall this workspace's context. Billed
     monthly, and cancelling falls back to the plan's own window." Tier tiles (a tier shorter than
     the current window reads "already covered" and is disabled), footer "Currently keeping
     <window>", action "Choose a window" or "Extend to <label> · +$N/mo".
4. Admins only, card "Change plan": "Upgrading takes effect when the payment clears. Downgrading
   to Free is done by cancelling the subscription." A "Monthly" and "Annual" toggle in the card
   header, footer "Annual is ten months' price for twelve." One tile per plan on sale: name, price
   ("$0", "Custom", "$19/mo", "$18/person/mo"), for per seat plans "from 5, so $90/mo to start",
   a checklist of what the plan adds over the one before, a "Seats" number field (reads "People"
   on the current plan), and one action: "current" pill (with "N seats billed"), "Add N seats" or
   "Remove N seats" on the current per seat plan, "Talk to sales" for a contracted plan, the line
   "Cancel to return here" on Free, or "Switch" / "Switch · $X".

Actions. "Switch", "Buy", "Set to", "Add" and "Extend" open the Lemon Squeezy checkout as an
overlay over the console, with a side summary "You are buying", the item, the amount, up to four
plan lines and "Payment is taken by Lemon Squeezy, who appear on your statement. Cancel any time
from Billing." Closing it returns to the page, which refetches. A seat change on the current plan
does not leave the app: it opens a confirm, first "Change seats" / "Pricing this change." with a
skeleton, then either:

- "Too few seats": "N people hold a credential here, so this cannot go below N seats." / "Remove
  the people first, on the Members page, and the seats can come down afterwards. Nothing has been
  charged."
- or "Add N seats" / "Remove N seats" with "N people will be able to hold a credential, from the
  moment Lemon Squeezy confirms the payment.", rows "Seats" ("5 to 7"), "Charged today" ("up to
  $36, plus tax" or "nothing"), "Renews monthly" ("$126, was $90"), and a proration note. Removing
  is the danger tone.
- or, when pricing fails, "This change could not be priced, so nothing has been charged."

After a paid seat change that is still settling: "Payment sent for N seats. The seat appears here
once Lemon Squeezy confirms it, usually within a few seconds."

**States.** No workspace: card "Plan" with "Memory is made with the organization, so this failed
rather than needing setup. Sign out and back in, then tell whoever runs this Memnox." Loading:
"Plan" with a four line skeleton "Loading the plan". No record: "No billing record for this
organization yet." Catalogue loading: skeletons labelled "Loading usage" (Change plan) and
"Loading invoices" (Top ups). Catalogue missing: "The plan catalogue is unavailable, so nothing
can be priced right now." No add ons: "This deployment does not offer top-ups yet." Checkout
failure under each card: "Checkout could not be opened, so nothing was charged." Viewers and
reviewers see the plan and the meters only.

**What gets in the way.**

- The overlay and the plan card both say to cancel from Billing ("Cancel any time from Billing.",
  "Downgrading to Free is done by cancelling the subscription.", "Cancel to return here"), and
  there is no cancel action anywhere on the page, no invoice list and no link to the provider's
  portal. The page promises a door it does not have. [Consistency]
- The skeleton labels are wrong: "Change plan" loads as "Loading usage" and the top ups as
  "Loading invoices", so a screen reader announces things that are not there. [Accessibility]
- The plan wall under a spent meter links "What changes on <plan>" to `/settings/billing`, the page
  it is already on, so the link does nothing visible. [Consistency]
- Four top up cards sit above "Change plan" and above nothing else, so an admin who came to add
  one seat scrolls through agent packs, recording packs and memory windows before reaching the
  seat field, which is hidden inside the current plan's tile. Adding a person is the most common
  money act on a team. [Hierarchy] [Progressive disclosure]
- "Recording hours, every month" and "Meeting recording hours" are two cards for one allowance,
  named differently, one after the other. [Consistency]
- The seat field on the current plan reads "People" and on every other tile "Seats", for the same
  number. [Consistency]
- "Governed actions" spent shows a red bar and the pill "quota spent" but never says what happens
  to agents when it is spent: whether they are held, allowed, or refused. For a control plane
  that is the one thing an admin needs to know. [Proximity]
- Billing is reached from two places in two trees (sidebar and settings tree), and the settings
  pane heading says "Organization" over it, so the person cannot tell which tree they are in.
  [Consistency]

**Improved.**

```
Billing
Team · $18 a person a month · 5 seats · $90 a month          In good standing
Billing period October 2026

Seats      5 billed, 4 used                     [ Add a seat ]  [ Remove ]
Agents     3 of 5 enrolled
Machines   2 of 10
Memory     6 months

This month
Governed actions    41,210 of 100,000   ████████░░░░░░░░
  When this runs out, agents keep running and every action is asked.
Extraction runs     312 of 1,000
Recording hours     4h of 10h                         Usage by day →

Invoices and payment
Oct 1  $90  Paid    Sep 1  $90  Paid       [ Manage payment ]  [ Cancel plan ]

More for this organization                                 [ Show ▾ ]
  Extra agents · Recording hours · Memory window

Change plan                                   Monthly | Annual
  Free $0     Pro $19 a month     Team $18 a person     Enterprise  Talk to sales
```

- Seats become the first row of the plan card, with "Add a seat" and "Remove" opening the
  existing seat confirm, because adding a teammate is the common act. [Hierarchy]
- Each meter says what happens when it is spent, in one sentence beside the number. [Proximity]
- An "Invoices and payment" block with "Manage payment" and "Cancel plan" links to the provider's
  customer portal, so the promise in the overlay is kept. Until the cloud returns a portal URL,
  the overlay line and the Free tile drop the word "cancel". [Consistency]
- The four top ups fold into one disclosure "More for this organization", and the two recording
  cards merge into one with "Once" and "Every month" as a toggle. [Progressive disclosure]
- Skeleton labels read "Loading the plans" and "Loading top-ups". [Accessibility]
- The plan wall link on this page scrolls to `#change-plan` instead of reloading itself.
  [Consistency]

---

### Settings frame

`app/(workspace)/settings/layout.tsx`, `components/settings/settings-shell.tsx` · reached from:
the sidebar row "Settings"; the account menu.

**Job.** Find the one setting to change, and know whether it changes things for everyone or only
for me.

**Today.** A two column frame on wide screens: a left tree with the heading "Settings", then two
groups with uppercase mono headings and icons: "Organization" ("General", "Billing") and "My
account" ("Account", "Appearance"). The active row is tinted and carries `aria-current="page"`.
The right pane shows the group name small ("Organization" or "My account"), the page title, and
its summary:

- General: "What this organization is called, and how it is set up."
- Billing: "The plan this organization is on, and what it has used this month."
- Account: "How the cloud knows you, and the way out."
- Appearance: "How Memnox looks on this machine, and only on this one."

Below a large breakpoint the tree stacks above the pane, so on a phone the person scrolls past the
whole tree before any setting.

**What gets in the way.**

- On a phone the tree is a stacked list above every pane, so each settings page opens on
  navigation rather than on its content. [Hierarchy]
- The tree's "Settings" heading and the page's own title are both large (`text-2xl`), so two
  headings compete at the top. [Hierarchy]
- "Billing" lives in both the sidebar and this tree; "Settings" in the sidebar lands on General
  only. [Consistency]

**Improved.**

```
Settings
[ General ] [ Billing ] [ Account ] [ Appearance ]      ← a scrolling tab row on a phone

Organization · affects everyone
General
What this organization is called, and how it is set up.
```

- On narrow screens the tree becomes one horizontal tab row, so the pane is the first thing
  seen. [Hierarchy]
- The group line says who a change affects: "Organization · affects everyone" or "My account ·
  only you". [Proximity]
- The tree heading drops to the size of a group label. [Hierarchy]

---

### Settings: General

`/settings` (`components/settings/general-settings.tsx`) · reached from: the sidebar row
"Settings"; the tree row "General".

**Job.** What this organization is called, and the organization wide switches only an admin
holds.

**Today.**

1. Card "Company profile": "The name above every workspace. It appears wherever the product names
   this account rather than one workspace." For an admin, four fields:
   - "Company logo": "Worn at the top of the sidebar and anywhere this account is shown. PNG, JPG,
     SVG or WebP up to 256KB. Without one, Memnox wears its own mark." with the logo picker.
   - "Organization name": "Used in invitations and anywhere this account is named.", placeholder
     "Your company".
   - "Industry": "Shapes the examples Memnox reaches for when it reads your work.", placeholder
     "Software, logistics, healthcare".
   - "Company size": "Roughly how many people the organization has.", a select "Not set", "1-10
     people", "11-50 people", "51-200 people", "201-1000 people", "1000+ people".
     Footer: the note "These name the company everywhere Memnox does." which becomes "Saved." after
     a save, and the button "Save changes" (busy "Saving"), disabled until something changed.
     Failure: "Those details could not be saved, so nothing changed."
     For anybody else, a read only list: "Organization name", "Industry", "Company size" ("<size>
     people" or "Not set"), with no logo.
2. Admins only, card "Quiet servers": "A machine enrolled as a server is watched for going quiet.
   Its owner, or the admins where nobody owns it, is woken on their own devices once it has missed
   its heartbeat this long. A workstation asleep is not an outage, so none is watched." Field
   "Minutes before a server counts as quiet", "A whole number from <min> to <max>. Left alone, it
   is <default>." Toggle "Also say it in chat", "The owner gets a direct message, and the same
   thread is answered when the server beats again." Footer note "Every setting here is kept with
   the workspace." or "Saved.", invalid input "Enter a whole number of minutes from <min> to
   <max>.", failure "Those settings were not saved, so nothing changed.", button "Save changes".
3. Admins only, card "Delete this organization" (see the dialog below).
4. Only when an audit sink or incident webhook exists (both are set up through the API): a section
   "Where the record goes", "The log is written and sealed on the machine the action ran on. This
   is what happens to the copy that reaches Memnox.", with panels "Audit streaming" (sink type and
   "active" or "paused") and "Incident webhooks" (URL and "active" or "paused").

**States.** Loading: a four field skeleton "Loading the company profile". Non admin: read only
profile, nothing else except the audit section. Three cards in the codebase,
"Deployments you registered", "Keep a workspace's data on your own servers" and "Customer
organizations", are not rendered anywhere and so are not part of this page.

**What gets in the way.**

- "Quiet servers" is a fleet setting about when to wake somebody, sitting between the company
  name and the delete button. Sam, who runs one server, would look for it on Machines, where the
  quiet state shows. [Proximity]
- The destructive "Delete this organization" card sits above the read only audit section, so it
  is not last on the page as its own comment intends whenever a sink exists. [Hierarchy]
- The read only view drops the logo entirely, so a viewer cannot see the mark the sidebar wears.
  [Consistency]
- "Industry" says it "Shapes the examples Memnox reaches for when it reads your work.", which is a
  promise about model behaviour a person cannot check. [Consistency]
- The quiet minutes field is a free text input for a number with a range, so a typo is caught only
  by a note, not by the control. [Accessibility]

**Improved.**

```
Organization · affects everyone
General

Company profile
[logo]  Acme Robotics
Organization name   [ Acme Robotics          ]
Industry            [ Software               ]
Company size        [ 11-50 people ▾ ]
These name the company everywhere Memnox does.          [ Save changes ]

Where the record goes          (only when a sink exists)
Audit streaming   splunk    active

Danger zone
Delete this organization                      [ Delete organization ]
```

- "Quiet servers" moves to Machines, beside the quiet state it controls, with a link from here
  for one release. [Proximity]
- Destructive cards are always last, under a "Danger zone" heading, after the audit section.
  [Hierarchy]
- The minutes field becomes `type="number"` with `min` and `max`. [Accessibility]
- The viewer's read only list shows the logo too. [Consistency]

---

### Delete this organization (dialog)

`components/settings/delete-org-card.tsx` · reached from: "Delete organization" on Settings:
General (admins only).

**Job.** Wind the whole organization up, knowing it cannot be undone.

**Today.** Card "Delete this organization": "Erases the organization, its memory and your own
account in one act. Every other member has to be removed first." Button "Delete organization"
(busy "Deleting") in the danger outline. It opens a confirm: title "Delete <org name>?",
description "This cannot be undone, and nobody can restore it for you.", body "The organization
record, its memory and your own account go together, with every decision and audit entry read
into it. None of it is recoverable.", then "Type <org name> to confirm." with a field; the button
"Delete organization" stays disabled until the typed text equals the name exactly. On success the
browser loads `/login`. Failure under the card: the cloud's refusal (which names members still
present) or "The organization could not be deleted, so nothing changed."

**What gets in the way.**

- The rule "Every other member has to be removed first" is only discovered by being refused after
  typing the name. The card does not count the members still there or link to People. [Proximity]
- The confirm is disabled by passing `isBusy` when the name does not match, so the button may draw
  as busy rather than plainly disabled. [Accessibility]
- The match is case and space exact with no hint of which part is wrong. [Accessibility]

**Improved.**

```
Delete this organization
Erases the organization, its memory and your account.
5 other people are still in it. Remove them on People first.     People →
[ Delete organization ]   (disabled until nobody else is left)
```

- The card reads `useOrgUsers` and states the blocker before anything is pressed. [Proximity]
- The confirm uses a plain disabled state, separate from busy. [Accessibility]

---

### Settings: Account

`/settings/account` (`components/settings/account-settings.tsx`) · reached from: the tree row
"Account"; the account menu.

**Job.** Who the cloud thinks I am, where my agents reach me when they need a yes, and how I sign
a yes from this browser.

**Today.** Seven cards, in this order. The four middle ones show only once the session has a user
id.

1. **"You"**: "Read from your session. Your name and email come from the account you signed in
   with." Avatar, name, email or "No email on this session". Two rows: "What you can do" ("Change
   settings, approve, and read everything", "Approve and confirm decisions", "Read, but not
   decide", or "Unknown") and "Where you work" (the organization name). A note: "There is one of
   these and it is your organization, and every rule, decision and approval belongs to it. What
   you may do here is your role."
2. **"Also ask me in my DM"** (`dm-approvals-card.tsx`): "When your agent needs your yes and cannot
   show its own permission prompt, it always asks you in the session. With this on, the question
   is also sent to your DM in Slack, Discord, Telegram or Microsoft Teams, and the agent hears your
   answer from there and carries on." A toggle in the card header labelled "Also ask me in my DM",
   saved at once. Note: "Whichever answer arrives first, in the session or in your DM, is the one
   kept. A DM needs your chat account linked under Chat accounts below." Error: "Your choice could
   not be read or saved. Nothing on your machines changed."
3. **"Chat accounts"** (`chat-accounts-card.tsx`): "Where Memnox can write to you when an agent
   needs your answer. Each one is yours alone, and nobody else's answer counts as yours." Four
   fields:
   - "Slack": a pill "Found by your address" (good) or "Not found yet", and when not found "Memnox
     finds you in Slack by the address you sign in with, once Slack is connected under Connectors.
     If your Slack account carries another address, your questions wait in the console."
   - "Discord", "Telegram", "Microsoft Teams": "Linked" (good), or the link flow
     (`link-chat.tsx`): the tool's reason (for Discord "Discord does not share email addresses, so
     Memnox cannot tell which Discord account is yours. Get a code, then mention the Memnox bot
     with it in any channel the bot is in, once."), a button "Get a link code" (busy "Getting a
     code"), then the words to send in a code block (`link <code>`, or `/memnox link <code>` on
     Telegram) with a copy button ("Copy the link words", "Copy the Telegram message", "Copy the
     Teams message") and where to send them: "Type @ and pick the Memnox bot, then paste this,
     within N minutes. It works once." (Discord), "Open a private chat with the Memnox bot and send
     this, within N minutes. It works once." (Telegram), "Open a chat with the Memnox app in Teams
     and send this, within N minutes. It works once." (Teams). Failure: "A link code could not be
     made."
     Loading: a four field skeleton "Loading your chat accounts". Read failure: "Which chat accounts
     are yours could not be read."
4. **"Passkeys"** (`passkeys-card.tsx`): "A yes to an agent from a browser is signed with one of
   these, so an answer that reaches a machine as allowed was given by somebody who could unlock
   it. A deny needs none." A list of passkeys, each with its name (for example "Firefox on
   Linux"), "Added <when>, never used yet" or ", last used <when>", and "Remove" (busy
   "Removing", label "Remove the passkey <name>"), which removes at once. None: "None yet. Add one
   to allow agents from this browser." Footer button "Add a passkey" (busy "Waiting"), which opens
   the browser's own passkey sheet. Unsupported: "This browser cannot make a passkey, so add one
   from another browser or answer from the iPhone or Mac app." Failures: "That passkey was not
   added." and "That passkey was not removed."; cancelling the browser sheet shows nothing.
5. **"Wake this browser"** (`notifications-card.tsx`): "When an agent is waiting on your answer,
   or a server you own goes quiet, this browser shows a notification that says only "Memnox needs
   you". Clicking it opens your inbox." A toggle in the header. Notes: "On for this browser.
   Turning it off removes this browser from your devices.", "Off. Your browser asks for permission
   the first time you turn it on.", "Notifications are blocked for this site, so allow them in the
   browser's site settings first." (toggle disabled), "This browser cannot receive push
   notifications. Installing the console as an app often can." (toggle disabled). Failure: "That
   change did not reach Memnox, so nothing changed."
6. **"How you sign in"**: "A provider, never a password. There is nothing on this account to
   change or lose." Two info pills naming every provider (Google and GitHub), whichever one was
   used, and "Your organization may also connect its own identity provider, in which case you sign
   in with your work account instead."
7. **"Sign out"**: "Ends this session on the server, not just in this browser. Anything holding a
   copy of it stops working too." A sign out button in red text, which returns to `/login`.
8. **"Delete your account"** (see the dialog below).

**What gets in the way.**

- The four cards that decide whether Lin can answer an agent at all ("Also ask me in my DM",
  "Chat accounts", "Passkeys", "Wake this browser") have equal weight and no summary. Nobody can
  tell at a glance "you can answer from: this browser, Discord" or "you cannot allow anything from
  this browser yet". [Hierarchy]
- The DM toggle can be switched on with no chat account linked, and says so only in its note;
  the result is a setting that does nothing. The order also puts the toggle before the accounts it
  depends on. [Progressive disclosure] [Proximity]
- Passkeys have no visible link to the inbox: without one, "Allow once" in Waiting on you cannot
  be signed, but this card does not say that a yes will be refused, only that one is needed.
  [Proximity]
- "Remove" on a passkey acts at once with no confirm, though removing the last passkey silently
  ends the ability to allow from any browser. [Consistency]
- "How you sign in" shows both provider pills whatever was used, so it does not answer the question
  its title asks. [Consistency]
- The "Sign out" button is drawn in the destructive red, the same colour as "Delete account"
  below it, so the safe act and the irreversible act look alike. [Contrast]
- The link code expires in minutes but the card shows no countdown and no "Get a new code" after
  expiry; the old words stay on screen. [Accessibility]
- "Chat accounts" never shows which Discord or Telegram account is linked, only "Linked", and
  offers no way to unlink. [Consistency]

**Improved.**

```
My account · only you
Account

You can answer agents from
  ✓ This browser (passkey "Firefox on Linux", notifications on)
  ✓ Discord
  ✗ Slack: not found by bo@acme.dev        Fix →
  Also ask me in my DM   [ On ]

Chat accounts
  Slack            Not found yet. Connect Slack under Connectors.
  Discord          Linked as bo#2231                         Unlink
  Telegram         [ Get a link code ]
  Microsoft Teams  [ Get a link code ]

Passkeys
  Firefox on Linux   Added Oct 2, last used today            Remove
  Without a passkey, Allow on Waiting on you cannot be signed here.
                                                    [ Add a passkey ]

Wake this browser                                            [ On ]

You
  Bo Chen · bo@acme.dev · Reviewer: approve and confirm decisions
  Signed in with GitHub                                     [ Sign out ]

Danger zone
  Delete your account                              [ Delete account ]
```

- A summary block "You can answer agents from" leads the page, built from the four existing
  queries, with a "Fix" link on each missing door. [Hierarchy]
- The DM toggle sits under the chat accounts it depends on and is disabled with a reason while no
  chat account is linked. [Proximity] [Progressive disclosure]
- Removing the last passkey asks first and says "Nothing can be allowed from a browser until you
  add another." [Consistency]
- "Sign out" uses the neutral outline; only delete is red, under "Danger zone". [Contrast]
- The link code shows its minutes counting down and offers "Get a new code" once it lapses.
  [Accessibility]
- "How you sign in" names the provider of this session once the cloud records it; until then the
  card states both without claiming which. [Consistency]

---

### Delete your account (dialog)

`components/settings/delete-account-card.tsx` · reached from: "Delete account" on Settings:
Account.

**Job.** Leave for good, knowing what stays behind.

**Today.** Card "Delete your account": "Erases your account and ends this session. If you are alone
in this organization, the organization goes with it." Button "Delete account" (busy "Deleting"),
danger outline. The confirm: title "Delete your account?", description "This cannot be undone, and
nobody can restore it for you.", two paragraphs: "What you approved or decided keeps your name on
it, because the audit trail has to say who acted." and "As its last administrator you are refused,
so make somebody else one first. Alone in it, the organization and its memory go with your
account." Confirm "Delete my account". On success the browser loads `/login`. Failure: the cloud's
refusal or "Your account could not be deleted, so nothing changed."

**What gets in the way.**

- Unlike deleting the organization, there is no typed confirmation, though being alone in the
  organization makes this the same act. [Consistency]
- "As its last administrator you are refused" is shown to everybody, including viewers it can
  never apply to, and to the last admin it is only found out after pressing. [Progressive
  disclosure]

**Improved.**

- When the person is alone, the dialog says "This also deletes Acme Robotics and its memory" and
  asks for the organization name, the same as the organization delete. [Consistency]
- When the person is the last admin with others present, the card says so up front and links to
  People, and the button is disabled with that reason. [Progressive disclosure]

---

### Settings: Appearance

`/settings/appearance` (`components/settings/appearance-settings.tsx`) · reached from: the tree
row "Appearance".

**Job.** Light or dark on this machine.

**Today.** One card "Theme": "How Memnox looks on this machine. Stored in this browser, so it
changes nothing for anybody else in the organization." A radio group labelled "Theme" of three
tiles, each with an icon, a label and a line: "Light" ("The light palette, whatever this machine
is set to."), "Dark" ("The dark palette, whatever this machine is set to."), "System" ("Follows the
machine, and keeps following it if it changes."). The picked tile has a primary border and tint.
The choice applies at once; there is no save and no footer.

**What gets in the way.**

- The tiles are buttons with `role="radio"` but no arrow key handling, so keyboard users tab
  through three stops instead of moving within one group. [Accessibility]
- The picked state is shown only by border colour and tint; the icon colour change is the only
  other cue. [Accessibility] [Contrast]

**Improved.**

```
Theme
(•) System   Follows the machine.
( ) Light
( ) Dark
Stored in this browser only.
```

- Real radio inputs (or roving tabindex with arrow keys) and a visible check mark on the picked
  tile, so the state reads without colour. [Accessibility]
- "System" first, because following the machine is the choice that needs no upkeep. [Hierarchy]

---

## Elsewhere in the console

Three routes live outside the sidebar tree. `app-nav.ts` keeps File locks and Usage in
`offNavLinks` on purpose, and Platform admin sits under the account menu for operators only.
No other route exists: the workspace has no session or live view beyond `/fleet/[agentId]`,
and every `page.tsx` under `app/` is covered by the sections above.

### File locks

`/leases` · reached from: nowhere in the interface today. `offNavLinks` names it, but nothing
renders `offNavLinks`, the command palette (`palette-data.ts`) lists only `appNav` plus Sources,
and no link to `/leases` exists on Machines despite the nav comment saying it is "linked from
Machines". Typing the address is the only way in.

**Job.** Which paths are agents holding while they write, and can I take one over when it is
stuck?

**Today.** The tab title is "File locks" (page metadata), but the page header reads "Locks"
with the description "Paths an agent is holding while it writes them. Reading is never blocked,
and every lease expires on its own."

Below it, one table (`DataTable`) with four columns:

- "Path": the path in monospace, and under it in muted type the last line of the holder's
  `activity` when there is any.
- "Held by": "<agent> on <machine>", or the agent alone when no machine was reported.
- "State", pinned at 14rem: a pill reading "released" (neutral), "taken over by <agent>" (red)
  or "until <time>" (green), the time formatted by `formatWhen` against now.
- An unlabelled action column: "Take it over", in destructive red text, shown only while the
  lease is not released and the signed in person has `can.review`.

Under the table, a `FormNote` that shows a failure, and a `DoneInChat` line: "You can also take
lines over by pressing Free these lines on the collision message in your team's channel, or by
accepting Claude Code's own prompt when it asks."

Actions:

- "Take it over" posts `/leases/<id>/take-over` with the fixed reason "Taken over from the
  console". No confirmation, no reason field. The row's button disables while busy. On success
  the list refetches; on failure the note reads "That lease was not taken over." followed by
  the cloud's reason, or "Memnox did not answer in time, so try again in a moment." or the
  offline or unreachable wording from `apiRefusal`.
- `useReleaseLease` exists in `lib/leases.ts` but the page never offers a release.
- The query asks only for live leases (`/leases`, `includeEnded` false) and refreshes after 15
  seconds of staleness.

States:

- Loading: `TableSkeleton` with three rows.
- Empty: a lock icon, "Nothing is held", and "An agent takes a lease before it writes a path
  and releases it when it is done. Nothing held means nothing is mid-write."
- Plan missing (the cloud answers 403): the table is replaced by a card with a lock icon,
  "Shared locks are a Team feature", "One machine keeps its own locks locally and always will,
  free. Sharing them between machines is what this plan adds." and a `PlanWall`: "Two machines
  on one repository can see each other's locks, so a refactor on one does not land on top of a
  refactor on the other." with the link "What changes on Team" to `/settings/billing`.
- Error other than 403: nothing says so. The table renders with no rows and the empty state,
  so a failed read looks like "Nothing is held".
- Permission missing (no `can.review`): the action column is blank, with no word on why.
- No workspace: `NoWorkspace`, "Memory is made with the organization, so this failed rather
  than needing setup. Sign out and back in, then tell whoever runs this Memnox."

**What gets in the way.**

- [Consistency] The page is called "File locks" in the tab and in `offNavLinks`, "Locks" in its
  header, and "lease" in its own body copy and empty state. Three words for one object.
- [Hierarchy] The page cannot be reached. A Team admin who sees a collision on Machines or in
  chat has no path here, and the palette cannot find it either.
- [Contrast] "Take it over" is red text with no confirmation and no reason, while the lib says
  "A reason is required" and the record is meant to say who and why. The recorded reason is
  always the same canned sentence, so the row carries no why.
- [Contrast] A live lease is a green pill and a taken over lease is a red pill. Green reads as
  "fine" when the person is usually here because something is stuck, and the takeover, which is
  a normal recorded act, reads as an error.
- [Progressive disclosure] Only the last activity line is shown, truncated. The whole point of
  the activity list ("so the next agent can tell whether it is about to repeat the work") is
  hidden.
- [Accessibility] The action column has an empty header and the button has no accessible name
  beyond "Take it over", so a screen reader hears the same words on every row with no path.
- [Consistency] The holder label drops "from <person>'s team" and shows the raw agent id.
- [Hierarchy] A load failure renders as the reassuring empty state, which the 403 branch was
  written specifically to avoid.
- [Progressive disclosure] There is no view of ended leases or takeovers, although the API
  supports `?ended=true`, so "the record outlives the lease" is not visible here.

**Improved.**

```
Fleet  ›  File locks
File locks
Paths an agent is holding while it writes them. Reading is never blocked, and every
lock ends on its own.

[ Held now (2) ]  [ Ended in the last 7 days (5) ]

PATH                         HELD BY                              ENDS IN
src/billing                  Claude Code on maya-mbp              18 min       [ Take over… ]
  Editing invoice.ts, then the tests for it  ▸ 3 more steps
packages/core/src/policy     Codex on build-box, from Ana's team  4 min        [ Take over… ]
  Running the policy tests

  ┌ Take over src/billing? ───────────────────────────────────────────┐
  │ Claude Code on maya-mbp has held it for 12 minutes.               │
  │ Last steps: Editing invoice.ts, then the tests for it              │
  │ Why are you taking it?  [ The session crashed overnight        ]   │
  │ This is recorded under your name and stays after the lock ends.   │
  │                               [ Cancel ]  [ Take over src/billing ] │
  └────────────────────────────────────────────────────────────────────┘

You can also do this in chat: press "Free these lines" on the collision message.
```

- One name, "File locks", in the tab, the header, the copy and the nav; "lease" stays a code
  word.
- Reachable: a "File locks" link on Machines beside the machines that share a repository, and an
  entry in the palette from `offNavLinks`, so nothing off the tree is unreachable.
- "Take over…" opens a confirm with a required reason, which is what `useTakeOverLease` already
  sends, and the button names the path for screen readers.
- State shows time left as words with neutral tone; a takeover shows as "Taken over by Ana" in
  neutral type, because it is a recorded act and not a failure.
- An "Ended" tab reads `?ended=true`, so takeovers and their reasons can be found later.
- A read error says "The locks did not load." with the `apiRefusal` reason, never "Nothing is
  held".
- Activity expands in place, so the whole list of steps is one click and never a truncation.

### Usage

`/usage` · reached from: Settings Billing, the line "Usage over time breaks the same
allowances down by day and by workspace." Not in the sidebar, not in the command palette.

**Job.** How much of this month's plan has the workspace used, and what did model work cost?

**Today.** Tab title "Usage". Page header with the eyebrow "Organization" (bar chart icon), the
title "Usage" and "What this workspace has used against its plan this month, and what the model
cost while doing it."

Panel "Allowances" (gauge icon), with the month (`plan.month`) at the right. Three meters, each
a label, a figure, a bar and a note:

- "Governed actions": "Every action an agent checked against the rules."
- "Extraction runs": "Each pass over your events to read decisions out of them."
- "Recording hours": "Hours of meeting recorded, counted when a recording ends." with the unit
  "h".

The figure reads "<used> of <limit>", or "<used> used" when unlimited, plus " · <credit> bought"
when credit exists. A red "spent" pill follows the label when the allowance is exhausted, and
the bar turns red. Unlimited and zero limit meters show no bar. A meter the cloud does not send
is dropped.

Panel "Model spend" (coins icon), meta "<month> · estimated". Four tiles: "Estimated cost"
("$" with two decimals), "Calls", "Input", "Output" (tokens shortened to "k" or "M"). Then two
breakdowns, "By model" (chip icon) and "By purpose" (gauge icon), each a list of names in
monospace with "<tokens> · <percent>%" and a thin bar, sorted largest first. Last, "Estimated
from published per-token rates, so it is what the work cost rather than what anyone was
charged."

There are no actions on the page beyond the one link in the empty state.

States:

- Loading: `SkeletonMeters` (four, labelled "Loading the allowances") and `SkeletonTiles` (four,
  labelled "Loading the spend") plus four bar skeletons.
- No billing record: "No billing record for this workspace yet."
- No model spend: "Nothing has run through a model this month, so there is nothing to cost yet.
  Extraction runs when evidence arrives, so connecting a source is what starts it." with
  "connecting a source" linking to `/sources`.
- Error: neither query shows an error. A failed billing read falls to "No billing record for
  this workspace yet." and a failed usage read falls to the "Nothing has run through a model"
  notice.
- No workspace: `NoWorkspace`.

**What gets in the way.**

- [Consistency] Billing promises "Usage over time breaks the same allowances down by day and by
  workspace." The page has no days and no workspace split; it is this month only, which is the
  same three meters Billing already shows.
- [Consistency] The skeleton draws four meters while the page draws three, so the layout jumps
  when it loads.
- [Hierarchy] A load failure reads as "No billing record" or as "nothing has run", which are
  both confident and both false in that case.
- [Consistency] The eyebrow says "Organization" while the description says "this workspace",
  and Billing's own note for "Recording hours" reads "Hours of meeting actually recorded" while
  this one drops "actually". The same meter carries two notes.
- [Consistency] The empty state links to `/sources`, a route the sidebar does not draw, rather
  than to Connectors, which is the row people know.
- [Contrast] The "spent" pill and the red bar carry the only signal of an exhausted allowance;
  the figure itself does not change wording, so colour carries meaning alone.
- [Hierarchy] Agent work, which is the product, is one meter among model calls and recording
  hours. Nothing links a governed action count to Home's "Today" counts or to What was caught.

**Improved.**

```
Organization  ›  Billing  ›  Usage
Usage
What this workspace used against the Team plan in October, and what model work cost.

Allowances                                                       October 2026
  Governed actions   18,240 of 50,000                     ▓▓▓▓▓▓░░░░░░░░░  36%
  Every action an agent checked against the rules. Resets 1 November.
  Extraction runs    412 of 500                           ▓▓▓▓▓▓▓▓▓▓▓▓░░░  82%
  Recording hours    20h of 20h · all used, 5h bought      ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓
  [ Buy hours ]

By day                                       Governed actions ▾
  ▁▂▂▃▅▄▃▂▃▅▆▄▃▂▁▂▃▄▅▆▅▄   1 to 22 October

Model spend, estimated                                           October 2026
  $14.20    1,904 calls    2.1M in    310k out
  By model     claude-sonnet   1.9M · 79%
  By purpose   extraction      2.0M · 83%
Estimated from published per-token rates, so it is what the work cost rather than
what anyone was charged.
```

- Either build the promised "By day" chart from the cloud's daily rows, or change Billing's
  sentence to what the page holds. A link must not promise a view that is not there.
- Reach it from the palette and from Billing, with a breadcrumb back to Billing.
- Three skeleton meters for three meters.
- An exhausted meter says "all used" in words beside the red bar, so colour is never the only
  signal.
- A failed read says "The allowances did not load." with the `apiRefusal` reason, separately
  from the honest empty states.
- The empty state links to Connectors, and the meter notes match Billing word for word.

### Platform admin

`/admin` · reached from: the account menu, section "Deployment", row "Platform admin", drawn
only when the session has `platformAdmin`. Not in the sidebar or the palette.

**Job.** For the people who run this deployment: which organizations are on it, what each pays,
and what can I change for one of them?

**Today.** Tab title "Platform admin". The page renders even without a workspace
(`worksWithoutWorkspace`). Header with eyebrow "Deployment" (shield icon), title "Platform
admin" and "Every organization on this deployment, the plan each is on, and the people in it.
Every change here is logged under your address."

While the session loads, nothing below the header. When the person is not an operator, one panel:
"This page is only for the people who run this deployment."

For an operator, three blocks:

1. **Overview tiles**, four across on wide screens and two on narrow ones: "Organizations"
   (count), "New" ("<n> in <days> days"), "Members" (users), "Workspaces". Each shows a dash glyph until
   counted, and keeps it if the overview fails, with no error.
2. **Panel "Organizations"** (building icon). A search box, placeholder "Search by name or id",
   aria "Search organizations", settled before it queries and resetting to page one. Table
   columns: "Organization" (the name as a button, with the id under it), "Plan" (pill "Free"
   neutral, otherwise green, from `ADMIN_PLAN_NAME`: "Free", "Pro", "Team", "Enterprise",
   "Platform"), "Billed by" ("Subscription", "Assigned", or blank for Free), "Members",
   "Workspaces", "Created" (local date). Empty: "No organization matches that search."
   Pagination: "Previous page", "Next page", "Showing <first> to <last> of <total>", "Rows per
   page" with 8, 16 or 32 (16 by default). A refetch fades the table to 60% opacity. Loading:
   `SkeletonRows` with four rows, "Loading organizations". Error: "The organizations did not
   load." plus the refusal reason.
3. **Panel "Find a person"** (person icon). An email field, placeholder "name@example.com",
   aria "Email address". Before an answer: "Type a full address to see every organization it
   belongs to." Error: "The lookup did not answer." plus the reason. Table: "Organization" (a
   button opening the drawer), "Name", "Role" (the raw role word), "Status" (pill "Active" green
   or "Suspended" red). Empty: "No account holds that address."

Clicking an organization name in either table opens the drawer.

#### Organization drawer

A right drawer, max width 2xl, labelled "Organization", closed by its "Close" button or Escape.
Header: the organization name (or "Organization" while loading), the id under it, and an info
pill with the plan name. Loading: four skeleton rows, "Loading the organization". Error: "This
organization did not load." plus the reason. Then four sections, each a heading over a top
border.

**Section "Subscription".** Read from the payment provider.

- Loading: a grey block. Error: "The subscription could not be read." plus the reason.
- Nothing billing: a dashed box, "Nothing bills this organization at the payment provider. Its
  plan is assigned by hand below."
- With a subscription:
  - Summary card: card icon, "<Plan>, billed monthly" or "billed annual", then "Renews <date>"
    or "Ends <date>", and a pill "Active" (green) or "Cancelled" (amber). Three facts: "Seats"
    (a number, or "Flat price"), "Last invoice" ("<amount>, <status>" or "None yet"),
    "Subscription" (the id with a "Copy" button that reads "Copied" for a moment, aria "Copy
    the subscription id"). When the provider did not answer: "The payment provider did not
    answer, so this is the last record held: <detail>".
  - Card "Change plan": "The difference is charged or credited now, prorated to the day." Two
    segmented controls, "Plan" (Pro, Team, Enterprise, Platform) and "Billing period" (Monthly,
    Annual). The footer reads "Pick another plan or billing period." when unchanged, "Resume the
    subscription to change its plan." when cancelled, or "<Plan interval> → <Plan interval>".
    Button "Review change" opens a confirm: "Move to <plan interval>?", "The customer is charged
    or credited the difference now, prorated to the day.", "Cancel" and "Move and charge".
    Success: "Requested. The plan changes once the payment provider confirms the charge."
    Failure: "The payment provider did not take that change." plus the reason.
  - Card "Seats", only on a per seat plan: "<n> people hold an account here, so it cannot go
    below <floor>." (or "person holds"). A stepper with "One seat fewer", a number field "Seats"
    and "One seat more", then "<n> billed now" or "<from> to <to> seats". Button "Update seats"
    opens "Bill for <n> seats?", "From <n>. The difference is invoiced now, prorated to the
    day.", "Cancel" and "Update seats". Success: "Requested. The seats change once the payment
    provider confirms the charge."
  - Card "Invoices", only when there are invoices: the latest five, with "The latest 5 of <n>."
    when there are more. Each row: date, status pill ("Paid" green, others amber, underscores
    turned into spaces), amount, and an external link icon labelled "Open the invoice of
    <date>" when the provider gave a URL.
  - Block "Cancel subscription" (red border) or "Resume subscription". Copy: "Stops the next
    payment. <Plan> stays until <date>, then drops to Free." or "Cancelled. <Plan> stays until
    <date>, then drops to Free unless resumed." Button "Cancel subscription" (danger) or
    "Resume". Confirm: "Cancel the subscription?" with "No further payment is taken. <Plan>
    stays until <date>, then drops to Free." and the buttons "Cancel" and "Cancel subscription";
    or "Resume the subscription?" with "It renews again on <date>, on <plan>." and "Cancel" and
    "Resume". Resume success: "Requested. It renews again once the payment provider confirms."

**Section "Plan assigned by hand".** Shown only when nothing bills the organization. A row of
five toggle buttons, Free to Platform, the current one pressed. Under it: "Nothing is charged
at the payment provider for a plan given here." Choosing another opens "Move to <plan>?", "Its
limits change on the next request anybody in it makes.", "Cancel" and "Move to <plan>"; the
dialog is danger toned for Free. Failure: "The plan was not changed." plus the reason.

**Section "Members"**, with the count at the right. Table: "Member" (name, email under it),
"Role" ("Admin", "Reviewer", "Viewer"), "Status" ("Active" or "Suspended"), and a row menu
labelled "Actions for <name>" with "Make admin", "Make reviewer" or "Make viewer" (the two the
member is not), then, except on the operator's own row, "Suspend" (danger) or "Reinstate", and
"Remove" (danger). Confirms:

- Role: "Make <name> <role>?", "It applies on their next request.", confirm "Make <role>".
- Suspend: "Suspend <name>?", "They are signed out on their next request, everywhere, until
  reinstated.", confirm "Suspend". Reinstate: "Reinstate <name>?", "They can sign in again with
  the role they held.", confirm "Reinstate".
- Remove: "Remove <name>?", "Their account is erased and they lose access at once. What they
  did stays recorded under their name.", confirm "Remove".

Empty: "Nobody is in this organization." Failure: "That member was not changed." plus the
reason.

**Section "Organization".**

- "Name": a text field and "Rename", enabled only when the trimmed name differs and is not
  empty. No success message.
- "Recording hours, given free": a number field, placeholder "Hours", aria "Recording hours to
  give", and "Give hours". Confirm: "Give <n> recording hours?", "Free of charge, used once the
  plan's own hours for the month are spent. It does not expire.", confirm "Give hours". Success:
  "<n> recording hours are now held as credit."
- "Delete organization" (danger) opens "Delete <name>?", "Its workspace, its members and
  everything Memnox holds for it are erased. This cannot be undone, and it is refused while a
  subscription still takes payment.", a field "Type <name> to confirm", and "Delete for good",
  enabled only when the typed name matches. Success closes the drawer.
- One shared failure note for all three: "That change was not made." plus the reason.

**What gets in the way.**

- [Hierarchy] The overview tiles never say they failed; the dash glyph stays forever and reads as
  "still counting".
- [Consistency] The "New" tile uses the overview's own `recentDays`, while every other tile is a
  bare number, so one tile is a sentence and three are figures.
- [Contrast] In the cancel confirm, the quiet button is "Cancel" and the destructive one is
  "Cancel subscription". Two buttons begin with the same word and do opposite things.
- [Contrast] "Move and charge" and "Update seats" take money and use the default tone, while
  "Make admin" also uses the default tone; the only financially binding buttons look like the
  routine ones.
- [Progressive disclosure] The drawer stacks billing, plan, members and erasure in one scroll.
  "Delete organization" sits directly under "Give hours" in the same column, separated only by
  a margin.
- [Proximity] The section "Organization" uses one failure note for rename, credit and delete,
  so a refused delete can show under the hours field, and rename success says nothing at all.
- [Consistency] "Find a person" shows the role as the raw word ("admin") while the Members
  section shows "Admin".
- [Accessibility] Organization names are buttons styled as text with no affordance beyond
  underline on hover; the table row itself is not a target.
- [Hierarchy] Operators cannot see which organizations need them: a failed invoice, a
  subscription ending this week or a suspended member is only found by opening each drawer.
- [Consistency] Admin governs plans and seats, but nothing on it links to the organization's
  Usage, so "why did they hit the limit" means asking the customer.

**Improved.**

```
Deployment
Platform admin
Every organization on this deployment, the plan each is on, and the people in it.
Every change here is logged under your address.

 Organizations 412   New this month 37   Members 2,180   Workspaces 418
 The counts did not load. Retry          ← only when the overview failed

Needs a look
  3 invoices unpaid   ·   5 subscriptions end in 7 days   ·   2 suspended members
                                                              [ Show these ]

Organizations                       [ Search by name or id            ]
  NAME              PLAN     BILLED BY      MEMBERS  WORKSPACES  CREATED
  Acme Robotics ›   Team     Subscription   14       1           3 Mar 2026
  ...
  Showing 1 to 16 of 412      Rows per page 16 ▾      ‹ Previous  Next ›

┌ Acme Robotics · org_8f2c  Team ───────────────── [ Billing | People | Organization ] ┐
│ Billing                                                                              │
│  Team, billed monthly · Renews 1 Nov 2026                           Active           │
│  Seats 14   Last invoice $420.00, paid   Subscription sub_19x  Copy                  │
│  Change plan   ( Pro | Team | Enterprise | Platform )  ( Monthly | Annual )           │
│                Team monthly → Enterprise monthly          [ Review change ]          │
│  ─────────────────────────────────────────────────────────────────────────────────── │
│  Stop payments    Team stays until 1 Nov 2026, then drops to Free.                   │
│                                                    [ Stop payments… ]                │
└──────────────────────────────────────────────────────────────────────────────────────┘

  ┌ Stop payments for Acme Robotics? ────────────────────────────┐
  │ No further payment is taken. Team stays until 1 Nov 2026,    │
  │ then drops to Free.                                          │
  │                         [ Keep paying ]  [ Stop payments ]   │
  └──────────────────────────────────────────────────────────────┘
```

- A "Needs a look" row of counts built from the subscriptions and members the cloud already
  returns, each count filtering the table, so an operator starts from what is owed.
- The drawer splits into three tabs, "Billing", "People", "Organization", so erasure sits alone
  under its own tab rather than under a goodwill field.
- The cancel action is named "Stop payments", and its dialog's quiet button is "Keep paying",
  so the two words never collide.
- Each write in the Organization tab gets its own note, and "Rename" confirms with "Renamed to
  <name>."
- A failed overview says "The counts did not load." with "Retry" in place of a permanent dash glyph.
- Roles read "Admin", "Reviewer", "Viewer" in both tables, and the whole organization row is
  the click target, with the name kept as the accessible label.
- The drawer header links to that organization's Usage, read through the same allowances the
  workspace page uses.

---

## Across the console

The ten changes that matter most, in the order to make them. Each names the pages it touches.

1. **Never show calm when a read failed.** A failed read today renders as "Nothing needs you.
   Memnox is running.", "Nothing is enrolled", "No agent yet", "Nothing is held" or "Nothing
   outstanding"; give every list a distinct "Could not reach the workspace. Try again" state.
   Touches Home, Waiting on you, Machines, Agents, Memory, File locks, Usage, Admin.
2. **Put the waiting count in the shell.** Show the number of held calls on the "Waiting on you"
   row, the browser tab title and the installed app badge, and stop the bell counting incidents
   under the same weight. Touches the app shell, Home, Waiting on you, What was caught.
3. **Make the held call card the one answer surface, with a no that is never dimmed.** Show
   "Allow once" and "Deny" first at equal weight, "Allow for this session" beside them, the three
   always answers behind "More answers", ask for the passkey on every yes, and render the same
   card in place on Home and on the agent page rather than linking away. Touches Waiting on you,
   Home, Agent detail, Approve a machine, Sign in an app.
4. **Lead the empty home with one next step chosen from onboarding.** Ask in onboarding what the
   person runs agents on, then put "Install the Mac app", "Add a server" or "Install Memnox on
   this computer" above the five blocks instead of nine competing steps. Touches Onboarding,
   Sign up, Home, Machines.
5. **One block order and one set of words on Home.** Waiting on you, Working now, Today, Ready to
   hand over, Not covered, then Your team; remove the triplicated waiting and hand over rows, name
   the page "Home" in nav, tab and heading, and drop percent bars for counts. Touches Home,
   Autonomy, the app shell.
6. **Confirm every irreversible act, and only those.** "Revoke" a machine, "Take it over" on a
   lock, "Merge into", removing a passkey, "Forget" a meeting, disconnecting a connector and
   cancelling a connection each get a confirm that names what goes with it. Touches Machines,
   Map, File locks, People, Settings Account, Meetings, Connectors, Sources.
7. **One agent label everywhere.** "<agent> on <machine>", plus "from <person>'s team", on agent
   rows, the agent page title, held cards, Autonomy's hand over table and the Map; the mode word
   is the same on Machines and Map, and after an answer elsewhere every door reads "Allowed once
   by <person> on <door>." Touches Agents, Agent detail, Waiting on you, Autonomy, Map, Home.
8. **Make Autonomy lead with what can be handed over.** Put the hand over table first with
   agent, machine and the count of yeses, keep it visible when empty with what earns a row, and
   preview the rule and its scope before "Stop asking" proposes it; second admin approval is
   signed and is refused to the proposer up front. Touches Autonomy, Waiting on you, Home.
9. **Close the loop when a server joins.** Add a server shows all three lines including `memnox
setup`, uses one install command everywhere, polls until the machine checks in and then says
   "build-box joined". Machines and Agents refresh on their own. Touches Add a server, Machines,
   Agents, Home.
10. **Fix the names and dead ends that make the console look smaller than it is.** One name per
    page ("People" not "Members", "Connectors" not "Connected systems"), a link to File locks from
    Machines, Usage that matches what Billing promises, a real way to cancel from Billing, and a
    palette that finds agents, machines and people by name rather than only pages. Touches the
    app shell, People, Connectors, Sources, File locks, Usage, Billing, Machines.

## Added after this review

Three pages this review did not have, written in the same shape, and the improvements above that
have since shipped, so the next reader knows which bullets are still open.

### Rules

`/rules` (`app/(workspace)/rules/page.tsx`, `components/rules/rules-view.tsx`) · reached from: the
sidebar row "Rules" under Govern, and the proposal link back from Waiting on you.

**Job.** What does every machine and cloud agent decide with, who decided each rule, and how do I
change one?

**Today.** Heading "Rules", description "What every machine and cloud agent decides with. A change
is proposed here and holds once a second admin approves it on Waiting on you." Admins see "Propose
a rule" first: an effect select (allow, ask, deny), "Action" in mono with the runtime's own names
as examples, "Only for an agent (optional)", and "Propose", answered "Proposed. It waits for a
second admin on Waiting on you." Then "In force" with the version, one row per rule: the actions in
mono, the source line ("Decided by Ana on 24 Sept, said on their phone, their Mac or the console,
approved by Bo"), who it is for, and a pill for what it decides. Empty: "No team rules yet". Then
"Published versions", newest first, with who approved each and any rollback. A failed read says so
in red rather than showing an empty table.

### Cloud agents

`/cloud-agents` (`components/cloud-agents/*`) · reached from: the sidebar row "Cloud agents" under
Fleet, and Home's "Do this next" when setup was told the agents run in the cloud.

**Job.** Which of my agents run in a cloud, what did they do, what are they waiting on, and how do
I connect another?

**Today.** "Connect a cloud agent" first: "What the agent is called" and "Make a credential", which
mints a `cloud` connection (interposed, no keypair) and shows the token once beside "Shown once.
Copy it now". Two ways to use it, as a radio pair: "Guard library" (the three environment lines and
the Claude Agent SDK wrapper) and "MCP gateway" (the client config with the gateway URL, the bearer
and `x-memnox-agent`). Then one card per agent: its surfaces ("guarded", "via the gateway", or
"reports only" for the advisory MCP door), when it was last seen, "n allowed, n asked, n refused"
over the newest thousand actions and saying so, any paused session with "Resume" for reviewers,
open questions, and its last decisions. Then "Servers behind the gateway": each routed server with
whether a credential is held and its gateway URL, "Stop routing" behind a confirmation that says
agents get an error and the credential is deleted, and a form for name, URL and an optional
credential.

### Download (marketing site)

`/download` on the marketing origin (`apps/web/app/download/page.tsx`) · reached from: every
"Download for Mac" and "App Store" link, and Home's "Get the Mac app" and "Get the iPhone app".

**Job.** How do I get the apps and the runtime, and what do I do after?

**Today.** Three cards: the Mac app, the iPhone app and the runtime, each with what it needs. A
store button where `NEXT_PUBLIC_MAC_DOWNLOAD_URL` or `NEXT_PUBLIC_IPHONE_APP_URL` is set, and where
it is not, a sentence saying the app is not in a public store yet with "Ask us for the build",
never a link to nothing. The runtime card copies `npm i -g memnox` and `memnox setup`. "After you
install" in three numbered steps, then "Start free".

### Shipped from the improvements above

- Onboarding step 3 asks "Where your agents run" (on my Mac, on a server or in CI, on Linux or
  Windows, in our cloud, not sure yet), with the connector picks folded under "Where your team
  decides things (optional)". Step 2 asks "Where should questions find you?" and skips title and
  department for one person. Step 1 offers the domain guess as a one tap chip.
- Home leads with one "Do this next" card chosen from those two answers, and folds every other way
  in under "Other ways to put an agent under Memnox".
- The held call card puts Deny first at full weight, Allow once as the only filled button, writes
  what each answer does under it, and keeps the always answers behind "More answers" for admins.
  The Mac island and the iPhone card keep "Allow from now on" behind More in the same way.
- The sidebar shows how many calls wait on you beside "Waiting on you".
- Waiting on you never says "Nothing needs you" over a failed read: it names what could not be
  read and offers "Try again", and leads with a one line count by kind.
- Autonomy is titled "Autonomy" and leads with "Ready to hand over", with what earns a row when it
  is empty and an error state instead of a silent gap.
- Add a server adds `memnox setup` as step 3, makes the shown once note neutral, and says "Waiting
  for build-box to report…" until "build-box joined".
- Tab titles match the sidebar: Home, Waiting on you, People.
- Billing has "Invoices and payment" with "Manage payment" and "Cancel plan" behind a
  confirmation. Chat accounts show the linked handle with "Unlink" behind a confirmation.

### Shipped from the read and contract audit

- A failed read is never a calm empty state. `ReadError` says what could not be read, what stays
  true regardless, and offers "Try again", on Home (machines, approvals, to confirm, autonomy,
  findings, connections), Machines, Locks, Meetings, Usage, Fleet, Memory, the map, Sources and an
  agent's waiting card. Home no longer says nothing is governed when the machines read failed, and
  Waiting on you no longer says "Nothing needs you" while any of its reads, decisions to check
  included, failed.
- Every action the cloud would refuse is either gated to the role it accepts or replaced with a
  sentence naming who can do it: hand over and rule set answers (admin, never the author for
  Approve), MCP server and exception answers (admin), suggested decisions and incidents
  (reviewer), meetings join, call out and forget (reviewer), people link and merge (admin), adding
  a chat bot (admin), the gateway's server list (admin) and the audit forwarders (admin).
- Taking a lock over sends the person as the holder, which the cloud requires, and asks for the
  reason in a confirmation, since the reason is kept on the lease for good. Forgetting a meeting is
  confirmed, with what is and is not removed.
- Enterprise and Platform plans read their features as "all", so remote agents are no longer shown
  to them as locked. Home's brief survives a cloud that did not report running sessions.
- Device and app approvals name the workspace rather than its id, say whether the machine is a
  runtime in the path, an advisory connection or a cloud agent, count down live, and turn Approve
  off once the code expires.
- Linking Telegram or Teams opens the chat with the code filled in when the cloud offers a link.
- The incident drawer says why an acknowledge or resolve did not land.
- An autonomy row held back says what it reaches that cannot be undone.
- Sign in waits for a late session cookie before giving up, then says the browser did not keep the
  session rather than silently returning to sign in.
- The palette reaches File locks and Usage, Machines links to File locks, the top bar button reads
  "Go to" because the palette finds pages and answers nothing, Connectors points at setup rather
  than a page that does not exist, Billing describes Usage as it is, and the remote server steps
  use the one `memnox setup` run.
