import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DECISION_EFFECT,
  MEMNOX_HOME,
  Milestones,
  NodeGit,
  NodeWorktree,
  overlaysInForce,
  PolicyEngine,
  Proposals,
  readOrgConditions,
  SessionTurns,
  stateLabelsOf,
  writeAccount,
  writeJsonFile,
  writeOrgConditions,
  type Policy,
} from '@memnox/core';
import { pauseAgent, resumeAgent } from '../src/agents/agent-pause';
import { CliContext } from '../src/cli-context';
import { RecordedOutput } from '../src/cli-output';
import { buildProgram } from '../src/program';
import { plainStyle } from '../src/style';
import { CloudUnreachable } from '../src/sync/client';
import type { CloudCall } from '../src/sync/agent-pause-cloud';
import { isThisAgent } from '../src/session-tools/agent-pause-tools';
import { callOperatorTool } from '../src/session-tools/operator-tools';
import type { SessionToolDeps } from '../src/session-tools/read-tools';
import type { RewindSeams } from '../src/session-tools/rewind-tool';

const NOW = new Date('2026-10-23T10:00:00.000Z');

const allowEverything: Policy = {
  name: 'allow-everything',
  match: { actions: ['*'] },
  decision: { effect: DECISION_EFFECT.ALLOW },
};

async function home(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'memnox-pause-agent-'));
}

/** Enrolled, and the person signed in here, both in one workspace. */
async function enrolled(dir: string): Promise<void> {
  await writeAccount(dir, {
    version: 1,
    baseUrl: 'https://cloud.example',
    workspaceId: 'ws_1',
    machineId: 'm-laptop',
    token: 'machine-token',
    privateKey: 'unused',
    enrolledAt: NOW.toISOString(),
  });
  await writeJsonFile(join(dir, MEMNOX_HOME, 'person.json'), {
    baseUrl: 'https://cloud.example',
    token: 'person-token',
    personId: 'p_1',
    name: 'Ada',
    workspaceId: 'ws_1',
    deviceId: 'd_1',
    privateKey: 'unused',
  });
}

interface Sent {
  path: string;
  method?: string;
  token?: string;
  body?: unknown;
}

function recording(answer: (sent: Sent) => { status: number; body?: unknown }): {
  call: CloudCall;
  sent: Sent[];
} {
  const sent: Sent[] = [];
  const call = (async (request: Sent) => {
    sent.push(request);
    return answer(request);
  }) as CloudCall;
  return { call, sent };
}

const unreachable = (async () => {
  throw new CloudUnreachable('offline');
}) as CloudCall;

async function effectFor(dir: string, agentName: string): Promise<string> {
  const state = stateLabelsOf(await overlaysInForce(dir), NOW.toISOString());
  return new PolicyEngine([allowEverything]).evaluate(
    { action: 'git.push' },
    { agentName, state },
  ).effect;
}

describe('pausing an agent and telling the workspace', () => {
  it('pauses here first and declares the freeze on the machine route, on its own credential', async () => {
    const dir = await home();
    await enrolled(dir);
    const { call, sent } = recording(() => ({ status: 201, body: { id: 'st_1' } }));
    const paused = await pauseAgent(
      { home: dir, now: () => NOW, call },
      'codex-cli',
      'pause Codex',
    );
    expect(paused.workspace).toEqual({ outcome: 'told', conditionId: 'st_1' });
    expect(sent[0]?.path).toBe('/v1/workspaces/ws_1/state/machine-freezes');
    expect(sent[0]?.token).toBe('machine-token');
    // The cloud pins the machine from the credential, so the body never names one.
    expect(sent[0]?.body).toEqual({
      agents: ['agt_codex-cli'],
      value: expect.any(String),
      validUntil: expect.any(String),
    });
  });

  it('tells the workspace with nobody signed in, since the machine speaks for itself', async () => {
    const dir = await home();
    await enrolled(dir);
    await rm(join(dir, MEMNOX_HOME, 'person.json'));
    const { call, sent } = recording(() => ({ status: 201, body: { id: 'st_9' } }));
    const paused = await pauseAgent({ home: dir, now: () => NOW, call }, 'cursor');
    expect(paused.workspace).toEqual({ outcome: 'told', conditionId: 'st_9' });
    expect(sent[0]?.token).toBe('machine-token');
  });

  it('says the workspace still holds a freeze this machine did not declare', async () => {
    const dir = await home();
    await enrolled(dir);
    await writeOrgConditions(dir, {
      syncedAt: NOW.getTime(),
      conditions: [
        {
          id: 'st_3:agent:agt_codex-cli@m-laptop',
          kind: 'freeze',
          subject: 'agent:agt_codex-cli',
          fromAt: 0,
        },
      ],
    });
    const { call } = recording(() => ({
      status: 404,
      body: { message: 'That condition no longer exists.' },
    }));
    const resumed = await resumeAgent({ home: dir, now: () => NOW, call }, 'codex-cli');
    expect(resumed.workspace).toEqual([
      { outcome: 'refused', said: 'That condition no longer exists.' },
    ]);
    expect(await effectFor(dir, 'codex-cli')).toBe(DECISION_EFFECT.DENY);
  });

  it('keeps the pause when the workspace cannot be reached', async () => {
    const dir = await home();
    await enrolled(dir);
    const paused = await pauseAgent(
      { home: dir, now: () => NOW, call: unreachable },
      'codex-cli',
    );
    expect(paused.workspace.outcome).toBe('unreachable');
    expect(await effectFor(dir, 'codex-cli')).toBe(DECISION_EFFECT.DENY);
    expect(await effectFor(dir, 'claude-code')).toBe(DECISION_EFFECT.ALLOW);
  });

  it('pauses only here on a machine with no workspace, and sends nothing', async () => {
    const dir = await home();
    const { call, sent } = recording(() => ({ status: 201 }));
    const paused = await pauseAgent({ home: dir, now: () => NOW, call }, 'cursor');
    expect(paused.workspace.outcome).toBe('no workspace');
    expect(sent).toHaveLength(0);
    expect(await effectFor(dir, 'cursor')).toBe(DECISION_EFFECT.DENY);
  });

  it('lifts both on resume, and drops the pulled freeze at once rather than at the next beat', async () => {
    const dir = await home();
    await enrolled(dir);
    const { call, sent } = recording((request) =>
      request.path.endsWith('/lift')
        ? { status: 200 }
        : { status: 201, body: { id: 'st_1' } },
    );
    await pauseAgent({ home: dir, now: () => NOW, call }, 'codex-cli');
    // As the next heartbeat would have pulled it back down.
    await writeOrgConditions(dir, {
      syncedAt: NOW.getTime(),
      conditions: [
        {
          id: 'st_1:agent:agt_codex-cli@m-laptop',
          kind: 'freeze',
          subject: 'agent:agt_codex-cli',
          fromAt: 0,
        },
      ],
    });
    const resumed = await resumeAgent({ home: dir, now: () => NOW, call }, 'codex-cli');
    expect(resumed.liftedHere).toBe(1);
    expect(sent.at(-1)?.path).toBe('/v1/workspaces/ws_1/state/machine-freezes/st_1/lift');
    expect(sent.at(-1)?.token).toBe('machine-token');
    expect(await readOrgConditions(dir)).toEqual([]);
    expect(await effectFor(dir, 'codex-cli')).toBe(DECISION_EFFECT.ALLOW);
  });

  it('says the workspace still holds it when the lift there fails', async () => {
    const dir = await home();
    await enrolled(dir);
    await writeOrgConditions(dir, {
      syncedAt: NOW.getTime(),
      conditions: [
        {
          id: 'st_2:agent:agt_codex-cli',
          kind: 'freeze',
          subject: 'agent:agt_codex-cli',
          fromAt: 0,
        },
      ],
    });
    const resumed = await resumeAgent(
      { home: dir, now: () => NOW, call: unreachable },
      'codex-cli',
    );
    expect(resumed.workspace).toEqual([{ outcome: 'unreachable' }]);
    expect(await effectFor(dir, 'codex-cli')).toBe(DECISION_EFFECT.DENY);
  });
});

const SEAMS: RewindSeams = {
  build: (place) => new Milestones(new NodeGit(place), new NodeWorktree(place)),
  unattended: () => true,
  terminal: () => false,
  confirm: async () => null,
};

async function depsAt(dir: string): Promise<SessionToolDeps> {
  return {
    home: dir,
    cwd: dir,
    agent: 'unknown-agent',
    env: {},
    now: () => NOW,
    readStatus: async () => ({ mode: 'enforce' }),
    milestonesAt: async () => [],
    brief: async () => null,
  };
}

describe('pausing an agent by voice', () => {
  it('pauses Codex at once and leaves Claude Code working', async () => {
    const dir = await home();
    const answer = (await callOperatorTool(await depsAt(dir), SEAMS, 'pause_agent', {
      agent: 'Codex',
      said: 'pause Codex',
    })) as Record<string, unknown>;
    expect(answer['paused']).toBe(true);
    expect(answer['agent']).toBe('codex-cli');
    expect(await effectFor(dir, 'codex-cli')).toBe(DECISION_EFFECT.DENY);
    expect(await effectFor(dir, 'claude-code')).toBe(DECISION_EFFECT.ALLOW);
  });

  it('asks back rather than pausing when the name fits two agents', async () => {
    const dir = await home();
    const answer = (await callOperatorTool(await depsAt(dir), SEAMS, 'pause_agent', {
      agent: 'Claude',
    })) as Record<string, unknown>;
    expect(answer['paused']).toBe(false);
    expect(answer['candidates']).toEqual(['claude-code', 'claude-desktop']);
    expect(await effectFor(dir, 'claude-code')).toBe(DECISION_EFFECT.ALLOW);
  });

  it('proposes the resume for Touch ID rather than lifting it', async () => {
    const dir = await home();
    const deps = await depsAt(dir);
    await callOperatorTool(deps, SEAMS, 'pause_agent', { agent: 'Cursor' });
    const answer = (await callOperatorTool(deps, SEAMS, 'propose_agent_resume', {
      agent: 'Cursor',
    })) as Record<string, unknown>;
    const proposal = await new Proposals(dir).read(String(answer['proposed']));
    expect(proposal?.change).toEqual({
      kind: 'command',
      argv: ['agents', 'resume', 'cursor'],
    });
    expect(await effectFor(dir, 'cursor')).toBe(DECISION_EFFECT.DENY);
  });

  it("interrupts only that agent's sessions, under any name a session records", async () => {
    const dir = await home();
    const turns = new SessionTurns(dir);
    await turns.prompted('s-codex', 'codex', NOW.toISOString());
    await turns.prompted('s-claude', 'claude-code', NOW.toISOString());
    const all = await turns.all();
    expect(
      all.filter((turn) => isThisAgent(turn, 'codex-cli')).map((t) => t.sessionId),
    ).toEqual(['s-codex']);
  });
});

describe('memnox agents --help', () => {
  it('offers pause and resume for one agent', async () => {
    const program = buildProgram(new CliContext(new RecordedOutput(), plainStyle));
    let written = '';
    program.configureOutput({
      writeOut: (text) => {
        written += text;
      },
    });
    program.exitOverride();
    try {
      await program.parseAsync(['agents', '--help'], { from: 'user' });
    } catch {
      // `--help` exits through the override once it has written, which is the run under test.
    }
    expect(written).toMatch(/pause \[options\] <agent>/);
    expect(written).toMatch(/resume \[options\] <agent>/);
  });
});
