import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { PROPOSAL_KIND, Proposals } from '@memnox/core';
import { applyPersonal } from '../src/daemon/confirm-work';
import {
  findLocalTools,
  LOCAL_SLUG,
  type LocalCli,
  type LocalServer,
} from '../src/local-tools/local-catalogue';
import {
  runLocalTool,
  type LocalGate,
  type LocalVerdict,
  type RunBinary,
} from '../src/local-tools/local-run';
import { findEveryTool } from '../src/local-tools/local-tools';
import { McpPool } from '../src/local-tools/mcp-client';

/**
 * The tools a Mac reaches itself, with no Memnox service and no account: the MCP servers its agents
 * are configured with and its signed in command line tools, read at once and changed only after Touch
 * ID, and every call through the same gate an agent's call goes through.
 */

/** A real stdio MCP server in a few lines: one tool that reads and one that deletes, each call kept in a file. */
const FAKE_SERVER = `
const { appendFileSync } = require('node:fs');
const log = process.env.FAKE_LOG;
let buffered = '';
process.stdin.on('data', (chunk) => {
  buffered += chunk;
  const lines = buffered.split('\\n');
  buffered = lines.pop();
  for (const line of lines) {
    if (line.trim() === '') continue;
    const message = JSON.parse(line);
    if (message.id === undefined) continue;
    let result = {};
    if (message.method === 'tools/list') {
      result = { tools: [
        { name: 'list_notes', description: 'List the notes in a folder', annotations: { readOnlyHint: true }, inputSchema: { properties: { folder: { type: 'string' } } } },
        { name: 'delete_note', description: 'Delete a note for good', annotations: { destructiveHint: true } },
      ] };
    }
    if (message.method === 'tools/call') {
      appendFileSync(log, message.params.name + '\\n');
      result = { content: [{ type: 'text', text: 'note one, token ' + process.env.FAKE_SECRET }] };
    }
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\\n');
  }
});
`;

const pool = new McpPool();
afterAll(() => pool.closeAll());

/** A gate that answers one effect for everything and keeps what it was asked. */
function gate(
  effect: string | null,
): LocalGate & { asked: string[]; recorded: string[] } {
  const asked: string[] = [];
  const recorded: string[] = [];
  return {
    asked,
    recorded,
    evaluate: async (action) => {
      asked.push(action);
      return effect === null
        ? null
        : ({ effect, reason: 'a test rule' } satisfies LocalVerdict);
    },
    record: async (action) => {
      recorded.push(action);
    },
  };
}

async function fakeServer(): Promise<{
  server: LocalServer;
  calls: () => Promise<string[]>;
}> {
  const dir = await mkdtemp(join(tmpdir(), 'memnox-local-'));
  const script = join(dir, 'server.js');
  const log = join(dir, 'calls.log');
  await writeFile(script, FAKE_SERVER);
  await writeFile(log, '');
  return {
    server: {
      name: 'notes',
      launch: {
        command: process.execPath,
        args: [script],
        // As the agent's config hands it over: the child gets it, and nothing here prints it.
        env: { FAKE_LOG: log, FAKE_SECRET: 'ghp_' + 'a'.repeat(36) },
      },
    },
    calls: async () =>
      (await readFile(log, 'utf8')).split('\n').filter((line) => line !== ''),
  };
}

const GH: LocalCli = {
  name: 'gh',
  path: '/usr/local/bin/gh',
  headline: 'GitHub CLI is signed in.',
};

/** Runs nothing, keeping each command line it was handed. */
function fakeExec(): RunBinary & { ran: string[][] } {
  const ran: string[][] = [];
  const exec = (async (_path: string, argv: readonly string[]) => {
    ran.push([...argv]);
    return { exitCode: 0, stdout: 'listed', stderr: '' };
  }) as RunBinary & { ran: string[][] };
  exec.ran = ran;
  return exec;
}

describe("listing what this Mac reaches as the person's own tools", () => {
  it("lists the server's tools and the signed in command line tools, started from the config's launch line", async () => {
    const { server } = await fakeServer();
    const found = await findLocalTools(
      { servers: async () => [server], clis: async () => [GH], pool },
      'list notes',
    );
    const notes = found.find((tool) => tool.name === 'list_notes');
    expect(notes).toMatchObject({
      slug: `${LOCAL_SLUG.MCP}notes:list_notes`,
      toolkit: 'notes',
      workClass: 'read',
      local: true,
    });
    expect(found.some((tool) => tool.name === 'gh')).toBe(false);

    const named = await findLocalTools(
      { servers: async () => [server], clis: async () => [GH], pool },
      'anything',
      'GH',
    );
    expect(named.map((tool) => tool.slug)).toEqual([`${LOCAL_SLUG.CLI}gh`]);
  });

  it('uses a tool this Mac reaches without asking the cloud, and keeps local tools when the cloud is down', async () => {
    let asked = 0;
    const cloud = async (): Promise<{ ok: false; said: string }> => {
      asked += 1;
      return { ok: false, said: 'unreachable' };
    };
    const home = await mkdtemp(join(tmpdir(), 'memnox-every-'));
    const nothingHere = await findEveryTool(home, 'send email', undefined, cloud);
    expect(nothingHere).toEqual({ ok: false, said: 'unreachable' });
    expect(asked).toBe(1);
  });
});

describe('running a local tool through the gate', () => {
  it('reads at once once the gate allows it, takes secrets out, and records the call', async () => {
    const { server, calls } = await fakeServer();
    const allow = gate('allow');
    const ran = await runLocalTool(
      { servers: async () => [server], clis: async () => [], pool, gate: allow },
      `${LOCAL_SLUG.MCP}notes:list_notes`,
      '{"folder":"work"}',
      false,
    );
    expect(ran.ok).toBe(true);
    const text = JSON.stringify(ran.ok ? ran.value.data : {});
    expect(text).toContain('note one');
    expect(text).not.toContain('ghp_');
    expect(text).toContain('"untrusted":true');
    expect(allow.asked).toEqual(['mcp.notes.list_notes']);
    expect(allow.recorded).toEqual(['mcp.notes.list_notes']);
    expect(await calls()).toEqual(['list_notes']);
  });

  it("never runs a change on the voice's word, and never asks the gate for one", async () => {
    const { server, calls } = await fakeServer();
    const allow = gate('allow');
    const ran = await runLocalTool(
      { servers: async () => [server], clis: async () => [], pool, gate: allow },
      `${LOCAL_SLUG.MCP}notes:delete_note`,
      '{}',
      false,
    );
    expect(ran.ok ? '' : ran.said).toMatch(/propose_tool/);
    expect(allow.asked).toEqual([]);
    expect(await calls()).toEqual([]);
  });

  it('refuses a confirmed change a rule denies, and runs one a rule asks about once confirmed', async () => {
    const { server, calls } = await fakeServer();
    const deps = { servers: async () => [server], clis: async () => [], pool };
    const denied = await runLocalTool(
      { ...deps, gate: gate('deny') },
      `${LOCAL_SLUG.MCP}notes:delete_note`,
      '{}',
      true,
    );
    expect(denied.ok ? '' : denied.said).toMatch(/A rule stops that: a test rule/);
    expect(await calls()).toEqual([]);

    const asked = await runLocalTool(
      { ...deps, gate: gate('ask') },
      `${LOCAL_SLUG.MCP}notes:delete_note`,
      '{}',
      true,
    );
    expect(asked.ok).toBe(true);
    expect(await calls()).toEqual(['delete_note']);
  });

  it('asks the gate about sensitive data going out, and a rule on it holds after Touch ID', async () => {
    const { server, calls } = await fakeServer();
    const classified: Array<string | undefined> = [];
    const customerRule: LocalGate = {
      evaluate: async (_action, _target, dataClassification) => {
        classified.push(dataClassification);
        return dataClassification === undefined
          ? { effect: 'allow', reason: 'a test rule' }
          : { effect: 'deny', reason: 'customer data stays inside' };
      },
      record: async () => undefined,
    };
    const ran = await runLocalTool(
      { servers: async () => [server], clis: async () => [], pool, gate: customerRule },
      `${LOCAL_SLUG.MCP}notes:delete_note`,
      JSON.stringify({
        to: 'someone@rival.example',
        body: 'Jane Doe, jane.doe@example.com, +1 415 555 0100, card 4111 1111 1111 1111',
      }),
      true,
    );
    expect(ran.ok ? '' : ran.said).toMatch(/customer data stays inside/);
    expect(classified.some((each) => each !== undefined)).toBe(true);
    expect(await calls()).toEqual([]);
  });

  it('fails closed when the gate cannot be asked', async () => {
    const exec = fakeExec();
    const ran = await runLocalTool(
      { servers: async () => [], clis: async () => [GH], pool, gate: gate(null), exec },
      `${LOCAL_SLUG.CLI}gh`,
      '{"args":["pr","list"]}',
      false,
    );
    expect(ran.ok ? '' : ran.said).toMatch(/not run/);
    expect(exec.ran).toEqual([]);
  });

  it('tells a command line read from a change by its verb table, and asks the gate by the action name', async () => {
    const exec = fakeExec();
    const allow = gate('allow');
    const deps = {
      servers: async () => [],
      clis: async () => [GH],
      pool,
      gate: allow,
      exec,
    };
    const read = await runLocalTool(
      deps,
      `${LOCAL_SLUG.CLI}gh`,
      '{"args":["pr","list"]}',
      false,
    );
    const merge = await runLocalTool(
      deps,
      `${LOCAL_SLUG.CLI}gh`,
      '{"args":["pr","merge","12"]}',
      false,
    );
    expect(read.ok).toBe(true);
    expect(merge.ok ? '' : merge.said).toMatch(/propose_tool/);
    expect(exec.ran).toEqual([['pr', 'list']]);
    const confirmed = await runLocalTool(
      deps,
      `${LOCAL_SLUG.CLI}gh`,
      '{"args":["pr","merge","12"]}',
      true,
    );
    expect(confirmed.ok).toBe(true);
    expect(allow.asked[0]).toMatch(/^gh\./);
    expect(allow.asked[1]).toMatch(/^gh\.pr-merge/);
    expect(exec.ran).toEqual([
      ['pr', 'list'],
      ['pr', 'merge', '12'],
    ]);
  });
});

describe('a confirmed proposal for a local tool', () => {
  it('runs on this Mac rather than in the cloud, and runs nothing it cannot check', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-confirm-local-'));
    const proposal = await new Proposals(home).propose({
      change: {
        kind: PROPOSAL_KIND.WORK,
        toolkit: 'gh',
        tool: `${LOCAL_SLUG.CLI}gh`,
        argumentsText: '{"args":["pr","merge","12"]}',
        label: 'merge pull request 12',
      },
      rationale: 'On gh: merge pull request 12',
      proposedBy: 'agt_memnox-operator',
      at: new Date().toISOString(),
      ttlMs: 60_000,
    });
    const settled = await applyPersonal(home, proposal);
    expect(settled).toMatchObject({ ok: false });
  });
});
