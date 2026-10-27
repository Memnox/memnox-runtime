# Home page wireframe

The layout for `memnox-client/apps/web/app/page.tsx`, band by band: where each text,
illustration, logo, Mac, iPhone, agent and tool goes. [landing.md](landing.md) holds the copy
rules and the real product strings; this file holds the placement.

The patterns are borrowed from three pages the team pointed at:

| Borrowed from         | Pattern                                                       | Used in       |
| --------------------- | ------------------------------------------------------------- | ------------- |
| Parley                | The product itself as the hero picture, beside the words      | Band 1        |
| Folio                 | Tools joined by lines to one logo in the middle               | Band 2        |
| Parley                | A stack of large lines, the current one lit, beside its scene | Band 4        |
| Parley                | "At home on every screen": one card per device                | Band 5        |
| Cloudflare and Parley | A logo strip, then a coloured closing band                    | Bands 6 and 7 |

**Look.** The site's own tokens: ground `#030303`, text `#fdfdfd`, accent `#1e86ee`, Instrument
Serif for headings, Inter for text, a mono for commands.

**One key for the whole page: Allow, Ask, Deny.** The hero names the three answers Memnox gives,
and every band after it draws them the same way, so a visitor learns the key once and reads every
illustration with it. Each also differs in lightness and in shape, so it reads without colour.

| Answer    | Means                         | Line                       | Mark                |
| --------- | ----------------------------- | -------------------------- | ------------------- |
| **Allow** | what can happen on its own    | grey, solid                | none                |
| **Ask**   | when a person needs to decide | blue, double               | the person's avatar |
| **Deny**  | what should never happen      | orange, heavy, then dashed | ✕                   |

**Legend.** `[IMG]` an illustration, `[LOGO]` a logo mark, `[MAC]` a MacBook frame, `[IPHONE]` an
iPhone frame, `(btn)` a button, `«tab»` a tab.

---

## 0. Navigation

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ [LOGO] memnox      Product  Security  Apps  Pricing  Docs     Sign in (Start free) │
└──────────────────────────────────────────────────────────────────────────────┘
```

| Slot  | Content                                                |
| ----- | ------------------------------------------------------ |
| Logo  | The Memnox mark and the word "memnox"                  |
| Links | Product, Security, Apps, Pricing, Docs                 |
| Right | "Sign in" as a text link, "Start free" as a white pill |

---

## 1. Hero: the claim, the three answers, and the product answering

Two columns on desktop: the words on the left, the product on the right. The words are yours and
stay as they are; the right side replaces the ASCII portrait with the Mac, the iPhone and a chat
answering one real question.

```
┌────────────────────────────────────┬─────────────────────────────────────────────┐
│ ── Before you leave an agent       │ [IMG] animated, 8 second loop               │
│    running                         │                                             │
│                                    │     ┌──[MAC]────────────────────────────┐   │
│ Your agents can                    │     │    ╭── island ──────────────╮     │   │
│ already do the work.               │     │    │ Claude Code on Maya's  │     │   │
│                                    │     │    │ Mac wants a production │     │   │
│ Memnox makes it safe to let        │     │    │ deploy                 │     │   │
│ them do it without you.            │     │    │ (Deny) (Allow this     │     │   │
│                                    │     │    │ session) (Allow once)  │     │   │
│ what can happen on its own   Allow │     │    ╰────────────────────────╯     │   │
│ when a person needs to        ASK  │     │ $ vercel --prod                   │   │
│ decide                    ← lit    │     │ Held by Memnox, asking Maya       │   │
│ what should never happen     Deny  │     └───────────────────────────────────┘   │
│                                    │  ┌ Slack DM ─────────┐      ┌[IPHONE]──────┐ │
│ Point it at your agent             │  │ Claude Code on    │      │ 9:41         │ │
│ [LOGO] [LOGO] [LOGO] [LOGO]        │  │ Maya's Mac wants  │      │ Memnox needs │ │
│ [LOGO] [LOGO]                      │  │ a production      │      │ you on       │ │
│                                    │  │ deploy            │      │ Maya's Mac   │ │
│ (Start free →) (Download for Mac)  │  │ (Allow once)(Deny)│      │ (Deny)(Allow)│ │
│ or run locally: npm i -g memnox    │  └───────────────────┘      └──────────────┘ │
│                                    │ READ OFF YOUR OWN DISK · NOTHING IS         │
│                                    │ TRANSMITTED                                 │
└────────────────────────────────────┴─────────────────────────────────────────────┘
```

| Slot                    | Content                                                                                                                                                                                                                                                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Kicker                  | A short rule, then "Before you leave an agent running", in mono                                                                                                                                                                                                                                                                      |
| Headline, first weight  | "Your agents can already do the work." Serif, the largest type on the page                                                                                                                                                                                                                                                           |
| Headline, second weight | "Memnox makes it safe to let them do it without you." At about 60 percent of the first line's size, muted, with "do it without you" in full white                                                                                                                                                                                    |
| The three answers       | "Allow" · "what can happen on its own", "Ask" · "when a person needs to decide", "Deny" · "what should never happen". Large bold words on the right of each row, notes on the left. They light in step with the scene: Ask lights while the question waits, Deny lights when Maya taps it. This is the key the rest of the page uses |
| Agent row               | "Point it at your agent", then the marks for Claude Code, Codex, Cursor, Hermes, OpenClaw and Ruflo, each named for screen readers                                                                                                                                                                                                   |
| Buttons                 | "Start free" filled with an arrow, "Download for Mac" outlined                                                                                                                                                                                                                                                                       |
| Small line              | "or run locally: npm i -g memnox", linking to the runtime repository, so the old "Run locally" door stays                                                                                                                                                                                                                            |
| `[MAC]`                 | A MacBook with its notch. The island drops from the notch over a terminal                                                                                                                                                                                                                                                            |
| Slack card              | Overlapping the Mac's lower left corner, so a visitor without Apple sees their own door in the first screen                                                                                                                                                                                                                          |
| `[IPHONE]`              | Overlapping the Mac's lower right corner, a lock screen with the Live Activity                                                                                                                                                                                                                                                       |
| Plate caption           | "READ OFF YOUR OWN DISK" and "NOTHING IS TRANSMITTED" in mono capitals under the scene, as today                                                                                                                                                                                                                                     |

**Motion.**

1. The terminal types `vercel --prod` and stops. "Ask" lights on the left.
2. The island, the Live Activity and the Slack card rise together.
3. A tap on "Deny" in Slack. "Deny" lights on the left.
4. All three read "Denied by Maya on Slack."
5. The terminal goes on to `vercel`, "Preview ready" appears, and "Allow" lights.

One loop walks the visitor through all three answers without a word of explanation.

---

## 2. Your team's tools: the hub

```
Your team's tools.                         Connect what the team already uses.
Your agents. Safely.                       Reads are allowed, writes ask the right
                                           person, the dangerous is denied.
┌──────────────────────────────────────────────────────────────────────────────┐
│ [IMG] dots travel left to right                                              │
│                                                                              │
│  AGENTS                                                         TOOLS        │
│  ([LOGO] Claude Code)   ── linear.list_issues ───────────   ([LOGO] GitHub)  │
│  ([LOGO] Cursor)                                             ([LOGO] Linear) │
│  ([LOGO] Codex)         ══ gh pr create ══ (BO) ═════════   ([LOGO] Jira)    │
│  ([LOGO] Hermes)                 ┌──────────┐                ([LOGO] Slack)  │
│  ([LOGO] OpenClaw)               │  [LOGO]  │                ([LOGO] Notion) │
│                                  │  Memnox  │                ([LOGO] Stripe) │
│                                  └──────────┘                ([LOGO] Vercel) │
│                         ━━ stripe refunds create ━━ ✕ ┄┄┄┄   ([LOGO] AWS)    │
│                                                                              │
│                    ── Allow        ══ Ask a person        ━━ Deny  ✕         │
│ ──────────────────────────────────────────────────────────────────────────── │
│ (AN) Ana asked first   (BO) Bo after 5 min   (LI) Lin on Discord             │
│                             Example · Today 212 actions · 9 asked · 1 stopped │
└──────────────────────────────────────────────────────────────────────────────┘
```

| Slot     | Content                                                                                                                                                |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Heading  | Left, serif: "Your team's tools. Your agents. Safely."                                                                                                 |
| One line | Right, muted, in the same row as the heading                                                                                                           |
| Agents   | Five pills, each a logo and a name: Claude Code, Cursor, Codex, Hermes, OpenClaw                                                                       |
| Centre   | The Memnox logo in a rounded square with a soft blue ring                                                                                              |
| Tools    | Eight pills in two columns: GitHub, Linear, Jira, Slack, Notion, Stripe, Vercel, AWS                                                                   |
| Lanes    | Allow: grey `linear.list_issues` passes. Ask: blue `gh pr create` stops for Bo's avatar, then passes. Deny: orange `stripe refunds create` ends in a ✕ |
| People   | Ana, Bo and Lin as avatars, each lighting when the question is theirs                                                                                  |
| Tally    | Mono, right aligned, and the page's one "Example" label                                                                                                |

**Motion.** One dot per lane in turn. Bo's avatar turns blue before the write passes, and the
refund dot shakes and fades at the ✕.

---

## 3. Stopped before it happened

```
                      Stopped before it happened.
               The tool would do it. Memnox does not let it.

                      «CLI»   «MCP tools»   «Code»
┌────────────────────────┐ ┌────────────────────────┐ ┌────────────────────────┐
│ $ psql $DATABASE_URL   │ │ $ gh pr review         │ │ $ terraform destroy    │
│   -c "DELETE FROM      │ │   --approve 412        │ │                        │
│   orders"              │ │                        │ │                        │
│ ✕ Denied by Memnox:    │ │ ✕ Denied by Memnox:    │ │ ✕ Denied by Memnox.    │
│   a DELETE with no     │ │   an approval is what  │ │   Instead: terraform   │
│   WHERE is every row   │ │   lets a merge through │ │   plan -destroy, and   │
│                        │ │   Instead: gh pr review│ │   read it              │
│                        │ │   --comment, and let a │ │                        │
│                        │ │   person approve       │ │                        │
└────────────────────────┘ └────────────────────────┘ └────────────────────────┘
```

| Tab       | Cards                                                                                                                                                                           |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLI       | The three above, each sliding in one after another                                                                                                                              |
| MCP tools | `stripe.create_refund`, `slack.post_message #customers`, `linear.delete_issue`, `github.merge_pull_request`, each with its tool logo and a blue Ask mark and the owner's avatar |
| Code      | Three pairs, refused then fixed: `body: any` to `body: unknown`, `import axios` to `fetch`, `export default` to a named export                                                  |

| Slot    | Content                                                                                 |
| ------- | --------------------------------------------------------------------------------------- |
| Heading | Centred serif                                                                           |
| Tabs    | Pills, keyboard operable, auto advancing while on screen until clicked                  |
| Card    | The attempt in mono on a darker well, then an orange ✕ and the exact line Memnox prints |

No force push here: GitHub's branch protection already refuses it, so it is not Memnox's win.

---

## 4. Talk to them, teach them

```
┌──────────────────────────────────┐  ┌────────────────────────────────────────┐
│ Ask out loud.        ← lit       │  │ [IMG] Mac island, voice                 │
│ Say a rule.          ← dim       │  │        ╭──────────────────────────╮     │
│ Follow up.           ← dim       │  │        │          ( ◉ orb )       │     │
│ Two agents, one file.← dim       │  │        │          Listening       │     │
│                                  │  │        │  what is Cursor doing?   │     │
│                                  │  │        │  Cursor is fixing the    │     │
│                                  │  │        │  cart tests in shop-web. │     │
│                                  │  │        ╰──────────────────────────╯     │
└──────────────────────────────────┘  └────────────────────────────────────────┘
 01 Ask out loud        02 Say a rule          03 Follow up           04 Two agents, one file
 Say "Memnox", or       "Never deploy on       From your phone,       The second one waits,
 press Option Space.    Fridays." Touch ID.    typed into the         and is told who
                                               agent's own app.       holds it.
```

| Step                 | Scene on the right                                                                                                                                                               |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ask out loud         | The Mac island: the orb pulses, "Listening", live words, then "Speaking" with captions                                                                                           |
| Say a rule           | "Say a rule", live words, then the rule card, "Where should it hold?", Touch ID, "That rule is in force on this Mac."                                                            |
| Follow up            | `[IPHONE]` with the orb, live words "when the tests pass, open a pull request", then `[MAC]` behind it showing the words typed into Claude Code, and "Typed it into Claude Code" |
| Two agents, one file | Two terminals side by side. Cursor gets the held prompt for `src/billing` with "[w] wait up to 120s [t] take it anyway [d] don't", waits, then carries on                        |

The large lines on the left are serif, about 46 px. The current one is white and the others are
dark grey, as on Parley. They change every 9 seconds and stop changing once one is clicked.

---

## 5. At home on every screen

```
                       At home on every screen.
             No Mac? No iPhone? Answer in Slack or Discord.

┌──────────────┐ ┌──────────────┐ ┌══════════════════┐ ┌──────────────┐
│  ╭────────╮  │ │   ┌──────┐   │ ║ [No Apple needed]║ │ ● ● ●        │
│  │ island │  │ │   │ Live │   │ ║ [LOGO]×4         ║ │ Waiting on   │
│  ╰────────╯  │ │   │Activ.│   │ ║ Codex on build-  ║ │ you          │
│              │ │   │      │   │ ║ box wants to run ║ │ ┌──────────┐ │
│   [MAC]      │ │  [IPHONE]    │ ║ the migration    ║ │ │ passkey  │ │
│              │ │              │ ║(Allow once)(Deny)║ │ └──────────┘ │
│              │ │              │ ║ Allowed once by  ║ │ $ memnox     │
│              │ │              │ ║ Bo on Discord.   ║ │   inbox      │
└──────────────┘ └──────────────┘ └══════════════════┘ └──────────────┘
 On your Mac      On your iPhone    In your chat         In a browser or terminal
 Touch ID for     Face ID, even     Slack, Discord,      Linux and Windows too.
 a yes.           locked.           Telegram, Teams.
```

| Card | Device                                                                                                         | Caption                                               |
| ---- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| 1    | `[MAC]` cropped to the notch and island                                                                        | "On your Mac" · "Touch ID for a yes."                 |
| 2    | `[IPHONE]` top half, Live Activity                                                                             | "On your iPhone" · "Face ID, even locked."            |
| 3    | A chat DM with four `[LOGO]` marks: Slack, Discord, Telegram, Teams. Blue border and a "No Apple needed" badge | "In your chat" · "Slack, Discord, Telegram, Teams."   |
| 4    | A browser window with "Waiting on you", and a `memnox inbox` line                                              | "In a browser or terminal" · "Linux and Windows too." |

The chat card is the only one with a coloured border, so a visitor without Apple finds their
door first.

---

## 6. Logo strip

```
             Works with the agents and tools you already use
 ([LOGO] Claude Code) ([LOGO] Cursor) ([LOGO] Codex) ([LOGO] Hermes) ([LOGO] OpenClaw)
 ([LOGO] GitHub) ([LOGO] Linear) ([LOGO] Jira) ([LOGO] Notion) ([LOGO] Slack)
 ([LOGO] Discord) ([LOGO] Telegram) ([LOGO] Teams) ([LOGO] Stripe) ([LOGO] Vercel)
 ([LOGO] AWS) ([LOGO] Terraform) ([LOGO] Postgres)
```

The pills scroll slowly and pause on hover. Under reduced motion they wrap and stay still. Most
marks are already in `apps/web/public/connectors`. Telegram, Terraform and AWS
still need a mark.

---

## 7. Start

```
┌══════════════════════════════════════════════════════════════════════════════┐
║                              Let them work.                                  ║
║                         Free to start. No card.                              ║
║  ┌──────────────────┐  ┌──────────────────┐  ┌────────────────────────────┐  ║
║  │ Mac app          │  │ iPhone app       │  │ Linux, servers, WSL        │  ║
║  │ Download for Mac │  │ App Store        │  │ npm i -g memnox            │  ║
║  └──────────────────┘  └──────────────────┘  └────────────────────────────┘  ║
║                               (Start free)                                   ║
║  No AI decides what is allowed · Secrets stay on your machine · Every yes is signed ║
└══════════════════════════════════════════════════════════════════════════════┘
```

| Slot      | Content                                                              |
| --------- | -------------------------------------------------------------------- |
| Band      | Full width, filled with the accent blue, rounded corners             |
| Heading   | Serif, white, about 64 px                                            |
| Tiles     | Three darker translucent tiles: Mac, iPhone, the npm command in mono |
| Button    | White pill, "Start free"                                             |
| Trust row | Three short claims, white at 85 percent                              |

Footer: the wordmark, then Docs, Security, Pricing, GitHub.

---

## On a phone

Every row becomes a column, in the same order:

1. **Hero:** kicker, headline, the three answers, the agent row and the buttons, then the scene with the iPhone first, the Slack card next
   and the Mac last.
2. **Hub:** agents above the Memnox logo and tools below it, so the lanes run down rather than
   across.
3. **Stops:** the tabs, then the cards in a column.
4. **Talk:** the four lines become a row of tabs above the scene.
5. **Screens:** one card per row, with the chat card first.

---

## From today's page to this one

What the site has now, in `apps/web`, and what each piece becomes.

| Today                                                                                                  | Becomes                                                                                            |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| Hero words: kicker, the two weight headline, the three answers, "Point it at your agent", "Start free" | Kept word for word in band 1's left column                                                         |
| "Run locally" button                                                                                   | The small "or run locally: npm i -g memnox" line, so "Download for Mac" can take the second button |
| The ASCII portrait in the hero's middle column                                                         | The Mac, iPhone and Slack scene                                                                    |
| The plate caption "READ OFF YOUR OWN DISK · NOTHING IS TRANSMITTED"                                    | Kept, under the scene                                                                              |
| `TeamSection`                                                                                          | Band 2, the hub                                                                                    |
| `ReachSection`                                                                                         | Band 3, stopped before it happened. Rename the file to match, so the next person is not misled     |
| `WatchSection`                                                                                         | Band 4, talk to them                                                                               |
| `DoorsSection`                                                                                         | Bands 5 and 7: every screen, then the start band                                                   |
| No logo strip                                                                                          | Band 6, built from `public/connectors`                                                             |

---

## Still to provide

| Item                                 | Status                                                 |
| ------------------------------------ | ------------------------------------------------------ |
| Real logo marks                      | In `public/connectors` except Telegram, Terraform, AWS |
| Download for Mac                     | No URL yet; needs a `/download` page or the real link  |
| App Store link                       | No URL yet                                             |
| The tally and Cursor's spoken answer | Invented examples, labelled "Example"                  |
