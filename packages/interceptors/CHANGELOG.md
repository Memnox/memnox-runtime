# @memnox/interceptors

## 0.14.2

### Patch Changes

- 011467d: Two agents on two machines meeting in one file now settle it between themselves first. A write held off by another machine's agent tells the agent it can ask that agent directly with `memnox_message_agent`, and a message from another agent reaches it at its next step with the address to answer. The person hears about the hold only if their agent is still held off a minute later, or when an agent asks them. People can speak to each other by voice too: "tell Ana I'm done with billing" or "ask them how long they need" is said on the teammate's Mac at once, and their spoken answer comes back. The workspace stream now picks up what it missed after a dropped connection, so nothing said during a network blink is lost. Memnox now also finds people working on one feature from their branches and tickets, including different tickets under one epic, introduces their agents to each other, keeps each told what the other is doing, and lets an agent ask the backend or frontend agent on its feature directly. A question from another agent reaches an agent whose turn has ended. `team_work` tells a person who they are working with and what each agent is doing.
- 754e395: A write held off because another agent has the same lines now reaches the notch in about a fifth of a second, and where that agent is on another machine in the workspace the voice offers to ask its owner: say "ask Ana if I can have it" and her voice tells her at once, her spoken give, wait or keep comes straight back to yours, and a give hands the lines to your agent so its next write goes through. The daemon now holds the person's workspace stream open itself, so incidents, exception requests and calls still short of their approvals are said the moment they reach someone who can act on them, and an incident can be taken and an exception refused by voice.
- 4abbc02: A follow up to Cursor goes into its agent chat through Cursor's own prompt link and is called sent only once the Mac reads it there and sees it go, rather than being typed wherever Cursor's focus was and called sent when an empty box read empty. A Cursor desktop session can now be stopped by voice, through its Stop button.

  A message sent to a session reads in its steps as what became of it, such as "Your message went in", rather than as the ledger's own "voice delivered typed".

- bf73f4e: `memnox protect` asks about databases on their own rather than as a CLI: a DELETE or UPDATE with no WHERE, a TRUNCATE, a DROP or a schema change is held on every database client, while a write bounded by a WHERE on a local database goes through, and any change to a database on another host still asks. The refusal names the table and the bounded way forward, such as only the test orders. A person who denies a held call from the console, the workspace or a phone can say why, and the agent is told their reason beside that way forward. Existing `cli-ask` rules are left as they were written; run `memnox protect` again to take the new database rules.
- 8cd90e9: A calendar event or a Notion page about to go out in your name is drawn as one on its card: the event with its day, its hours and who is invited, the page with its title and its words.
- feabcfa: A reply typed from the notch or the phone to an agent that is busy in a terminal is typed into its prompt, so it shows in the session as your message and the agent picks it up as its next one, rather than arriving as a note nobody saw.
- e6009a1: `memnox run --for <person>` names who the agent works for, and a rule's `principals:` now fires on it, so an agent on a shared credential never does what its person may not. An agent setting its own identity variables, or running `memnox run --for` or `--role`, is refused. A database tool that has only ever read now asks before its first change, and one that has only made bounded changes asks before its first DELETE or UPDATE with no WHERE. `memnox why` now reads each decision against its context, person, agent, intent, tools, systems and history, and marks the part that decided, from what the gate found, which every row now keeps. The MCP proxy honours `--role` and `--for` and records the class a statement gave a call. An agent can no longer rewrite or delete its host's own session record.
- 1bed4a4: The voice and the switcher order sessions by when you last wrote to each, read from the agent's own transcript, so "the last session" is the one you were working in rather than whichever agent last ran something on its own.
- 87e88a5: Acting as yourself needs no Memnox account. The voice and a paired phone now reach the MCP servers your agents are configured with and the command line tools you are signed in to, such as gh, stripe or psql, straight from this Mac: reads run at once, anything that changes something waits on your Touch ID, and every call passes the same rules, pauses and limits an agent's call does. Connecting a tool from the catalogue opens only that tool's own sign in, because the Mac registers a private personal space of its own the first time it needs one, and pairing a phone works the same way. Signing in later moves what you connected and your paired phone into your account, so nothing is connected or paired twice.
- 981a89a: A paired phone now answers every yes with Face ID. While a phone is paired, every held call and proposal it may answer names it as `answerOn`, so the Mac leaves a spoken yes to that phone rather than Touch ID and says where to answer it. Something a phone asked the Mac to do now names that phone as its origin, so it waits for that phone's Face ID whether or not the phone still holds the voice, and the Mac never declines it as unasked. A phone talking from the island with its app away is woken for what waits even while its tunnel is open for the turn, and a wake held back by the one a minute spacing is sent once the minute is up rather than never.
- dfdfe98: A wrapped MCP server now reads the rules, the workspace bundle and the conditions in force again whenever one of them changed, so pausing an agent or pulling a new bundle decides its very next tool call rather than waiting for the agent to restart. The proxy knows the agent `memnox mcp wrap` wrote into its line, so a pause on that agent stops its servers too. A SQL statement handed to a database MCP tool is ruled like the same statement on `psql`: a DELETE or UPDATE with no WHERE is held with the bounded way forward on its table, while a bounded write goes through where the call shows the database is on this machine, and anything else still asks. Run `memnox protect` again to take the new MCP rule.
- 963416d: An agent that asks several questions in one picker now keeps them on the notch step by step: each answer, spoken or tapped, moves the card and the voice on to the next question, the voice never asks one twice, and each answer gives the next its own time, up to four and a half minutes, so a long set no longer falls back to the terminal halfway through. Claude Code's hook is given five minutes before a tool runs for this, and an existing install is upgraded on its next setup.
- f83fe63: The voice can search the web: "google flights to Oslo" opens the results in the browser on the phone that asked, else on the Mac. A new folder the person asked for is made and the session started in it at once, rather than being asked about twice.
- 10490c2: When two agents need the same lines, the second now waits for the first to let go and goes ahead within a few hundred milliseconds of it doing so, on one machine and across machines, where it used to wait five seconds here and be refused at once by another machine. An editor's write waits up to forty five seconds where its host lets a hook run that long, then is refused naming the holder as before. Where the workspace cannot be asked, the write still goes ahead, but the agent is told a collision with another machine was not ruled out and the timeline keeps a row saying so. An editor working in a project folder that is not a git checkout now takes holds too, on this machine.
- bf73f4e: A rule can now say sensitive data never leaves for a destination nobody approved. What a call sends is read by shape at every seam that sees it, the MCP proxy, agent hooks, `curl` and `wget` bodies, plain HTTP through the egress proxy and `@memnox/guard`, and named `secret`, `financial`, `health`, `government-id`, `personal-data`, `customer-record`, `confidential`, `source-code` or `bulk-records`, each also `sensitive`, which `dataClassifications` matches, with the recipient's domain or the URL's host as the target. A policy file or the workspace's bundle can add its own patterns under a named classification. `memnox protect` offers the rule as a question. A cloud agent wrapped by `@memnox/guard` that reads a tool answer written to steer it now asks a person before its next send, post or loss, as the gateway does.
- cbc69a3: The live session window carries the whole recent conversation with every reply whole, and asking what happened in a session tells what the agent changed, why it said it did, and what was decided along the way.
- ceda286: A session's card is now titled by what it is about now, as Claude Code titles the session itself and keeps that title current, rather than by the first message it was sent. A session with no such title keeps its first message as before.
- fa0c28f: A rule can be said in plain words, on the Mac or from the phone, and is read back before anything is written: "never let an agent send customer records to an unapproved destination" asks which destinations are approved, "ask me before any agent pushes to main" and "Codex may not touch the payments database" are read by a fixed grammar, and on a machine in a team the workspace drafts it, with its model on Pro and Team, kept only when the runtime's validator accepts it. Once confirmed with Touch ID or Face ID it holds on this machine from the next action, offline and with no account, and on a machine in a team it is also offered to the team with its destinations, kinds of data and alternative, where a second admin approves it. A phone asks for it with the new `rule` daemon method.
- Updated dependencies [011467d]
- Updated dependencies [754e395]
- Updated dependencies [4abbc02]
- Updated dependencies [bf73f4e]
- Updated dependencies [8cd90e9]
- Updated dependencies [feabcfa]
- Updated dependencies [e6009a1]
- Updated dependencies [1bed4a4]
- Updated dependencies [87e88a5]
- Updated dependencies [981a89a]
- Updated dependencies [dfdfe98]
- Updated dependencies [963416d]
- Updated dependencies [f83fe63]
- Updated dependencies [10490c2]
- Updated dependencies [bf73f4e]
- Updated dependencies [cbc69a3]
- Updated dependencies [ceda286]
- Updated dependencies [fa0c28f]
  - @memnox/core@0.14.2

## 0.14.1

### Patch Changes

- 97039ac: When the Mac could type but found no message box in an app, the voice is told that reason and that typing is allowed, so asked what it needs it no longer sends the person to switch on a permission that was never the problem.
- 7b2621d: An instruction that cannot reach a session yet is no longer typed into the agent's desktop app instead. A session waiting in a terminal or an editor is shown and sent again, and one just started that has not come up is offered another try in a moment, rather than landing in a different chat in the Claude or Codex app.
- Updated dependencies [97039ac]
- Updated dependencies [7b2621d]
  - @memnox/core@0.14.1

## 0.14.0

### Patch Changes

- 9a7a649: The autopilot acts once a person turns it on: an action an agent was approved for five times with no refusal is handed to that agent for seven days, and one refusal takes it back. `memnox autopilot` lists and revokes the grants, and an agent can no longer run `next --hand-over` itself.
- 099b03f: Every person on every plan connects any tool as themselves. The daemon answers connections-sign-in with the tool's sign in page, opened on the Mac when asked there and handed to a paired phone to open, connections-sign-out with the list as it then stands, and toolkits-search with up to thirty tools from the cloud's catalogue. The voice calls sign_in the moment somebody says "connect my Notion", and no longer says an admin has to connect a tool first.
- d706518: Agent hooks run the edit hook by its absolute path, because an agent started without the installer's PATH failed every tool call with `memnox-edit-hook: command not found`, and the daemon rewrites any hook still written by the bare name.
- f46a903: Setup puts a Memnox plugin into Hermes, enabled without turning off the plugins Hermes already runs, so a Hermes session is ruled on, takes leases and reaches the ledger, and an ask goes to its person through Hermes's own approval. Shell hooks an earlier install wrote are taken out.
- b1c309b: An agent the workspace plan has no room for is reported as governed on this machine rather than failed, since the plan caps workspace credentials and never the gates on the laptop.
- cbfd421: GitHub Copilot CLI, Devin and OpenCode are hooked by setup and found by scan, as Gemini CLI and Windsurf now are too. Claude Code's hook stands down where Cursor, Devin or Copilot runs it, so no call is ruled twice or filed under the wrong agent, and doctor says when Codex no longer runs a Memnox hook it once trusted. Every agent's hook and plugin runs through one launcher at a fixed path, so an update to Memnox never sends Codex's hooks back for approval, and the launcher and the daemon run on a Node of the person's own before one another app bundles. Setup ends with what only the person can do, such as approving hooks in Codex or restarting an agent that loads a plugin, and doctor tells a terminal older than its PATH from one that is missing it. The daemon's home carries the same list as needsYou, each item kept until the ledger hears from that agent after the change, so the Mac app says what setup could not when it ran without a terminal. Doctor counts MCP servers the way mcp wrap acts on them, so Memnox's own servers and those declared by URL no longer read as unrouted.
- f46a903: Setup writes a Memnox plugin into OpenClaw that hands every tool call and session to the policy hook, so OpenClaw is ruled on, takes leases and reaches the ledger. A relative path is resolved against the directory OpenClaw itself resolves it in, an ask goes to its person through OpenClaw's own approval and a no or a timeout there is recorded, and a config written as JSON5 is joined with marked insertions that keep every comment.
- 3b2790a: The proxy and interceptors package descriptions read as sentences rather than around dashes.
- 5427677: An email draft card shows the real address it goes to, with the name beside it, and the person can change that address on the card before Send. The new address goes out only under a fingerprint over it and the words together (`memnox-confirm:v3`), the voice reads the address back exactly, and `sent` names the address a mail really went to.
- 2081eb8: A session that starts on a machine logged in to a workspace is told, before its first turn, who has a pull request or a pushed branch open on the files it is about to work on, which other open work touches them, and what was said about them in connected tools, asked once with a short timeout and said nothing about when the workspace cannot answer. The brief tool says the same lines first, and a note about other work on a file now reads as being about other work rather than about another agent.
- e12626a: The Sessions overview no longer lists the voice's own Hermes conversations as Hermes working, shows a Hermes session as working only while Hermes is running, and no longer counts a terminal the voice typed into, such as iTerm, as an agent working now.
- 2081eb8: What connected tools such as Slack, Notion and Linear said that nobody has approved yet now reaches the agent as context. The workspace memory keeps it in its own `unconfirmed` list, the `memory` and `brief` session tools answer it apart from the facts under a warning, and the session hook says at most one per call, each opening with that nobody approved it and naming where it was read and who said it, with the untrusted warning where its source was outside the workspace. No verdict reads it, and nothing in it is ever described as settled.
- 11dc443: The voice takes the person's name out of a reply only where it calls them, at the end of a clause or the start of a sentence, so "assigned to Moise, and nothing matches" is said whole rather than as "assigned to and nothing matches". A resumed voice is told which drafts it put up were sent, failed, declined, withdrawn or ran out since the person last spoke, so a draft already sent is never called waiting on their screen. The `repository` tool finds a repository named out loud on the disk when no session touched it in the last day, rather than reporting it missing, and its description no longer offers a real project name as the example.
- 11dc443: The voice signs the person in to Memnox Cloud itself with `memnox_sign_in`, the same sign in as the Account row, rather than sending them to a menu or a terminal. It counts the tools their workspace connected from the same list the Tools panel shows, never calls an unverified account one still to confirm, reads only their own pull requests when asked for theirs, keeps dictated words such as "gate status" as said, writes a draft's label for the screen, and says they for anyone whose pronouns it was not told.
- Updated dependencies [9a7a649]
- Updated dependencies [099b03f]
- Updated dependencies [4c51627]
- Updated dependencies [819f22d]
- Updated dependencies [d706518]
- Updated dependencies [f46a903]
- Updated dependencies [b1c309b]
- Updated dependencies [cbfd421]
- Updated dependencies [f46a903]
- Updated dependencies [3b2790a]
- Updated dependencies [f2eb66a]
- Updated dependencies [5427677]
- Updated dependencies [2081eb8]
- Updated dependencies [e12626a]
- Updated dependencies [2081eb8]
- Updated dependencies [11dc443]
- Updated dependencies [11dc443]
  - @memnox/core@0.14.0

## 0.13.15

### Patch Changes

- 12b056a: The voice reads and acts in your own tools in your own name rather than a bot's: Slack, mail, documents, GitHub and Linear, read at once, and a DM, an email or a review reply drawn the way that tool draws it and sent only after Touch ID or Face ID. Working alone, you can use any tool; in a team, your own mail, calendar and documents, and the team's tools once an admin connected them. Ask for something in a tool you have not used yet and its icon appears in the notch: one tap signs you in, and the voice carries on with what you asked. Name the tool, as in "comment on the GitHub pull request", and that tool is used and no other, whichever tool it is. An account nothing ties to you is named in the notch with Not me beside it and asks nothing more, since the first thing you send from it with Touch ID ties it to you. Ask without the words and the voice drafts them for you to read on the card, and who it goes to is found among the people in that tool rather than written as heard. A company that holds an app back is named rather than leaving it to fail.
- 66ac35a: Words typed into an agent go in within about half a second rather than three, in an editor's terminal and in a tmux or WezTerm pane, and the voice hears the Mac's answer sooner.
- 559ff78: Scan reads whether each agent asks before acting, where its binary lives and who signed it, and which agents were removed. `protect --managed` moves Claude Code's hook into managed settings. Every row names the subagent that did it. `run --hold-credentials` keeps tokens out of the agent's environment and hands each only to the CLI that uses it.
- af96f45: An agent you start by voice that stops to ask something in its terminal before it starts, such as Claude Code asking whether you trust the folder, is no longer left waiting in silence: the voice reads its tab, says what it asks and the choices, and presses the keys for your answer in that tab and nowhere else. The same works for any question an agent shows in its terminal later. A repository, folder or agent you name is the one used, never one you use more often, and a name that only sounds like a repository is read back to you rather than started. A permission or a choice Claude Code asks for in the middle of a session is read out the moment it is asked, and answered the same way. The voice finds the person you mean by name in the workspace before it sends them anything, says the name of the workspace it is connected to after a login, and tells you when this Mac is enrolled in a different workspace from the one you signed in to, rather than reporting an empty memory. As an admin you can read through a tool you connected for the workspace without signing in again; sending still goes out under your own sign in. The VS Code extension is installed again whenever what it declares changes, not only its code, so it runs in every window and the window holding a session's terminal answers when words are typed into it.
- c21e7b6: A question your agent asks in its own picker now reaches the notch and your iPhone with its choices, so you can tap one, or say it, and the agent carries on with your answer. Nobody answering in time leaves the picker to open on screen as before.
- a7aa583: A held call answered by voice or Touch ID is now a row in the agent's own session: the person, what they answered, and what they said, with any secret they read out masked. `replay` shows it in place, `why` can name who let a call through and in what words, and a session's summary counts it among the approvals. The row is written after the answer and can never undo it, so an agent already released is not held again because the ledger could not be opened.
- d3dfad9: The voice can answer a question your team routed to you. The phone or Mac you are talking from names the team's questions waiting on you, so "allow it" or "no" can mean one of them; the voice only writes the answer down, and that device carries it out with the workspace, Face ID or Touch ID first for a yes, a no sent as it is.
- 397c68a: With a phone paired, an answer given in the workspace now reaches a held call within a second rather than on the next poll: the control plane sends the machine a beat with nothing in it over the relay, and the machine checks at once. The fast poll while a call is held relaxes to thirty seconds behind it.
- 9cfa5d2: The voice answers sooner after a sentence said with pauses, since a guess it dropped no longer holds up the real answer and both share one look at the sessions.
- 29c4b55: `memnox ask "<anything>"` answers questions about your agents in your own words, through your own Claude Code rather than any key Memnox holds. The words go whole, with no keyword matching. Claude Code is started with every built-in tool off and only `memnox-operator`, recorded as the operator rather than as your work, kept warm across a conversation and resumed for thirty minutes, and answers stream sentence by sentence, which is what the voice will speak. A plan that has run out is said plainly.
- dc22c3e: The circuit breaker no longer pauses a session for a command that failed and then worked again: a success clears that command's failures, so five failures spread across a day of successes is not an error loop. A pause now names the command and its exit code, "git symbolic-ref has failed the same way 5 times, exiting 128", rather than "git.unknown".
- c8fd0b2: A work brief now carries the ticket read whole, and documents and cut messages too, through the workspace's new `memnox_source`, and tells the agent to write the change the way the repository already writes code and to check it against every point the ticket asked for before saying it is done.
- 698eeaf: The daemon answers `cancel`, which stops the answer in flight when the person talks over it. The turn ends with `cancelled` rather than as a failure, and the brain's process is ended rather than left to finish an answer nobody is listening to on the person's plan. The conversation survives it: the next question resumes where it was.
- cce3e4b: A reply whose opening name was taken out starts with a capital rather than mid sentence.
- d9cb171: A milestone is kept before every command that destroys work, not only `rm`, `mv` and four git subcommands. `shred`, `unlink` and `rmdir` were already destructive to the seam that rules on them and invisible to the one that keeps a tree first, so an agent was asked about them and then ran them with nothing to rewind to. `truncate` to a size that is not an extension, `git checkout --force`, `git switch --discard-changes`, `git switch -f`, `git stash drop` and `git stash clear` join them, and `--force` is now accepted wherever `-f` already was.

  A dropped stash is not in the tree a milestone keeps, so that row marks when the work went rather than offering to bring it back.

- a7501ce: Asked to close a session that is mid turn, the voice asks once and closes it on a yes rather than refusing again, and asked to stop one right now it offers that, since a pause only holds the agent at its next step.
- ef431cb: The gcloud and az verb tables now find list, describe, show and delete wherever the command group puts them, and name secret reads and `gcloud storage rm`. A resource named like a verb no longer turns a delete into a read.
- 82c2667: A Codex patch that moves a file now has its destination checked as well as its source, so renaming a file out of the repository is held at the boundary rather than slipping through.
- 0037d4a: A write through a symlink inside the repository that points outside it now asks first, because the repository boundary compares where a path really lands rather than how it is spelled. A link that points elsewhere inside the repository still counts as inside.
- 5d259cf: The voice starts, shows, stops and closes sessions in more places: a new tmux or WezTerm window, another terminal app such as Ghostty, and Claude Code's editor panel; closing ends the agent first where a tab cannot simply be closed; and any desktop app can be stopped, closed or given a new chat.
- 3577504: A session `memnox run` just started is counted at once, with its agent, folder and terminal, rather than only after its agent first acts, so the voice no longer says nothing is running a minute after you started Claude Code.
- bb540ad: The daemon also listens on the egress port an agent started by an older `memnox run` was pointed at, read back from that agent's own proxy variables, so a session started before an upgrade or a reinstall keeps its network with nobody running a command.
- 3525cc5: The daemon can now be the voice of what is waiting on a person. `subscribe` keeps a connection open and writes one line for every held call, proposal and paused session as it appears, `waiting` lists what is answerable now, and `confirm` answers a held call or a proposal. A refusal needs nothing, because saying no can do no harm. Anything that lets something happen carries a P-256 signature from a key registered once through `register-key` and never replaced from the socket, so a process running as the same user can raise a Touch ID sheet but never finish an approval. Proposals are a new store under `~/.memnox/proposals/`: a change something other than a person suggested, written down and applied only once confirmed, and a confirmed rule may only ever land in `memnox.policies.toml`.

  `memnox unattended [--agent <name>] [--json]` answers whether an agent can be left running: the boundary the rules draw for it, and every reason not to yet, each one a count or a fact, in the order a person should deal with them.

  The voice is one more route to a held call, beside the terminal, `memnox approve` and the workspace DM, and none of them is taken away: whichever answers first releases the agent's session with that answer, so it carries on after an allow and is handed the refusal after a deny. A subscriber is told `settled` when something it heard about was answered elsewhere or expired, so a question answered in a terminal stops being asked out loud.

- b5e4ad0: The daemon answers `ask`: what the person said, whole, answered by their own Claude Code one chunk per line as it streams, which is what the Mac app will speak. One warm brain serves every caller, turns wait for each other so two questions never interleave in one conversation, and a brain quiet for five minutes has its process let go while the conversation stays resumable. A turn that fails ends with a failure the voice can say rather than silence.
- 9389d60: An intercepted command now keeps its ledger row and exits with its real status when the daemon closes the connection without replying. A final reply the daemon sends without a trailing newline is read rather than dropped.
- 831b86c: `memnox daemon --install` stops a daemon the machine already holds before starting it again, so a rebuilt runtime, and the Mac app that installs it, meet the new code rather than a process still running the old one.
- 376a05c: A restarted daemon takes back the egress port it held, so an agent started under `memnox run` keeps reaching the network instead of getting connection refused.
- 826250d: Installing the daemon picks a Node on this machine that really runs it, rather than whichever came first on the PATH, so an app that ships its own Node, such as Hermes, no longer leaves the daemon dying at every start.
- 06593e2: The daemon refuses a request whose fields hold the wrong types and hangs up on a line too long to be a request, rather than trusting either. What the voice reads off the screen or from an agent is marked as evidence, never an instruction, so a line on screen asking it to approve or send something is described and never done.
- 539521b: The voice sees sessions in the Codex app and Claude desktop's agent mode, read from what those apps keep on this Mac: they are listed beside the others, read whole by history, and announced as they start and as a turn there finishes. A Codex session in a terminal now has what it answered in its history too.
- c7932f4: Docker commands that remove containers, images, volumes and networks, prune the system with `--all`, or bring compose down with its volumes are now destructive rather than unknown. `run`, `exec`, `compose up`, `stop`, `kill`, `tag` and `login` are named writes, and `login` is tagged as touching secrets.
- 44df5d6: The VS Code, Cursor and Windsurf extension is put in when the editor was installed under your own Applications folder, not only the shared one.
- 1bde963: The daemon's egress proxy listens on a port the system picks rather than 8888, so it never takes the port Jupyter, Charles or another local proxy expects. `memnox run` already read the port from the daemon, so agents are pointed at it as before.
- d84d991: `@memnox/core/engine` is the rule engine with nothing that reads a disk or opens a database: the policy engine, the default rules, the verb tables, the tool and SQL classifiers, the circuit breaker and budgets. An agent running in somebody's cloud can load it and decide allow, ask or deny in its own process, in microseconds. The SQL check's `psql -f` file reader moved to its own module so the check itself stays pure.

  `@memnox/guard` governs an agent running in the cloud, built with the Claude Agent SDK or any framework that calls tools: allow and deny are decided in its own process from the workspace's signed rules, an ask is put to the right person on their phone, Mac, Slack, Discord or the console and waits a bounded time, only a signed answer is believed, and the circuit breaker pauses a session that fails the same way five times.

  The guard also wraps OpenAI Agents SDK function tools and any plain function (`wrapTool`), can refuse a yes no device or passkey signed (`requireDeviceProof`), records a circuit breaker pause, and lifts it once a person resumes the session from their phone or the console. On a Mac connected to a team, a rule said aloud can now be offered to the team as a third place beside the whole Mac and a repository, and the voice can say what an agent running in the cloud is doing.

- 7676585: A scan now counts `PASSWORD`, `PGPASSWORD`, `MYSQL_PWD` and `SECRET_KEY_BASE` as credentials and reads `export NAME=` lines by their name, so `echo $PGPASSWORD` is recorded as an environment read. It also looks in `.envrc`, `.env.staging`, `.env.test` and `.env.production.local`.
- 37c2318: The macOS kernel guard's profile now escapes a backslash in a path, so a path ending in one can no longer close its string early and add a rule of its own.
- c2fc346: The daemon puts the Memnox extension back into an editor that uninstalled it, since the folder an editor leaves behind until it restarts is no longer read as installed.
- be99ac9: The daemon puts the editor extension in again whenever its manifest changes, not only its script, so a fix to how the extension starts reaches every editor.
- ad69765: The VS Code extension runs in every window from the start, so a follow up reaches a session's terminal in whichever window holds it.
- 1d19498: Listing sessions and reading one by voice no longer starts git for every folder a session touched to find its repository, which made "what is that session doing" take several seconds more than it needed.
- d84d991: Memnox asks less as it learns, and says so. An allow rule can now name the ask rules it stands in for (`relaxes`), because an allow beside an ask was always still asked about: `memnox next --hand-over` writes allows that actually stop the asking, never over a deny and never over a rule the workspace published. A held call takes a fourth answer, "From now on", on the Mac and the iPhone: the call runs once and a narrow rule for that agent, action and target goes on a card the person places and signs. A new agent on probation no longer asks before writing inside its repository, because the milestone kept before its first write puts that back; writes outside the repository, deletes and outward actions still ask. A finished turn now says what it came to, "It ran 47 actions and asked you 1 time", and `memnox next` shows questions per week against work per week, with the sessions that asked nothing.
- 9059b09: The voice hands the Mac a session's latest request and reply with each request to type, stop, close or show it, so a terminal app with several tabs, such as Ghostty or Warp, has its session's tab found by what is on screen in it.
- 5f19368: A finished notice now says how the turn left its tests: passed, failed, passed but changed since, or not run. It is read from the agent's own transcript against the writes the ledger saw, so the Mac orb celebrates only a turn that ended on a passing run.
- de574df: A follow up to a session in the Codex, Claude or Cursor app is typed into that app rather than left waiting, and a Cursor start says your words are waiting in its chat.
- 596c058: A follow up you ask for by voice lands in the session where it already runs, in its VS Code terminal whichever VS Code window holds it, its Claude Code panel, or its Terminal or iTerm tab, and never opens a new session or chat. A native Claude Code install is recognised as the agent in its terminal, "gate" is heard as git, and a reply that asked you something is no longer followed by "I didn't quite catch that".
- f1eecb2: Git commands that destroy the way back, such as `reflog expire`, `stash clear` and `push --delete`, are now destructive, and a `+main` refspec resolves to the same force push action as `--force`.
- 15a5436: `memnox protect --hooks` now asks git where its hooks live, so it installs into linked worktrees and submodules instead of failing, and says it skipped rather than claiming success when `core.hooksPath` points at a hook framework such as Husky. The installed hook also quotes its binary path, so a path containing a space, `$` or quote still runs.
- d5f7cad: Asked for a session's git status, the voice reads it from the repository the session was opened in, even when the session has only run commands.
- 083a43d: An answer guessed while you pause never types, starts or sends anything: an action it reaches for waits until you finish and runs once, only when you said the same, so nothing is done twice.
- 67ebfa7: `uploadPaths = "hashed"` in `config.toml` sends file paths and command lines to the workspace as a keyed hash under a key that never leaves this machine, so the same file still matches and none can be read. The default stays `full`.
- 59ab0be: A held call now reaches the voice with its facts rather than one finished line: the agent by the name the person gave it, the folder it works in, the task it was given, what it wants in the same plain words the session and the DM use, and why it was held. The Mac app words them the way a colleague would, starting with the person's name.
- 6ce7a00: A held call now carries what its session did before it asked: the last test run and whether anything changed after it, the files it changed, what it changed elsewhere, and what failed and was got past. It reaches the terminal, the approvals list and a paired phone, masked for secrets, and never leaves for the workspace.
- 2033ead: Hermes sessions now show beside the others on the phone and the Mac, read from Hermes's own database without writing to it: what each is on, where it works, and its latest conversation, so on a server where Hermes runs you can see what it is doing and ask what it found. An instruction for a Hermes session starts Hermes on that session from its own command line, so it reaches the agent with no Mac to type into it. A held call now carries the name of the rule that asked, so the workspace can put it to that rule's approvers, and an enrolled machine keeps the person who owns it.
- 9b35113: Every surface opens on the same home: what is waiting on you, who is working now, today in counts, the one action ready to run on its own and the agents not covered yet. `memnox status` shows it, and the Mac and the phone read it with `home`. Handing a ready action over writes a rule proposal you still confirm. A server can join from a console token with `memnox login --token`, no browser needed.
- 559ff78: Scan counts the hooks every agent here runs on its own events, including those an enabled Claude Code plugin brought, and a new hook is drift with its own alert and notice. A server fetched by `npx` or `uvx` without an exact version is named as unpinned. `scan --sarif` writes a comparison as SARIF 2.1.0 for code scanning. A rule handed over from `memnox next` names only the targets that were approved, and an action is judged by the widest class it was recorded under.
- 3eb0e20: The interceptor now skips a directory or a file without the execute bit that is named like the binary it wraps, and keeps walking PATH as a shell would, so an earlier stray entry no longer makes the command fail silently.
- af30a19: A kubectl short resource name such as `ns`, `deploy` or `persistentvolumeclaim`, and the `type/name` form, now resolves to the same action as the long name. A rule on `kubectl.delete-namespace` can no longer be stepped around by typing `kubectl delete ns/prod`.
- 3a548d2: Two worktrees or clones of one repository now share leases on this machine, as they already did through the workspace, so a second agent writing the same file in another checkout waits and is told where the holder works.
- ca6b0ea: An iPhone whose app was put away gives the voice back to the Mac after 90 seconds without a word from it, and can be woken for what waits again, rather than holding the voice until the relay dropped.
- fe39d75: On Linux, a session with no terminal is no longer taken to be in one named `?`, so an instruction for an agent waiting in an editor is put in the editor rather than held for later.
- dc963af: Opening a session by voice now shows it live. A new `session-view` daemon request answers with what the session is on, whether it is working, thinking or waiting, its latest steps in plain words with refusals and failures marked, its helpers and the files it changed, so the Mac app can open a window on it that updates while it works. `show` with display open puts that window up, with a button to the session's own terminal tab or editor.
- dc963af: The live window on a Claude Code session shows the conversation itself: what the person asked, what the agent is saying and each tool it runs, read from the end of the session's own transcript for the screen only. The agent's private thinking and its helpers' side conversations are left out, and nothing of it is written to the ledger.
- d277e9c: A session now says where it runs. When it starts, the hook notes the app hosting the agent (the outermost app bundle above it, so a terminal inside VS Code is VS Code), the terminal it has and its folder, once per session and never on the hot path. The daemon's `locate` answers that for a session, with whether the agent is still running, so the Mac app can bring the right window forward for "show me", and `sessions` names the app, so the voice can say which window to look in. A machine where `ps` cannot run still notes the session, without its app.
- 8009857: A question the Mac app or a paired phone can answer no longer opens a Claude Code picker that an answer there could never close: the agent says it is waiting and ends its turn, and your answer from the notch or the phone reaches it and it carries on.
- 7e17bf5: When the Mac has already said out loud what the person needs to do after typing failed, the voice adds nothing, so a failure is heard once rather than three times.
- 373f283: `memnox run --transcript` masks credentials on the way to disk. The agent's output was teed straight into the log file, so a token in an error message or an `aws configure` echo landed in clear text under `~/.memnox/transcripts/` — and `memnox claims` and `memnox trace` read it back onto a screen long after the session ended. The terminal still sees the stream exactly as the agent printed it; only the copy that stays is rewritten.

  Masking is by whole lines, because a chunk boundary falls wherever the pipe happened to break and half a token matches no rule. A character whose bytes arrive in two chunks is held until it is complete, and a last line the agent never terminated is kept and masked rather than dropped. The transcript is also flushed before `run` returns, so its final lines are no longer cut off by the process exiting first.

- 85a36b4: When the voice asks what a message should say, your next words are the message, however short, and looking at a window full of text no longer times out.
- ece8053: A milestone is now taken on a machine where git has no name or email set. `git commit-tree` refused outright there, so every milestone, and every rewind that needs one, failed on a fresh laptop or a CI runner. Milestones are Memnox's own objects under `refs/memnox/`, never part of the person's history, so they are now signed as Memnox rather than borrowing whatever identity the machine has.
- 3f63367: `memnox mission` groups many sessions under one goal: start one with a statement and a reference, join a run with `memnox run --mission`, and the runs it starts join on their own, as does any session working in the mission's repository or its worktrees. `memnox mission show` with no id is the screen for coming back: each session clear, waiting, failing or stopped, and what is waiting on you.
- 881b60b: `memnox-mcp-proxy` now refuses `--name` or `--agent` given no value and names the flag, rather than taking the next flag as the value and misreading everything after it.
- 17e0a33: A wrapped command no longer has to start Node when the daemon is running. Where a native build of `memnox-intercept-native` ships for the platform, `memnox protect` puts it in front of each shim: it asks the daemon, which rules on the whole command with the Node interceptor's own code, and runs the real binary itself. Anything the daemon cannot rule on exactly as Node would, such as a rule that asks a person, a push, or a command that destroys work, still goes to `memnox-intercept`, and so does every command when the daemon is not running or `MEMNOX_INTERCEPT_NATIVE=off` is set. Without a native build nothing changes.
- 4ed9ef8: Memnox can now govern agents running natively on Windows, not only inside WSL, which still works as before. On Windows the daemon listens on a named pipe, `memnox protect` writes `.cmd` interceptors beside the Git Bash scripts, `memnox run` finds `claude.exe` or an npm installed `.cmd` agent and puts the interceptors first on `Path`, `memnox daemon --install` registers a Scheduled Task that starts the daemon at logon, and `memnox doctor` lists which agents are governed natively and which seams, such as the kernel guard, are not available on Windows. This has only been tested on macOS with Windows simulated; ADR 0003 lists what is not yet verified on a real Windows machine, including that the pipe is not a boundary against another local user.
- 8995046: When you talk over the voice after it has already typed, started or sent something, it no longer does it a second time.
- 111655e: `timeline --limit`, `purge --days`, `budget set --limit` and `task set --hours` now refuse `abc`, `0` and `-1` with a plain sentence naming the flag, rather than sending `LIMIT NaN` to SQLite, writing a budget nobody could count against, or declaring a task that has already expired.
- 6bbbf39: The interceptors on PATH now read the machine's mode the way the hook does, so observe records what a rule would have said about `git push --force` or `rm -rf` and lets it run, rather than refusing at one seam what it only annotated at the other. Advise says on stderr what enforce would have done. The ledger row carries the mode and the shadow verdict, so `why` and `timeline` tell a deny that stopped something from one observe let through.
- a0a9c2a: A bare OK after the voice offers something is taken as a yes, rather than as goodbye.
- d3dfad9: The terminal answers the way every other door does. `memnox approve --session` allows a call for the rest of its session, and `memnox approve --always` says where an always answer is made, since it becomes a team rule. `memnox team login` signs you in as yourself with a code you approve in the browser, so `memnox inbox` lists everything waiting on you, this machine's calls and the questions your team routed to you, and `memnox approve` or `memnox deny` answers either kind, a yes signed by a key that never leaves the machine. `memnox timeline --follow` prints each action as it happens. An instruction for OpenClaw now says plainly that it cannot be handed work yet rather than waiting for a hook OpenClaw never runs. The Noise addon pairing needs now ships prebuilt for macOS and Linux on Intel and ARM, so installing memnox on a server needs no Rust.
- 8fed8fb: A second `memnox daemon` no longer takes the socket from one already running. Started by hand it says so and stops, and started by launchd or systemd it waits and takes over when the other stops, so a machine never runs two egress proxies on two ports.
- 30d83eb: The voice has set lines for the moments that recur, such as a blocked action, a decision waiting on you, a finished task and standing by, and credits a refusal to the runtime rather than to itself.
- 6763839: `memnox-operator` is a new MCP server for the voice's brain: the person's own agent CLI runs it as the only tools it has, and it is never registered into a working agent's session. It reads the machine (`status`, `waiting`, `unattended`, `why`, `replay`, `decisions`) and writes nothing but proposals. `propose_answer` answers a held call from what the person said in whatever words: a deny takes effect at once, and an allow waits for Touch ID and never outlives the call. `propose_rule` writes down a rule the person asked for, named the way the engine rules on it, and nothing is in force until they confirm it.
- 163ca31: A package install is recognised when flags come before the verb, so `pnpm --filter web add left-pad` is gated as an install rather than read as a command named `web`. The recorded target is now the package rather than a flag such as `-D`, and a bare `yarn` or `pnpm` counts as the install it runs.
- c7baa06: A phone or a Mac can now pair with a machine that has no Memnox app, such as a server you reach over SSH. `memnox pair` draws the QR in the terminal and you accept by typing the six digits the device shows; three wrong codes close the pairing, and an agent can never run it. `memnox devices` lists, revokes and grants what each device may do. With a paired device connected, a held call waits for its answer rather than falling straight to the terminal nobody is watching, the daemon tells a device whether it has a voice to lend so the device speaks with its own when it has none, and on Linux `memnox daemon --install` keeps the daemon running after you log out.
- 4db992c: A question nobody answers in time is parked for sixteen hours instead of dropped. The agent is told to carry on with what does not need it, a retry is answered at once rather than asked again, and a yes given later from the phone, the terminal or the workspace lets the retry through. `memnox approvals` shows parked questions and how long they have waited.
- ce600c3: A phone is told when a person away should hear something that is not a question: a session the breaker stopped, one struggling, and a long turn that handed back while nobody answered, with what it came to.
- ea20a9a: A wrapped MCP server killed by a signal is now reported as down and the proxy exits 128 plus the signal number, so a SIGKILL reads as 137 rather than a clean exit. A server command that cannot start is said and exits 127, and a broken pipe to a dying server no longer crashes the proxy, since the next call is refused as server gone.
- 232f5d6: `memnox purge` now also drops the records beside the ledger past the retention window: parked and expired questions, posts, lifted pauses, closed missions, turns, tasks and old grants. Nothing still in force is touched, and `--dry-run` counts them.
- bb7721d: The voice no longer says a paused session has nothing new, never offers to bring a window forward for you to send something yourself, and hears pay this after a bug as fix this.
- ddfacba: A tool result is read for instruction-shaped content wherever that content sits. `textOfResult` looked only at a content block's own `text`, so an injection placed in an embedded resource's `text` or in `structuredContent` was never quoted, never put the session under suspicion, and was recorded as fewer bytes than it carried. Both are now read, along with the text beside them, and the framing is unchanged: the content still survives whole inside the quotation rather than being stripped.
- 5ff2702: A read such as `cd ../other && f=$(grep -rl x src); grep -n y $f` no longer asks as a write outside the project, so a session that only searched another repository is not reported as having worked in it. What an assignment like `f=$(...)` runs is now ruled on too.
- c32f588: A quoted credential is masked whole rather than to its first space. `--password="correct horse battery staple"` came back as `--password="[redacted] horse battery staple"`: the rules that mask a named value consumed the opening quote but stopped the value at whitespace, so everything after the first word stayed in the text that reaches a ledger row, a report or a screenshot. A partly masked value is worse than an unmasked one, because it reads as handled.

  Both rules now run a quoted value to its closing quote on the same line, so a passphrase, a JSON string and `--password "a b c"` mask in full. Apostrophes inside double quotes and vice versa are covered; an unterminated quote falls back to the previous behaviour.

- 843776b: `memnox protect --apply-native` and `--revert-native` no longer crash on a Claude Code or OpenClaw settings file that holds `null`, an array, or a string where a permission list belongs. The file is left exactly as it was, and the refusal names it and says what is wrong with it.
- 5abda70: The daemon refuses a method it does not know rather than answering it with a bare "ok". A newer client, such as the Mac app asking an older daemon for `ask`, read that "ok" as support and waited for an answer that was never coming.
- f6bb56a: A download run as code is now held as hidden code when it is piped into `sudo bash` or a bare `python3`, `node`, `ruby`, `perl`, `fish` or `pwsh`, and when it is substituted in, as in `bash -c "$(curl ...)"` or `bash <(curl ...)`. Process substitutions are read as the commands they run rather than as files.
- 0ec7df2: `memnox report --since` and `memnox next --since` now read `30m`, `2h`, `7d` and an ISO timestamp the way `timeline` does, so `--since 2h` covers two hours rather than two days. A value neither command can read is refused with the same message `timeline` gives, rather than quietly falling back to a default window.
- 21394c4: Risk classification now splits actions on dashes and camelCase, so verb table actions like `gh.repo-delete` and MCP tools like `deleteRepo` are rated high. `rm`, `remove`, `unpublish` and `terminate` now count as destructive, and `view`, `describe` and `show` as reads.
- f875d2e: A held `rm` now reads as a recursive, forced delete however the flags are spelled, so `rm -r -f`, `rm -rfv` and `rm --recursive --force` say the same thing as `rm -rf`.
- 780cf49: Every call in a JSON-RPC batch is ruled on. MCP permits batching, and the proxy cast whatever arrived to a single message: an array has no `method`, so it matched no rule and went straight to the wrapped server. A `tools/call` sent inside a batch ran with no verdict, no ledger row and no result framing, and its reply came back unframed because nothing was waiting for it.

  A batch is now split and each element goes through the same path a lone message does. One denied call does not carry the rest with it: the allowed ones travel on as a batch, the denied ones come back as a batch of refusals, and each call is a row of its own. A batched reply is split the same way, so a result is framed and recorded against the call it answers.

  A denied notification is no longer answered. JSON-RPC says a notification receives no reply, and a refusal was going back with no id on it. The refusal is still recorded; only the reply is gone.

  An item inside a batch that is not a request object is answered with `Invalid Request` rather than read as one. A `null` threw where the proxy had nothing to catch it, which took the session down, and a call nested in an inner array carried no `method`, so it was forwarded with no ruling at all.

- 376a05c: `memnox run` points its agent at a relay of its own rather than the daemon's egress port, so an agent keeps its network when the daemon stops or restarts on another port. Without a daemon its calls go straight through, and a desktop notice says Memnox is not watching until the daemon is back.
- a2ad9a4: Every action the voice takes is witnessed: the window it acted on is captured just before and just after, its words read on your Mac and handed to the voice, so it says what the screen shows rather than what it hoped. Looking at your screen hands on the words, not the picture, says what changed, and forget what was on my screen deletes every capture.
- 0d736d9: A drop-in database client is ruled on like the client it replaces. `mysql -e "DROP DATABASE prod"` was destructive and `mariadb -e` with the same statement was an ordinary shell line, because the statement grammar was keyed on four binary names. `mariadb` and `mycli` now read a statement the way `mysql` does, and `pgcli` the way `psql` does, each keeping its own name in the action so a rule can still name one client.

  `redis-cli` has a table of its own, matched whatever case the command is typed in, since the protocol ignores it. Destructive: `FLUSHALL`, `FLUSHDB`, `DEL`, `UNLINK`. Write: `SET`, `CONFIG SET`, and an interactive session. Read: `GET`, `KEYS`, `SCAN`, `INFO`.

- 9eb85b9: The voice learns of every session as it starts and as it ends, within seconds: a start or a close is shown, and a session whose process went away in the middle of a turn is said out loud with what it was working on.
- 0bcabac: `memnox-shell -- <command>` now quotes each argument before ruling on it, so `rm -rf "my dir"` is ruled and checkpointed as one target and `echo "a; rm x"` stays one command instead of two.
- b8ecc00: Fingerprint checks on shell edits now run where a gitconfig sets `diff.noprefix` or a custom `diff.dstPrefix`, because the diff Memnox reads names its own prefixes instead of inheriting the person's.
- 394f680: The governed shell now passes the words after a `-c` line on to the real shell, so `$0`, `$1` and `"$@"` arrive as they were given, and a `--` after the line no longer switches it into the argv form. Options that take a value, such as `-o pipefail`, keep their value instead of it being run as a script.
- 4e05c30: `memnox team login` is `memnox signin`, and `team logout` is `signout`, since one person signs in and the word team said otherwise. `login` is the machine and `signin` is you, and each one's help and close says so. The Mac app's Account page can now run the daemon's sign in itself, through the `person`, `person-sign-in` and `person-sign-out` daemon requests, so the voice acting in your own tools no longer needs a terminal. A start in a folder Claude Code was never told to trust now says that it is asking about the folder before it starts, from Claude Code's own record, even when the tab cannot be read.
- f117ec2: A command killed by any signal now exits 128 plus the signal number through `memnox-shell` and the interceptors, so SIGKILL reads as 137 and SIGSEGV as 139 rather than as a refusal (77) or a plain failure (1). A command that cannot be started exits 127 when it is missing and 126 when it is not executable, and the interceptor now says why on stderr.
- 7edb332: The voice stops saying what it is about to do and speaks only the outcome, or a question when it needs a yes. It talks like an operator: what needs you comes first, a stopped action is told by what it would have done, a loop or two agents on one file is named with what to do about it, and an agent calling something safe is never taken as a reason to approve it.
- 653511b: A database command is now ruled on by its most dangerous statement, so a WHERE in one statement no longer hides an unbounded DELETE or UPDATE in the next.
- e146987: Ask your iPhone to start a session and it can: the phone shows what will start and where, and the Mac opens the terminal once you approve with Face ID. A phone needs to be allowed to act on your Mac first, and a drive never starts one without that approval.
- 9af703d: Asked only to open a session, the voice starts the agent waiting for its first prompt rather than on a task it made up, names the new session so a follow up reaches it, and finds iTerm when it is called iTerm2.
- b7cb71d: The voice starts a session in any folder in your home, a repository or not, and makes a new folder you name, in Documents unless you say where, to start one in.
- 694f7ee: A plain ask to start an agent starts it at once rather than being read back, a follow up that has not reached its session is offered to be typed in for you, and asking what the voice knows about you before telling it anything gets a plain answer.
- bd66de6: The voice says a session it started is starting only once the agent shows itself running in that repository, and otherwise says it typed the line in and the agent has not come up yet.
- fb0dc89: "Stop", "quiet" or "enough" now silences the voice and keeps it listening for what you say next, usually a correction, rather than ending the conversation. "Stand by", "that is all" or a goodbye still ends it.
- cecf039: Saying "stop it" stops the agent at once by pressing Escape in the terminal it runs in, in iTerm, Terminal or an editor's own terminal, and keeps its tab and conversation, rather than pausing it until its next step.
- 82a8a7a: A session that keeps failing is narrowed rather than stopped. Once three failures stand that the same command has not since got past, it keeps working on this machine but asks before it changes anything outside it or deletes anything, and a person away is told it is struggling. It lifts as soon as the agent gets past them.
- dc963af: A session summary now says what the session actually did. Every turn is kept with its start and end, so `changes` finds files a session changed in its own repository while it worked even when no command named them, places the edit tool's relative paths in that repository, and says for each file how it knows. The summary card lists the changed files with their lines added and removed and shows a few changed lines of the file that changed most. A task is read from the person's own words, past a stray backtick or a pasted log, and a card is never said to be in an app.
- 805f065: One malformed request no longer ends the egress proxy. Both handlers ran with no `catch` and nothing registers an `unhandledRejection`, so a rejection took the process down — and that process can be the daemon. A mangled `Proxy-Authorization` threw `URIError` and an `https://` absolute-form request threw `TypeError: Protocol "https:" not supported`, either of which any local process could send.

  Each is answered now and the server serves the next request. A CONNECT authority is read through `URL`, so `[2001:db8::1]:443` tunnels instead of resolving to host `[2001` on port `NaN`, and an IPv6 host in absolute form has its brackets taken off before it is forwarded. An absolute-form request whose scheme this proxy cannot speak is refused with the reason, and an upstream error after the head has gone out ends the response rather than writing the head twice.

- e1f5ac1: The voice talks like a person rather than reading a report. Its instructions replace Claude Code's own rather than being added to them, ask for one spoken sentence, and show by example the difference between a report and an answer. It runs on the fast model at low effort, set with `MEMNOX_VOICE_MODEL` for a deeper one, starts where no project memory or settings ride along, and never uses the person's name except to get their attention on a held call. The daemon's new `warm` starts the brain as soon as the person starts talking, and a conversation begun under older instructions is started fresh rather than resumed, since its own history teaches the old way.
- 3abaaed: A machine says at enrolment whether it is a server or a workstation, read off the machine or given with `memnox login --class`, so a workspace rule can hold on servers only. Workspace rules now keep their project and who decided them: `memnox why` names a workspace rule as the team's, with who approved it and when, and says when the team has published newer rules since. A workspace rule that asks can no longer be answered by a local `memnox allow`, and naming policy files in `MEMNOX_POLICIES` keeps the workspace's rules rather than setting them aside. An answer from the workspace is now written into the ledger naming who gave it, a shell or MCP question honours the approval route set in `config.toml`, a refusal says who refused, and when a phone, the workspace and a terminal answer the same call at once exactly one answer is taken.
- 28af148: A turn that finished while you were away is told once on the notch and your iPhone, rather than once as it happened and again when the list of what waits came round.
- f77eee9: A request the wrapped server starts is no longer read as a tool result. Client and server number their JSON-RPC ids apart, so `sampling/createMessage`, `roots/list`, `elicitation/create` or `ping` could arrive carrying the id of an open `tools/call`. The proxy retired that call, wrote a ledger row with an empty result, framed the server's own request as though it were output, and then let the real result through unrecorded and unframed. Where the colliding id belonged to an open `tools/list`, the tool manifest was wiped.

  A server message counts as a response only when it carries no method and does carry a result or an error. Anything the server started goes to the client untouched.

- 07729db: A server whose tools both see the screen and press keys gives its agent a `desktop` surface, read off the tool names after a probe, and `memnox explain` says that no seam here holds it rather than counting it as one more server. Claude Code's `auto` mode is reported as `model-reviewed`, since a model answering the permission prompt is neither asking a person nor acting alone, and the scan says so beside the agents that ask nobody. Two risk rules follow: `model-approves` is HIGH, and `desktop-control` is HIGH, or CRITICAL when the agent driving the desktop asks nobody first. `memnox protect --project-hook` writes the Claude Code hook into the repository's own `.claude/settings.local.json`, which a Claude Code started by a harness with project setting sources only still reads, where the user file is skipped.
- 6771935: Asked to type into an app by name, such as Windsurf or Perplexity, the voice finds it among the installed apps and types there, rather than only into Claude, Codex, Cursor and Hermes.
- 7ea12c4: The voice types into, and stops, an agent running in a tmux or WezTerm pane through the multiplexer itself, whatever app shows it, and hands an agent in any other terminal app to the Mac rather than waiting for its next prompt.
- 8672e7b: The voice understands the names on this machine when speech recognition mishears them. The brain is told its words come through speech recognition and given the machine's own names, its agents, the CLIs Memnox watches, its MCP servers and the folders its sessions work in, so "clothes code on right away" is answered as Claude Code on Railway rather than met with a request to spell it. The daemon's new `vocabulary` gives the Mac app the same names to listen for, and the operator's new `reach` says what the agents here can use, including which CLIs are signed in, so "is Claude Code connected to Railway" has an answer.
- edfffcf: `memnox update` checks a release before installing it: every Memnox package must carry provenance from this repository's release workflow at a version tag, and the install is pinned to the version checked. `--skip-verify` installs anyway and is kept on the record in `~/.memnox/updates.jsonl`.
- 8c1a7eb: Reject malformed policy time windows and UTC offsets outside -840 to 840 minutes so invalid time-scoped rules fail validation instead of crashing or silently not matching.
- 70f81f4: The vercel verb table now covers a bare `vercel`, `env pull`, `env ls`, `rm`, `remove`, `promote`, `rollback`, `redeploy`, `alias` and `dns rm`, so none of them resolve to unknown any more.
- dc963af: The voice can tell you when a session finishes, passes or fails its tests, or gets stuck; put back what a session broke after Touch ID, and bring it back again; start a new agent session in a repository you name; hand one agent's work to another for review; and walk you through a change on a card that turns a page per file.
- 5985f66: The voice says a reply once even when it ends the conversation, briefs unasked through the same filtered stream, acts on the likeliest reading rather than asking what you meant, onboards several agents with one Touch ID, and tells which onboardings finished and which are still running.
- 5985f66: The voice reads a long instruction back as its gist rather than word for word, reads back only what changed when you correct it, and sends at once when you already said yes or send it. It explains that an instruction handed to a busy agent arrives at its next step rather than in its message box, and never sends the same words twice.
- 1087a50: While the Mac voice is listening, a held call waits up to fifty seconds for a spoken answer, so a yes confirmed with Touch ID lets the agent carry on rather than leaving it on a picker only a click could close.
- 5985f66: The voice answers sooner. It starts the answer during the pause before the Mac is sure the person finished, says it only when the final words match, and stops any guess that reaches for a tool that acts. A tool call is reported the moment it starts rather than once its arguments are written, and the voice says a few words of what it is doing before it looks something up.
- 5985f66: The voice answers sooner: its brain no longer thinks for hundreds of tokens before each spoken sentence, which was most of the five to fifteen seconds it took, and it waits less after a finished question.
- 5985f66: The voice closes a session in a VS Code, Cursor or Windsurf terminal through the Memnox extension, says plainly what closed and what stayed open, and clears every popup at once without ending any session when you ask to close the cards or windows.
- 2ca7fee: `memnox protect --vscode` installs a small extension into VS Code, Cursor and Windsurf, so asking the voice to go to a session brings forward the exact integrated terminal it runs in, even with several open. It types into one only an instruction the person said yes to, read from Memnox rather than from the link.
- dc963af: Asking the voice what changed after it says a session finished now reads that session. A notice or held call names its session id and the folder it last wrote in, and the brain passes that id to `changes`, `show` and `replay` rather than guessing. A window merely opened no longer stands in for the session that did the work. `changes` reads the repository the session wrote in last, counts the agent's own edits and the files a shell command changed while it ran, never another session's work in the same tree, lists what the latest turn changed, and finds a file by its short name.
- 22cfa8f: `memnox voice` shows the key the Mac app signs its confirmations with, and `memnox voice forget-key` clears it so the app can register its own again. It asks first and defaults to no, because whichever key registers next is the one trusted, and an agent is refused it like every other command that loosens what agents may do.
- 5985f66: The voice greets for the hour on the first words in a while and signs off for it, says "Standing by." when told to hold on without pausing any agent, says what it looked for and offers the next step when something is missing, and never describes a status it did not read.
- 44556b5: The voice tells you when two agents collide: two sessions writing the same files on this Mac, or one of its agents held off a file or an action another agent here or on another machine has, each said once with who and what, and it asks which one to pause. It also answers who said something and what someone has to work on, now that tickets carry their status, priority and assignee.
- 162c06d: The voice never says "I am listening for the rest" over you, never waits for more twice running, and answers in the shapes a composed assistant uses for several requests, a conflict, a review and coming back after a while.
- 5985f66: The voice speaks more like J.A.R.V.I.S.: no contractions or fillers, the status first, one level tone for good news and bad, and "I took the liberty" only for what a tool actually did.
- 162c06d: The voice still tells a held call whose session's process has moved on, keeps every held call in front of the brain so one you talked over is answered rather than dropped, answers "summarise our decisions" with the decisions the workspace holds instead of none, looks in Slack and tickets before saying the workspace has nothing, stays listening after an answer instead of closing on you, and never argues when you correct a fact it gave.
- 5985f66: The voice keeps the thread: every offer still waiting on your yes and the last few things said are carried into each question, so a fresh conversation never asks what you are saying yes to, and a no closes an offer so a later yes can never reach it. It asks one courteous question at the end of a reply, sends an agent everything you asked it to do rather than doing the work itself, and never says a tab is closed when it is not.
- 9098294: The voice answers any question about Memnox itself, from the vision and its numbered sections to every command, the policies, the threat model, the build plan and the changelog, because the project's own documents now ship with the CLI and a new `about` tool searches them by the words of the question. It also says which agents approve their own actions and where each was installed from, names the subagent behind a refusal or a step, locks the hook in with `protect --managed`, and starts a session with `--hold-credentials` when asked to keep tokens away from it.
- c8fd0b2: The voice reads what the workspace lets this Mac read: its name, its Slack and Discord messages and its Linear, Jira and GitHub tickets. Asked to have an agent implement a ticket, it gathers the ticket, what was said about it and the decisions that bind it into a brief the agent reads through the new `work` session tool, told to keep to every decision and to ask when one disagrees with the ticket. Workspace memory is pulled fresh before it is read, and the voice never reads an id aloud.
- 5985f66: The voice puts the session working now first and answers what it is doing from its turn in progress, says when a window did not come forward rather than calling it open, keeps listening after a reply that asks something, and carries what you said while Memnox was unreachable into your next question.
- 6be3864: The voice knows where each session runs, a Terminal or iTerm tab, an editor's own terminal, or an agent's panel inside the editor, with the folder it was opened on, and opening one brings forward that exact place, opening an editor panel session on its own conversation. A session that began before Memnox saw it is placed at its first hook, and an agent inside another app's bundle, such as Codex inside ChatGPT, is placed in the terminal it runs in. The voice no longer says it already did something it did not do this turn.
- 8b44f9e: The voice offers once to learn about you, your work, the projects that matter, your tools and how you want to be spoken to, keeps what you say on this Mac, says out loud what it kept, and answers from it in every conversation.
- 38c9bac: The voice now speaks like a colleague who has been watching the sessions. The brain is told the person's name and to talk the way a person does: short, the answer first, one concrete detail, never guessing. The daemon's new `brief` has it tell what happened rather than what was asked: a held call with what its session has been doing and why it needs the person, a paused session with where it got stuck, and a catch up when the person comes back to the Mac. Text that came from an agent is marked as data in those prompts, never an instruction, and the name is kept to plain letters before it goes anywhere near one.
- 5985f66: The voice calls you by name or title at most once every ten minutes, speaks more slowly with a breath between sentences, types an instruction again when you say type it, counts subagents rather than sessions, and does by voice what it would otherwise send you to do yourself.
- 596c058: The voice opens the Claude, Codex, Cursor and Hermes desktop apps on a repository with the task in them, finds Codex inside ChatGPT.app, starts Hermes in a terminal, and understands more misheard technical words, such as "gate push" for git push. The daemon says its version on ping and `memnox update --yes` updates without asking, so the Mac app installs, starts and updates Memnox by itself. The voice types into the chat open in Claude desktop, the Codex app or Hermes where the person watches it go in, and opens an app with nothing to ask it yet. An agent starts where the person last had it, app or terminal, and a hold on a whole request is asked again at once instead of waiting on the person.
- 5985f66: Asking the voice to open a session takes you to the session itself, with the live window kept for watching it; a summary card lays out what happened in markdown; a login by voice opens its approval page in the browser and is said as started rather than done; and the agent scan names each agent's MCP servers with their tools and the CLIs signed in for its shell.
- dc963af: The voice can pass an instruction to an agent session. `propose_instruction` keeps what the person said and reads it back, since a recognizer mishears, and `send_instruction` sends it only after their yes. A working session picks it up after its next tool call, or as the next thing to do when its turn ends; one waiting in iTerm or Terminal has it typed in, only when the agent is the tab's foreground program; one waiting in VS Code, Cursor or Windsurf opens with it in its input for the person to send. It reaches the agent as the person's own request, and everything the agent then does is ruled as before.
- 5985f66: The voice stays quiet after a conversation until it is called, and speaks unasked only for what needs the person: a held call, an agent's question, a paused session, a failed command or a watch they set. A login or onboarding that worked is shown rather than said, coming back to the Mac is greeted only when something waits, and a notice no longer ends in an offer. The voice can also read the workspace memory this Mac pulled and ask the workspace for a brief.
- 5985f66: The voice knows every memnox command and subcommand from `memnox help --tree`, runs what reads at once and asks Touch ID for every subcommand that writes, keeps its conversation for three hours and its last ten exchanges across a restart, and says plainly what the workspace keeps from this Mac by design.
- 5985f66: The voice reads out a question an agent asks in its own picker and passes the spoken answer back in its place, so the agent carries on without the picker ever opening; unanswered, the picker opens as before. It stays silent when the person pauses mid sentence, keeps a request across two turns, proposes again when a start is corrected, understands more misheard names, and can watch a session it only just started.
- 3911ff3: The voice can say what a session changed and what it reached. A new `outside` operator tool lists the hosts a session fetched from, the MCP servers and tools it called and the pages a browser opened, from the ledger and destinations only. `changes` compares with the last commit when no milestone was taken, kept to the files that session wrote. `sessions` marks the catch-all session as this Mac rather than an agent, and the voice now gives files, lines and services when asked for detail, explains a failed command and its exit code, and stays warm when it mishears.
- dc963af: The voice now reads what a session it started actually answered, because a session under `memnox run` is found by the agent's own transcript id. Asking it to close a session closes its live window and its terminal tab, though never mid turn, where it used to pause the session instead. Asking it to log in, or to onboard an agent, takes one Touch ID and a page in your browser to approve the Mac, with no terminal, and the voice tells you when it is done. It stops waiting the moment it decides you have not finished, rather than after the brain writes on, and it understands more misheard names such as "my nose cloud" for Memnox Cloud.
- dc963af: The voice remembers which session you last asked about, so "it" stays that session, and tells sessions apart by when each started. It finds Codex inside the ChatGPT app when it is not on PATH, names a Cursor session Cursor rather than "an agent", and understands more of how "Claude Code", "Codex", "Cursor" and "git history" get misheard.
- 5985f66: The voice no longer asks the same question twice, narrates its own steps such as an instruction expiring, or repeats what the Mac already said, and "try again" sends the same words again at once.
- 5985f66: A rule asked for by voice is now registered once you confirm it, so every hook enforces it, where before it sat in a project file only `memnox policy test` read. While Memnox is only watching, the voice tells you when one of your rules would have asked about or refused something that went through, and it offers to turn on enforcing behind Touch ID. Registering a rule file by voice now waits for Touch ID too, and a rule for a project folder that is not there is refused before Touch ID rather than failing after it.
- 30e48bd: Any memnox command can be asked for by voice: what reads runs at once, and what changes something waits for Touch ID. `memnox traces` shows an agent's session or Memnox answering a question as a waterfall of what ran, for how long and what failed, and sends it to Logfire or any OpenTelemetry collector with `--otlp`.
- dc963af: The voice waits for the Mac to say an instruction was typed before it says it was sent, names the session it put on screen, and stops taking a session that only said hello for the last one.
- 4060ede: The voice says your title now and then and keeps your name for a greeting, at most once in half an hour, and never right after it answered your call. `memnox voice name` sets the name.
- dc963af: Asking the voice to scan your computer puts every agent on the whole screen with its logo and what it reaches. A session started by voice now opens in the repository you named rather than your home folder, starts only an agent whose command is installed, can start Cursor's terminal agent, and finds the repository even when its name is misheard.
- 8c9ea42: The voice can see what a session did and which session it is. `sessions` lists every agent session on the machine lately, side by side: the agent, the task it was given, the repository, how busy and how quiet it has been, what is waiting on the person and whether it is paused, so two Claude sessions are two rows and the voice asks which one is meant rather than picking the newest. `changes` reads what a session changed in the code against the milestone taken before its first write, file by file with lines added and removed, or the diff of one file, writing git objects only so no ref and no index moves. The operator never reads its own run as the session it was asked about.
- dc963af: An instruction reaches the agent in the person's own words, read back once, and to the session as it is now. The brain passes on exactly what was asked, fixing only misheard names, and calls its tool before it speaks so nothing is said twice. Typing into a terminal and bringing a session forward use the terminal its process holds now, and a session whose process has ended is never typed into.
- 160b382: The voice answers small talk without looking anything up, says where a fact it might be acted on came from, gives every number with what it counts from, keeps detail on screen rather than reading it out, and says what it learned when you correct a word.
- 5985f66: The voice speaks in the manner of J.A.R.V.I.S.: formal, precise and composed, with a light British turn of phrase, a calm recommendation whenever something is wrong, and a dry line only now and then. `memnox voice address` sets how it addresses you, such as "sir" or your name, and with nothing set it uses no form of address rather than guessing one.
- 596c058: The voice starts Claude Code, or any agent, in a new terminal inside VS Code, Cursor or Windsurf when the person names the editor, through the Memnox extension, and remembers that place for the next start. A turn always ends, so a request the brain held on twice is answered out loud rather than leaving the orb silent. A send the Mac cannot type is said once with its real reason, is not tried again the same way, and is offered as a new session where the person works. The voice keeps to the place the person named, reads "poem" as prompt and "tent file" as the changed files, and hears "so you cannot open VS Code" as a request. A session recorded under both its hosted id and the agent's own conversation id is one session, so its edits show beside its network, and the files it changed are listed from every repository it wrote in. Each snapshot of the working tree uses a scratch index of its own, since a lock left on the shared one made every later comparison in that repository come back empty.
- c8fd0b2: Asking the voice to start an agent on a ticket now hands the agent its whole brief before its first turn through `memnox run --brief`, gathers what names the ticket by its key, its link or in documents as well as by its words, and works in the ticket's repository or the one the last session used when none is named.
- 5985f66: The daemon restarts itself when memnox is rebuilt or updated, so the voice never confirms against older code. Logging in by voice names the Mac by its own name, a command the voice could not run is said to have failed rather than to be waiting, and the voice stays quiet when what it heard was not meant for it.
- dc963af: The voice answers without cold starts. Talking over an answer now interrupts the brain's turn instead of ending its process, so the next question meets it warm; the brain starts when the Mac app connects rather than at the first question, and stays up through half an hour of quiet. The brain also matches a session described by its work or project against the sessions it was handed, instead of asking which.
- 14acc2b: The voice signs off with one line, stops grading what you said and offering to look again, never claims a retry it did not make, and hears kids status and guest status as git status.
- 677ad4e: The voice thinks with whichever agent you already use and that actually answers: Claude Code, Codex, Cursor, Hermes or OpenClaw. The first time the Mac app listens, every installed agent is asked one question and one that answered is kept, and the app's settings show which ones work, why the others do not, and let you pick another.
- dc963af: The voice answers sooner and opens the session asked for. Each question reaches the brain with the sessions on the machine right now, and a new `session` tool gives one session's state, conversation, steps and files in one call, so "open my last session" no longer waits on a chain of lookups. A `sessions-list` request feeds the Mac app's 3D switcher, and `show` takes `focus` to bring a session's own terminal tab or editor conversation forward.
- 596c058: The voice types an instruction into a Claude Code session in an editor's agent panel and sends it, even when the editor was started from a shell and the panel inherited that shell's terminal.
- 5985f66: The voice can type an instruction into an editor session it did not start, such as Claude Code in VS Code, since that session's own id is its conversation id; before, it left the words on the clipboard.
- 2ca7fee: The voice types a confirmed instruction into an agent in a VS Code, Cursor or Windsurf terminal a key at a time and sends it, through the Memnox extension, and never says a sentence twice or reads out a system reminder.
- dc963af: The voice waits for a person to finish. A new `keep_listening` operator tool lets the brain stay silent when somebody stops mid thought, rather than answering half a sentence. `changes` gives every file a kind and lists the interface files, so a question about the UI is answered from the screens that changed. The voice no longer reads tool labels aloud, checks the record before saying there are no issues, never answers a complaint defensively, and picks up where it left off when told it went quiet.
- 94e88ba: Putting the Memnox extension into VS Code, Cursor or Windsurf clears a copy the editor had marked removed first, and only says it is installed once the editor lists it, so the voice never reports an extension the editor will not load.
- 6c797fb: The VS Code extension carries a version of its own for every build, so putting it in again after an update no longer leaves the editor treating it as removed.
- 3fd9343: Asked what happened in a session, the voice reads it whole, however long ago: when it started, how it ended, and every turn with what was asked, what the agent answered, the files it wrote, its commits and pushes, and what was refused or put to the person.
- 558b2a3: A wildcard in a rule pattern now spans a line break, the same way it already spanned `.` and `/`. `*` compiled to a regular expression whose `.` stopped at a newline, so a pattern matched a single-line value and not the multi-line one the rule author meant it to cover. Arguments are matched exactly as the agent sent them, deliberately, so a value that arrives carrying a line break reaches the matcher with it intact.
- Updated dependencies [12b056a]
- Updated dependencies [66ac35a]
- Updated dependencies [559ff78]
- Updated dependencies [af96f45]
- Updated dependencies [c21e7b6]
- Updated dependencies [a7aa583]
- Updated dependencies [d3dfad9]
- Updated dependencies [397c68a]
- Updated dependencies [9cfa5d2]
- Updated dependencies [29c4b55]
- Updated dependencies [dc22c3e]
- Updated dependencies [c8fd0b2]
- Updated dependencies [698eeaf]
- Updated dependencies [cce3e4b]
- Updated dependencies [d9cb171]
- Updated dependencies [a7501ce]
- Updated dependencies [ef431cb]
- Updated dependencies [82c2667]
- Updated dependencies [0037d4a]
- Updated dependencies [5d259cf]
- Updated dependencies [3577504]
- Updated dependencies [bb540ad]
- Updated dependencies [3525cc5]
- Updated dependencies [b5e4ad0]
- Updated dependencies [9389d60]
- Updated dependencies [831b86c]
- Updated dependencies [376a05c]
- Updated dependencies [826250d]
- Updated dependencies [06593e2]
- Updated dependencies [539521b]
- Updated dependencies [c7932f4]
- Updated dependencies [44df5d6]
- Updated dependencies [1bde963]
- Updated dependencies [d84d991]
- Updated dependencies [7676585]
- Updated dependencies [37c2318]
- Updated dependencies [c2fc346]
- Updated dependencies [be99ac9]
- Updated dependencies [ad69765]
- Updated dependencies [1d19498]
- Updated dependencies [d84d991]
- Updated dependencies [9059b09]
- Updated dependencies [5f19368]
- Updated dependencies [de574df]
- Updated dependencies [596c058]
- Updated dependencies [f1eecb2]
- Updated dependencies [15a5436]
- Updated dependencies [d5f7cad]
- Updated dependencies [083a43d]
- Updated dependencies [67ebfa7]
- Updated dependencies [59ab0be]
- Updated dependencies [6ce7a00]
- Updated dependencies [2033ead]
- Updated dependencies [9b35113]
- Updated dependencies [559ff78]
- Updated dependencies [3eb0e20]
- Updated dependencies [af30a19]
- Updated dependencies [3a548d2]
- Updated dependencies [ca6b0ea]
- Updated dependencies [fe39d75]
- Updated dependencies [dc963af]
- Updated dependencies [dc963af]
- Updated dependencies [d277e9c]
- Updated dependencies [8009857]
- Updated dependencies [7e17bf5]
- Updated dependencies [373f283]
- Updated dependencies [85a36b4]
- Updated dependencies [ece8053]
- Updated dependencies [3f63367]
- Updated dependencies [881b60b]
- Updated dependencies [17e0a33]
- Updated dependencies [4ed9ef8]
- Updated dependencies [8995046]
- Updated dependencies [111655e]
- Updated dependencies [6bbbf39]
- Updated dependencies [a0a9c2a]
- Updated dependencies [d3dfad9]
- Updated dependencies [8fed8fb]
- Updated dependencies [30d83eb]
- Updated dependencies [6763839]
- Updated dependencies [163ca31]
- Updated dependencies [c7baa06]
- Updated dependencies [4db992c]
- Updated dependencies [ce600c3]
- Updated dependencies [ea20a9a]
- Updated dependencies [232f5d6]
- Updated dependencies [bb7721d]
- Updated dependencies [ddfacba]
- Updated dependencies [5ff2702]
- Updated dependencies [c32f588]
- Updated dependencies [843776b]
- Updated dependencies [5abda70]
- Updated dependencies [f6bb56a]
- Updated dependencies [0ec7df2]
- Updated dependencies [21394c4]
- Updated dependencies [f875d2e]
- Updated dependencies [780cf49]
- Updated dependencies [376a05c]
- Updated dependencies [a2ad9a4]
- Updated dependencies [0d736d9]
- Updated dependencies [9eb85b9]
- Updated dependencies [0bcabac]
- Updated dependencies [b8ecc00]
- Updated dependencies [394f680]
- Updated dependencies [4e05c30]
- Updated dependencies [f117ec2]
- Updated dependencies [7edb332]
- Updated dependencies [653511b]
- Updated dependencies [e146987]
- Updated dependencies [9af703d]
- Updated dependencies [b7cb71d]
- Updated dependencies [694f7ee]
- Updated dependencies [bd66de6]
- Updated dependencies [fb0dc89]
- Updated dependencies [cecf039]
- Updated dependencies [82a8a7a]
- Updated dependencies [dc963af]
- Updated dependencies [805f065]
- Updated dependencies [e1f5ac1]
- Updated dependencies [3abaaed]
- Updated dependencies [28af148]
- Updated dependencies [f77eee9]
- Updated dependencies [07729db]
- Updated dependencies [6771935]
- Updated dependencies [7ea12c4]
- Updated dependencies [8672e7b]
- Updated dependencies [edfffcf]
- Updated dependencies [8c1a7eb]
- Updated dependencies [70f81f4]
- Updated dependencies [dc963af]
- Updated dependencies [5985f66]
- Updated dependencies [5985f66]
- Updated dependencies [1087a50]
- Updated dependencies [5985f66]
- Updated dependencies [5985f66]
- Updated dependencies [5985f66]
- Updated dependencies [2ca7fee]
- Updated dependencies [dc963af]
- Updated dependencies [22cfa8f]
- Updated dependencies [5985f66]
- Updated dependencies [44556b5]
- Updated dependencies [162c06d]
- Updated dependencies [5985f66]
- Updated dependencies [162c06d]
- Updated dependencies [5985f66]
- Updated dependencies [9098294]
- Updated dependencies [c8fd0b2]
- Updated dependencies [5985f66]
- Updated dependencies [6be3864]
- Updated dependencies [8b44f9e]
- Updated dependencies [38c9bac]
- Updated dependencies [5985f66]
- Updated dependencies [596c058]
- Updated dependencies [5985f66]
- Updated dependencies [dc963af]
- Updated dependencies [5985f66]
- Updated dependencies [5985f66]
- Updated dependencies [5985f66]
- Updated dependencies [3911ff3]
- Updated dependencies [dc963af]
- Updated dependencies [dc963af]
- Updated dependencies [5985f66]
- Updated dependencies [5985f66]
- Updated dependencies [9444d66]
- Updated dependencies [30e48bd]
- Updated dependencies [dc963af]
- Updated dependencies [4060ede]
- Updated dependencies [dc963af]
- Updated dependencies [8c9ea42]
- Updated dependencies [dc963af]
- Updated dependencies [160b382]
- Updated dependencies [5985f66]
- Updated dependencies [596c058]
- Updated dependencies [c8fd0b2]
- Updated dependencies [5985f66]
- Updated dependencies [dc963af]
- Updated dependencies [14acc2b]
- Updated dependencies [677ad4e]
- Updated dependencies [dc963af]
- Updated dependencies [596c058]
- Updated dependencies [5985f66]
- Updated dependencies [2ca7fee]
- Updated dependencies [dc963af]
- Updated dependencies [94e88ba]
- Updated dependencies [6c797fb]
- Updated dependencies [3fd9343]
- Updated dependencies [558b2a3]
  - @memnox/core@0.13.15

## 0.13.14

### Patch Changes

- 402deda: The code fingerprint now holds in every agent Memnox hooks, not only Claude Code. A shell command's lines are read after it runs in Codex, Gemini CLI, Cursor and Windsurf too, paired with its return by session where the agent sends no call id, and Windsurf, which reads nothing back after a tool, has its next call refused with the report. The first write held until a fingerprint exists is refused in each agent's own words. Cursor is now told the session's context at its `sessionStart`, Windsurf hears the fingerprint when `memnox-session` connects, and `memnox setup` writes a `/fingerprint` command for each agent (`/prompts:fingerprint` in Codex), never over one a person wrote.
- 3963ae4: A code fingerprint check now holds however an agent writes, rather than only when it uses its edit tool. A shell line that shows its text (a heredoc or here-string into `cat` or `tee`, or `echo` and `printf` into a file) is refused before it runs, with the same message an edit gets. A command that shows nothing beforehand, such as `perl -pi` or a script, is read after it runs: the repository's tree is kept before it through an index of its own and compared after, and a forbidden line it added is told to the agent to put right in the same turn.
- Updated dependencies [402deda]
- Updated dependencies [3963ae4]
  - @memnox/core@0.13.14

## 0.13.13

### Patch Changes

- 77f2d6d: Claude Code now has a `/fingerprint` command that records a repository's code fingerprint, because a hook can tell a person the fingerprint is missing but cannot put a prompt in their input. It is written with the session tools and taken out with them, and a `fingerprint.md` a person wrote is never replaced or removed. A session in a repository with no fingerprint now says to type it.
- 051a41f: The agent recording a code fingerprint is now asked for one a newcomer could work from alone: every kind of file read and each convention counted before it is stated, a fixed set of sections from the stack and layout to a recipe for adding a feature and the commands to build and test, and eight to fifteen checks spent on the repository's own boundaries rather than on libraries nothing there would use. Guidance may run to sixty lines, and what is past that is said rather than cut in silence; every enforced check is always told, however long the guidance before it.
- Updated dependencies [77f2d6d]
- Updated dependencies [051a41f]
  - @memnox/core@0.13.13

## 0.13.12

### Patch Changes

- 0c02f8f: A repository with no code fingerprint now gets one. The first write of a session there is held once, with the agent sent to record the fingerprint and then make the change again, because an ask at session start alone was skipped by any agent busy with its task. Once a session, so a recording that fails never stops the work. The person sees it too: a session starts with a line saying the repository has no fingerprint yet and what to ask for, or how many of its checks are enforced.
- Updated dependencies [0c02f8f]
  - @memnox/core@0.13.12

## 0.13.11

### Patch Changes

- fc003ae: The code fingerprint now describes the code that is actually there. It is tested against untracked code as well as committed code, so a repository nobody has committed to yet is read rather than taken as empty, and vendored directories are skipped even where no `.gitignore` names them. A check whose files name nothing the repository has is dropped with the reason, a repository with no code of its own records nothing, and a proposal too large to read in full says how much went unread. The agent now receives the whole of what to write, which was cut short before it reached the `enforce` list.
- 9216d9c: A shell line is no longer taken for one that writes everywhere it names because of a dollar it cannot expand. A `$` inside single quotes is text, so an awk program counting files reads as the read it is; a variable the line itself set to a plain path is read as that path; and awk is judged by its program, so only one with a redirect, a pipe, `system` or `getline` counts as writing. A variable that could hold anything else stays unknown and is ruled on as before.
- Updated dependencies [fc003ae]
- Updated dependencies [9216d9c]
  - @memnox/core@0.13.11

## 0.13.10

### Patch Changes

- 3a5201f: "Allow once" now lets the call through. A write outside the project is ruled on twice, by the rules and by the project boundary, and the first took the answer off the question, so the boundary found nothing and refused the retry, telling the agent a yes in the conversation could not allow it. A once answer now leaves a single use the boundary spends on that retry, good until the question would have expired, and the next write asks again.
- 572a008: The project boundary now holds for shell commands as well as the file tools. A line that changes something is ruled as a write to every place it reaches: where it `cd`s or `pushd`es, the directory a `git -C` names, and, when it runs code Memnox cannot read, such as `python3 - <<EOF` or `node -e`, every absolute path written in it. Editing another repository by `cd`ing there first or through an interpreter used to go through without anybody being asked; now it asks as a write there would. Working inside the project and reading anywhere stay unasked.
- 7a88a5c: The first agent in a repository now records how its code is written, as a code fingerprint every agent after it is held to and told about at the start of each session. Only a first fingerprint is taken without a person, so it can only tighten, and it is read from what git tracks, never from ignored, built, vendored or oversized files.
- 7a88a5c: A rule can now carry a content convention, and a write that adds a line matching it is refused, such as a `console.log` left in source. The lines are read where the call is made and never recorded, since a ledger row carries names and never contents, and a write whose lines cannot be read is not matched.
- e349d75: A yes for the rest of the session to writing a file now covers the whole git repository that file is in, so an agent working across a project is not asked again folder by folder. A write anywhere outside that repository still asks, and a file in no repository, or in one that is the whole home directory, keeps the yes to its own folder, so one answer never reaches `~/.zshrc`, `~/.ssh` or another project.
- 7a88a5c: The hooks now read the results of every agent's MCP calls for instructions, and claim its outward calls the way the proxy does, so two agents about to send the same message or work the same issue meet even through MCP servers the proxy cannot sit in front of.
- 7a88a5c: A repository's own MCP servers, from its `.mcp.json`, now go through the Memnox proxy too, without the team's committed file ever being rewritten: each server a person approved in Claude Code is placed behind the proxy in Claude Code's local scope, which only this machine reads.
- 7a88a5c: `memnox setup` now runs from any directory and picks up each repository in its first session. The baseline rules live in the machine's own file, merged rather than written over, so a second run never undoes somebody's edits, and the copies earlier setups left in whatever directory they ran in, which applied to the whole machine, are no longer read unless somebody changed them.
- 7a88a5c: Every write the ledger records now names, by id, the settled decisions it bears on, found the way a brief finds them for the paths it touches. The control plane can then ask whoever answers for a decision to look at a change that touches it, and a common word no longer lists every decision there is.
- Updated dependencies [3a5201f]
- Updated dependencies [572a008]
- Updated dependencies [7a88a5c]
- Updated dependencies [7a88a5c]
- Updated dependencies [e349d75]
- Updated dependencies [7a88a5c]
- Updated dependencies [7a88a5c]
- Updated dependencies [7a88a5c]
- Updated dependencies [7a88a5c]
  - @memnox/core@0.13.10

## 0.13.9

### Patch Changes

- d0290f5: A yes for the rest of the session to running a command now covers commands the same program runs and nothing else. It used to cover every command, so one yes to `pnpm test` let `curl ... | sh` or any other command through without asking. The question and the answer both say which program the yes covers, and any other command is asked again.
- 7269367: With "Also ask me in my DM" on, a held question no longer opens Claude Code's picker. Nothing outside can close a picker, so a question answered in Slack or Discord left it on screen asking for nothing. The agent now says it is waiting and ends its turn, and the answer from the DM, or a 1, 2 or 3 typed in the session, carries it on. A picker opened for a question that is already answered is refused with that answer, and a pick that arrives after another answer is not used, with both the person and the agent told which answer stands.
- 134835f: Memnox now fails closed when its own settings cannot be trusted. A `config.toml` that exists but cannot be read, or that was emptied so it no longer names a mode, is read as enforce rather than as a first run that only watches, since one `chmod` or truncation used to switch enforcement off. And in enforce, a hook that fails before it could rule on a tool call now refuses that call instead of letting it through.
- 352f377: A yes for the rest of the session to reading or writing a file now covers that file's folder and nothing else. It used to cover the action everywhere, so one yes about a file in the project let the agent write `~/.zshrc`, a login item or any other file outside it for the rest of the session without asking, and the project boundary honoured the same grant. The question and the answer both say which folder the yes covers, and a write anywhere else is asked again.
- 3f73639: An agent can no longer reach what governs it by a path that does not look like one. A write is checked where it really lands, so a symlink into `~/.memnox` is `~/.memnox`. Claude Code's settings files, which install Memnox's hooks and could switch them off, and the `memnox` binaries a hook runs, are now protected like Memnox's own rules. A command line that names any of these and also writes, runs an interpreter such as `python -c` or `node -e`, or hides part of itself is refused, which catches `cd ~/.memnox && tee`, `ln -s ~/.memnox`, `chmod` and `sqlite3` on the ledger; reading them stays allowed.
- 47bf456: Installing the Claude Code hook now also turns on Claude Code's own sandbox for the agent's shell, so a command it runs cannot write `~/.memnox`, Claude's settings files or `~/.claude.json`, however the path is spelled, since the sandbox holds at the system call rather than reading the command line. Unsandboxed retries are turned off, and writes and the network stay as open as they were, so ordinary work goes on. A sandbox the person already set is kept and only the wall is added, removing Memnox puts their own back, and on a Claude Code too old to allow every host the wall is skipped and the install says so rather than cutting the network off.
- ba9a222: Credentials are masked in everything that leaves the machine. A command line is the target when nothing narrower was parsed, so `vercel deploy --token=...`, a password in a `DATABASE_URL`, a `Bearer` header or a key set in the environment used to reach the control plane, the held question in a DM and the ledger rows the cloud keeps. Named secrets, secrets in a URL, auth headers and the usual key shapes (GitHub, OpenAI and Anthropic, Slack, AWS, npm, JWTs) are now masked in the question's wording, the heartbeat and every action synced, while the local ledger keeps the target whole so `memnox why` can still show it.
- 126d869: Memnox trusts an MCP server's word only where it has earned it. Memnox's own tool names are recognised only on Memnox's own server, so a lookalike `memnox_memory` elsewhere is classified on its own rather than read as harmless. A server named `memnox` in a project's `.mcp.json`, which anybody with the repository can write, no longer has its tools skip the rules. And a server's read-only annotation can no longer make a tool whose name says it deletes or writes read as harmless: it may call a tool worse than its name, never better.
- f2c8c37: A person acting is now sent to the control plane as `person`, the word it accepts. The machine's ledger says `human`, and one such row, a person stopping protection, clearing a taint or answering a held question, had the control plane refuse the whole batch it was in, so none of those actions, and nothing sent beside them, reached the workspace.
- 6115e27: A held question's picker now counts only when it is worded exactly as Memnox wrote it: the question for one held call, word for word, and exactly its three options. The agent types the picker, so it could put a harmless question over a dangerous call's id, hide another call's id in an option, or relabel an option so that "Allow once" read as a yes for the whole session. Any of those is now refused before the picker opens, a pick is read by its exact label rather than as free text, and a reply typed in place of a pick answers nothing.
- 249479d: A command no longer slips past the rules by sitting behind something that only runs it. What `$(...)` and backticks run is ruled on like any other command, and `env`, `sudo`, `nohup`, `nice`, `timeout`, `xargs`, `find -exec` and `find -delete`, `bash -lc` and a `git -c alias.x='!...'` are all seen through to the command they run, so `echo $(rm -rf ~/work)` or `ls | xargs rm` is the delete it is. A download piped straight into a shell, or a payload decoded and run where the decoding could not be read, is now put to a person whatever the rules allow, because what it runs is only known once it has run.
- Updated dependencies [d0290f5]
- Updated dependencies [7269367]
- Updated dependencies [134835f]
- Updated dependencies [352f377]
- Updated dependencies [3f73639]
- Updated dependencies [47bf456]
- Updated dependencies [ba9a222]
- Updated dependencies [126d869]
- Updated dependencies [f2c8c37]
- Updated dependencies [6115e27]
- Updated dependencies [249479d]
  - @memnox/core@0.13.9

## 0.13.8

### Patch Changes

- d361982: `memnox_claim_action` and `memnox_finish_action` on the workspace's `memnox` server are known as Memnox's own tools that record something, so an agent claiming an outward action before it takes it is never held for approval as an unknown tool.
- abd9106: The hooks and the edit watcher now name a repository by its remote when they take a lease in the workspace, so the same project cloned on two machines is one repository there. A `git push` is claimed by the branch it writes, filed the way a GitHub tool call that pushes to that branch is, so two agents pushing one branch from two machines meet before either lands.
- e4b726c: A lease now holds the code a session is editing rather than the whole file: the lines it changes and the function, method or class they sit in, named like `PaymentService.retryCharge`. Two sessions in one file meet only when they touch the same code, names win over line numbers where both sides give them, and a second part of the same file grows the session's lease rather than adding one. Each lease also says which checkout it is in, so one machine's register keeps its repositories apart, and a repository is named by its remote, so two clones of one project meet and two projects that share a folder name do not.
- Updated dependencies [d361982]
- Updated dependencies [abd9106]
- Updated dependencies [e4b726c]
  - @memnox/core@0.13.8

## 0.13.7

### Patch Changes

- 8e8fd11: In Claude Code a held question is now asked in Claude Code's own picker, the same one the agent uses for its questions: Allow once, Allow for this session, or Deny, chosen with the arrow keys, and the pick is recorded as the person's answer at once. The agent can send that picker with its own answer already filled in and Claude Code passes it through unseen, so Memnox refuses a picker that arrives answered and takes an answer only from one it saw open empty. Every other agent still shows the numbered choices, and typing 1, 2 or 3 still works everywhere.
- c9da610: A held question is now put to the person in plain words, and the session shows it to them directly rather than leaving the agent to relay it: which agent wants to do what ("Claude Code wants to delete finish-cloud.patch."), what it was working on, why they are being asked, and three numbered choices they can answer with 1, 2 or 3. A target that is only a shell variable, like `$S`, says so instead of reading like a file name. The agent is told the same choices and, once somebody answers, what it may now do. The heartbeat carries the same wording to the control plane, so a DM can ask in the same words.
- b7c2b21: A yes for the rest of the session now counts the moment it is given, wherever it was given: typed in the session, run as `memnox approve`, or pressed in a Slack or Discord DM. It used to count only if the agent retried the same call before the question expired, so an answer from a phone was usually lost and the same question came back. The project boundary check reads the same grant, so one yes is never asked for twice, and when a question is held for a person that question is what the session shows, rather than a refusal telling the agent that a yes could not help. A yes for the session on a delete covers that one file, and an answer about one file is never spent on another.
- Updated dependencies [8e8fd11]
- Updated dependencies [c9da610]
- Updated dependencies [b7c2b21]
  - @memnox/core@0.13.7

## 0.13.6

### Patch Changes

- 1ed367e: Every tool on the workspace's `memnox` server whose name starts with `memnox_` is now Memnox's own, so a tool the control plane adds is never held as unknown until the next release. The new ones, `memnox_people`, `memnox_workspace` and `memnox_sources`, are known as reads, which is what lets somebody ask an agent session who is in the workspace, what it runs, and what people said or filed there. The same names on any other server are still ruled on like every other tool.
- Updated dependencies [1ed367e]
  - @memnox/core@0.13.6

## 0.13.5

### Patch Changes

- 337bff0: Memnox no longer holds its own tools for approval. A rule asking about unknown MCP tools held `memnox_memory` and `memnox_context`, which are the reads Memnox tells an agent to make before it changes anything, because a hook sees a tool's name and never its listing. Memnox's own tools are now known by what they do, and the hook rules on any other server's tools by what the last scan heard that server declare. The workspace's bookkeeping on the `memnox` server, which is asking for approval, taking and releasing a path and reporting an action, is not ruled on at all, since holding a request for approval asks one person twice. The same names on any other server are ruled on like every other tool, and `memnox policy test` now answers for a session tool as the hook would.
- Updated dependencies [337bff0]
  - @memnox/core@0.13.5

## 0.13.4

### Patch Changes

- @memnox/core@0.13.4

## 0.13.3

### Patch Changes

- A refusal names a real way forward under the rules `memnox protect --yes` writes. A force push was told `Instead: git.push-force: Ask somebody`, pointing back at itself, because the PATH wrapper and `memnox policy test` kept the generated rule's note where `memnox-shell` already used the verb table's. Both now say `push a branch and open a PR`.
- Updated dependencies
  - @memnox/core@0.13.3

## 0.13.2

### Patch Changes

- The question `memnox run` asks on the terminal is one card answered with the arrows and enter, or one number, with the command as typed, the reason said once, a live countdown, and the id to answer from anywhere. Escape and ctrl-c are a no, the command can be edited in place, and one line stays in the scrollback saying what was decided. The terminal is opened as a terminal, which is what makes a single key work.
- 278df61: An agent another agent started is held to that agent's rules as well as its own, so a child never does what its parent may not. Codex launched from Claude Code's shell, or an agent started under a nested `memnox run`, is ruled as itself and as every agent above it, the strictest answer winning, and a refusal that came from a parent names it. The chain is read from what the parent hands down, its own marker and the `MEMNOX_PARENT_AGENTS` that `memnox run` writes. A sub-agent Claude Code runs inside its own session was already ruled as Claude Code.
- 10e0423: A repository an agent clones starts on probation, because it is a stranger's code. From the `git clone` on, work inside it is contained as `memnox run --untrusted` contains a session: outward and destructive actions ask, and writes outside it ask, without anybody having to remember the flag. `memnox repo list` shows what is on probation and `memnox repo trust <path>` ends it once somebody has looked. It ends by itself after seven days, as an agent's or a server's does.
- 757e71d: A wrapped MCP server that dies under a working agent is said on the proxy's stderr and kept as a `config.drift.server-down` row with its exit code. One that ends cleanly, or that the agent itself stopped, is not news. `memnox doctor --servers` lists the servers that stopped in the last day above the ones it starts and asks.
- 2c8590c: A session only the hooks see can have a task. `memnox task set "<what the agent is here to do>" --paths src/payments` declares one for the repository you are in, for twelve hours unless `--hours` says otherwise, and any session working there without a task of its own takes it: actions outside the paths count as drift toward the circuit breaker, and a rule matching `scope = out_of_scope` fires. `memnox task show` and `memnox task clear` read and end it. Only `memnox run --task` could declare one before, and a hooked session's id is not something anybody knows.
- b54d3df: Typing `claude`, `codex` or `gemini` now starts it under `memnox run`, so the egress proxy, the kernel wall and the session's records come with it and nobody has to remember the command. Setup puts a small launcher for each agent CLI this machine has in the same directory as the interceptors. Inside a session it runs the real binary, so a run never starts itself again; `--version`, `--help`, `mcp`, `config`, `update`, `doctor`, `login` and `logout` go straight through; and `MEMNOX_LAUNCH=off` turns it off for one command. `memnox uninstall` removes them with the rest.
- ec909de: `memnox allow "railway.*" --env staging --for 30m --reason "reproducing the retry bug"` allows a scope for a while, so an agent working inside it is not asked at every step: one approval rather than thirty. It is narrowed by action, environment, target and agent, it only ever answers a question a rule would have asked and never overrules a refusal, it ends on its own and at most eight hours out, and every decision it makes says who allowed it and until when. `memnox allow --list` shows what is in force and `memnox allow --revoke <id>` ends one now.
- b1f1458: The daemon now says when an agent's authority grew between two of its passes: an agent that can now change a system with nobody asked, where before it could only read it; a CLI newly logged in on the machine, which any agent with a shell can then use; and a CLI whose credential now names something like production, such as a kubectl context called `prod-eu-1`. Each is a notice and a `config.drift.authority` row, the first pass only records what there is, and authority that narrowed is not news.
- 710da87: A shell command that writes several files takes a lease on each of them, so `touch a b`, `sed -i` across two directories or a redirect alongside them is withheld when another agent holds any of the paths, not only the first. Two leases one process took in the same millisecond shared an id and the second overwrote the first on disk; the id now carries the path.
- 19758d2: The MCP proxy classifies a call by what the server said about its tool when it listed it, so a `readOnlyHint` or a `destructiveHint` decides over a name that says something else, and a rule about changes reads the server's own word. Before the first listing it goes by the name, as it did.

  The first time an agent reaches a host through the egress proxy is a `network.first-destination` row, so a timeline shows when it began, and `memnox explain <agent>` lists the hosts it has reached with how often and since when.

- 60433f8: A session only the hooks see now trips the circuit breaker's scope drift. An allowed action outside the task declared for it, by `memnox task set` or `memnox run --task`, is reported to the daemon as drift and nothing else, so the breaker counts it toward its threshold without the action being charged to a budget or counted as work done.
- 9ae6524: Printing a key is ruled on as reading it. `env`, `printenv`, `export -p` and `set` print every variable, and `printenv NAME` or `echo $NAME` prints one, so each is an `environment.read` naming the variable, or `all`. Only a name that looks like a credential counts, and a key handed to `curl` is left to the egress check, since it is used there rather than shown. The generated rule about credential files covers these too.

  `gh api -X PUT repos/<owner>/<repo>/pulls/<n>/merge` is `gh.pr-merge`, so a rule about merging is not stepped around through the REST API.

- e6b7881: On Linux, the Landlock wall of `memnox run --untrusted` now leaves the repository's own `.env` files out of what it grants, to read and to write, since a Landlock write grant reads as well. They are found by name up to three directories down, never inside `node_modules`, `.git` or build output, and `.env.example`, `.env.sample` and `.env.template` stay granted.
- Cursor and Windsurf learn to ask what the workspace settled before they edit. Their hooks cannot add anything to a session, so `memnox-session` says it in the instructions every host reads when it connects.
- 847c05b: `memnox mode investigate` lets every agent on this machine read anything, files, repositories, logs, databases, APIs and MCP tools, and refuses every change outside the machine, pushes, and writes outside the workspace, with a way forward that says to report what it found. `memnox mode autonomous` lets the work through, edits, tests, commits, pushes and pull requests, and stops at moving money, deploying, handing out authority, deleting outside the machine and any change in an environment named like production. `memnox mode off` goes back to your own rules. A mode is a set of ordinary rules in `~/.memnox/mode.policies.toml`, so `why` and `policy test` explain it like any other.

  A task can be declared as an investigation, with `memnox task set "..." --intent investigate` or `memnox run --investigate`, and a change outside the machine is then refused with the ask quoted back. The summary at the end of a session now says how many changes landed outside the machine and how many a person approved.

- 25efef3: "Allow for this session" now holds for the rest of the session. The grant was kept in the memory of the process that heard the answer, and every hook and shell wrapper is its own process, so the next call was asked again. Grants are kept on disk under `~/.memnox/grants`, and cover the action the question named, so `gh.pr-view` allowed once for the session covers the next pull request viewed as well. A web request's grant covers that host and an MCP call's covers that server's tool. A delete is only ever granted for the exact call.

  The second yes to the same action in one session is the last one asked for, whether it was given in the terminal, from the workspace, or in the agent's own permission prompt, where the tool running is read as the yes. A delete is never learned this way, and a new session starts over.

- c432e3f: A shell line is split only where the shell splits it, so `psql -c "SELECT 1; DROP TABLE t"` is one statement that drops a table rather than a read followed by an unknown command. Every `-c` is read, and so is a heredoc or a here-string, a `DROP` of any object, `COPY ... FROM`, `SELECT ... INTO`, `DO`, `CALL` and `VACUUM`. A statement nothing recognises is a write, since a database session can do anything. `mongosh` is read by its method names, so `deleteMany({})` is every document and `find` is a read.

  Writes the shell makes are ruled on as writes: a redirect, `tee`, `touch`, `mkdir`, `sed -i`, `chmod`, `ln`, `truncate`, both ends of `mv` and the destination of `cp`, and `rmdir`, `unlink` and `shred` are deletes.

  Flags before the verb no longer hide it, so `kubectl --context prod delete`, `git -C dir push` and `aws --profile prod s3 rm` are the delete or push they are. `gh api -XPOST`, `--method=POST` and a lowercase method are writes, a GraphQL query is a read and a mutation a write, and an approving review is its own action. The `railway`, `stripe`, `npm`, `git`, `kubectl`, `terraform` and `docker` tables cover the verbs that were unknown and so let through, among them `railway redeploy`, `down` and `variables --set`, `stripe post`, `delete`, `trigger` and every resource's `create`, `update`, `confirm` and `capture`, and `npm ci`.

  An MCP tool named `rerun`, `cancel`, `redeploy`, `refund` or `approve` is a write, a name that opens with a read verb stays a read whatever noun follows, and a database tool is judged by the statement it was handed. `memnox policy test` and `memnox next` rule with each action's class, so a rule about changes no longer shows a read as refused, and `policy test --class` names one.

- `memnox rewind` typed by an agent is refused, so a rewind always goes through the session tool and a person saying yes. `memnox rewind --list` still works, so the agent can find a milestone id.
- 298d974: A milestone now keeps the small files git ignores, so a rewind puts back an ignored config or key file the agent changed or deleted. Only files of a megabyte or less are kept, at most two hundred, and a wholly ignored directory such as `node_modules` or `dist` is skipped without being walked. A rewind still never deletes an ignored file created since the milestone, and the person's own index never sees any of them. The contents are kept in this repository's `.git` under `refs/memnox/`, which no ordinary push sends anywhere.
- 51302eb: A rule's pattern can now leave things out: one starting with `!` takes matches back out, and `{workspace}` stands for the directory the agent is working in. So a rule can ask about every host but the ones a project talks to, and refuse a write anywhere but the workspace while the workspace goes through untouched, which an allow rule could never do because an ask or a deny beats it. A request that names no target or no working directory cannot be shown to be excluded, so the rule still applies to it. The hook now reports the working directory for file edits too.

  The generated rule about credential files leaves `.env.example`, `.env.sample` and `.env.template` readable, since a template holds names and no values. Claude Code's native permissions and the kernel wall cannot express an exclusion, so they stay the wider of the two.

- 78b400b: `psql -f query.sql` is ruled on by what the file holds, so a file of selects is a read under a read-only rule and one that drops a table is destructive. A file over half a megabyte, or one that will not read, leaves the command the write it was before.
- 8178240: A session is summed up when it ends, without anybody asking. `memnox run` prints one line after the agent exits: actions, files read and changed, reads and changes in the busiest systems, and what was stopped, with the command that shows the rest. A session only the hooks saw leaves the same line as a `session.summary` row when it ends, filed with the config rows so no count of agent work includes it.
- 5bc572d: A session's task is now what the person typed, without anybody declaring one. Each prompt is kept as the session's task, so `why` quotes the ask, and a prompt that reads as an investigation, "investigate why the payments failed", "look into the staging failure", or anything that says "do not change anything", holds the session to reading: a change outside this machine is refused and the agent is told so up front. A prompt that asks for a fix is not an investigation, a task a person declared with `memnox task set` or `memnox run --task` is never replaced by one read from a prompt, and it is read by its words, never by a model.

  A session only the hooks saw now shows its summary line as a desktop notice when it ends, since nobody is watching its terminal by then.

- 1873b63: A server that grows a tool that changes things is caught the moment it lists it. The MCP proxy keeps what each server listed last time under `~/.memnox/pins`, and a listing with a new tool that writes, deletes or sends, or an old one that started to, is said on the proxy's stderr and kept as a `config.drift.new-write-tool` row naming the tools and which of them no rule covers. `replay` shows it beside what the session did. The daemon still never starts a server; the proxy already talks to it.
- 8b83d27: A session that has only read other systems and then changes one is asked about once. After three reads through a CLI or an MCP tool and no change outside this machine, the first change there, such as a refund after looking at the payment, needs a person, because each step being allowed does not make "look into it" the same as "fix it". A web fetch is reading the docs and does not count toward it, and local work never does.

  `memnox doctor --servers` starts every MCP server an agent is configured with, as `memnox scan` does when asked, and says which answer and for which agents, since a server that is configured and does not answer is one an agent will fail on.

- bcbbd28: Inside an untrusted repository, a cloned one or one run with `--untrusted`, an MCP tool that changes something is refused rather than asked about, while reading through it still goes, and the repository's own `.env` files are refused while `.env.example`, `.env.sample` and `.env.template` stay readable. On macOS the kernel wall of `memnox run --untrusted` refuses those key files too, so a binary the agent runs cannot read them either. A CLI that reaches out still asks, as it did.
- c481f9b: A session becomes wary of what it read from any tool, not only an MCP one. When a fetched page, a file or a command's output addresses the model, such as "ignore previous instructions", the after-tool hook marks the session and what goes outward is asked about for the window, as an MCP result saying it already did. Memnox's own session tools never mark it.

  The circuit breaker now counts actions outside the task `memnox run --task --paths` declared, so its scope-drift trip can fire. Nothing reported them before, and the counter it reads stayed at zero.

- 9f4bbdb: A rule can name what a change does rather than only its class: `capabilities` matches `transfer` for anything that moves money, `deploy` for a deploy, a release, `kubectl apply` or `terraform apply`, `admin` for IAM, secrets, roles and invites, `execute` for code run somewhere else, and `delete`, `send`, `write` and `read`. It is read from the action's name and class, the same way for an MCP tool and a CLI verb, and a local command such as `git apply` stays a `write`. `memnox explain <server>` shows what each tool does in these words.
- d4a7575: `memnox report --session <id>` adds up one session, `last` for the latest: files read and changed, reads and changes in each system outside this machine, what was held and what was stopped. `memnox why` shows the task declared for the session and the three steps before the decision. `memnox replay` puts what changed on the machine, from an hour before the session until it ended, in order beside what the session did, so a server that gained a tool sits right before the agent calling it.

  `memnox explain <server>` shows what each tool would meet under the rules in force and which rule decides it, and `memnox explain <agent>` shows each system the agent reaches with its reads and its changes counted as allowed, asked, refused and covered by no rule. A server that disappears from an agent's config is now a notice, because what relied on it will fail, and a new server's notice says how many of its tools read, write and delete.

- 8e809aa: A rule's `environments` now matches. A command's environment is the one it names, as it names it: railway's `--environment`, kubectl's `--context`, aws's `--profile`, gcloud's `--project`, docker's `--context`, and `RAILWAY_ENVIRONMENT`, `AWS_PROFILE`, `TF_WORKSPACE` or `DOCKER_CONTEXT` where no flag says. `vercel --prod`, `netlify --prod` and `stripe --live` are `production`, and an MCP call names its own in an `environment`, `environmentName`, `env` or `stage` argument. Before this, no seam set an environment, so a rule naming one never fired.

  A refusal says which environment the command named, and where the rule only said to ask somebody it names the verb table's way forward for that command, such as `railway logs` for a refused `railway redeploy`. A shell command refused inside Claude Code's own shell tool now carries its way forward too, which it used to drop.

- What your workspace has settled reaches the agent in its session. Once a machine is connected, the daemon pulls the decisions, policies, owners and approval authorities in force beside the rules, with who confirmed each and when, into `~/.memnox/memory.json`. The agent is told at the start of a session to ask before it changes code, what was settled about a subject or a path is added when a prompt names it or just before the first write to it, and two new `memnox-session` tools answer on request: `memory` looks through what this machine holds, and `brief` asks the workspace live about the paths an agent is about to change. Matching is by shared words and paths on the machine, and none of it ever allows or refuses an action.
- Updated dependencies
- Updated dependencies [278df61]
- Updated dependencies [10e0423]
- Updated dependencies [757e71d]
- Updated dependencies [2c8590c]
- Updated dependencies [b54d3df]
- Updated dependencies [ec909de]
- Updated dependencies [b1f1458]
- Updated dependencies [710da87]
- Updated dependencies [19758d2]
- Updated dependencies [60433f8]
- Updated dependencies [9ae6524]
- Updated dependencies [e6b7881]
- Updated dependencies
- Updated dependencies [847c05b]
- Updated dependencies [25efef3]
- Updated dependencies [c432e3f]
- Updated dependencies
- Updated dependencies [298d974]
- Updated dependencies [51302eb]
- Updated dependencies [78b400b]
- Updated dependencies [8178240]
- Updated dependencies [5bc572d]
- Updated dependencies [1873b63]
- Updated dependencies [8b83d27]
- Updated dependencies [bcbbd28]
- Updated dependencies [c481f9b]
- Updated dependencies [9f4bbdb]
- Updated dependencies [d4a7575]
- Updated dependencies [8e809aa]
- Updated dependencies
  - @memnox/core@0.13.2

## 0.13.1

### Patch Changes

- 3ca11bc: Reading never waits on a person, and changing somebody else's system still does. A web fetch, a search, `curl` or `wget` without a body goes through, and a `POST`, `PUT`, `PATCH` or `DELETE` is asked about. An MCP tool that lists or reads goes through, and one that writes, deletes, sends a message or cannot be classified is asked about. The CLIs that act on a remote system, which are the cloud providers, `gh`, `kubectl`, `terraform`, the hosting platforms, `stripe`, the database clients, `docker push` and `npm publish`, are asked about for their writes and deletes and left alone for their reads, while installs, builds and test runs stay local work. Rules gain a `classes` field for this, and an `http.request` names its `method`.

  The `aws` table now reads an operation by its verb whatever the service, so `aws ec2 describe-instances` is a read and `create-`, `put-`, `update-`, `delete-` and the rest are changes, where before most of them matched nothing. `gh api` is a change when a method or a field says so, and the everyday `pr`, `issue`, `workflow` and `run` verbs are classified.

  A refused edit tells the agent that a yes in the conversation allows nothing and that the same write made another way is the same write, and says how its person can allow it.

- Updated dependencies [3ca11bc]
  - @memnox/core@0.13.1

## 0.13.0

### Minor Changes

- beee8d3: Protection can be turned off on purpose and on the record. `memnox stop` lets every seam through without ruling and keeps the daemon from putting hooks back, with `--for` to end it on time and `--reason` for the team; `memnox start` turns it back on in the mode it was stopped in. Both are ledger rows, `memnox status` shows the stop first, and an enrolled machine reports it to its workspace.

  A newly adopted agent or wrapped MCP server starts on probation for seven days: its writes, outward and destructive actions ask, and its reads do not. `memnox agents trust` and `memnox mcp trust` end a probation now. An agent that has been silent for thirty days while holding a write tool, a credential or a hook is shown as dormant.

  Memnox answers from inside the agent's own session. `memnox-session` is a local MCP server every installed agent launches, with `why`, `status`, `replay` and `decisions` to read the record and `rewind` as the one tool that acts, which always asks its person first. No tool can allow, approve or trust anything, because an agent that could call one would approve itself.

  A run can be held to its task with Landlock and edit containment, and the working tree is checkpointed before a destructive write so `memnox rewind` can put it back. `memnox replay` walks one session step by step, marking what led to a failure or a breaker trip.

  The daemon keeps the boundary setup drew and notices drift, raising a desktop notice and writing every config change to the ledger. Unusual actions are called out as they happen, and egress is served from the daemon.

  `memnox update` shows the installed and latest versions and upgrades with the command that matches how this copy was installed, after you say yes. Decisions, protection changes and actions now sync to the control plane behind a cursor, so nothing is sent twice.

### Patch Changes

- Updated dependencies [beee8d3]
  - @memnox/core@0.13.0

## 0.12.0

### Minor Changes

- c153c55: Two agents on two machines stop writing the same lines without either being told. An edit takes its lease from inside the agent through a hook, in Claude Code, Codex, Cursor, Gemini CLI and Windsurf, and the hook reads the lines and the function the edit is about to change, so two sessions in one file only meet where their edits do. Anything with no hook of its own, which is every other agent and a person in their own editor, is watched instead: the daemon claims the lines a saved file changed a moment after the save, says plainly that it could not stop that save, and tells the other side.

  Work that writes no path is claimed too. Posting the message, opening the issue, closing the pull request: the MCP proxy and the shell wrappers ask one register before the work goes out, so an agent here meets an agent there on the same issue rather than doing it twice. A claim lasts as long as the call and is let go the moment it returns.

  A refusal now names which lines are held, who holds them, whether they have gone quiet and when they free up, and it ends on the one thing a person can type, `memnox lock --free <id>`, which frees another machine's hold with the reason kept on the record. Where a person is at the session, Claude Code asks them in its own permission prompt instead of refusing.

  A running session is told while it works. The same hook collects what was said to that session at every pause and hands it to the agent beside the tool result, and the proxy does the same for an agent with no hooks, so the agent that got somewhere first hears about the collision in its own session. What it did is sent within a couple of seconds rather than on the next heartbeat.

  `memnox setup` wraps the MCP servers as part of the guided run and writes into each wrapped line which agent it belongs to, so a refusal names Claude Code or Cursor rather than "an agent".

### Patch Changes

- Updated dependencies [c153c55]
  - @memnox/core@0.12.0

## 0.11.0

### Minor Changes

- 7ed5b5c: `memnox setup` finishes the job it started: it enrols the machine and then wires it, putting the seams, a baseline rule set and the daemon in place, so the command the console tells somebody to run leaves no agent ungoverned behind a ticked step.

  Every command is drawn on one rail with a tone per line, which is what makes a refusal read differently from a result.

  A held answer travels back inside the window the agent is still waiting in, rather than after it has given up. The shell seam records what it decided and names which refusal it was, and a credential rule fires at the seam that reads the file rather than one layer above it. A lease is never recorded against a pid nothing can outlive, `doctor` names the two failures its count cannot see, and a conflict nobody is having is no longer reported.

### Patch Changes

- Updated dependencies [7ed5b5c]
  - @memnox/core@0.11.0

## 0.10.1

### Patch Changes

- @memnox/core@0.10.1

## 0.10.0

### Patch Changes

- Updated dependencies
  - @memnox/core@0.10.0

## 0.9.1

### Patch Changes

- Keep a workspace id out of sentences, and revoke what offboard says it revokes.

  A control plane that keys workspaces by UUID turned every prompt into
  `Call it something 789fdf81-0ecc-4d17-a234-464bc0a8ecf4 will recognise`, which
  is a sentence nobody reads to the end. The id now appears on the lines that
  state facts, where it can be copied, and prose says the workspace's name where
  there is one short enough to read and "your workspace" where there is not.

  `memnox agents offboard` restored an agent's config and then failed to revoke
  its credential, reporting only that it could not. The control plane refuses one
  machine acting on another's row, and an agent's row is not the laptop's, so the
  call never had a chance. A machine may now hand back the credentials of agents
  it enrolled itself, which is the same authority it used to mint them. Nothing
  else moved: it still cannot beat, sync or pull rules as one of its agents.

- Updated dependencies
  - @memnox/core@0.9.1

## 0.9.0

### Minor Changes

- One approval per machine, and one rail for the whole setup run.

  `memnox setup` sent you to a browser for every agent it onboarded, so a laptop
  with five agents asked for five approvals after you had already approved the
  laptop itself. Agents on this machine are now enrolled on the credential that
  first approval produced, through a door the control plane opens only to a
  machine acting for itself. Each agent still holds its own credential, so
  revoking one does not silence the others, and each records the machine that
  vouched for it, so revoking the laptop takes them all. Against a control plane
  that has no such door the browser flow still runs, and the screen says why one
  opened rather than leaving a tab to explain itself.

  Everything the run prints is on one rail now, prompts and enrolment included:
  enrolment had been writing to stdout while the rest drew on stderr, so the one
  step that can block on a person looked like another command interrupting, and
  anything piping `memnox` received it. Paths print under `~`, backup filenames
  are short enough to read, and every wait names its deadline. The approval poll
  now has a floor, because a control plane sending a zero interval left it
  polling as fast as the network would answer.

### Patch Changes

- Updated dependencies
  - @memnox/core@0.9.0

## 0.7.2

### Patch Changes

- @memnox/core@0.7.2

## 0.7.1

### Patch Changes

- 7d23156: The ledger's append-only trigger now holds what it claimed.

  It asked only whether `authorizedBy` moved the right way, so any `UPDATE` that
  set it could rewrite every other column in the same statement: one release of a
  held call could turn a denied action into an allowed one, under a different name
  and with a different reason, and SQLite raised nothing. `memnox why` reads those
  rows a year later, which is the whole reason the trigger exists. Migration 4
  recreates it so that nothing except `authorizedBy` may change, and a test holds
  the guarded column list against the table itself so a column added later cannot
  slip out from under it.

  The git credential seam now carries an allow list rather than a deny list.
  `protocol`, `host`, `path` and `username` are what naming a remote needs; every
  other field git sends is dropped unread. The old list named `password` and
  `credential`, which was right for the protocol as it stood and wrong as a shape,
  since the block is extensible and already carries `oauth_refresh_token`. What
  the seam carries reaches the ledger, so a list of what is safe is the only shape
  that cannot be outgrown.

- Updated dependencies [7d23156]
  - @memnox/core@0.7.1

## 0.7.0

### Patch Changes

- Updated dependencies [451aa4e]
  - @memnox/core@0.7.0

## 0.4.1

### Patch Changes

- Updated dependencies [8c92a70]
  - @memnox/core@0.4.1

## 0.4.0

### Patch Changes

- Updated dependencies [8530156]
  - @memnox/core@0.4.0

## 0.2.1

### Patch Changes

- Updated dependencies [f99aca0]
  - @memnox/core@0.2.1
