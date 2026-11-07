import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CAPABILITY_LEVEL,
  CONNECTION_KIND,
  CONNECTION_STATUS,
  ENFORCEMENT_SEAM,
  MEDIATION,
  PROOF,
  PROOF_RECORD_VERSION,
  type AgentConnection,
  type ProofRecord,
} from '@memnox/core';
import { withLevels } from '../src/profiles/connection-levels';

/** A proof refusing on MCP for Claude Code, run against the path `path-a`. */
function provedHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'memnox-levels-'));
  mkdirSync(join(home, '.memnox'), { recursive: true });
  const record: ProofRecord = {
    version: PROOF_RECORD_VERSION,
    runtimeVersion: '0.0.0',
    modeApplied: 'enforce',
    provedAt: '2026-11-07T10:00:00.000Z',
    seamConfigDigest: 'path-a',
    seams: [{ seam: 'mcp', state: PROOF.ENFORCED, detail: 'refused', test: 'planted' }],
    agents: [
      {
        agentId: 'agt_claude-code',
        kind: 'claude-code',
        installed: ['mcp'],
        tested: ['mcp'],
        demonstrated: ['mcp'],
      },
    ],
  };
  writeFileSync(join(home, '.memnox', 'proof.json'), JSON.stringify(record));
  return home;
}

const HOOKED: AgentConnection = {
  id: 'con_1',
  profileId: 'default-claude-code',
  kind: CONNECTION_KIND.RUNTIME_HOOK,
  agentKind: 'claude-code',
  agentId: 'agt_claude-code',
  mediation: MEDIATION.INTERPOSED,
  firstSeen: '2026-11-07T09:00:00.000Z',
  lastSeen: '2026-11-07T10:00:00.000Z',
  status: CONNECTION_STATUS.LIVE,
};

async function mcpLevel(home: string, digest: string): Promise<string | undefined> {
  const [connection] = await withLevels(home, [HOOKED], new Map(), async () => digest);
  return connection?.levels?.enforcement[ENFORCEMENT_SEAM.MCP];
}

describe('connection levels against the last proof', () => {
  it('read enforced while the installed path is the one the proof ran against', async () => {
    expect(await mcpLevel(provedHome(), 'path-a')).toBe(CAPABILITY_LEVEL.ENFORCED);
  });

  it('drop to checked once the path changed after the proof', async () => {
    expect(await mcpLevel(provedHome(), 'path-b')).toBe(CAPABILITY_LEVEL.MEDIATED);
  });

  it('never scan where no proof ran', async () => {
    const home = mkdtempSync(join(tmpdir(), 'memnox-levels-none-'));
    let scanned = false;
    await withLevels(home, [HOOKED], new Map(), async () => {
      scanned = true;
      return 'path-a';
    });
    expect(scanned).toBe(false);
  });
});
