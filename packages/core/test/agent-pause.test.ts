import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DECISION_EFFECT } from '@memnox/core';
import { PolicyEngine } from '../src/policy/policy-engine';
import { overlaysInForce, writeOrgConditions } from '../src/policy/overlay-store';
import { stateLabelsOf } from '../src/policy/overlay';
import { AGENT_FROZEN_REASON } from '../src/policy/agent-freeze';
import {
  pauseAgentHere,
  resolveAgentName,
  resumeAgentHere,
  workspaceFreezeIds,
} from '../src/policy/agent-pause';
import type { Policy } from '../src/policy/policy';

const allowEverything: Policy = {
  name: 'allow-everything',
  match: { actions: ['*'] },
  decision: { effect: DECISION_EFFECT.ALLOW },
};

const NOW = '2026-10-23T10:00:00.000Z';

async function home(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'memnox-agent-pause-'));
}

/** What the gate does on every call: read the overlays from disk, then evaluate. */
async function next(dir: string, agentName: string, at = NOW): Promise<string> {
  const state = stateLabelsOf(await overlaysInForce(dir), at);
  return new PolicyEngine([allowEverything]).evaluate(
    { action: 'git.push' },
    { agentName, state },
  ).effect;
}

describe('pausing one agent on this machine', () => {
  it("refuses Codex's very next action and leaves Claude Code working, with no wait", async () => {
    const dir = await home();
    await pauseAgentHere(dir, { kind: 'codex-cli', now: NOW, said: 'pause Codex' });
    expect(await next(dir, 'codex-cli')).toBe(DECISION_EFFECT.DENY);
    expect(await next(dir, 'claude-code')).toBe(DECISION_EFFECT.ALLOW);
  });

  it('holds the agent under every name a seam runs it as', async () => {
    const dir = await home();
    await pauseAgentHere(dir, { kind: 'codex-cli', now: NOW });
    expect(await next(dir, 'codex')).toBe(DECISION_EFFECT.DENY);
    expect(await next(dir, 'agt_codex-cli')).toBe(DECISION_EFFECT.DENY);
  });

  it('tells the agent a person paused it and to wait', async () => {
    const dir = await home();
    await pauseAgentHere(dir, { kind: 'cursor', now: NOW });
    const result = new PolicyEngine([allowEverything]).evaluate(
      { action: 'filesystem.write' },
      { agentName: 'cursor', state: stateLabelsOf(await overlaysInForce(dir), NOW) },
    );
    expect(result.reason).toBe(AGENT_FROZEN_REASON);
    expect(result.reason).toMatch(/person paused this agent, so stop and wait/);
  });

  it('keeps one pause when asked twice', async () => {
    const dir = await home();
    const first = await pauseAgentHere(dir, { kind: 'codex-cli', now: NOW });
    const second = await pauseAgentHere(dir, { kind: 'codex-cli', now: NOW });
    expect(first.fresh).toBe(true);
    expect(second.fresh).toBe(false);
    expect(second.overlay.id).toBe(first.overlay.id);
  });

  it('lets it carry on the moment it is resumed, and only it', async () => {
    const dir = await home();
    await pauseAgentHere(dir, { kind: 'codex-cli', now: NOW });
    await pauseAgentHere(dir, { kind: 'cursor', now: NOW });
    const lifted = await resumeAgentHere(dir, 'codex-cli', NOW);
    expect(lifted).toHaveLength(1);
    expect(await next(dir, 'codex-cli')).toBe(DECISION_EFFECT.ALLOW);
    expect(await next(dir, 'cursor')).toBe(DECISION_EFFECT.DENY);
  });

  it('ends on its own, since a pause nobody resumed must not last for ever', async () => {
    const dir = await home();
    await pauseAgentHere(dir, { kind: 'codex-cli', now: NOW });
    const twoDaysOn = new Date(Date.parse(NOW) + 2 * 24 * 60 * 60_000).toISOString();
    expect(await next(dir, 'codex-cli', twoDaysOn)).toBe(DECISION_EFFECT.ALLOW);
  });

  it("finds the workspace's id for a freeze the console pressed on this agent", async () => {
    const dir = await home();
    await writeOrgConditions(dir, {
      syncedAt: Date.parse(NOW),
      conditions: [
        {
          id: 'st_9:agent:agt_codex-cli@m-1',
          kind: 'freeze',
          subject: 'agent:agt_codex-cli',
          fromAt: 0,
        },
        { id: 'st_8:agent:cursor', kind: 'freeze', subject: 'agent:cursor', fromAt: 0 },
      ],
    });
    expect(await workspaceFreezeIds(dir, 'codex-cli')).toEqual(['st_9']);
  });
});

describe('the agent a spoken name means', () => {
  it('reads the product a person says for its kind', () => {
    expect(resolveAgentName({ said: 'Codex' })).toEqual({ kind: 'codex-cli' });
    expect(resolveAgentName({ said: 'Claude Code' })).toEqual({ kind: 'claude-code' });
    expect(resolveAgentName({ said: 'the Cursor agent' })).toEqual({ kind: 'cursor' });
  });

  it('forgives a name heard a letter or two off', () => {
    expect(resolveAgentName({ said: 'kodex' })).toEqual({ kind: 'codex-cli' });
    expect(resolveAgentName({ said: 'windsurff' })).toEqual({ kind: 'windsurf' });
  });

  it('asks back when the name fits more than one agent', () => {
    const match = resolveAgentName({ said: 'Claude' });
    expect(match).toEqual({ ambiguous: ['claude-code', 'claude-desktop'] });
  });

  it('settles it by what is on this machine', () => {
    expect(
      resolveAgentName({ said: 'Claude', present: ['claude-code', 'cursor'] }),
    ).toEqual({
      kind: 'claude-code',
    });
  });

  it('knows an agent by the name the person gave it', () => {
    expect(
      resolveAgentName({
        said: 'backend coder',
        names: { 'codex-cli': 'Backend Coder' },
      }),
    ).toEqual({ kind: 'codex-cli' });
  });

  it('says so when no agent goes by the name', () => {
    expect(resolveAgentName({ said: 'spreadsheet' })).toEqual({ unknown: 'spreadsheet' });
  });
});
