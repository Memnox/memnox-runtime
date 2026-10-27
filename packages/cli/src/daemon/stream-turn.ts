import type { DaemonAskChunk } from '@memnox/core';
import { BRAIN_CHUNK } from '../operator/brain';
import type { BrainTurns } from './brain-turns';
import { OpeningHold } from './opening-hold';
import { acts } from './speculation';
import { SpokenFilter } from './spoken-filter';

/**
 * One turn streamed out, ended the moment the brain holds for the rest, since whatever it
 * writes after holding would be dropped anyway and the orb should listen now.
 */
export async function streamTurn(
  turns: BrainTurns,
  asked: string,
  send: (chunk: DaemonAskChunk) => void,
  unsaid: readonly string[] = [],
  wanted?: () => boolean,
): Promise<{ answered: string; ended: boolean; held: boolean; acted: string[] }> {
  let held = false;
  let cut = false;
  let ending = false; // Set once the brain ended it after speaking, so a second wording is never said.
  const answered: string[] = [];
  const acted: string[] = [];
  const spoken = new SpokenFilter(unsaid);
  const opening = openingFor(answered, send);
  const each = (arrived: DaemonAskChunk): void => {
    if (acts(arrived)) acted.push(bareName(arrived)); // It ran whether or not the chunk is passed on.
    if (held) return;
    if (arrived.kind === BRAIN_CHUNK.TEXT) {
      if (!ending) opening.push(spoken.text(arrived.text ?? ''));
      return;
    }
    const done = arrived.kind === BRAIN_CHUNK.DONE;
    if (done && !ending) opening.push(spoken.end());
    // A reply that only said "I am listening" was a hold written out instead of called for.
    const listened = opening.settle(isHold(arrived), done);
    const chunk = listened ? HOLD : arrived;
    if (isEnd(chunk) && answered.length > 0) ending = true;
    if (isEnd(chunk) && keepsListening(answered.join(''))) return;
    if (chunk.kind === BRAIN_CHUNK.TOOL) spoken.tool();
    else if (!ending) opening.push(spoken.end());
    if (chunk.kind === BRAIN_CHUNK.CANCELLED) cut = true;
    send(chunk);
    if (!isHold(chunk)) return;
    held = true;
    closeHeld(turns, send, done);
  };
  await turns.ask(asked, each, wanted);
  return { answered: answered.join(''), ended: !held && !cut, held, acted };
}

/** Closes a turn that ended in a hold: the done the surface waits for, and the brain stopped if still going. */
function closeHeld(
  turns: BrainTurns,
  send: (chunk: DaemonAskChunk) => void,
  done: boolean,
): void {
  send({ kind: BRAIN_CHUNK.DONE });
  // A hold read from the turn's own end has nothing left to stop, and an interrupt sent to an idle brain killed its warm process.
  if (!done) turns.cancel();
}

/** What separates an MCP tool's server prefix from its own name, as in mcp__memnox-operator__show. */
const TOOL_PREFIX_SEPARATOR = '__';

/** A tool by its own name, which is how a reply cut off after acting says what it already did. */
function bareName(chunk: DaemonAskChunk): string {
  return (chunk.tool ?? '').split(TOOL_PREFIX_SEPARATOR).pop() ?? '';
}

/**
 * The chunks bound for the Mac without a hold and the end sent with it, for words too whole to
 * hold on, so the caller asks again at once rather than the Mac listening for more.
 */
export function withoutHolds(
  send: (chunk: DaemonAskChunk) => void,
): (chunk: DaemonAskChunk) => void {
  let dropping = false;
  return (chunk) => {
    if (isHold(chunk)) dropping = true;
    else if (!(dropping && chunk.kind === BRAIN_CHUNK.DONE)) send(chunk);
  };
}

/** The opening of the reply, which says each piece it lets through and keeps it for recall. */
function openingFor(
  answered: string[],
  send: (chunk: DaemonAskChunk) => void,
): OpeningHold {
  return new OpeningHold((text) => {
    answered.push(text);
    send({ kind: BRAIN_CHUNK.TEXT, text });
  });
}

/**
 * Whether a reply the brain ended still keeps the microphone open: one that asks is waiting on
 * its answer, and one longer than a sign off answered something the person may follow up on.
 */
function keepsListening(reply: string): boolean {
  return reply.trim().endsWith('?') || wordCount(reply) > MOST_SIGN_OFF_WORDS;
}

/** "Of course. Ready when you are." is six; an answer that reported something runs longer. */
const MOST_SIGN_OFF_WORDS = 8;

function wordCount(text: string): number {
  return text.split(/\s+/).filter((word) => word !== '').length;
}

/** What the Mac knows as a hold, sent for one the brain only wrote out. */
const HOLD: DaemonAskChunk = { kind: BRAIN_CHUNK.TOOL, tool: 'keep_listening' };

/** The brain closing the conversation, by the tool's own name whatever server prefix it carries. */
function isEnd(chunk: DaemonAskChunk): boolean {
  return (
    chunk.kind === BRAIN_CHUNK.TOOL && (chunk.tool ?? '').endsWith('end_conversation')
  );
}

/** The brain saying the person is mid thought, by the tool's own name whatever server prefix it carries. */
function isHold(chunk: DaemonAskChunk): boolean {
  return chunk.kind === BRAIN_CHUNK.TOOL && (chunk.tool ?? '').endsWith('keep_listening');
}
