import type { MemnoxEvent } from './event';

/** Enough of a host's helper id to tell two apart on one screen. */
const SHORT_ID = 8;

/**
 * Who handed the work down, as one line: the person where one is known, the agent, and
 * the helper it delegated to. Absent parts are left out rather than guessed.
 */
export function delegationChain(
  event: Pick<MemnoxEvent, 'agent' | 'principal' | 'subagent' | 'subagentType'>,
): string {
  const parts = [
    ...(event.principal === undefined ? [] : [event.principal]),
    event.agent,
    ...(event.subagent === undefined
      ? []
      : [helperOf(event.subagent, event.subagentType)]),
  ];
  return parts.join(' > ');
}

/** The helper alone, for a column too narrow for the whole chain. */
export function helperOf(subagent: string, type: string | undefined): string {
  const id = subagent.slice(0, SHORT_ID);
  return type === undefined ? `subagent ${id}` : `${type} subagent ${id}`;
}
