import {
  CloudLeases,
  CloudNotes,
  DELIVERY,
  deliveryRow,
  desktopNotice,
  LeaseRegistry,
  markActivity,
  MINUTE_MS,
  NOTE_KIND,
  readWorkspaceMemory,
  renderNotes,
  SECOND_MS,
  SpokenInstructions,
  SqliteEventStore,
  type NoteKind,
  type SessionNote,
} from '@memnox/core';

import { EDIT_HOST } from './agent-edits';
import { takeOverIfAllowed, type EditHookContext } from './edit-claims';
import { EDIT_IDLE_MINUTES } from './edit-hook';
import { markIfDue } from './edit-marks';
import {
  activityOf,
  readsNotesAt,
  SESSION_MOMENT,
  sessionAnswer,
  withDecisions,
  type SessionEvent,
} from './session-events';

/**
 * A tool call returned or a turn ended: write down what the agent did, keep its holds
 * alive, and hand it whatever is waiting for its session, in the words its host reads.
 */

/**
 * How often a session asks for notes after a tool
 * call, at most, since agents run tools in bursts.
 */
const NOTES_EVERY_MS = 10 * SECOND_MS;

/**
 * How often a working session renews what it holds,
 * at most, since this runs after every call.
 */
const RENEW_EVERY_MS = MINUTE_MS;

/** How often another agent's question may wake a session whose turn ended. */
const AGENT_WAKE_EVERY_MS = 2 * MINUTE_MS;

/**
 * What the host reads back at this pause, with a trailing newline, or empty for nothing.
 * `said` is anything else this pause carries, such as a decision the prompt names.
 */
export async function answerPause(
  pause: SessionEvent,
  context: EditHookContext,
  said: string | null = null,
): Promise<string> {
  await recordActivity(pause, context);
  if (pause.moment === SESSION_MOMENT.AFTER_TOOL) await takeOverIfAllowed(pause, context);
  const notes = await notesAt(pause, context);
  await recordPickedUp(
    notes.filter(fromAnAgent),
    pause.sessionId,
    context,
    FROM_AN_AGENT,
  );
  // A collision note goes on the person's screen
  // too, since they are usually in another window.
  const collided = notes.filter((note) => note.kind === NOTE_KIND.COORDINATION);
  if (collided.length > 0 && pause.host !== EDIT_HOST.WINDSURF) {
    desktopNotice(collided.map((note) => note.message).join(' '));
  }
  // A remembered decision rides beside the notes, never instead of them.
  const told = [
    ...(notes.length === 0 ? [] : [renderNotes(notes)]),
    ...(said === null ? [] : [said]),
  ];
  const answer = sessionAnswer(pause, told.length === 0 ? null : told.join('\n\n'));
  return answer === '' ? '' : `${answer}\n`;
}

async function recordActivity(
  pause: SessionEvent,
  context: EditHookContext,
): Promise<void> {
  const done = activityOf(pause, context.agent, undefined, context.now().toISOString());
  if (done.length === 0) return;
  try {
    // No memory pulled yet means nothing settled to bear on, not a reason to lose the row.
    const memory = await readWorkspaceMemory(context.home).catch(() => null);
    const rows = memory === null ? done : withDecisions(done, memory);
    const ledger = SqliteEventStore.forHome(context.home);
    try {
      for (const row of rows) await ledger.append(row);
    } finally {
      ledger.close();
    }
    await markActivity(context.home);
  } catch {
    // A lost row is a lost row; the agent's tool call already happened.
  }
}

/**
 * What to hand this session: after a tool call, at most every
 * few seconds; at a turn's end, only a person's words, since a
 * note then wakes the agent; at a prompt, everything waiting.
 */
async function notesAt(
  pause: SessionEvent,
  context: EditHookContext,
): Promise<SessionNote[]> {
  const { agent, home } = context;
  const inbox = new CloudNotes(home);
  // The holds are filed under the session `memnox run` set, where there is one.
  const holder = context.runSession ?? pause.sessionId;
  // A host that reads nothing back here would have a collected note marked delivered and never seen.
  if (!readsNotesAt(pause.host, pause.moment)) {
    await keepHoldsAlive(holder, context);
    return [];
  }
  const spoken = await spokenFor(home, [pause.sessionId, holder], agent);
  await recordPickedUp(spoken, pause.sessionId, context);
  if (pause.moment === SESSION_MOMENT.TURN_END) {
    return [
      ...spoken,
      ...(await inbox.collect(
        agent,
        pause.sessionId,
        await turnEndKinds(pause, context),
      )),
    ];
  }
  if (pause.moment === SESSION_MOMENT.PROMPT)
    return [...spoken, ...(await inbox.collect(agent, pause.sessionId))];

  const chore = { name: 'notes', sessionId: pause.sessionId, everyMs: NOTES_EVERY_MS };
  const [, notes] = await Promise.all([
    keepHoldsAlive(holder, context),
    markIfDue(home, chore, context.now()).then((due) =>
      due ? inbox.collect(agent, pause.sessionId) : [],
    ),
  ]);
  return [...spoken, ...notes];
}

/**
 * What may wake a session whose turn ended: a person's turn always, and another agent's
 * question at most every few minutes, so two agents can never keep each other running.
 */
export async function turnEndKinds(
  pause: SessionEvent,
  context: EditHookContext,
): Promise<NoteKind[]> {
  const chore = {
    name: 'woken',
    sessionId: pause.sessionId,
    everyMs: AGENT_WAKE_EVERY_MS,
  };
  const wakes = await markIfDue(context.home, chore, context.now());
  return wakes ? [NOTE_KIND.OPERATOR, NOTE_KIND.AGENT_ASK] : [NOTE_KIND.OPERATOR];
}

/** What the person said to this session out loud, under either id it goes by. */
async function spokenFor(
  home: string,
  ids: readonly string[],
  agent: string,
): Promise<SessionNote[]> {
  const inbox = new SpokenInstructions(home);
  const found: SessionNote[] = [];
  for (const id of new Set(ids))
    found.push(...(await inbox.collect(agent, id).catch(() => [])));
  return found;
}

/** What the hook says it handed over from another agent, so `why` and the timeline show the conversation. */
const FROM_AN_AGENT =
  "another agent's message, handed to the session by its own hook at its next step";

function fromAnAgent(note: SessionNote): boolean {
  return note.kind === NOTE_KIND.AGENT || note.kind === NOTE_KIND.AGENT_ASK;
}

/** What the hook says it handed over, so the person's words are only called delivered once the session took them. */
const PICKED_UP = "the session's own hook handing it over at its next step";

async function recordPickedUp(
  spoken: readonly SessionNote[],
  sessionId: string,
  context: EditHookContext,
  checked: string = PICKED_UP,
): Promise<void> {
  if (spoken.length === 0) return;
  const at = context.now().toISOString();
  try {
    const ledger = SqliteEventStore.forHome(context.home);
    try {
      for (const note of spoken) {
        await ledger.append(
          deliveryRow({
            sessionId,
            agent: context.agent,
            text: note.message,
            outcome: DELIVERY.VERIFIED,
            proof: { checked },
            at,
          }),
        );
      }
    } finally {
      ledger.close();
    }
  } catch {
    // A lost row is a lost row; the note was already handed over.
  }
}

/**
 * The session is still working, so what it holds lasts
 * another few minutes. A missed renewal lapses early.
 */
async function keepHoldsAlive(
  sessionId: string,
  context: EditHookContext,
): Promise<void> {
  const { agent, home } = context;
  const chore = { name: 'renewed', sessionId, everyMs: RENEW_EVERY_MS };
  if (!(await markIfDue(home, chore, context.now()))) return;
  await new LeaseRegistry(home)
    .renewSession(sessionId, context.now().toISOString(), EDIT_IDLE_MINUTES)
    .catch(() => 0);
  await new CloudLeases(home)
    .renewSession({ agent, sessionId, pid: context.pid }, EDIT_IDLE_MINUTES)
    .catch(() => undefined);
}
