import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MEMORY_EXTRACT_SYSTEM } from '@memnox/core';
import { ownExtractor } from '../src/memory/memory-brain';
import { VoiceAgents } from '../src/operator/voice-agents';
import { voiceBrainSpec, type VoiceBrainSpec } from '../src/operator/voice-brains';

/**
 * Memory extraction on an agent that speaks the Agent Client Protocol: a stand in agent records what
 * it was sent, asks for a permission mid turn, and answers with candidates once the refusal comes back.
 */
const FAKE_AGENT = `#!/usr/bin/env node
const fs = require('node:fs');
const log = (entry) => fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify(entry) + '\\n');
const out = (value) => process.stdout.write(JSON.stringify(value) + '\\n');
let pending = '';
let finish = null;
process.stdin.on('data', (chunk) => {
  pending += chunk;
  const lines = pending.split('\\n');
  pending = lines.pop();
  for (const each of lines) {
    if (each.trim() === '') continue;
    const message = JSON.parse(each);
    if (message.method === undefined) {
      log({ answered: message.id, result: message.result ?? null });
      if (finish) finish();
      continue;
    }
    log({ method: message.method, params: message.params });
    const reply = (result) => out({ jsonrpc: '2.0', id: message.id, result });
    if (message.method === 'initialize') reply({ protocolVersion: 1, agentCapabilities: { loadSession: true } });
    else if (message.method === 'session/new') reply({ sessionId: 's1', modes: { currentModeId: 'agent', availableModes: [{ id: 'agent', name: 'agent' }, { id: 'read-only', name: 'read-only' }] } });
    else if (message.method === 'session/set_mode' || message.method === 'session/close') reply({});
    else if (message.method === 'session/prompt') {
      finish = () => {
        out({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 's1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '[{"kind":"fact"}]' } } } });
        reply({ stopReason: 'end_turn' });
      };
      out({ jsonrpc: '2.0', id: 500, method: 'session/request_permission', params: { sessionId: 's1', toolCall: { toolCallId: 'x' }, options: [{ optionId: 'ok', kind: 'allow_once', name: 'Allow' }, { optionId: 'no', kind: 'reject_once', name: 'Deny' }] } });
    }
  }
});
`;

interface Logged {
  method?: string;
  params?: Record<string, unknown>;
  answered?: number;
  result?: { outcome?: { outcome?: string; optionId?: string } } | null;
}

async function fakeAgent(): Promise<{ home: string; command: string; log: string }> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-extract-'));
  const command = join(home, 'fake-acp');
  const log = join(home, 'agent.log');
  await writeFile(command, FAKE_AGENT);
  await chmod(command, 0o755);
  process.env['FAKE_LOG'] = log;
  return { home, command, log };
}

async function logged(path: string): Promise<Logged[]> {
  return (await readFile(path, 'utf8'))
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as Logged);
}

function spec(kind: string): VoiceBrainSpec {
  const found = voiceBrainSpec(kind);
  if (found === null) throw new Error(`no ${kind}`);
  return found;
}

// The stand in agent is a #! script, which Windows cannot execute.
describe.skipIf(process.platform === 'win32')('memory extraction on any agent', () => {
  it('reads on an ACP agent in its read-only mode, with no tools, refusing what it asks', async () => {
    const { home, command, log } = await fakeAgent();
    const extract = ownExtractor(home, {
      brains: async () => [spec('codex')],
      command: () => command,
    });

    expect(await extract('the notes')).toBe('[{"kind":"fact"}]');
    const sent = await logged(log);
    const opened = sent.find((each) => each.method === 'session/new');
    expect(opened?.params?.['mcpServers']).toEqual([]);
    expect(sent.find((each) => each.method === 'session/set_mode')?.params).toMatchObject(
      {
        modeId: 'read-only',
      },
    );
    const prompt = sent.find((each) => each.method === 'session/prompt')?.params?.[
      'prompt'
    ] as { text: string }[];
    expect(prompt.map((each) => each.text)).toEqual([MEMORY_EXTRACT_SYSTEM, 'the notes']);
    expect(sent.find((each) => each.answered === 500)?.result?.outcome).toMatchObject({
      outcome: 'selected',
      optionId: 'no',
    });
  });

  it('goes down the preference order past an agent that is not there, and never to an unsealed one', async () => {
    const { home, command } = await fakeAgent();
    const tried: string[] = [];
    const extract = ownExtractor(home, {
      brains: async () => [spec('hermes'), spec('claude-code'), spec('cursor')],
      claude: async () => {
        tried.push('claude-code');
        return null;
      },
      command: (each) => {
        tried.push(each.kind);
        return each.kind === 'cursor' ? join(home, 'missing') : command;
      },
    });

    expect(await extract('the notes')).toBeNull();
    expect(tried).toEqual(['claude-code', 'cursor']);
  });

  it('orders by the pinned agent, then the chosen one, then the rest installed, checking none', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-extract-order-'));
    const agents = new VoiceAgents(home, {
      env: { MEMNOX_VOICE_BRAIN: 'cursor' },
      installed: () => [spec('claude-code'), spec('codex'), spec('cursor')],
      checkable: () => {
        throw new Error('nothing is checked');
      },
    });
    expect((await agents.preferred()).map((each) => each.kind)).toEqual([
      'cursor',
      'claude-code',
      'codex',
    ]);
  });
});
