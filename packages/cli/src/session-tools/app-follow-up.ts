import { basename } from 'node:path';
import {
  DESKTOP_APPS,
  isStartableAgent,
  type SessionHost,
  type SpokenInstruction,
} from '@memnox/core';
import { isDesktopSessionId } from '../daemon/desktop-sessions';
import { typeInAppTool } from './app-tools';
import type { SessionToolDeps } from './read-tools';
import {
  APP_BUNDLE_SUFFIX,
  APP_SESSION_PREFIX,
  TOOL_ARG,
} from './session-tools.constants';

/** How a follow up typed into a desktop app's own chat is reported. */
export const HOW_IN_APP = 'typed in its app';

/**
 * A follow up for a session that lives in its desktop app, typed there where the person watches, since
 * no hook of Memnox's reads a note queued for it; null when the session lives anywhere else, or is
 * working where a hook will hand it over at its next step.
 */
export async function typedInItsApp(
  deps: SessionToolDeps,
  instruction: SpokenInstruction,
  host: SessionHost | null,
  waiting: boolean,
): Promise<Record<string, unknown> | null> {
  if (!inItsDesktopApp(instruction, host)) return null;
  if (!waiting && !keptByItsApp(instruction.sessionId)) return null;
  const typed = await typeInAppTool(deps, {
    [TOOL_ARG.AGENT]: instruction.agent,
    message: instruction.message,
  });
  const result = typeof typed === 'object' && typed !== null ? typed : {};
  // Reported the way every other route reports it, so a phone's follow up reads it as sent.
  const sent = (result as { typed?: unknown }).typed === true;
  return { session: instruction.sessionId, how: HOW_IN_APP, ...result, sent };
}

/** A session only its desktop app keeps, read from the app or started there by voice, which no hook ever drains a note for. */
function keptByItsApp(sessionId: string): boolean {
  return isDesktopSessionId(sessionId) || sessionId.startsWith(APP_SESSION_PREFIX);
}

/**
 * Whether the session lives in its agent's desktop app rather than a terminal or an editor: one the app keeps
 * itself, or one whose window is the app's own, such as the Codex app rather than codex in a terminal.
 */
function inItsDesktopApp(
  instruction: SpokenInstruction,
  host: SessionHost | null,
): boolean {
  if (!isStartableAgent(instruction.agent)) return false;
  if (keptByItsApp(instruction.sessionId)) return true;
  if (host === null || host.tty !== undefined || host.panel === true) return false;
  const app = (host.app ?? basename(host.appPath ?? '', APP_BUNDLE_SUFFIX)).toLowerCase();
  return app !== '' && app === DESKTOP_APPS[instruction.agent].name.toLowerCase();
}
