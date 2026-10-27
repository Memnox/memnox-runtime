import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BRAIN_CHUNK, type BrainChunk } from '../src/operator/brain';
import { ClaudeCodeBrain } from '../src/operator/claude-brain';
import { MOST_CONVERSATION_TURNS } from '../src/operator/conversation';

/**
 * A stand-in `claude` that records how it was started and answers every turn the way
 * Claude Code's stream does, so none of this needs anybody's subscription.
 */
const FAKE_CLAUDE = `#!/usr/bin/env node
const fs = require('node:fs');
const log = process.env.FAKE_LOG;
fs.appendFileSync(log, JSON.stringify({ argv: process.argv.slice(2), agent: process.env.MEMNOX_AGENT_NAME ?? null, session: process.env.MEMNOX_SESSION ?? null, thinking: process.env.MAX_THINKING_TOKENS ?? null }) + '\\n');
let turn = 0;
let pending = '';
process.stdin.on('data', (chunk) => {
  pending += chunk;
  const lines = pending.split('\\n');
  pending = lines.pop();
  for (const each of lines) {
    if (each.trim() === '') continue;
    const out = (value) => process.stdout.write(JSON.stringify(value) + '\\n');
    const message = JSON.parse(each);
    // Honoured only when asked to, so the fallback of ending the process is tested too.
    if (message.type === 'control_request') {
      if (process.env.FAKE_INTERRUPTS) out({ type: 'result', subtype: 'error_during_execution', is_error: true, session_id: 'conv-1' });
      else process.exit(1);
      continue;
    }
    turn += 1;
    const said = message.message.content[0].text;
    out({ type: 'system', subtype: 'init', session_id: 'conv-1' });
    if (said === 'talk for ever') continue;
    out({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'mcp__memnox-operator__sessions' }] } });
    out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Turn ' + turn + ': ' + said + '.' } } });
    out({ type: 'result', is_error: false, result: 'x', session_id: 'conv-1' });
  }
});
`;

async function fake(): Promise<{ home: string; command: string; log: string }> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-brain-'));
  const command = join(home, 'claude');
  await writeFile(command, FAKE_CLAUDE);
  await chmod(command, 0o755);
  return { home, command, log: join(home, 'launches.jsonl') };
}

function brainFor(setup: {
  home: string;
  command: string;
  log: string;
}): ClaudeCodeBrain {
  return new ClaudeCodeBrain({
    home: setup.home,
    command: setup.command,
    operator: { command: '/usr/bin/true', args: [] },
    env: { ...process.env, FAKE_LOG: setup.log, MEMNOX_SESSION: 'ses_somebody_else' },
  });
}

async function turn(brain: ClaudeCodeBrain, said: string): Promise<BrainChunk[]> {
  const chunks: BrainChunk[] = [];
  for await (const chunk of brain.ask(said)) chunks.push(chunk);
  return chunks;
}

/** What the fake brain wrote down each time it was started. */
interface Launch {
  argv: string[];
  agent: string | null;
  session: string | null;
  thinking: string | null;
}

async function launches(log: string): Promise<Launch[]> {
  return (await readFile(log, 'utf8'))
    .trim()
    .split('\n')
    .map((each) => JSON.parse(each) as Launch);
}

describe("the person's own Claude Code as the brain", () => {
  it('starts with every built-in tool off and only the operator server', async () => {
    const setup = await fake();
    const brain = brainFor(setup);
    await turn(brain, 'what is claude doing');
    brain.close();

    const [first] = await launches(setup.log);
    const argv = first?.argv ?? [];
    expect(argv[argv.indexOf('--tools') + 1]).toBe('');
    expect(argv).toContain('--strict-mcp-config');
    expect(argv[argv.indexOf('--allowedTools') + 1]).toBe('mcp__memnox-operator');
    expect(JSON.parse(argv[argv.indexOf('--mcp-config') + 1] ?? '{}')).toEqual({
      mcpServers: { 'memnox-operator': { command: '/usr/bin/true', args: [] } },
    });
    expect(argv).not.toContain('--resume');
  });

  it('is recorded as the operator and never as the session of whoever started it', async () => {
    const setup = await fake();
    const brain = brainFor(setup);
    await turn(brain, 'hello');
    brain.close();

    const [first] = await launches(setup.log);
    expect(first?.agent).toBe('memnox-operator');
    expect(first?.session).toBeNull();
    // A spoken answer starts at once, rather than after the model thinks for seconds first.
    expect(first?.thinking).toBe('0');
  });

  it('streams a turn: the tool it read, the words, then the end', async () => {
    const setup = await fake();
    const brain = brainFor(setup);
    const chunks = await turn(brain, 'what is waiting');
    brain.close();

    expect(chunks).toEqual([
      { kind: BRAIN_CHUNK.TOOL, tool: 'mcp__memnox-operator__sessions' },
      { kind: BRAIN_CHUNK.TEXT, text: 'Turn 1: what is waiting.' },
      { kind: BRAIN_CHUNK.DONE },
    ]);
  });

  it('stays warm across turns, so a follow up is one process and one conversation', async () => {
    const setup = await fake();
    const brain = brainFor(setup);
    await turn(brain, 'what is waiting');
    const second = await turn(brain, 'and the other one');
    brain.close();

    expect(second).toContainEqual({
      kind: BRAIN_CHUNK.TEXT,
      text: 'Turn 2: and the other one.',
    });
    expect(await launches(setup.log)).toHaveLength(1);
  });

  it('resumes the conversation after a restart, so context survives a quiet minute', async () => {
    const setup = await fake();
    const first = brainFor(setup);
    await turn(first, 'what is waiting');
    first.close();

    const again = brainFor(setup);
    await turn(again, 'and the other one');
    again.close();

    const [, second] = await launches(setup.log);
    const argv = second?.argv ?? [];
    expect(argv[argv.indexOf('--resume') + 1]).toBe('conv-1');
  });

  it('fails a turn plainly when there is no claude to run', async () => {
    const setup = await fake();
    const brain = new ClaudeCodeBrain({
      home: setup.home,
      command: join(setup.home, 'no-such-claude'),
      operator: { command: '/usr/bin/true', args: [] },
    });
    const chunks = await turn(brain, 'hello');
    expect(chunks.at(-1)?.kind).toBe(BRAIN_CHUNK.FAILED);
  });

  it('stops mid answer when cancelled, and the next question resumes the conversation', async () => {
    const setup = await fake();
    const brain = brainFor(setup);
    const chunks: BrainChunk[] = [];
    const turn = (async () => {
      for await (const chunk of brain.ask('talk for ever')) chunks.push(chunk);
    })();
    // Cancelled once the conversation has begun, which is when there is something to resume.
    await until(() =>
      existsSync(join(setup.home, '.memnox', 'voice', 'conversation.json')),
    );
    brain.cancel();
    await turn;
    expect(chunks.at(-1)).toEqual({ kind: BRAIN_CHUNK.CANCELLED });

    const next = await (async () => {
      const out: BrainChunk[] = [];
      for await (const chunk of brain.ask('and now')) out.push(chunk);
      return out;
    })();
    brain.close();
    expect(next.at(-1)).toEqual({ kind: BRAIN_CHUNK.DONE });
    const [, restarted] = await launches(setup.log);
    const argv = restarted?.argv ?? [];
    expect(argv[argv.indexOf('--resume') + 1]).toBe('conv-1');
  });

  it('keeps its process warm when an interrupted turn stops, so the next answer is not a cold start', async () => {
    const setup = await fake();
    const brain = new ClaudeCodeBrain({
      home: setup.home,
      command: setup.command,
      operator: { command: '/usr/bin/true', args: [] },
      env: { ...process.env, FAKE_LOG: setup.log, FAKE_INTERRUPTS: '1' },
    });
    const chunks: BrainChunk[] = [];
    const first = (async () => {
      for await (const chunk of brain.ask('talk for ever')) chunks.push(chunk);
    })();
    await until(() =>
      existsSync(join(setup.home, '.memnox', 'voice', 'conversation.json')),
    );
    brain.cancel();
    await first;
    expect(chunks.at(-1)).toEqual({ kind: BRAIN_CHUNK.CANCELLED });
    const next = await turn(brain, 'and now');
    brain.close();
    expect(next.at(-1)).toEqual({ kind: BRAIN_CHUNK.DONE });
    expect(await launches(setup.log)).toHaveLength(1);
  });

  it('talks on the fast model, and never hands the brain their name', async () => {
    const setup = await fake();
    const brain = new ClaudeCodeBrain({
      home: setup.home,
      command: setup.command,
      operator: { command: '/usr/bin/true', args: [] },
      env: { ...process.env, FAKE_LOG: setup.log },
      model: 'haiku',
      effort: 'low',
    });
    await turn(brain, 'hello');
    brain.close();
    const [first] = await launches(setup.log);
    const argv = first?.argv ?? [];
    expect(argv[argv.indexOf('--model') + 1]).toBe('haiku');
    expect(argv[argv.indexOf('--effort') + 1]).toBe('low');
    expect(argv[argv.indexOf('--system-prompt') + 1]).toContain('never their name');
    expect(argv).not.toContain('--append-system-prompt');
    expect(argv[argv.indexOf('--setting-sources') + 1]).toBe('project');
  });

  it('starts a fresh conversation once one has run long, so every answer stops rereading it', async () => {
    const setup = await fake();
    const brain = brainFor(setup);
    for (let each = 0; each < MOST_CONVERSATION_TURNS; each += 1)
      await turn(brain, 'hello');
    await turn(brain, 'and now');
    brain.close();

    const started = await launches(setup.log);
    expect(started).toHaveLength(2);
    expect(started[1]?.argv).not.toContain('--resume');
  });

  it('carries the count across a restart, so a resumed conversation still ends', async () => {
    const setup = await fake();
    await mkdir(join(setup.home, '.memnox', 'voice'), { recursive: true });
    const first = brainFor(setup);
    await turn(first, 'hello');
    first.close();
    const kept = join(setup.home, '.memnox', 'voice', 'conversation.json');
    const record = JSON.parse(await readFile(kept, 'utf8')) as Record<string, unknown>;
    await writeFile(kept, JSON.stringify({ ...record, turns: MOST_CONVERSATION_TURNS }));

    const again = brainFor(setup);
    await turn(again, 'and now');
    again.close();
    const [, second] = await launches(setup.log);
    expect(second?.argv).not.toContain('--resume');
  });

  it('starts fresh rather than resume a conversation begun under other instructions', async () => {
    const setup = await fake();
    await mkdir(join(setup.home, '.memnox', 'voice'), { recursive: true });
    await writeFile(
      join(setup.home, '.memnox', 'voice', 'conversation.json'),
      JSON.stringify({
        brain: 'claude',
        sessionId: 'conv-old',
        lastAt: new Date().toISOString(),
        version: 'instructions-from-before',
      }),
    );
    const brain = brainFor(setup);
    await turn(brain, 'hello');
    brain.close();
    const [first] = await launches(setup.log);
    expect(first?.argv).not.toContain('--resume');
  });
});

async function until(done: () => boolean): Promise<void> {
  for (let tries = 0; tries < 300 && !done(); tries += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
