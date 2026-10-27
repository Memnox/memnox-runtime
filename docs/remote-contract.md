# Remote contract: phone, relay and runtime

The one description every repo builds to for pairing a phone and steering the runtime from it.
`memnox-runtime` owns this file. `memnox-cloud`, `memnox-macos` and `memnox-ios` follow it, and
any change lands in all of them in the same piece of work.

## Trust rules

1. A relay token (`mch_`, `rlp_`, `rly_`) only lets a connection put bytes into a mailbox. The
   runtime treats a frame as a device's only after a Noise IK handshake completes against a
   static key in its device registry, and looks capabilities up from that key, never from a
   token, a header or a mailbox id.
2. The 6 digit code is a human check that both screens finished the same handshake. A device
   record is written only after the person says yes. Where a Mac key is kept (`this-mac` in the
   registry), that yes is a Touch ID signed `pair-accept`. On a machine with no Mac key, such as a
   server reached over SSH, the shell is the root of trust: `memnox pair` puts the QR on the
   terminal, `pair-pending` leaves the code out, and `pair-accept` carries the code the person
   reads off the device and types. Three wrong codes close the pairing.
3. All Noise mechanics (handshake, cipher states, nonces, rekey) come from snow, through the
   one crate at `memnox-runtime/native/noise`, used by the runtime and the iPhone alike.

## Noise

- Prologue for every handshake: the UTF-8 bytes of `memnox-remote:v1`.
- Pairing: `Noise_XXpsk0_25519_ChaChaPoly_BLAKE2s`, phone is the initiator, the PSK is the 32
  byte `secret` from the QR.
- Every later connection: `Noise_IK_25519_ChaChaPoly_BLAKE2s`, phone is the initiator and knows
  the runtime's static key from pairing.
- Code shown on both screens: the first 4 bytes of the handshake hash as a big endian unsigned
  integer, modulo 1000000, zero padded to 6 digits.
- Rekey: a sender calls `rekeyOutgoing` after every 1048576 transport messages it sends, and a
  receiver calls `rekeyIncoming` after every 1048576 it receives. The phone also closes and
  starts a fresh IK handshake every hour.

### Crate API (`native/noise`)

Node binding (napi-rs), package `@memnox/noise`:

```ts
export function generateKeypair(): { publicKey: Buffer; privateKey: Buffer };
export class Handshake {
  static initiator(
    pattern: 'IK' | 'XXpsk0',
    localPrivate: Buffer,
    remotePublic?: Buffer,
    psk?: Buffer,
  ): Handshake;
  static responder(
    pattern: 'IK' | 'XXpsk0',
    localPrivate: Buffer,
    psk?: Buffer,
  ): Handshake;
  writeMessage(payload: Buffer): Buffer;
  readMessage(message: Buffer): Buffer;
  isFinished(): boolean;
  handshakeHash(): Buffer;
  remoteStatic(): Buffer | null;
  intoTransport(): Transport;
}
export class Transport {
  encrypt(plaintext: Buffer): Buffer;
  decrypt(ciphertext: Buffer): Buffer;
  rekeyOutgoing(): void;
  rekeyIncoming(): void;
}
export function pairingCode(handshakeHash: Buffer): string;
```

C ABI for iOS (`memnox_noise.h`, static library in `MemnoxNoise.xcframework`): the same
operations over opaque handles, with buffers passed as pointer plus length and errors as a
nonzero return code.

## Relay

- `wss://api.memnox.com/v1/relay`, overridable with `MEMNOX_RELAY_URL` on the runtime and a
  debug setting on the phone, for a local relay in tests.
- The connection authenticates with `Authorization: Bearer <token>`:
  - `mch_` the machine token. The connection carries every mailbox that machine created. A Mac
    with no account has one too: the first pairing registers a personal space for it with
    `POST /v1/device-spaces` (two public keys and a small proof of work, no credential), whose
    one machine holds an ordinary `mch_`. Signing in later claims the space, and its mailboxes
    move to the account's machine, so a paired phone is never paired again.
  - `rlp_` a pairing token, scoped to one mailbox, single use, 120 seconds.
  - `rly_` a phone token, scoped to one mailbox, lasts until revoked.
- A mailbox id is 16 random bytes, written base64url without padding in JSON and the QR.
- Every binary WebSocket message is `mailbox (16 bytes) || payload`, at most 65552 bytes in all.
  The relay checks the token may use that mailbox, then forwards the payload unchanged to the
  other side of the mailbox. It stores nothing and logs only mailbox ids, directions and sizes.
- A text WebSocket message is never mailbox traffic. The relay refuses text from a client, and
  sends text only to a machine's own `mch_` connection, never to a phone. The one text it sends
  is the beat, exactly `{"type":"beat"}`: the control plane stored an answer to a call this
  machine holds, so run the heartbeat now. It carries no call id, no answer and no mailbox, since
  the answer itself still travels on the heartbeat; a beat that is lost costs latency and never a
  decision. A machine ignores text it does not recognise, and honours at most one beat a second
  and only while it holds a call. While its relay link is up, a machine that holds a call already
  carried up polls every 30 seconds as the fallback for a lost beat, and a new call still goes up
  within 2 seconds. A machine with no paired device opens no relay link, so it keeps polling every
  2 seconds while it holds a call, as before.
- Machine HTTP routes, authenticated with `mch_`:
  - `POST /v1/workspaces/:ws/machines/:id/relay/mailboxes` returns
    `{ mailbox, pairingToken, expiresAt }`.
  - `POST /v1/workspaces/:ws/machines/:id/relay/mailboxes/:mailbox/tokens` returns
    `{ tokenId, token }`, a `rly_` for that mailbox.
  - `DELETE /v1/workspaces/:ws/machines/:id/relay/mailboxes/:mailbox` revokes every token on the
    mailbox and closes its connections.
  - `POST /v1/workspaces/:ws/machines/:id/relay/mailboxes/:mailbox/wake` with
    `{ reason: 'waiting' }` sends the phone a push with generic text only.
- Phone HTTP route, authenticated with `rly_`:
  - `PUT /v1/relay/push` with `{ apnsToken, pushToStartToken? }` from an iPhone, or
    `{ fcmToken }` from an Android phone. One phone is on one push service, so a body naming both
    is refused. Either way the wake carries no text, and the question arrives through the tunnel.

## Payload framing inside a mailbox

The first byte of every payload says what follows:

| Byte   | Meaning                             |
| ------ | ----------------------------------- |
| `0x01` | a Noise handshake message           |
| `0x02` | a Noise transport message           |
| `0x03` | close: the sender drops its session |

A transport plaintext starts with one flag byte, `0x00` when this chunk ends a line and `0x01`
when more chunks follow, and then up to 65000 bytes of UTF-8. The joined chunks are one JSON
line: a `DaemonRequest` from the phone or a `DaemonResponse` from the runtime, exactly as on
the Unix socket.

## Pairing handshake payloads

1. Phone writes message 1 with an empty payload.
2. Runtime writes message 2 with `{"machine":"<machine name>"}`. The phone checks that the
   runtime's static key equals `runtimeNoiseStatic` from the QR and drops the session if not.
3. Phone writes message 3 with `{"name":"<device name>","signingPoint":"<base64 X9.63 P256>","kind":"phone"}`.
   A Mac pairing over the relay sends `"kind":"desktop"`; anything else, or no kind, is a phone.
4. Phone sends the first transport line `{"proof":"<base64 DER>"}`: a Secure Enclave signature
   over `memnox-device:v1:<base64 handshake hash>`, which proves it holds the signing key.
5. Runtime answers with one transport line once the person decides:
   `{"paired":true,"deviceId":"...","relayToken":"rly_...","voice":"af_heart","speaks":true}` or
   `{"paired":false}`. `speaks` says whether this machine has a Kokoro voice to lend; when it is
   false the device speaks with its own and never calls `speak`.

Device fingerprint: base64url, unpadded, of SHA256 over `signingPoint bytes || noiseStatic
bytes`. Touch ID signs `memnox-pair:v1:<pairingId>:<fingerprint>` for `pair-accept`, and
`memnox-grant:v1:<deviceId>:<capability>` for `device-grant`.

## QR

`memnox://pair?d=<base64url of JSON>` where the JSON is
`{"v":1,"machineId":"...","machine":"...","relayUrl":"...","mailbox":"...","pairingToken":"rlp_...","runtimeNoiseStatic":"<base64>","secret":"<base64>","expiresAt":"<ISO 8601>"}`.

## New daemon methods

Local socket only unless marked remote. A remote call to anything not on the allowlist below is
answered `outcome: 'refused'`.

| Method                        | Request fields                        | Answer                                                                                                                                                                                                              |
| ----------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pair-begin`                  | `name?`                               | `outcome: 'pairing'`, `pairing: { id, qr, expiresAt, approver }`, or `refused` with `reason` when the machine is not connected to Memnox Cloud                                                                      |
| `pair-pending`                | `pairingId`                           | streams `pairing: { id, state, approver, phone? }`, state is `waiting`, `answered`, `paired`, `declined` or `expired`, and `phone` is `{ name, fingerprint, code? }`, with `code` only when `approver` is `mac-key` |
| `pair-accept`                 | `pairingId`, `signature` or `code`    | `outcome: 'paired'`, `device`, or `refused`; a wrong `code` carries `triesLeft`, and at 0 the pairing is closed                                                                                                     |
| `pair-decline`                | `pairingId`                           | `outcome: 'declined'`                                                                                                                                                                                               |
| `devices-list`                | none                                  | `devices: Device[]`                                                                                                                                                                                                 |
| `device-revoke`               | `deviceId`                            | `outcome: 'revoked'`                                                                                                                                                                                                |
| `device-grant`                | `deviceId`, `capability`, `signature` | `outcome: 'granted'` or `refused`; `signature` is needed only where a Mac key is kept                                                                                                                               |
| `device-ungrant`              | `deviceId`, `capability`              | `outcome: 'ungranted'`, `device`; unsigned because taking a capability away only reduces what is allowed; removing `mac` also ends a live drive                                                                     |
| `voice-choice`                | `voice?`                              | sets the Kokoro voice when `voice` is present; always answers `voice`                                                                                                                                               |
| `drive` (remote, needs `mac`) | `until?`, `signature?`                | `outcome: 'driving'` with `until`, or `'stopped'` when `until` is absent, or `refused`                                                                                                                              |
| `voice-release` (`see`)       | none                                  | `ok: true`; the phone's app left the screen, so the voice goes back to the Mac at once; unsigned because it only gives power up                                                                                     |
| `follow-up` (`steer`)         | `sessionId`, `said`, `signature`      | `outcome: 'queued'`, `'typed'` or `'later'`, or `refused` with `reason`; `said` reaches the session as it is, signed over `memnox-follow-up:v1:<sessionId>:<said>`                                                  |
| `files-list` (remote, `see`)  | `path?`                               | `path`, `files: FileEntry[]`, or `refused` with `reason`; see below                                                                                                                                                 |
| `speak` (remote, `ask`)       | `line`, `voice?`, `speed?`            | streams `audio: { rate, samples, last }` on the request's id until `last` is true, or `refused` with `reason`; see below                                                                                            |

`Device` is `{ id, name, kind: 'mac' | 'phone' | 'desktop', fingerprint, capabilities: string[], pairedAt, revokedAt?, approvedBy? }`, where `approvedBy` is `mac-key` or `local-shell`. A `desktop` is a Mac reaching this machine through the relay, and starts with what a phone holds.

`ping` from a device also answers `speaks`, as in the pairing welcome, so a device paired before
the field existed learns it on its next connection.

`files-list` lists one folder under the person's home, so the phone browses the Mac without the
brain and without the screen. `path` is relative to the home, and absent lists the home itself.
The answer's `path` is the folder listed, relative to the home and `''` for the home.
`FileEntry` is `{ name, kind: 'folder' | 'file', bytes?, modified? }`, where `bytes` is a file's
size and `modified` is ISO 8601. Folders come first and then files, each by name, numbers read as
numbers; hidden entries starting with `.` are left out; at most 500 entries are sent. Only names
and metadata travel, never what is in a file. The daemon refuses, with a plain `reason`, a path
that resolves outside the home once links are followed, a hidden folder, a folder where
credentials sit (the credential targets the rules deny an agent, such as `.ssh` and `.aws`, and
the folders an untrusted run cannot read, such as `Library/Keychains`), a file, and a folder that
is not there.

`speak` says one line in the person's Kokoro voice, so a phone whose app is in the background,
where iOS allows no GPU, still speaks with the voice they chose: the Mac renders and the phone
plays. It needs the Mac app running, since the daemon asks the Mac app's own Kokoro server on
`127.0.0.1:8723`, and nothing else, so a line never leaves the machine. `line` is one sentence, trimmed and cut at 1000 characters as
the server cuts it. `voice` is a Kokoro id and absent means the voice the Mac uses, the one
`voice-choice` answers. `speed` is held between 0.5 and 1.5 and absent is the Mac's own 0.85.
The answer is one or more responses on the request's id, each carrying
`audio: { rate, samples, last }`, where `rate` is in hertz and `samples` is base64 of little
endian signed 16 bit mono PCM. Each piece carries at most 48000 base64 characters, well under the
65000 bytes a link chunks a line at, so the first sound arrives fast and the phone can start
playing it while the rest arrives. The final piece has `last: true` and may still carry samples;
an empty line of sound is one piece with `samples: ''` and `last: true`. A failure is one
response with `ok: false`, `outcome: 'refused'` and a plain `reason`: nothing to say, a voice id
that is not one, Kokoro not running on the Mac, a voice Kokoro does not know, or an answer with
no sound. It grants nothing beyond hearing the line: no agent is asked, nothing runs, and nothing
on the Mac changes.

## Capabilities and the remote allowlist

| Capability | Methods and answers it covers                                                                                                                                   | Phone default                             |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `see`      | `ping`, `sessions-list`, `session-view`, `waiting`, `subscribe`, `trace`, `voice-agents`, `voice-choice` without `voice`, `files-list`, `home`, `voice-release` | on                                        |
| `ask`      | `ask`, `cancel`, `warm`, `brief`, `speak`, `hand-over`, `rule`                                                                                                  | on                                        |
| `answer`   | `confirm` on a held call or an `answer` proposal                                                                                                                | on, a yes is signed                       |
| `steer`    | `confirm` on a stop, freeze or resume proposal, and `follow-up`, which is signed                                                                                | on, a yes is signed                       |
| `rules`    | `confirm` on a rule proposal                                                                                                                                    | off                                       |
| `rewind`   | `confirm` on a rewind proposal                                                                                                                                  | off                                       |
| `mac`      | `drive`, and `confirm` on a proposal for something only the Mac can do (open a folder, file or app, bring a window forward, type, click)                        | off, turned on from the Mac with Touch ID |

A device's `ping` answer carries `capabilities`, the list it holds on this machine, so it never
offers a choice that would be refused. A device that reads none from an older runtime assumes
the phone defaults.

## Talking to and driving the Mac from the phone

- On a remote `ask`, the daemon sets `origin: { deviceId }` from the session principal and
  ignores any origin the client sent. Spoken text streams back only to that device and the Mac
  stays silent, showing the exchange on its island.
- An `ask` may carry `sessionId`: the session the person has open on the phone. The daemon
  keeps it, and when the session views know that id the brain is told this is the session they
  are following up on, its agent, task, repository, state and latest steps, so an instruction
  goes to that agent and a question is about it unless they name another. Their words still go
  whole to the brain. An id nothing is known about is logged and left out, never an error.
  Naming a session grants nothing: anything acting on it still arrives as a proposal under its
  own capability.
- Events the daemon raises for a phone's ask carry `origin: { deviceId }`, on the Mac app's
  copy as well, so the Mac shows them without a sound and that phone says them.
- A `show` the brain raises for a phone's ask also reaches that phone, and no other, when it
  names a session (`focus`, `open`, `card` or `walk` with a `sessionId`), stamped with `origin`,
  so the phone can fly to that session and open it. It still goes to the Mac app as before. Every
  other `show` stays away from phones.
- A `show` event carries `needsMac: true` when only the Mac app can perform it. The daemon
  sends it to the Mac app's subscription, even when a phone asked.
- When the Mac app finishes such an action it reports through `delivered` as today. The daemon
  then sends the asking device one line `{ done: { text } }`, for example "Typed it into
  Claude Code", for the phone to speak.
- When no Mac app is subscribed, the daemon answers the device with
  `{ done: { text: "Open Memnox on your Mac to do that" } }` instead of holding.
- Listing a folder is `files-list` under `see`, never an `ask`, so it needs neither the brain
  nor Screen Recording. Reading the rest of the Mac (what is open, a described summary of the
  screen) is a plain `ask` under `see`. Screen pictures never leave the Mac.
- Acting on the Mac arrives as a proposal, and a yes is signed by the phone.
- `drive` with `until` (ISO 8601, at most 15 minutes ahead) and `signature` over
  `memnox-drive:v1:<deviceId>:<until>` lets that device's `mac` proposals run unsigned until
  then.
  - The grant ends early on `drive` with no `until`, on the phone's close message, or when its
    session drops.
  - It never covers deleting files, sending anything off the machine, rule writes, rewind or
    pairing, which keep asking.
  - While a grant is live, the daemon sends the Mac app a `notice` with `drivenBy: { deviceId,
name, until }`, and the Mac island shows "Driven from <name>" for its whole length.
  - When a grant ends for any reason before `until`, the daemon sends a `notice` with
    `drivenBy: { deviceId, name }` and no `until`. That absence is the only stop signal; the
    Mac also clears the pill on its own once `until` passes.
- **The Mac island mirrors a phone conversation.** For every remote `ask`, the daemon sends the
  Mac app's subscription a `notice` with `phoneTurn: { deviceId, name, said?, answer?, ended? }`:
  one with `said` when the turn starts, then the answer text as it streams in `answer` chunks,
  then `ended: true`. The Mac shows it on the island without speaking. What the person said and
  the answer travel only over the local socket, never through the relay to anyone but the
  asking phone.
- **One device holds the voice at a time, and while a phone holds it the Mac is silent.** A phone
  holds the voice while it has a live `subscribe` stream, while its `drive` grant is live, while
  an `ask` from it is in flight, and for 30 seconds after its last turn or its stream ended, so a
  follow up and what the agent raises from that turn stay on the phone. iOS drops the socket
  within seconds of the app leaving the front, so a live stream means the app is open, and the
  Mac never wakes on its name said to an open phone. The relay never says a phone's socket went
  away, so a phone session that sends no frame for 90 seconds is closed with a `close` frame: an
  open app asks for its sessions every few seconds and opens a fresh one, and a suspended one
  gives the voice back after the grace and can be woken again. When several phones qualify, the one active
  most recently holds it. A revoked phone gives the voice back at once. A phone whose app leaves
  the screen sends `voice-release` unless its person kept alerts on the phone, and the voice is
  back on the Mac at once, with what still waits asked again there; a new `subscribe`, a
  `subscribe` again on the same stream, an `ask` or a `drive` takes it back. A phone may start a
  session only with Face ID: from a phone `propose_start` skips the spoken read back, and a
  `launch` show, or an `app` show that opens a start or a new chat, raised for it becomes a `mac`
  proposal that phone signs, which needs `mac` and is never released by a drive. The daemon
  decides this and the apps only follow it:
  - While a phone holds the voice, every event to every subscriber, the Mac app and the phones
    alike, carries `heardOn: { deviceId, name }`. That phone speaks it and the Mac shows it
    without a sound.
  - Whenever the holder changes (taken, given back, a grace or a grant running out, the device
    revoked), the daemon sends the Mac app alone a `notice` with
    `voiceOn: { deviceId, name, holding }` and a plain summary, "Talking on <name>" or "Back on
    the Mac". It is noticed on a timer, so the voice comes back with no other event, and it
    never goes through the relay.

- **Pairing a phone is enough for every yes to go to it.** The person who paired it may be far
  from the Mac, so while a phone is paired, every held call and proposal it may answer carries
  `answerOn: { deviceId, name }`, the phone paired last that holds the capability the yes takes.
  The Mac app puts a spoken yes to that phone's Face ID rather than Touch ID and says "Answer it
  on <name>, which asks for Face ID"; a press on the Mac's own card is a hand at the Mac and still
  signs with Touch ID unless a phone holds the voice or drives, and whichever answer lands first
  stands. A `mac` proposal also carries `origin` naming the phone whose ask raised it, so that
  phone signs it whether or not it still holds the voice, and the Mac never declines it as
  unasked. A phone whose app follows no `subscribe` stream, such as one asked from the island
  with the app away, is woken for what waits even while its tunnel is open for that turn, and
  reads `waiting` once its turn has been said, where the same stamps are found.

A remote yes is always signed by that device's key, so the `withinSession` exception applies to
local socket callers only. A remote deny or decline needs no signature. Pairing, devices,
`register-key`, setting the voice, and every core method stay local.

A `confirm` that says no to a held call (`deny`, or `never`) may carry `reason`, what the person
said with it. It is kept as one line of at most 200 characters on the held call, so the agent is
told "said no to this, and said: ..." beside the rule's own way forward; a reason sent with a yes
is dropped. `never` is "deny from now on": the call is refused now, unsigned like any no, and a
deny rule for that agent, action and target goes on a `rules` card with the reason as the rule's
own, which the person places and signs like `always`.

## Answering a team's question by voice

A question the workspace routed to the person never reaches this machine; only the devices
signed in to the team see it, through the workspace inbox. So the device names those questions
when it asks the voice, and carries out the answer itself.

- `ask` takes `teamCalls: [{ id, label, what }]`: the workspace's id for each question, the
  label every door shows ("Codex on build-box, from Ana's team") and what it wants in plain
  words. Sending an empty list forgets them. The daemon keeps the last list for ten minutes, for
  the voice's own tools.
- When the person answers one, the voice writes a proposal of kind `team` and the proposal
  event carries `teamAnswer: { callId, answer, label }`, where `answer` is `once`, `session` or
  `deny`. Nothing is answered on this machine.
- The device that asked carries it out with the workspace: a yes after Face ID or Touch ID,
  signed over `memnox-confirm:v1:<callId>:<answer>` to `POST /v1/workspaces/:ws/me/held/:id`;
  a no unsigned. Then it confirms the proposal here: a yes signed as every remote yes is, a no
  with no signature. Declining the proposal sends nothing to the workspace.

## Answering an agent's own question with a tap

When an agent opens its own picker (Claude Code's `AskUserQuestion`) while somebody can answer,
the hook holds the picker for 45 seconds and the question waits on the person like a held call.

- The feed carries it as a `notice` with `notice: "question"`, a subject starting `aqn_`, and
  `questions: [{ question, header?, options: [{ label, description? }], multiSelect }]`. Once
  some are picked, `answers` holds them by question text, so a surface asks only what is left.
- A tap answers one question with `confirm` and `{ subject, answer, questionNumber }`, where
  `answer` is the option's label (several labels joined by `, ` for a `multiSelect`, or the
  person's own words) and `questionNumber` counts from one and defaults to the first. The
  outcome is `answered`.
- It needs no signature on the Mac or from a phone, because it is the person's choice going to
  their own agent, which is ruled on as ever when it acts. A phone needs `answer`.
- Once every question has an answer the agent carries on and the daemon sends `settled`. Where
  nobody answers in time, the picker opens on screen as it always did.
- The voice answers the same question by name through its `answer_question` tool, so a spoken
  pick and a tapped one land in the same place.

## The home every surface opens on

`home` (under `see`) answers `{ home }`, the same five blocks on the Mac, the phone and `memnox
status`, so no surface counts differently from another:

- `waiting`: how many calls are held on this machine.
- `working`: `[{ sessionId, agent, agentName, task?, repository? }]` for the sessions working now.
- `today`: `{ actions, asked, allowed, refused }` since local midnight, from the ledger. `allowed`
  counts a person's yes, never an agent's own allowed call.
- `ready` (absent when nothing is): `{ action, approvals, agentName?, targets, because }`, the one
  action people have said yes to often enough, and never refused, to let it run on its own.
- `notCovered`: `{ unprotected, dormant }`, agents found here that Memnox does not govern yet.

Every field is a count or a name. Arguments, paths beyond the targets already shown in an
approval, and secrets never appear.

`hand-over` (under `ask`) takes `action`, which must be the `ready` action, and answers
`{ proposed }`: the id of a `rules` proposal for an allow rule scoped to the targets people
approved. Nothing changes until that proposal is confirmed, which needs `rules`; a phone without
that grant shows "Confirm on your Mac, or let this phone change rules". An action that was ever
refused, or has not been approved often enough, is refused with `ok: false` and a reason.

`rule` (under `ask`) takes `said`, one sentence such as "never let an agent send customer
records to an unapproved destination", and answers `{ rule }`: the `draft` in the runtime's own
match fields (`effect`, `operation`, `agent`, `targets` with `!` exclusions,
`dataClassifications`, `classes`, `branches`, `alternative`), its `readBack` in plain words,
`openQuestions`, `draftedBy` (`pattern` for a fixed grammar, `model` for the workspace's model),
`note` where the workspace says why no model read it, and `offeredToTeam`. On an enrolled machine
the sentence goes to the workspace's `from-sentence` on the machine's own credential, and its plan
decides whether a model drafts it: a sentence no grammar reads on a plan with no model is refused
with the workspace's reason, which names the upgrade, and `upgrade: true` so the phone offers the plan. With no account, or offline, this machine's
own grammar reads it and nothing else does. Either way the draft is checked by the runtime's own
validator before it is read back. While a question is open
nothing is proposed: the phone asks it and sends `rule` again with the same `said` and
`approved`, the destinations the person named, joined by commas. With nothing open the answer
also carries `proposed`, a `rules` proposal confirmed like any other, which needs `rules` and a
Face ID signature. Once signed it holds on this machine from the next action, offline and with
no account, and on an enrolled machine it is also sent to the team as a proposal a second admin
approves. A sentence nobody could read is refused with `ok: false` and a reason that says how
to say it.

## Joining a server from the console

An admin makes a single use join token in the console, good for a few minutes. On the server,
`memnox login --token <token>` (or `MEMNOX_JOIN_TOKEN`, which keeps it out of shell history)
sends `POST /v1/machines/join` with `{ token, publicKey, hostname, label?, machineClass?,
runtimeVersion }` and gets the same answer the device flow gives: `{ machineId, token, mode,
workspaceId, ownerPersonId }`. The person who made the token owns the machine. The machine key is
still generated on the server and only its public half is sent. A token already used, expired or
revoked is any 4xx, and the CLI says to make a new one. The control plane stores only a hash of
the token.
