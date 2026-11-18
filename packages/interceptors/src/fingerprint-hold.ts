/**
 * A repository that states no code fingerprint has the first write of a session held once,
 * with the agent sent to record one, because the ask at session start alone was skipped by
 * any agent busy with its task. Once a session, so a recording that fails never stops work.
 */
import {
  ACTION,
  DECISION_EFFECT,
  markShown,
  notYetShown,
  readCodeFingerprint,
  slashed,
  SessionContextStore,
} from '@memnox/core';

import type { EditHookContext } from './edit-claims';
import { repositoryRootOf } from './seam-runtime';
import type { ToolAnswer } from './tool-hook';
import { refusalReply, type ToolReply } from './tool-policy';

/** Under this id the session remembers it was held, one repository apart from the next. */
const HELD_ID_PREFIX = 'fingerprint-hold:';

export const RECORD_FIRST = `Memnox: this repository does not yet state how its code is written, so record that before this first change. Call the memnox-session "fingerprint" tool without arguments for what to write, read enough of the code to answer it, and call it again with the yaml. Then make this change again. This is asked once a session: if the tool is not available, make the change again and it goes ahead.`;

/** The refusal for the session's first write in a repository with no fingerprint, or null. */
export async function fingerprintHold(
  ruled: ToolAnswer,
  context: EditHookContext,
  rootOf: (path: string) => string | null = repositoryRootOf,
): Promise<ToolReply | null> {
  const { call, ruling } = ruled;
  if (ruling.effect !== DECISION_EFFECT.ALLOW) return null;
  const sessionId = context.runSession ?? call.sessionId;
  if (sessionId === '') return null;
  // The session's repository, since a file about to be created has no folder to ask git in.
  const root = rootOf(call.cwd ?? context.cwd);
  if (root === null) return null;
  const inside = call.requests.some(
    (each) =>
      each.action === ACTION.FILESYSTEM_WRITE &&
      // Compared with `/`, so a write on Windows is placed in its repository too.
      slashed(each.target ?? '').startsWith(`${slashed(root)}/`),
  );
  if (!inside) return null;
  if ((await readCodeFingerprint(root).catch(() => null)) !== null) return null;

  const store = new SessionContextStore(context.home);
  const state = await store.read(sessionId);
  const id = `${HELD_ID_PREFIX}${root}`;
  if (notYetShown(state, [id]).length === 0) return null;
  await store.write(sessionId, markShown(state, [id], context.now().toISOString()));
  // In each host's own words, since every agent that writes can be sent to record one.
  return refusalReply(call.host, RECORD_FIRST);
}
