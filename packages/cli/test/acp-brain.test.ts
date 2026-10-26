import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AcpBrain } from '../src/operator/acp-brain';
import { BRAIN_CHUNK, type BrainChunk } from '../src/operator/brain';
import { voiceBrainSpec, type VoiceBrainSpec } from '../src/operator/voice-brains';

/**
 * A stand-in agent speaking the Agent Client Protocol the way Cursor and Hermes do, which
 * records what it was sent so a test can read how the brain drove it.
 */
const FAKE_AGENT = `#!/usr/bin/env node
const fs = require('node:fs');
const log = (entry) => fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify(entry) + '\\n');
log({ started: true, agent: process.env.MEMNOX_AGENT_NAME ?? null, session: process.env.MEMNOX_SESSION ?? null });
const out = (value) => process.stdout.write(JSON.stringify(value) + '\\n');
const modes = process.env.FAKE_MODES ? process.env.FAKE_MODES.split(',') : ['agent', 'ask'];
let turn = 0;
let permissionId = 900;
const waiting = new Map();
let pending = '';
process.stdout.write('a banner that is not json\\n');
process.on('SIGTERM', () => { log({ stopped: true }); process.exit(0); });
process.stdin.on('data', (chunk) => {
  pending += chunk;
  const lines = pending.split('\\n');
  pending = lines.pop();
  for (const each of lines) {
    if (each.trim() === '') continue;
    const message = JSON.parse(each);
    if (message.method === undefined) {
      log({ answered: message.id, result: message.result ?? null, error: message.error ?? null });
      waiting.get(message.id)?.(message);
      continue;
    }
    log({ method: message.method, params: message.params });
    const reply = (result) => out({ jsonrpc: '2.0', id: message.id, result });
    const update = (sessionId, body) => out({ jsonrpc: '2.0', method: 'session/update', params: { sessionId, update: body } });
    if (message.method === 'initialize') {
      if (process.env.FAKE_AUTH) out({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: 'Authentication required' } });
      else reply({ protocolVersion: 1, agentCapabilities: { loadSession: true } });
    } else if (message.method === 'session/new') {
      reply({ sessionId: 'ses-1', modes: { currentModeId: modes[0], availableModes: modes.map((id) => ({ id, name: id })) } });
    } else if (message.method === 'session/load') {
      update(message.params.sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'replayed history' } });
      reply({ modes: { currentModeId: 'agent', availableModes: modes.map((id) => ({ id, name: id })) } });
    } else if (message.method === 'session/close') {
      if (!process.env.FAKE_SILENT_CLOSE) reply({});
    } else if (message.method === 'session/set_mode') {
      reply({});
    } else if (message.method === 'session/cancel') {
      const stop = waiting.get('turn');
      if (stop) stop();
    } else if (message.method === 'session/prompt') {
      turn += 1;
      const sessionId = message.params.sessionId;
      const said = message.params.prompt[message.params.prompt.length - 1].text;
      update('another-session', { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'not mine' } });
      if (said === 'talk for ever') {
        waiting.set('turn', () => reply({ stopReason: 'cancelled' }));
        continue;
      }
      const finish = () => {
        update(sessionId, { sessionUpdate: 'tool_call', toolCallId: 't1', title: 'sessions', kind: 'read' });
        update(sessionId, { sessionUpdate: 'tool_call', toolCallId: 't2', title: 'sessions', kind: 'read' });
        update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Turn ' + turn + ': ' + said + '.' } });
        reply({ stopReason: 'end_turn' });
      };
      if (said === 'run something') {
        permissionId += 1;
        waiting.set(permissionId, finish);
        out({ jsonrpc: '2.0', id: permissionId, method: 'session/request_permission', params: { sessionId, toolCall: { toolCallId: 'x' }, options: [{ optionId: 'allow_once', kind: 'allow_once', name: 'Allow' }, { optionId: 'deny', kind: 'reject_once', name: 'Deny' }] } });
        out({ jsonrpc: '2.0', id: permissionId + 1000, method: 'fs/read_text_file', params: { sessionId, path: '/etc/passwd' } });
        continue;
      }
      if (said === 'die') process.exit(3);
      finish();
    }
  }
});
`;

async function fake(): Promise<{ home: string; command: string; log: string }> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-acp-'));
  const command = join(home, 'agent');
  await writeFile(command, FAKE_AGENT);
  await chmod(command, 0o755);
  return { home, command, log: join(home, 'agent.jsonl') };
}

function spec(kind: string): VoiceBrainSpec {
  const found = voiceBrainSpec(kind);
  if (found === null) throw new Error(`no brain ${kind}`);
  return found;
}

function brainFor(
  setup: { home: string; command: string; log: string },
  kind = 'cursor',
  env: Record<string, string> = {},
): AcpBrain {
  return new AcpBrain({
    spec: spec(kind),
    home: setup.home,
    command: setup.command,
    cwd: setup.home,
    operator: { command: '/usr/bin/true', args: ['--operator'] },
    env: {
      ...process.env,
      FAKE_LOG: setup.log,
      MEMNOX_SESSION: 'ses_somebody_else',
      ...env,
    },
  });
}

async function turn(brain: AcpBrain, said: string): Promise<BrainChunk[]> {
  const chunks: BrainChunk[] = [];
  for await (const chunk of brain.ask(said)) chunks.push(chunk);
  return chunks;
}

interface Logged {
  stopped?: boolean;
  method?: string;
  params?: Record<string, unknown>;
  answered?: number;
  result?: unknown;
  error?: unknown;
  started?: boolean;
  agent?: string | null;
  session?: string | null;
}

/** The log once the agent has been stopped, which ends whatever a close asked of it first. */
async function untilStopped(path: string): Promise<Logged[]> {
  for (let tries = 0; tries < 100; tries += 1) {
    const calls = await logged(path);
    if (calls.some((call) => call.stopped === true)) return calls;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('the agent was never stopped');
}

async function untilLogged(
  path: string,
  wanted: (call: Logged) => boolean,
): Promise<Logged[]> {
  for (let tries = 0; tries < 100; tries += 1) {
    const calls = await logged(path).catch((): Logged[] => []);
    if (calls.some(wanted)) return calls;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('the agent never logged what was waited for');
}

async function logged(path: string): Promise<Logged[]> {
  const text = await readFile(path, 'utf8');
  return text
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as Logged);
}

describe('AcpBrain', () => {
  it('answers a turn with the tool it read once and the words it said', async () => {
    const setup = await fake();
    const brain = brainFor(setup);

    const chunks = await turn(brain, 'how many sessions');
    brain.close();

    expect(chunks).toEqual([
      { kind: BRAIN_CHUNK.TOOL, tool: 'sessions' },
      { kind: BRAIN_CHUNK.TEXT, text: 'Turn 1: how many sessions.' },
      { kind: BRAIN_CHUNK.DONE },
    ]);
  });

  it('offers no files or terminal, hands over the operator server and asks for the read-only mode', async () => {
    const setup = await fake();
    const brain = brainFor(setup);

    await turn(brain, 'hello');
    brain.close();
    const calls = await logged(setup.log);

    const init = calls.find((call) => call.method === 'initialize');
    expect(init?.params?.['clientCapabilities']).toEqual({
      fs: { readTextFile: false, writeTextFile: false },
      terminal: false,
    });
    const opened = calls.find((call) => call.method === 'session/new');
    expect(opened?.params?.['mcpServers']).toEqual([
      {
        name: 'memnox-operator',
        command: '/usr/bin/true',
        args: ['--operator'],
        env: [],
      },
    ]);
    expect(calls.find((call) => call.method === 'session/set_mode')?.params).toEqual({
      sessionId: 'ses-1',
      modeId: 'ask',
    });
  });

  it('runs as the operator and never inside the session of whoever started it', async () => {
    const setup = await fake();
    const brain = brainFor(setup);

    await turn(brain, 'hello');
    brain.close();
    const [started] = await logged(setup.log);

    expect(started?.agent).toBe('memnox-operator');
    expect(started?.session).toBeNull();
  });

  it('puts the voice instructions on the first prompt only, and keeps the process warm', async () => {
    const setup = await fake();
    const brain = brainFor(setup);

    await turn(brain, 'first');
    const second = await turn(brain, 'second');
    brain.close();
    const prompts = (await logged(setup.log)).filter(
      (call) => call.method === 'session/prompt',
    );

    expect(second[1]).toEqual({ kind: BRAIN_CHUNK.TEXT, text: 'Turn 2: second.' });
    expect((prompts[0]?.params?.['prompt'] as unknown[]).length).toBe(2);
    expect(prompts[1]?.params?.['prompt']).toEqual([{ type: 'text', text: 'second' }]);
    const starts = (await logged(setup.log)).filter((call) => call.started === true);
    expect(starts).toHaveLength(1);
  });

  it('refuses every permission and every file request the agent makes', async () => {
    const setup = await fake();
    const brain = brainFor(setup);

    const chunks = await turn(brain, 'run something');
    brain.close();
    const answers = (await logged(setup.log)).filter(
      (call) => call.answered !== undefined,
    );

    expect(chunks.at(-1)).toEqual({ kind: BRAIN_CHUNK.DONE });
    expect(answers).toContainEqual({
      answered: 901,
      result: { outcome: { outcome: 'selected', optionId: 'deny' } },
      error: null,
    });
    expect(answers.find((answer) => answer.answered === 1901)?.error).toMatchObject({
      code: -32601,
    });
  });

  it('will not think with a lockable agent that offers no read-only mode', async () => {
    const setup = await fake();
    const brain = brainFor(setup, 'cursor', { FAKE_MODES: 'agent' });

    const chunks = await turn(brain, 'hello');
    brain.close();

    expect(chunks).toEqual([
      {
        kind: BRAIN_CHUNK.FAILED,
        text: 'Cursor offered no read-only mode, so it cannot be the voice',
      },
    ]);
  });

  it('says once, first, that an agent which cannot be locked is answering', async () => {
    const setup = await fake();
    const brain = brainFor(setup, 'hermes', { FAKE_MODES: 'default' });

    const first = await turn(brain, 'one');
    const second = await turn(brain, 'two');
    brain.close();

    expect(first[0]?.kind).toBe(BRAIN_CHUNK.TEXT);
    expect(first[0]?.text).toContain('Hermes, which can run ordinary shell commands');
    expect(second.map((chunk) => chunk.text ?? '').join('')).not.toContain('shell');
  });

  it('names the login when the agent is not logged in', async () => {
    const setup = await fake();
    const brain = brainFor(setup, 'cursor', { FAKE_AUTH: '1' });

    const chunks = await turn(brain, 'hello');
    brain.close();

    expect(chunks).toEqual([
      {
        kind: BRAIN_CHUNK.FAILED,
        text: 'Cursor is not logged in: install the Cursor CLI and run cursor-agent login',
      },
    ]);
  });

  it('says what to install when the agent is not there', async () => {
    const setup = await fake();
    const brain = new AcpBrain({
      spec: spec('codex'),
      home: setup.home,
      command: join(setup.home, 'missing'),
      operator: { command: '/usr/bin/true', args: [] },
    });

    const chunks = await turn(brain, 'hello');

    expect(chunks).toEqual([
      {
        kind: BRAIN_CHUNK.FAILED,
        text: 'Codex is not installed here: npm install -g @agentclientprotocol/codex-acp, then codex login',
      },
    ]);
  });

  it('fails the turn when the agent dies, and starts it again for the next one', async () => {
    const setup = await fake();
    const brain = brainFor(setup);

    const died = await turn(brain, 'die');
    const after = await turn(brain, 'again');
    brain.close();

    expect(died.at(-1)).toEqual({
      kind: BRAIN_CHUNK.FAILED,
      text: 'Cursor stopped before it answered',
    });
    expect(after.at(-1)).toEqual({ kind: BRAIN_CHUNK.DONE });
  });

  it('ends a cancelled turn as cancelled and keeps the conversation', async () => {
    const setup = await fake();
    const brain = brainFor(setup);

    const turning = turn(brain, 'talk for ever');
    // Cancelled once the agent holds the turn, since a fixed wait loses the race to a slow start.
    await untilLogged(setup.log, (call) => call.method === 'session/prompt');
    brain.cancel();
    const chunks = await turning;
    const next = await turn(brain, 'still there');
    brain.close();

    expect(chunks).toEqual([{ kind: BRAIN_CHUNK.CANCELLED }]);
    expect(next.at(-1)).toEqual({ kind: BRAIN_CHUNK.DONE });
  });

  it('carries the conversation on in a new process without replaying its history aloud', async () => {
    const setup = await fake();
    const first = brainFor(setup);
    await turn(first, 'remember this');
    first.close();

    const second = brainFor(setup);
    const chunks = await turn(second, 'and then');
    second.close();
    const calls = await logged(setup.log);

    expect(
      calls.find((call) => call.method === 'session/load')?.params?.['sessionId'],
    ).toBe('ses-1');
    expect(chunks.map((chunk) => chunk.text ?? '').join('')).not.toContain('replayed');
    const prompts = calls.filter((call) => call.method === 'session/prompt');
    expect(prompts.at(-1)?.params?.['prompt']).toEqual([
      { type: 'text', text: 'and then' },
    ]);
  });
  it('asks the agent to close its session before stopping it, so the agent records it ended', async () => {
    const setup = await fake();
    const brain = brainFor(setup, 'hermes', { FAKE_MODES: 'default' });

    await turn(brain, 'hello');
    brain.close();
    const calls = await untilStopped(setup.log);

    const closing = calls.findIndex((call) => call.method === 'session/close');
    expect(calls[closing]?.params).toEqual({ sessionId: 'ses-1' });
    expect(closing).toBeLessThan(calls.findIndex((call) => call.stopped === true));
  });

  it('stops an agent that never answers the close, after a short wait', async () => {
    const setup = await fake();
    const brain = brainFor(setup, 'hermes', {
      FAKE_MODES: 'default',
      FAKE_SILENT_CLOSE: '1',
    });

    await turn(brain, 'hello');
    brain.close();
    const calls = await untilStopped(setup.log);

    expect(calls.some((call) => call.method === 'session/close')).toBe(true);
  });

  it('tells whoever keeps the list each session it opens', async () => {
    const setup = await fake();
    const opened: string[] = [];
    const brain = new AcpBrain({
      spec: spec('hermes'),
      home: setup.home,
      command: setup.command,
      cwd: setup.home,
      operator: { command: '/usr/bin/true', args: [] },
      env: { ...process.env, FAKE_LOG: setup.log, FAKE_MODES: 'default' },
      opened: (sessionId) => {
        opened.push(sessionId);
        return Promise.reject(new Error('a home that cannot be written'));
      },
    });

    const chunks = await turn(brain, 'hello');
    brain.close();

    expect(opened).toEqual(['ses-1']);
    expect(chunks.at(-1)).toEqual({ kind: BRAIN_CHUNK.DONE });
  });
});
