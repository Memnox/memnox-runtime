import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ConfirmKeys,
  confirmationMessage,
  DisplayRequests,
  PROPOSAL_KIND,
  Proposals,
  readPolicyRegistry,
  SessionTurns,
  sessionTrace,
  summarizeTrace,
  TraceStore,
  waterfall,
  type MemnoxEvent,
} from '@memnox/core';
import { confirmAnswer } from '../src/daemon/confirm';
import { NoticeWatcher } from '../src/daemon/notice-watch';
import { callOperatorTool } from '../src/session-tools/operator-tools';
import { commandResults } from '../src/session-tools/voice-commands';
import type { SessionToolDeps } from '../src/session-tools/read-tools';
import type { RewindSeams } from '../src/session-tools/rewind-tool';
import {
  argumentsOf,
  voiceCommand,
  type CommandRun,
} from '../src/session-tools/voice-commands';
import { toOtlp, otlpEndpoint, otlpHeaders } from '../src/trace/otlp';
import { VoiceTurnTrace } from '../src/trace/voice-trace';

/**
 * Every memnox command by voice, and the traces that show what ran: an agent's session, and
 * Memnox itself answering the person.
 */

const NOW = new Date('2026-10-02T12:00:00.000Z');

const SEAMS: RewindSeams = {
  build: () => {
    throw new Error('no milestones here');
  },
  unattended: () => true,
  terminal: () => false,
  confirm: async () => null,
};

async function depsAt(ran: string[][] = []): Promise<SessionToolDeps> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-observe-'));
  return {
    home,
    cwd: home,
    agent: 'claude-code',
    env: {},
    now: () => NOW,
    readStatus: async () => ({ mode: 'observe' }),
    milestonesAt: async () => [],
    brief: async () => null,
    runMemnox: async (argv): Promise<CommandRun> => {
      ran.push([...argv]);
      return { exitCode: 0, output: `ran ${argv.join(' ')}` };
    },
  };
}

describe('what a voice may run', () => {
  it('runs what reads at once, asks Touch ID for what changes, and never runs a few', () => {
    expect(voiceCommand('status')?.run).toBe('now');
    expect(voiceCommand('memnox timeline --since 1h')?.argv).toEqual([
      'timeline',
      '--since',
      '1h',
    ]);
    expect(voiceCommand('lock --list')?.run).toBe('now');
    expect(voiceCommand('lock src/billing')?.run).toBe('confirm');
    expect(voiceCommand('mode autonomous')?.run).toBe('confirm');
    // A reading command turned into one that writes, or one that sends a trace off the Mac.
    expect(voiceCommand('doctor --fix')?.run).toBe('confirm');
    expect(voiceCommand('traces last --otlp')?.run).toBe('confirm');
    expect(voiceCommand('approve apr_1')).toMatchObject({
      run: 'never',
      why: expect.stringContaining('propose_answer'),
    });
    expect(voiceCommand('uninstall')?.run).toBe('never');
    // Signing in changes what this Mac talks to, so it waits for Touch ID like any change.
    expect(voiceCommand('memnox login')?.run).toBe('confirm');
    // Registering a rule file can loosen as well as tighten, so it is never a read.
    expect(voiceCommand('policy test "git push"')?.run).toBe('now');
    expect(voiceCommand('policy use ~/work/memnox.policies.toml')?.run).toBe('confirm');
    expect(voiceCommand('rm -rf /')).toBeNull();
  });

  it('splits words the way a shell would, with no shell to read them', () => {
    expect(argumentsOf(`explain "can claude push" --json`)).toEqual([
      'explain',
      'can claude push',
      '--json',
    ]);
    expect(argumentsOf(`status; rm -rf ~`)).toEqual(['status;', 'rm', '-rf', '~']);
  });
});

describe('a rule asked for by voice', () => {
  it('is registered once confirmed, so every seam loads it and not only policy test', async () => {
    const deps = await depsAt();
    const project = await mkdtemp(join(tmpdir(), 'memnox-voice-project-'));
    const { proposed, rule } = (await callOperatorTool(deps, SEAMS, 'propose_rule', {
      action: 'git push',
      effect: 'ask',
      project,
    })) as { proposed: string; rule: { file: string } };
    expect(
      await confirmAnswer(deps.home, {
        subject: proposed,
        answer: 'confirmed',
        signature: await signedBy(deps.home, proposed),
        at: NOW.toISOString(),
      }),
    ).toMatchObject({ ok: true });
    expect(
      await readPolicyRegistry(join(deps.home, '.memnox', 'policies.json')),
    ).toContain(rule.file);
  });
});

describe('a rule for a project folder that is not there', () => {
  it('is refused before anything is put to Touch ID', async () => {
    const deps = await depsAt();
    expect(
      await callOperatorTool(deps, SEAMS, 'propose_rule', {
        action: 'git push',
        effect: 'ask',
        project: join(deps.home, 'misheard-project'),
      }),
    ).toMatchObject({ refused: expect.stringContaining('not a folder') });
    expect(await new Proposals(deps.home).open(NOW.toISOString())).toEqual([]);
  });
});

describe('closing a session by voice', () => {
  it('never cuts off a turn in progress, and closes one that handed back', async () => {
    const deps = await depsAt();
    const turns = new SessionTurns(deps.home);
    await turns.prompted('ses_a', 'claude-code', '2026-10-02T11:59:00.000Z');
    const close = { session: 'ses_a', display: 'close' };
    const closing = {
      ...deps,
      delivered: async () => ({ outcome: 'typed' as const, at: NOW.toISOString() }),
    };
    expect(await callOperatorTool(closing, SEAMS, 'show', close)).toMatchObject({
      closed: false,
    });
    expect(await new DisplayRequests(deps.home).open(NOW.toISOString())).toEqual([]);

    await turns.ended('ses_a', 'claude-code', '2026-10-02T11:59:30.000Z');
    expect(await callOperatorTool(closing, SEAMS, 'show', close)).toMatchObject({
      closed: true,
    });
    const [request] = await new DisplayRequests(deps.home).open(NOW.toISOString());
    expect(request).toMatchObject({ display: 'close', sessionId: 'ses_a' });
  });
});

describe('closing a session mid turn because they said to', () => {
  it('asks once, then closes it now on their say so', async () => {
    const deps = await depsAt();
    await new SessionTurns(deps.home).prompted(
      'ses_a',
      'claude-code',
      '2026-10-02T11:59:00.000Z',
    );
    const closing = {
      ...deps,
      delivered: async () => ({ outcome: 'typed' as const, at: NOW.toISOString() }),
    };
    const asked = (await callOperatorTool(closing, SEAMS, 'show', {
      session: 'ses_a',
      display: 'close',
    })) as { closed: boolean; said: string };
    expect(asked.closed).toBe(false);
    expect(asked.said).toContain('now "true"');
    expect(
      await callOperatorTool(closing, SEAMS, 'show', {
        session: 'ses_a',
        display: 'close',
        now: 'true',
      }),
    ).toMatchObject({ closed: true });
    const [request] = await new DisplayRequests(deps.home).open(NOW.toISOString());
    expect(request).toMatchObject({ display: 'close', sessionId: 'ses_a' });
  });
});

describe('running memnox by voice', () => {
  it('signs in with one Touch ID, runs on its own, and tells the person when it ends', async () => {
    const ran: string[][] = [];
    let finish: (run: CommandRun) => void = () => undefined;
    const deps = { ...(await depsAt()), machineName: () => 'Studio Mac' };
    const { proposed, said } = (await callOperatorTool(deps, SEAMS, 'memnox_command', {
      command: 'login',
    })) as { proposed: string; said: string };
    expect(said).toContain('browser');
    expect((await new Proposals(deps.home).read(proposed))?.change).toEqual({
      kind: PROPOSAL_KIND.COMMAND,
      argv: ['login', '--name', 'Studio Mac'],
    });

    // Started before the wall clock the run stamps its end with, whatever day the suite runs.
    const watcher = new NoticeWatcher(deps.home, '2000-01-01T00:00:00.000Z');
    const confirmed = await confirmAnswer(deps.home, {
      subject: proposed,
      answer: 'confirmed',
      signature: await signedBy(deps.home, proposed),
      at: NOW.toISOString(),
      run: (argv) => {
        ran.push([...argv]);
        return new Promise<CommandRun>((resolve) => {
          finish = resolve;
        });
      },
    });
    // The confirmation ends while the login still waits on the browser, said as started, never done.
    expect(confirmed).toMatchObject({ ok: true, outcome: 'started' });
    expect(ran).toEqual([['login', '--name', 'Studio Mac']]);
    expect(
      await callOperatorTool(deps, SEAMS, 'command_output', { proposal: proposed }),
    ).toMatchObject({ running: true });
    expect(await watcher.look(NOW.toISOString())).toEqual([]);

    finish({ exitCode: 0, output: 'This machine is enrolled.' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const [told] = await watcher.look(NOW.toISOString());
    // A login that worked needs nobody, so it is shown rather than said.
    expect(told).toMatchObject({ kind: 'notice', notice: 'ended' });
    expect(told?.summary).toContain('it worked');
    expect(await watcher.look(NOW.toISOString())).toEqual([]);
  });

  it('tells an onboarding that ended by the agents it names, and the one still running as running', async () => {
    const deps = await depsAt();
    const results = commandResults(deps.home);
    await results.write('prp_a', {
      exitCode: 0,
      output: 'onboarded',
      argv: ['agents', 'onboard', 'claude-code', 'cursor'],
      at: '2026-09-30T11:00:00.000Z',
      doneAt: '2026-09-30T11:01:00.000Z',
    });
    await results.write('prp_b', {
      exitCode: 0,
      output: '',
      argv: ['agents', 'onboard', 'codex-cli'],
      at: '2026-09-30T11:00:00.000Z',
      running: true,
    });
    const watcher = new NoticeWatcher(deps.home, '2000-01-01T00:00:00.000Z');
    const told = await watcher.look(NOW.toISOString());
    expect(told).toHaveLength(1);
    expect(told[0]?.summary).toContain('Onboarding claude-code, cursor is done');
    expect(told[0]?.summary).toContain(
      'Still running, not done yet: Onboarding codex-cli',
    );
  });

  it('says a command that failed, since that is the one ending that needs the person', async () => {
    const deps = await depsAt();
    await commandResults(deps.home).write('prp_failed', {
      exitCode: 1,
      output: 'enrolling\nthe control plane refused this machine',
      argv: ['login'],
      at: '2026-09-30T11:00:00.000Z',
      doneAt: '2026-09-30T11:01:00.000Z',
    });
    const [told] = await new NoticeWatcher(deps.home, '2000-01-01T00:00:00.000Z').look(
      NOW.toISOString(),
    );
    expect(told).toMatchObject({ kind: 'notice', notice: 'watched' });
    expect(told?.summary).toContain('the control plane refused this machine');
  });

  it('runs a reading command at once and hands back what it printed', async () => {
    const ran: string[][] = [];
    const deps = await depsAt(ran);
    expect(
      await callOperatorTool(deps, SEAMS, 'memnox_command', {
        command: 'timeline --since 1h',
      }),
    ).toMatchObject({ ran: true, exitCode: 0, output: 'ran timeline --since 1h' });
    expect(ran).toEqual([['timeline', '--since', '1h']]);
  });

  it('only proposes what changes something, then runs it once Touch ID signs for it', async () => {
    const ran: string[][] = [];
    const deps = await depsAt(ran);
    const { proposed } = (await callOperatorTool(deps, SEAMS, 'memnox_command', {
      command: 'mode autonomous',
    })) as { proposed: string };
    expect(ran).toEqual([]);
    expect((await new Proposals(deps.home).read(proposed))?.change).toEqual({
      kind: PROPOSAL_KIND.COMMAND,
      argv: ['mode', 'autonomous'],
    });

    const { publicKey, privateKey } = generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
    });
    const spki = publicKey.export({ format: 'der', type: 'spki' });
    await new ConfirmKeys(deps.home).register(
      spki.subarray(spki.length - 65).toString('base64'),
      NOW.toISOString(),
    );
    const signature = sign(
      'sha256',
      Buffer.from(confirmationMessage(proposed, 'confirmed')),
      privateKey,
    ).toString('base64');
    const run = deps.runMemnox;
    expect(run).toBeDefined();
    expect(
      await confirmAnswer(deps.home, {
        subject: proposed,
        answer: 'confirmed',
        signature,
        at: '2026-10-02T12:00:10.000Z',
        ...(run === undefined ? {} : { run }),
      }),
    ).toMatchObject({ ok: true });
    expect(ran).toEqual([['mode', 'autonomous']]);
    expect(
      await callOperatorTool(deps, SEAMS, 'command_output', { proposal: proposed }),
    ).toMatchObject({
      ran: true,
      output: 'ran mode autonomous',
    });
  });

  it('says why, rather than running, what never runs by voice', async () => {
    const ran: string[][] = [];
    const deps = await depsAt(ran);
    expect(
      await callOperatorTool(deps, SEAMS, 'memnox_command', { command: 'approve apr_1' }),
    ).toMatchObject({ ran: false });
    expect(ran).toEqual([]);
  });

  it('refuses a proposal written by hand to run what a voice never may', async () => {
    const deps = await depsAt();
    const proposal = await new Proposals(deps.home).propose({
      change: { kind: PROPOSAL_KIND.COMMAND, argv: ['approve', 'apr_1'] },
      rationale: 'x',
      proposedBy: 'someone',
      at: NOW.toISOString(),
      ttlMs: 60_000,
    });
    const { publicKey, privateKey } = generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
    });
    const spki = publicKey.export({ format: 'der', type: 'spki' });
    await new ConfirmKeys(deps.home).register(
      spki.subarray(spki.length - 65).toString('base64'),
      NOW.toISOString(),
    );
    const signature = sign(
      'sha256',
      Buffer.from(confirmationMessage(proposal.id, 'confirmed')),
      privateKey,
    ).toString('base64');
    expect(
      await confirmAnswer(deps.home, {
        subject: proposal.id,
        answer: 'confirmed',
        signature,
        at: NOW.toISOString(),
      }),
    ).toMatchObject({ ok: false });
  });
});

/** A confirmation key registered here, and its signature over a confirmed answer to the proposal. */
async function signedBy(home: string, proposal: string): Promise<string> {
  const { publicKey, privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  });
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  await new ConfirmKeys(home).register(
    spki.subarray(spki.length - 65).toString('base64'),
    NOW.toISOString(),
  );
  return sign(
    'sha256',
    Buffer.from(confirmationMessage(proposal, 'confirmed')),
    privateKey,
  ).toString('base64');
}

function event(over: Partial<MemnoxEvent>): MemnoxEvent {
  return {
    id: `evt_${over.at ?? ''}`,
    schemaVersion: 1,
    at: '2026-10-02T11:00:00.000Z',
    sessionId: 'ses_1',
    agent: 'claude-code',
    actorType: 'agent',
    surface: 'shell',
    operation: 'shell.execute',
    class: 'write',
    effect: 'allow',
    mode: 'enforce',
    reason: 'no rule matched',
    ...over,
  };
}

describe('an agent session as a trace', () => {
  it('nests each action under the turn it ran in, with its decision, time and exit', () => {
    const spans = sessionTrace(
      'ses_1',
      [
        event({ at: '2026-10-02T11:00:05.000Z', durationMs: 3_000, exitCode: 0 }),
        event({
          at: '2026-10-02T11:00:10.000Z',
          durationMs: 9_000,
          exitCode: 1,
          operation: 'npm.test',
        }),
        event({
          at: '2026-10-02T11:00:30.000Z',
          effect: 'deny',
          operation: 'git.push',
          reason: 'pushing to main needs a person',
        }),
      ],
      {
        sessionId: 'ses_1',
        agent: 'claude-code',
        windows: [
          { promptAt: '2026-10-02T11:00:00.000Z', endedAt: '2026-10-02T11:01:00.000Z' },
        ],
      },
    );
    const rows = waterfall(spans);
    expect(rows.map((row) => [row.span.name, row.depth])).toEqual([
      ['session claude-code', 0],
      ['turn 1', 1],
      ['shell.execute', 2],
      ['npm.test', 2],
      ['git.push', 2],
    ]);
    expect(rows.map((row) => row.span.status)).toEqual([
      'error',
      'ok',
      'ok',
      'error',
      'refused',
    ]);
    expect(summarizeTrace(spans)).toMatchObject({
      errors: 2,
      refused: 1,
      slowest: { name: 'turn 1', durationMs: 60_000 },
    });
  });
});

describe('sending a trace to Logfire or any collector', () => {
  it('writes OTLP with ids of the sizes it wants and errors marked as errors', () => {
    const [span] = sessionTrace(
      'ses_1',
      [event({ exitCode: 2, durationMs: 1_500 })],
      null,
    ).slice(1);
    const payload = toOtlp(span === undefined ? [] : [span]);
    const otlp = payload.resourceSpans[0]?.scopeSpans[0]?.spans[0] as {
      traceId: string;
      spanId: string;
      startTimeUnixNano: string;
      status: { code: number };
    };
    expect(otlp.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(otlp.spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(otlp.startTimeUnixNano).toBe(
      `${Date.parse('2026-10-02T11:00:00.000Z')}000000`,
    );
    expect(otlp.status.code).toBe(2);
  });

  it('goes only where it is told, by flag or by the standard variables', () => {
    expect(otlpEndpoint(undefined, {})).toBeNull();
    expect(
      otlpEndpoint(undefined, {
        OTEL_EXPORTER_OTLP_ENDPOINT: 'https://logfire-api.pydantic.dev/',
      }),
    ).toBe('https://logfire-api.pydantic.dev/v1/traces');
    expect(
      otlpHeaders(['X-Extra=1'], { OTEL_EXPORTER_OTLP_HEADERS: 'Authorization=abc' }),
    ).toEqual({
      Authorization: 'abc',
      'X-Extra': '1',
    });
  });
});

describe('Memnox answering a person, traced', () => {
  it('times the context, the brain and each tool, and hangs the operator tool on the same trace', async () => {
    const deps = await depsAt();
    let clock = Date.parse('2026-10-02T12:00:00.000Z');
    const tick = (ms: number): string => {
      clock += ms;
      return new Date(clock).toISOString();
    };
    const now = (): string => new Date(clock).toISOString();
    const trace = new VoiceTurnTrace(deps.home, now, 7);
    const building = now();
    tick(600);
    trace.contextBuilt(building, 5);
    await trace.brainStarted();
    tick(2_000);
    trace.chunk({ kind: 'tool', tool: 'mcp__memnox-operator__sessions' });
    await callOperatorTool({ ...deps, now: () => new Date(clock) }, SEAMS, 'traces', {
      show: 'false',
    });
    tick(1_500);
    trace.chunk({ kind: 'text', text: 'Two are working.' });
    tick(300);
    trace.chunk({ kind: 'done' });
    await trace.finish();

    const spans = await new TraceStore(deps.home).recent();
    const turn = spans.find((span) => span.name === 'voice.turn');
    expect(turn?.attributes).toMatchObject({
      words: 7,
      ending: 'done',
      firstWordMs: 4_100,
    });
    expect(spans.find((span) => span.name === 'brain.sessions')).toMatchObject({
      kind: 'tool',
    });
    const brain = spans.find((span) => span.name === 'brain.turn');
    expect(spans.find((span) => span.name === 'operator.traces')).toMatchObject({
      traceId: turn?.traceId,
      parentId: brain?.spanId,
    });
  });

  it('draws the last answer as a waterfall and says what took longest', async () => {
    const deps = await depsAt();
    const trace = new VoiceTurnTrace(deps.home, () => NOW.toISOString(), 3);
    await trace.brainStarted();
    trace.chunk({ kind: 'done' });
    await trace.finish();
    expect(await callOperatorTool(deps, SEAMS, 'traces', {})).toMatchObject({
      found: true,
    });
    const [request] = await new DisplayRequests(deps.home).open(NOW.toISOString());
    expect(request).toMatchObject({ display: 'trace' });
    expect(request?.trace?.rows[0]?.name).toBe('voice.turn');
  });
});

describe('a finished turn told with how it left its tests', () => {
  // Shaped like a Claude Code session id, which is how its transcript is found.
  const SESSION = '7f3c2a10-4b5e-4c1d-9a2b-0e6f8d1c3b4a';

  async function finishedWith(
    passed: boolean,
  ): Promise<Record<string, unknown> | undefined> {
    const deps = await depsAt();
    const turns = new SessionTurns(deps.home);
    await turns.prompted(SESSION, 'claude-code', '2026-10-02T11:40:00.000Z');
    await turns.ended(SESSION, 'claude-code', '2026-10-02T11:50:00.000Z');
    const project = join(deps.home, '.claude', 'projects', 'shop');
    await mkdir(project, { recursive: true });
    const lines = [
      {
        timestamp: '2026-10-02T11:45:00.000Z',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'tu_1',
              name: 'Bash',
              input: { command: 'pnpm test' },
            },
          ],
        },
      },
      {
        timestamp: '2026-10-02T11:46:00.000Z',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'tu_1', is_error: !passed }],
        },
      },
    ];
    await writeFile(
      join(project, `${SESSION}.jsonl`),
      lines.map((line) => JSON.stringify(line)).join('\n'),
    );
    const told = await new NoticeWatcher(deps.home, '2000-01-01T00:00:00.000Z').look(
      NOW.toISOString(),
    );
    return told.find((event) => event.notice === 'finished') as
      Record<string, unknown> | undefined;
  }

  it('says the tests passed when the last run in the turn passed', async () => {
    expect(await finishedWith(true)).toMatchObject({
      notice: 'finished',
      tests: 'passed',
    });
  });

  it('says they failed when the last run in the turn failed', async () => {
    expect(await finishedWith(false)).toMatchObject({
      notice: 'finished',
      tests: 'failed',
    });
  });
});
