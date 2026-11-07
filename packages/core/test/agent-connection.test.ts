import { describe, expect, it } from 'vitest';
import {
  CONNECTION_KIND,
  CONNECTION_STATUS,
  connectionsFor,
  MEDIATION,
  mediationOf,
  type ConnectionEvidence,
} from '../src/index';

/**
 * A connection is how Memnox reaches an agent, read off what holds it here and never declared by
 * it: a seam in place is interposed, an MCP report is advisory, and anything else is only seen.
 */

const AT = '2026-11-07T10:00:00.000Z';

function evidence(over: Partial<ConnectionEvidence>): ConnectionEvidence {
  return {
    agentId: 'agt_claude-code',
    agentKind: 'claude-code',
    seam: 'hook',
    held: true,
    running: 0,
    firstSeen: AT,
    lastSeen: AT,
    ...over,
  };
}

describe('agent connections', () => {
  it('read an agent held by its own hook as interposed, and its default profile by kind', () => {
    const [connection] = connectionsFor([evidence({ running: 1 })], {});
    expect(connection).toMatchObject({
      id: 'con_claude-code',
      profileId: 'default-claude-code',
      kind: CONNECTION_KIND.RUNTIME_HOOK,
      agentId: 'agt_claude-code',
      mediation: MEDIATION.INTERPOSED,
      status: CONNECTION_STATUS.LIVE,
    });
  });

  it('read an agent whose seam is not in place as only observed', () => {
    const [connection] = connectionsFor([evidence({ held: false })], {});
    expect(connection?.kind).toBe(CONNECTION_KIND.OBSERVED);
    expect(connection?.mediation).toBe(MEDIATION.OBSERVED);
    expect(connection?.status).toBe(CONNECTION_STATUS.IDLE);
  });

  it('read the servers seam as the MCP proxy, and MCP reporting as advisory', () => {
    const [connection] = connectionsFor([evidence({ seam: 'servers' })], {});
    expect(connection?.kind).toBe(CONNECTION_KIND.RUNTIME_MCP_PROXY);
    expect(mediationOf(CONNECTION_KIND.MCP)).toBe(MEDIATION.ADVISORY);
    expect(mediationOf(CONNECTION_KIND.GUARD)).toBe(MEDIATION.INTERPOSED);
  });

  it('keep a bound agent on its profile, and a bound agent no longer found as gone', () => {
    const bindings = {
      'agt_claude-code': { profileId: 'reviewer', boundAt: AT },
      agt_cursor: { profileId: 'coder', boundAt: AT },
    };
    const connections = connectionsFor([evidence({})], bindings);
    expect(
      connections.map((each) => [each.agentId, each.profileId, each.status]),
    ).toEqual([
      ['agt_claude-code', 'reviewer', CONNECTION_STATUS.IDLE],
      ['agt_cursor', 'coder', CONNECTION_STATUS.GONE],
    ]);
  });
});
