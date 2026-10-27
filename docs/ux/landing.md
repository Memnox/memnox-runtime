# The marketing home page

`memnox-client/apps/web/app/page.tsx` · the first thing a stranger sees.

**Job.** Show, mostly without words, a team handing real work to agents through the tools it
already uses, the mistakes Memnox stops that nothing else would, and that anyone can answer from
Slack or Discord. The illustrations carry the page; text is a label, never a paragraph.

**Length.** Five bands, about four screens on a desktop.

**Word budget.** A band heading is six words or fewer, with at most one line under it. Inside an
illustration only real product text appears: commands, tool calls, buttons and the refusal
lines Memnox prints.

## What makes an example worth showing

Only mistakes an agent makes easily, that the tool it uses would happily carry out, and that
Memnox stops. A force push to main is a poor example, because branch protection on GitHub
already refuses it. Every example below is a real verb table row, SQL check, MCP class or code
fingerprint line in `memnox-runtime`, so the page never promises what the product does not do.

## Shape

| #   | Band                        | Illustration                                                               |
| --- | --------------------------- | -------------------------------------------------------------------------- |
| 1   | Hero                        | One question reaching a Mac, an iPhone and Slack at once                   |
| 2   | Your team, your tools       | Agents working through the team's connected tools, with Memnox at the edge |
| 3   | Caught before it happened   | Three tabs, CLI, MCP and Code, each a strip of real stops                  |
| 4   | Watch it work               | Four tabs: ask out loud, say a rule, follow up, two agents one file        |
| 5   | Answer anywhere, then start | Slack and Discord answering, then three ways in                            |

## 1. Hero

The words stay as they are on the site today:

- Kicker: "Before you leave an agent running"
- Headline: **Your agents can already do the work.** Then, a step smaller: "Memnox makes it safe
  to let them **do it without you**."
- The three answers, kept from today's hero and now the key for the whole page: "Allow" · "what
  can happen on its own", "Ask" · "when a person needs to decide", "Deny" · "what should never
  happen".
- "Point it at your agent" with the marks for Claude Code, Codex, Cursor, Hermes, OpenClaw and
  Ruflo.
- Buttons: **Start free**, **Download for Mac**, and "or run locally: npm i -g memnox".
- Plate caption: "READ OFF YOUR OWN DISK · NOTHING IS TRANSMITTED".
- The ASCII portrait is replaced by the illustration below, so the picture is the product.
- Illustration, 8 seconds: Claude Code runs `vercel --prod` from a feature branch and stops.
  The same card appears at once on the Mac island, an iPhone Live Activity and a Slack DM:
  "Claude Code on Maya's Mac wants a production deploy". A tap on "Deny" in Slack, and all
  three read "Denied by Maya on Slack." The terminal shows the agent going on to `vercel`, the
  preview deploy, which runs. The three answers on the left light in step: Ask while the
  question waits, Deny at the tap, Allow when the preview runs.
- Every band after this draws the same three answers the same way: Allow grey, Ask blue with the
  person's avatar, Deny orange with a ✕.

## 2. Your team, your tools

- Heading: **Your team's tools. Your agents. Safely.**
- Illustration: four agent marks on the left (Claude Code, Cursor, Codex, Hermes), the team's
  tools on the right (GitHub, Linear, Jira, Slack, Notion, Stripe, Vercel, AWS), Memnox as a thin
  line between them. Small dots travel left to right:
  1. Reads pass straight through, in the neutral tone: `linear.list_issues`, `gh pr view`,
     `aws s3 ls`.
  2. A write pauses at the line with a small person avatar, then passes once a face turns
     green: `linear.update_issue`, `gh pr create`.
  3. One dot stops at the line with a mark: `stripe refunds create`.
- Three avatars under the line, Ana, Bo and Lin, each lighting when the question is theirs.
- A tally fades in underneath: "Today: 212 actions · 9 asked · 1 stopped".

## 3. Caught before it happened

- Heading: **Stopped before it happened.**
- Three tabs with icons: **CLI**, **MCP tools**, **Code**. Each tab is a horizontal strip of
  three or four cards. A card is the attempt in mono, a stop mark, and the line Memnox printed.
  Cards slide in one at a time.

**CLI** (verb tables and the SQL check)

| Attempt                                      | Memnox                                                                                                   |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `psql $DATABASE_URL -c "DELETE FROM orders"` | "a DELETE with no WHERE is every row"                                                                    |
| `terraform destroy`                          | Instead: "terraform plan -destroy, and read it"                                                          |
| `gh pr review --approve 412`                 | "an approval is what lets a merge through" · Instead: "gh pr review --comment, and let a person approve" |
| `aws s3 rm --recursive s3://invoices`        | Instead: "aws s3 rm one key at a time"                                                                   |

**MCP tools** (tool classes; each one asks the owner rather than refusing)

| Attempt                            | Memnox                    |
| ---------------------------------- | ------------------------- |
| `slack.post_message` to #customers | Asks Maya                 |
| `stripe.create_refund` 4,200 USD   | Asks Maya · "moves money" |
| `linear.delete_issue` LIN-381      | Asks Maya                 |
| `github.merge_pull_request` #412   | Asks Maya                 |

**Code** (the repository's code fingerprint, enforced lines)

| The agent writes                     | Memnox                                                          |
| ------------------------------------ | --------------------------------------------------------------- |
| `const body: any = await res.json()` | Refused: `any` is how an untrusted payload becomes trusted      |
| `import axios from 'axios'`          | Refused: no new dependency, this repository uses node built ins |
| `export default function handler`    | Refused: named exports only                                     |

The Code tab ends with the agent's next attempt landing with a check: `unknown`, `fetch`, a named
export.

## 4. Watch it work

- Heading: **Talk to them. Teach them.**
- Four icon tabs, each one illustration and a three word caption:
  1. **Ask out loud.** Mac island: "Listening", live words "what is Cursor doing?",
     "Speaking" with the answer as captions.
  2. **Say a rule.** "Say a rule", live words "never deploy to production on Fridays", the rule
     card with a Touch ID glyph, "That rule is in force on this Mac."
  3. **Follow up.** iPhone orb, live words "when the tests pass, open a pull request", the words
     typed into Claude Code's window on the Mac, "Typed it into Claude Code".
  4. **Two agents, one file.** Two terminals; Cursor reaches `src/billing` while Claude Code
     holds it and gets the real held prompt with `[w] wait`, waits, then carries on.

## 5. Answer anywhere, then start

- Heading: **No Mac? No iPhone? Slack.**
- Illustration: a Slack DM and a Discord DM side by side with the same card, "Codex on build-box
  wants to run the migration", and the buttons "Allow once", "Deny", "Always allow this agent".
  A tap on Discord, and the Slack card turns to "Allowed once by Bo on Discord." Small browser and
  terminal cards sit behind, dimmed.
- Then three tiles: **Download for Mac**, **iPhone app**, `npm i -g memnox`, and **Start free**.
- One trust row of three icons: "No AI decides" · "Secrets stay on your machine" · "Every yes is
  signed".

## Rules for every illustration

1. HTML, CSS and SVG on the site's tokens; never video, never screenshots.
2. Plays only while on screen, slowly enough to read each frame: loops in 16 seconds or less, and rests about a second and a half on its last frame.
3. Reduced motion shows the last frame still.
4. Only real product text inside; numbers are examples, and the page says "Example" once.
5. No sound.
