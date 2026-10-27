import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'jsonc-parser';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { holdsPolicyHook, runsCurrentHook } from '../src/protect/claude-hook';
import {
  installOpenClawPlugin,
  OPENCLAW_CONFIG,
  OPENCLAW_PLUGIN,
  openClawPluginSource,
  removeOpenClawPlugin,
  withOpenClawPlugin,
  withoutOpenClawPlugin,
} from '../src/protect/openclaw-plugin';

/* OpenClaw runs hooks only as plugins in its own process. Memnox's plugin is generated
   JavaScript nobody compiles, so these run it the way OpenClaw would: imported, handed an
   api, and pointed at a stand-in for the hook. */

/** What the stand-in answers, by the raw OpenClaw tool it is asked about. */
const STAND_IN = `
import { appendFileSync } from 'node:fs';
let body = '';
process.stdin.on('data', (chunk) => (body += chunk));
process.stdin.on('end', () => {
  appendFileSync(process.argv[2], body + '\\n');
  const { tool_name } = JSON.parse(body);
  if (tool_name === 'exec') { process.stderr.write('not that command'); process.exit(2); }
  if (tool_name === 'write') process.stdout.write(JSON.stringify({ decision: 'ask', reason: 'outside the task' }) + '\\n');
  if (tool_name === 'apply_patch') process.stdout.write(JSON.stringify({ decision: 'block', reason: 'held by codex' }) + '\\n');
});
`;

type Handler = (event: unknown, ctx: unknown) => Promise<unknown>;

interface Loaded {
  handlers: Map<string, Handler>;
  warnings: string[];
  options: Map<string, unknown>;
}

describe('the plugin, run as OpenClaw runs it', () => {
  let dir: string;
  let log: string;
  let loads = 0;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'memnox-openclaw-'));
    log = join(dir, 'asked.jsonl');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function load(
    argv: readonly string[],
    api: Record<string, unknown> = {},
  ): Promise<Loaded> {
    // A file per load, because an ESM import of the same URL hands back the first module.
    const file = join(dir, `memnox-${loads++}.mjs`);
    await writeFile(file, openClawPluginSource(argv, 'command'), 'utf8');
    const plugin = (await import(pathToFileURL(file).href)) as {
      default: { id: string; register: (api: unknown) => void };
    };
    const handlers = new Map<string, Handler>();
    const options = new Map<string, unknown>();
    const warnings: string[] = [];
    plugin.default.register({
      ...api,
      on: (name: string, handler: Handler, opts?: unknown) => {
        handlers.set(name, handler);
        options.set(name, opts);
      },
      logger: {
        info: () => undefined,
        warn: (line: string) => warnings.push(line),
        error: () => undefined,
      },
    });
    expect(plugin.default.id).toBe('memnox');
    return { handlers, warnings, options };
  }

  async function standIn(api: Record<string, unknown> = {}): Promise<Loaded> {
    const script = join(dir, 'stand-in.mjs');
    await writeFile(script, STAND_IN, 'utf8');
    return load([process.execPath, script, log], api);
  }

  async function before(
    loaded: Loaded,
    toolName: string,
    ctx: Record<string, unknown> = {},
  ): Promise<unknown> {
    const handler = loaded.handlers.get('before_tool_call');
    if (handler === undefined) throw new Error('before_tool_call is registered');
    return handler(
      { toolName, toolCallId: 'call-1', params: { command: 'x' } },
      { sessionKey: 'agent:main:main', sessionId: 'rotating', agentId: 'main', ...ctx },
    );
  }

  async function lastAsked(): Promise<Record<string, unknown>> {
    const lines = (await readFile(log, 'utf8')).trim().split('\n');
    return JSON.parse(lines[lines.length - 1] ?? '{}') as Record<string, unknown>;
  }

  it('listens on the tool and session hooks, and on nothing it needs a grant for', async () => {
    const { handlers } = await standIn();

    expect([...handlers.keys()].sort()).toEqual([
      'after_tool_call',
      'before_tool_call',
      'session_end',
      'session_start',
    ]);
  });

  it('hands the hook the call under the session key, which survives a reset', async () => {
    const loaded = await standIn();
    await before(loaded, 'read');

    const asked = JSON.parse((await readFile(log, 'utf8')).trim()) as Record<
      string,
      unknown
    >;
    expect(asked).toMatchObject({
      hook_event_name: 'before_tool_call',
      session_id: 'agent:main:main',
      agent_id: 'main',
      tool_name: 'read',
      tool_input: { command: 'x' },
    });
  });

  it("turns the hook's answers into OpenClaw's block and its approval", async () => {
    const loaded = await standIn();

    expect(await before(loaded, 'read')).toBeUndefined();
    expect(await before(loaded, 'exec')).toEqual({
      block: true,
      blockReason: 'not that command',
    });
    expect(await before(loaded, 'apply_patch')).toEqual({
      block: true,
      blockReason: 'held by codex',
    });
    expect(await before(loaded, 'write')).toMatchObject({
      requireApproval: {
        description: 'outside the task',
        allowedDecisions: ['allow-once', 'deny'],
      },
    });
  });

  it('lets a call through and says so when the hook cannot be run at all', async () => {
    /* The same as every other host: a hook that is gone is not a refusal, and the hook
       itself refuses in enforce when its own check fails. */
    const loaded = await load([join(dir, 'missing-binary')]);

    expect(await before(loaded, 'exec')).toBeUndefined();
    expect(loaded.warnings).toEqual(['memnox: could not run command']);
  });

  it('asks OpenClaw for the time a person needs, without touching its config', async () => {
    const { options } = await standIn();

    expect(options.get('before_tool_call')).toEqual({ timeoutMs: 300_000 });
  });

  it("hands the person's answer back with the call it was about", async () => {
    /* OpenClaw calls the resolution with nothing but the word, so the plugin carries the
       call itself; the hook matches it to the question by OpenClaw's id for the call. */
    const loaded = await standIn();
    const asked = (await before(loaded, 'write')) as {
      requireApproval: { onResolution: (decision: string) => Promise<void> };
    };

    await asked.requireApproval.onResolution('deny');

    expect(await lastAsked()).toMatchObject({
      hook_event_name: 'approval_resolved',
      decision: 'deny',
      tool_use_id: 'call-1',
      tool_name: 'write',
      session_id: 'agent:main:main',
    });
  });
});

describe('where OpenClaw resolves a relative path', () => {
  /* OpenClaw resolves read, write, edit and exec against the agent's run directory, which
     its tool hook never names. Without it a "../.ssh/id_ed25519" met no absolute rule. */
  let dir: string;
  let log: string;
  let loads = 0;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'memnox-openclaw-root-'));
    log = join(dir, 'asked.jsonl');
    await writeFile(join(dir, 'stand-in.mjs'), STAND_IN, 'utf8');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function rootFor(
    api: Record<string, unknown>,
    agentId = 'main',
    sessionKey = 'agent:main:main',
  ): Promise<Record<string, unknown>> {
    const file = join(dir, `memnox-${loads++}.mjs`);
    await writeFile(
      file,
      openClawPluginSource([process.execPath, join(dir, 'stand-in.mjs'), log], 'command'),
      'utf8',
    );
    const plugin = (await import(pathToFileURL(file).href)) as {
      default: { register: (api: unknown) => void };
    };
    let handler: Handler | undefined;
    plugin.default.register({
      ...api,
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
      on: (name: string, each: Handler) => {
        if (name === 'before_tool_call') handler = each;
      },
    });
    await handler?.({ toolName: 'read', params: {} }, { agentId, sessionKey });
    const lines = (await readFile(log, 'utf8')).trim().split('\n');
    const asked = JSON.parse(lines[lines.length - 1] ?? '{}') as Record<string, unknown>;
    return { cwd: asked['cwd'], sandboxed: asked['sandboxed'] };
  }

  it("is the default agent's workspace from the config", async () => {
    expect(
      await rootFor({ config: { agents: { defaults: { workspace: '/srv/ws' } } } }),
    ).toEqual({
      cwd: '/srv/ws',
      sandboxed: undefined,
    });
  });

  it('is a folder of its own under the shared workspace for any other agent', async () => {
    const config = {
      agents: {
        defaults: { workspace: '/srv/ws' },
        entries: { main: { default: true }, scout: {} },
      },
    };

    expect((await rootFor({ config }, 'scout'))['cwd']).toBe('/srv/ws/scout');
  });

  it("follows the agent's run directory where one is set", async () => {
    const config = { agents: { defaults: { workspace: '/srv/ws', cwd: 'app' } } };

    expect((await rootFor({ config }))['cwd']).toBe('/srv/ws/app');
  });

  it("takes OpenClaw's own resolver over its own reading of the config", async () => {
    const runtime = { agent: { resolveAgentWorkspaceDir: () => '/from/openclaw' } };

    expect((await rootFor({ config: {}, runtime }))['cwd']).toBe('/from/openclaw');
  });

  it('reads the live config over the snapshot it was registered with', async () => {
    const runtime = {
      config: { current: () => ({ agents: { defaults: { workspace: '/live' } } }) },
    };

    expect(
      (
        await rootFor({
          config: { agents: { defaults: { workspace: '/stale' } } },
          runtime,
        })
      )['cwd'],
    ).toBe('/live');
  });

  it('names no directory for a sandboxed call, whose paths are inside its container', async () => {
    const all = {
      agents: { defaults: { workspace: '/srv/ws', sandbox: { mode: 'all' } } },
    };
    const nonMain = { agents: { defaults: { sandbox: { mode: 'non-main' } } } };

    expect(await rootFor({ config: all })).toEqual({ cwd: undefined, sandboxed: true });
    expect(await rootFor({ config: nonMain }, 'main', 'agent:main:telegram:9')).toEqual({
      cwd: undefined,
      sandboxed: true,
    });
  });
});

describe('the plugin in openclaw.json', () => {
  const PLUGIN = '/home/me/.openclaw/memnox/memnox.mjs';
  const CONFIG = [
    '{',
    '    // mine',
    '    "agents": { "defaults": { "model": "anthropic/claude" } },',
    '}',
    '',
  ].join('\n');

  it('loads and enables it, keeping comments and indentation', () => {
    const next = withOpenClawPlugin(CONFIG, PLUGIN) ?? '';
    const parsed = parse(next) as {
      plugins: { load: { paths: string[] }; entries: Record<string, unknown> };
    };

    expect(next).toContain('// mine');
    expect(next).toContain('\n    "plugins"');
    expect(parsed.plugins.load.paths).toEqual([PLUGIN]);
    expect(parsed.plugins.entries['memnox']).toEqual({ enabled: true });
  });

  it('joins an allowlist that is there, since one turns off every plugin it does not name', () => {
    const kept =
      withOpenClawPlugin('{ "plugins": { "allow": ["voice"] } }', PLUGIN) ?? '';
    const none = withOpenClawPlugin('{}', PLUGIN) ?? '';

    expect((parse(kept) as { plugins: { allow: string[] } }).plugins.allow).toEqual([
      'voice',
      'memnox',
    ]);
    expect(
      (parse(none) as { plugins: { allow?: unknown } }).plugins.allow,
    ).toBeUndefined();
  });

  it('changes nothing the second time, and takes out only what it added', () => {
    const once = withOpenClawPlugin(CONFIG, PLUGIN) ?? '';

    expect(withOpenClawPlugin(once, PLUGIN)).toBe(once);
    expect(parse(withoutOpenClawPlugin(once, PLUGIN) ?? '')).toEqual({
      ...(parse(CONFIG) as object),
      plugins: { load: { paths: [] }, entries: {} },
    });
  });
});

describe('the plugin in an openclaw.json written as JSON5', () => {
  /* OpenClaw reads JSON5, and its own config writer re-serializes the file and strips the
     comments. So this inserts its keys as marked text and takes back exactly that. */
  const PLUGIN = '/home/me/.openclaw/memnox/memnox.mjs';
  const JSON5_CONFIG = [
    '// my gateway',
    '{',
    '  agents: { defaults: { workspace: "~/work" } }, // where it works',
    '  channels: { telegram: { enabled: true, }, },',
    '}',
    '',
  ].join('\n');

  function plugins(text: string): {
    load: { paths: string[] };
    entries: Record<string, { enabled: boolean }>;
    allow?: string[];
  } {
    const json = text
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
      .replace(/'/g, '"')
      .replace(/,(\s*[}\]])/g, '$1');
    return (JSON.parse(json) as { plugins: ReturnType<typeof plugins> }).plugins;
  }

  it('adds the plugin where there was no plugins block, keeping every comment', () => {
    const next = withOpenClawPlugin(JSON5_CONFIG, PLUGIN) ?? '';

    expect(next).toContain('// my gateway');
    expect(next).toContain('// where it works');
    expect(plugins(next)).toEqual({
      load: { paths: [PLUGIN] },
      entries: { memnox: { enabled: true } },
    });
  });

  it('joins a plugins block already there, its paths and its allowlist', () => {
    const config = [
      '{',
      "  plugins: { allow: ['voice'], load: { paths: ['/opt/voice.mjs'] }, entries: { voice: { enabled: true } } },",
      '}',
    ].join('\n');

    expect(plugins(withOpenClawPlugin(config, PLUGIN) ?? '')).toEqual({
      allow: ['memnox', 'voice'],
      load: { paths: [PLUGIN, '/opt/voice.mjs'] },
      entries: { memnox: { enabled: true }, voice: { enabled: true } },
    });
  });

  it('changes nothing the second time, and gives back the file byte for byte', () => {
    const once = withOpenClawPlugin(JSON5_CONFIG, PLUGIN) ?? '';

    expect(withOpenClawPlugin(once, PLUGIN)).toBe(once);
    expect(withoutOpenClawPlugin(once, PLUGIN)).toBe(JSON5_CONFIG);
  });

  it('leaves an entry the person wrote for the plugin as they wrote it', () => {
    const config = '{ plugins: { entries: { memnox: { enabled: false } } } }';

    expect(plugins(withOpenClawPlugin(config, PLUGIN) ?? '').entries).toEqual({
      memnox: { enabled: false },
    });
  });

  it('leaves a file it cannot read with certainty alone', () => {
    expect(withOpenClawPlugin('{ plugins: { /* never closed ', PLUGIN)).toBeNull();
    expect(withOpenClawPlugin('{ plugins: [1, 2 3] }', PLUGIN)).toBeNull();
  });
});

describe('installing it', () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'memnox-openclaw-home-'));
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it('does nothing where OpenClaw is not installed', async () => {
    expect(await installOpenClawPlugin(home)).toBe(false);
  });

  it('writes a plugin the keeper reads as current, and takes it all out again', async () => {
    await mkdir(join(home, '.openclaw'));

    expect(await installOpenClawPlugin(home)).toBe(true);

    const source = await readFile(join(home, OPENCLAW_PLUGIN), 'utf8');
    expect(runsCurrentHook(source)).toBe(true);
    expect(holdsPolicyHook(source, 'openclaw')).toBe(true);

    expect(await removeOpenClawPlugin(home)).toBe(true);
    const config = parse(await readFile(join(home, OPENCLAW_CONFIG), 'utf8')) as {
      plugins: { load: { paths: string[] }; entries: Record<string, unknown> };
    };
    expect(config.plugins.load.paths).toEqual([]);
    expect(config.plugins.entries).toEqual({});
  });
});
