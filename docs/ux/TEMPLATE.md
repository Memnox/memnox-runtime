# Page spec template

Every page, screen, sheet, window or panel gets one entry in this shape. Write for a product
designer and an engineer who have never opened the app.

## <Page name as the user sees it>

`<route or file path>` · reached from: <where the user taps or clicks to get here>

**Job.** One sentence: the question this page answers for the person.

**Today.** What is on the page now, top to bottom, with every label in quotes exactly as the
code has it: headings, body copy, fields, buttons, links, badges, menus. Then every action and
what happens when it is taken (navigation, dialog, Touch ID or Face ID or passkey, network call,
toast). Then the states: loading, empty, error, partial, permission missing, offline, older
machine.

**What gets in the way.** Concrete UX and UI problems, each tied to a principle in brackets:
[Hierarchy] [Progressive disclosure] [Consistency] [Contrast] [Accessibility] [Proximity]
[Alignment]. Only real problems seen in the code; no padding.

**Improved.** What the page should look like: a wireframe in a fenced block, top to bottom,
with real copy and real numbers, then a short list of the changes and why. Keep the product's
voice: plain words, counts never scores, names never secrets, a yes is signed and a no is free.

---

## Rules for the writer

- No em dash, no en dash, no spaced hyphen anywhere in the prose. Use the joining word the dash
  stood for (because, so, which, and, but, rather than), or two sentences. A range is "11 to 50".
  Box drawing characters inside wireframes are fine.
- Quote labels exactly from code. If a label is computed, say what it is computed from.
- The shared shape every surface must follow:
  - Home blocks in this order: Waiting on you, Working now, Today, Ready to hand over, Not
    covered, then Your team on a team.
  - Agent label everywhere: "<agent> on <machine>", plus "from <person>'s team" when it came
    through the team.
  - Answer words everywhere: "Allow once", "Allow for this session", "Deny", and behind them
    "Always allow this agent", "Allow once, always ask", "Always deny".
  - After an answer elsewhere: "Allowed once by <person> on <door>."
- Do not invent features as if they exist. Anything new goes under **Improved**, and it should be
  buildable on what the code already has.
