import { describe, expect, it } from 'vitest';
import {
  ACTION,
  ACTOR_TYPE,
  DECISION_EFFECT,
  ENFORCEMENT_MODE,
  EVENT_SCHEMA_VERSION,
  EVENT_SURFACE,
  EXTERNAL_KIND,
  externalContacts,
  TOOL_CLASS,
  WEB_SEARCH_NAME,
  type EventSurface,
  type MemnoxEvent,
} from '../src/index';

function row(
  at: string,
  surface: EventSurface,
  operation: string,
  target?: string,
  effect: MemnoxEvent['effect'] = DECISION_EFFECT.ALLOW,
): MemnoxEvent {
  return {
    id: `evt_${at}`,
    schemaVersion: EVENT_SCHEMA_VERSION,
    at,
    sessionId: 'ses_1',
    agent: 'claude-code',
    actorType: ACTOR_TYPE.AGENT,
    surface,
    operation,
    ...(target === undefined ? {} : { target }),
    class: TOOL_CLASS.READ,
    effect,
    mode: ENFORCEMENT_MODE.OBSERVE,
    reason: 'recorded',
  };
}

describe('what a session reached outside the machine', () => {
  it('groups fetches by host, newest first, and counts what the rules held', () => {
    const contacts = externalContacts([
      row(
        '2026-10-01T10:00:00Z',
        EVENT_SURFACE.NETWORK,
        ACTION.HTTP_REQUEST,
        'docs.stripe.com',
      ),
      row(
        '2026-10-01T10:05:00Z',
        EVENT_SURFACE.NETWORK,
        ACTION.HTTP_REQUEST,
        'api.github.com',
      ),
      row(
        '2026-10-01T10:06:00Z',
        EVENT_SURFACE.NETWORK,
        ACTION.HTTP_REQUEST,
        'docs.stripe.com',
        DECISION_EFFECT.DENY,
      ),
    ]);
    expect(contacts.map((each) => [each.name, each.count, each.refused])).toEqual([
      ['docs.stripe.com', 2, 1],
      ['api.github.com', 1, 0],
    ]);
    expect(contacts[0]?.firstAt).toBe('2026-10-01T10:00:00Z');
  });

  it('names one MCP server the same way whether a hook or the proxy recorded it', () => {
    const contacts = externalContacts([
      row('2026-10-01T10:00:00Z', EVENT_SURFACE.MCP, 'mcp.github.list_issues'),
      row('2026-10-01T10:01:00Z', EVENT_SURFACE.MCP, 'github.get_issue'),
    ]);
    expect(contacts).toHaveLength(1);
    expect(contacts[0]).toMatchObject({
      kind: EXTERNAL_KIND.MCP,
      name: 'github',
      count: 2,
      operations: ['list_issues', 'get_issue'],
    });
  });

  it('files a search under its own name and leaves local work out', () => {
    const contacts = externalContacts([
      row('2026-10-01T10:00:00Z', EVENT_SURFACE.NETWORK, ACTION.HTTP_REQUEST),
      row(
        '2026-10-01T10:01:00Z',
        EVENT_SURFACE.FILESYSTEM,
        ACTION.FILESYSTEM_WRITE,
        '/repo/a.ts',
      ),
      row(
        '2026-10-01T10:02:00Z',
        EVENT_SURFACE.SHELL,
        ACTION.BROWSER_NAVIGATE,
        'example.com',
      ),
    ]);
    expect(contacts.map((each) => [each.kind, each.name])).toEqual([
      [EXTERNAL_KIND.BROWSER, 'example.com'],
      [EXTERNAL_KIND.WEB, WEB_SEARCH_NAME],
    ]);
  });
});
