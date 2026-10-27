import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { CODEX_HOOK_TRUST, codexHookStandingOf } from '@memnox/core';
import { readCodexHookStanding } from '../src/agents/codex-hooks';
import { displayName } from '../src/agents/names';
import { holdsPolicyHook, runsCurrentHook } from '../src/protect/claude-hook';
import {
  HERMES_ALLOWLIST,
  HERMES_CONFIG,
  installHermesHook,
} from '../src/protect/hermes-hook';
import {
  HERMES_PLUGIN,
  hermesPluginSource,
  installHermesPlugin,
  removeHermesPlugin,
  withPluginDisabled,
  withPluginEnabled,
} from '../src/protect/hermes-plugin';
import {
  COPILOT_HOOKS,
  copilotHooksFile,
  DEVIN_SETTINGS,
  installCopilotHook,
  installDevinHook,
  removeCopilotHook,
} from '../src/protect/named-host-hooks';
import { openClawConfigPath } from '../src/protect/openclaw-plugin';
import {
  HOOK_LAUNCHER,
  hookLauncherScript,
  launcherIsCurrent,
  writeHookLauncher,
} from '../src/protect/hook-launcher';
import { editHookCommand, namedHookArgv } from '../src/protect/claude-hook';
import {
  installOpenCodePlugin,
  OPENCODE_PLUGIN,
  openCodePluginSource,
  removeOpenCodePlugin,
} from '../src/protect/opencode-plugin';

/* The agents preloop governs that Memnox did not: Copilot CLI, Devin, OpenCode, Hermes
   through a plugin that can ask, and the Codex hooks that stop running without a word. */

/** A stand-in for the hook, answering by tool: blocks `exec`, asks about `write`. */
const STAND_IN = `
const fs = require('node:fs');
let body = '';
process.stdin.on('data', (chunk) => (body += chunk));
process.stdin.on('end', () => {
  fs.appendFileSync(process.argv[2], body + '\\n');
  const { tool_name } = JSON.parse(body);
  if (tool_name === 'exec' || tool_name === 'terminal') process.stdout.write(JSON.stringify({ decision: 'block', reason: 'not that' }) + '\\n');
  if (tool_name === 'write' || tool_name === 'write_file') process.stdout.write(JSON.stringify({ decision: 'ask', reason: 'outside the task' }) + '\\n');
});
`;

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'memnox-agents-'));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

async function standIn(): Promise<{ argv: string[]; log: string }> {
  const script = join(home, 'stand-in.cjs');
  await writeFile(script, STAND_IN, 'utf8');
  const log = join(home, 'asked.jsonl');
  return { argv: [process.execPath, script, log], log };
}

async function lastAsked(log: string): Promise<Record<string, unknown>> {
  const lines = (await readFile(log, 'utf8')).trim().split('\n');
  return JSON.parse(lines[lines.length - 1] ?? '{}') as Record<string, unknown>;
}

describe('Codex hooks it no longer runs', () => {
  const MARKER = 'memnox-edit-hook';
  const listed = (trustStatus: string, enabled = true): unknown => ({
    data: [
      {
        cwd: '/repo',
        hooks: [
          {
            eventName: 'PreToolUse',
            command: `node x --${MARKER}`,
            trustStatus,
            enabled,
          },
          {
            eventName: 'Stop',
            command: `node x --${MARKER}`,
            trustStatus: 'trusted',
            enabled,
          },
          {
            eventName: 'PreToolUse',
            command: 'someone-else',
            trustStatus: 'untrusted',
            enabled,
          },
        ],
      },
    ],
  });

  it("reads Codex's own answer: trusted, untrusted by event, or not loaded at all", () => {
    expect(codexHookStandingOf(listed('trusted'), MARKER)).toEqual({
      trust: CODEX_HOOK_TRUST.TRUSTED,
    });
    expect(codexHookStandingOf(listed('untrusted'), MARKER)).toEqual({
      trust: CODEX_HOOK_TRUST.UNTRUSTED,
      untrusted: ['PreToolUse'],
    });
    expect(codexHookStandingOf(listed('trusted', false), MARKER).trust).toBe(
      CODEX_HOOK_TRUST.UNTRUSTED,
    );
    expect(codexHookStandingOf({ data: [{ hooks: [] }] }, MARKER).trust).toBe(
      CODEX_HOOK_TRUST.NOT_LOADED,
    );
  });

  it('asks Codex only when its hooks file holds a Memnox hook, and says so when it cannot', async () => {
    const asked: string[] = [];
    const ask = async (cwd: string): Promise<unknown> => {
      asked.push(cwd);
      return listed('untrusted');
    };

    expect((await readCodexHookStanding(home, '/repo', ask, () => true)).trust).toBe(
      CODEX_HOOK_TRUST.ABSENT,
    );
    await mkdir(join(home, '.codex'));
    await writeFile(join(home, '.codex', 'hooks.json'), `{"x":"${MARKER}"}`, 'utf8');
    expect((await readCodexHookStanding(home, '/repo', ask, () => false)).trust).toBe(
      CODEX_HOOK_TRUST.UNKNOWN,
    );
    expect(await readCodexHookStanding(home, '/repo', ask, () => true)).toEqual({
      trust: CODEX_HOOK_TRUST.UNTRUSTED,
      untrusted: ['PreToolUse'],
    });
    expect(asked).toEqual(['/repo']);
  });
});

describe('every hook behind a launcher that never moves', () => {
  /* Codex trusts a hook by a hash of its entry, so an entry naming Memnox's Node and build
     went back for review at every update and stopped running until somebody noticed. */
  const BUILT = '/opt/memnox/dist/bin/edit-hook.js';
  const built = (): boolean => true;

  it('gives every host the launcher by its path, and no Node or build that moves', () => {
    const command = editHookCommand(built, BUILT, home);
    const argv = namedHookArgv('codex-cli', built, BUILT, home);

    expect(command).toBe(`"${join(home, HOOK_LAUNCHER)}"`);
    expect(command).not.toContain(BUILT);
    expect(argv).toEqual([join(home, HOOK_LAUNCHER), '--policy', '--agent', 'codex-cli']);
  });

  it('knows a launcher that runs an old build from one that runs this one', async () => {
    await writeHookLauncher(home);
    expect(launcherIsCurrent(home)).toBe(true);

    await writeFile(
      join(home, HOOK_LAUNCHER),
      hookLauncherScript(['/old/node', '/old/hook.js']),
      'utf8',
    );
    expect(launcherIsCurrent(home)).toBe(false);

    await writeHookLauncher(home);
    expect(launcherIsCurrent(home)).toBe(true);
  });

  it('hands the hook every argument the entry gives it, quoting and all', async () => {
    const echo = join(home, "it's echo.cjs");
    await writeFile(echo, 'console.log(JSON.stringify(process.argv.slice(2)));', 'utf8');
    await writeFile(
      join(home, 'launcher'),
      hookLauncherScript([process.execPath, echo, '--memnox-edit-hook']),
      'utf8',
    );

    const out = execFileSync(
      'sh',
      [join(home, 'launcher'), '--policy', '--agent', 'codex-cli'],
      {
        encoding: 'utf8',
      },
    );

    expect(JSON.parse(out)).toEqual([
      '--memnox-edit-hook',
      '--policy',
      '--agent',
      'codex-cli',
    ]);
  });

  it('is written executable, so a host can run it by its path', async () => {
    const path = await writeHookLauncher(home);
    const { statSync } = await import('node:fs');

    expect(statSync(path).mode & 0o111).not.toBe(0);
  });
});

describe('the Codex inside the ChatGPT app', () => {
  it('is asked when no codex is on PATH, since that is the only Codex such a Mac has', async () => {
    await mkdir(join(home, '.codex'));
    await writeFile(join(home, '.codex', 'hooks.json'), '"memnox-edit-hook"', 'utf8');
    const asked: string[] = [];

    await readCodexHookStanding(
      home,
      '/repo',
      async (_cwd, binary) => {
        asked.push(binary);
        return { data: [] };
      },
      (binary) => binary.includes('ChatGPT.app'),
    );

    expect(asked).toEqual([
      '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex',
    ]);
  });
});

describe('what an agent is called before anybody names it', () => {
  it('spells products the way they spell themselves', () => {
    expect(displayName({}, { id: 'agt_opencode', kind: 'opencode' })).toBe('OpenCode');
    expect(displayName({}, { id: 'agt_openclaw', kind: 'openclaw' })).toBe('OpenClaw');
    expect(displayName({}, { id: 'agt_copilot-cli', kind: 'copilot-cli' })).toBe(
      'Copilot CLI',
    );
  });
});

describe('GitHub Copilot CLI', () => {
  it('owns one hooks file, naming each event for a payload that names none', async () => {
    await mkdir(join(home, '.copilot'));

    expect(await installCopilotHook(home, {})).toBe(true);

    const text = await readFile(join(home, COPILOT_HOOKS), 'utf8');
    const file = JSON.parse(text) as {
      version: number;
      hooks: Record<string, { bash: string; powershell: string; timeoutSec: number }[]>;
    };
    expect(file.version).toBe(1);
    expect(file.hooks['preToolUse']?.[0]?.bash).toContain(
      '--host-event copilot:preToolUse',
    );
    expect(file.hooks['preToolUse']?.[0]?.powershell).toMatch(/^& '/);
    expect(runsCurrentHook(text)).toBe(true);
    expect(holdsPolicyHook(text, 'copilot-cli')).toBe(true);
    expect(file).toEqual(copilotHooksFile());
  });

  it('follows COPILOT_HOME, stays away where Copilot is absent, and deletes only its file', async () => {
    const own = join(home, 'copilot-home');
    await mkdir(own);

    expect(await installCopilotHook(join(home, 'nobody'), {})).toBe(false);
    expect(await installCopilotHook(home, { COPILOT_HOME: own })).toBe(true);
    expect(await removeCopilotHook(home, { COPILOT_HOME: own })).toBe(true);
    expect(await removeCopilotHook(home, { COPILOT_HOME: own })).toBe(false);
  });
});

describe('Devin', () => {
  it("writes Claude Code's shape into Devin's own settings, naming Devin", async () => {
    await mkdir(join(home, '.config', 'devin'), { recursive: true });

    expect(await installDevinHook(home)).toBe(true);

    const text = await readFile(join(home, DEVIN_SETTINGS), 'utf8');
    const hooks = (JSON.parse(text) as { hooks: Record<string, unknown> }).hooks;
    expect(Object.keys(hooks).sort()).toEqual([
      'PostToolUse',
      'PreToolUse',
      'SessionEnd',
      'Stop',
      'UserPromptSubmit',
    ]);
    expect(holdsPolicyHook(text, 'devin')).toBe(true);
  });
});

describe('OpenCode, run as OpenCode runs it', () => {
  type Hooks = Record<string, (input: unknown, output?: unknown) => Promise<void>>;

  async function loaded(argv: readonly string[]): Promise<Hooks> {
    const file = join(home, 'memnox.mjs');
    await writeFile(file, openCodePluginSource(argv, 'command'), 'utf8');
    const plugin = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
    // OpenCode loads every export as a plugin, so there must be exactly one.
    expect(Object.keys(plugin)).toEqual(['MemnoxPlugin']);
    const factory = plugin['MemnoxPlugin'] as (ctx: unknown) => Promise<Hooks>;
    return factory({ directory: '/repo' });
  }

  it('throws on a block, and sends the call under its session from its directory', async () => {
    const { argv, log } = await standIn();
    const hooks = await loaded(argv);
    const before = hooks['tool.execute.before'];
    if (before === undefined) throw new Error('the before hook is registered');

    await expect(
      before(
        { tool: 'exec', sessionID: 'oc1', callID: 'c1' },
        { args: { command: 'x' } },
      ),
    ).rejects.toThrow('not that');
    await before({ tool: 'read', sessionID: 'oc1', callID: 'c2' }, { args: {} });
    expect(await lastAsked(log)).toMatchObject({
      hook_event_name: 'opencode:tool.execute.before',
      session_id: 'oc1',
      tool_name: 'read',
      cwd: '/repo',
    });
  });

  it('is written only where OpenCode is, and taken back out', async () => {
    expect(await installOpenCodePlugin(home)).toBe(false);
    await mkdir(join(home, '.config', 'opencode'), { recursive: true });

    expect(await installOpenCodePlugin(home)).toBe(true);
    expect(runsCurrentHook(await readFile(join(home, OPENCODE_PLUGIN), 'utf8'))).toBe(
      true,
    );
    expect(await removeOpenCodePlugin(home)).toBe(true);
  });
});

describe('Hermes, through a plugin of its own', () => {
  it('enables itself without turning off the plugins Hermes grandfathered in', () => {
    /* A missing plugins.enabled is Hermes loading every installed plugin; writing a list
       with only memnox in it would quietly turn the rest off. */
    const fresh = parse(withPluginEnabled('model: x\n', ['voice']) ?? '') as {
      plugins: { enabled: string[] };
    };
    const listed = parse(
      withPluginEnabled('plugins:\n  enabled: [voice]\n', ['voice', 'other']) ?? '',
    ) as { plugins: { enabled: string[] } };

    expect(fresh.plugins.enabled).toEqual(['voice', 'memnox']);
    expect(listed.plugins.enabled).toEqual(['voice', 'memnox']);
    expect(withPluginDisabled('plugins:\n  enabled: [voice, memnox]\n')).toBe(
      'plugins:\n  enabled: [voice]\n',
    );
  });

  it('replaces the shell hooks an older install left, so no call is ruled twice', async () => {
    await mkdir(join(home, '.hermes'));
    await writeFile(join(home, HERMES_CONFIG), '# mine\nmodel: x\n', 'utf8');
    await installHermesHook(home, () => '2026-10-17T00:00:00.000Z');

    expect(await installHermesPlugin(home)).toBe(true);

    const config = await readFile(join(home, HERMES_CONFIG), 'utf8');
    expect(config).toContain('# mine');
    expect(config).not.toContain('memnox-edit-hook');
    expect((parse(config) as { plugins: { enabled: string[] } }).plugins.enabled).toEqual(
      ['memnox'],
    );
    const allow = JSON.parse(await readFile(join(home, HERMES_ALLOWLIST), 'utf8')) as {
      approvals: unknown[];
    };
    expect(allow.approvals).toEqual([]);
    expect(runsCurrentHook(await readFile(join(home, HERMES_PLUGIN), 'utf8'))).toBe(true);

    expect(await removeHermesPlugin(home)).toBe(true);
    expect(
      (
        parse(await readFile(join(home, HERMES_CONFIG), 'utf8')) as {
          plugins: { enabled: string[] };
        }
      ).plugins.enabled,
    ).toEqual([]);
  });

  const python = spawnSync('python3', ['--version']).status === 0;

  it.skipIf(!python)(
    "blocks, asks through Hermes's approval, and never sends a conversation",
    async () => {
      const { argv, log } = await standIn();
      const dir = join(home, 'plugin');
      await mkdir(dir);
      await writeFile(
        join(dir, '__init__.py'),
        hermesPluginSource(argv, 'command'),
        'utf8',
      );
      const driver = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("memnox_plugin", sys.argv[1])
plugin = importlib.util.module_from_spec(spec)
spec.loader.exec_module(plugin)
hooks = {}
class Ctx:
    def register_hook(self, name, callback):
        hooks[name] = callback
plugin.register(Ctx())
pre = hooks["pre_tool_call"]
print(json.dumps({
    "hooks": sorted(hooks),
    "block": pre(tool_name="terminal", args={"command": "rm -rf /"}, task_id="t1"),
    "ask": pre(tool_name="write_file", args={"path": "a"}, task_id="t1", conversation_history=["secret"]),
    "allow": pre(tool_name="read_file", args={"path": "a"}, task_id="t1"),
}))
`;
      const out = execFileSync(
        'python3',
        ['-I', '-c', driver, join(dir, '__init__.py')],
        {
          encoding: 'utf8',
        },
      );

      expect(JSON.parse(out)).toEqual({
        hooks: [
          'on_session_end',
          'on_session_finalize',
          'post_tool_call',
          'pre_llm_call',
          'pre_tool_call',
        ],
        block: { action: 'block', message: 'not that' },
        ask: { action: 'approve', message: 'outside the task' },
        allow: null,
      });
      const asked = await lastAsked(log);
      expect(asked).toMatchObject({
        hook_event_name: 'pre_tool_call',
        session_id: 't1',
        hermes_plugin: true,
      });
      expect(JSON.stringify(asked)).not.toContain('secret');
    },
  );
});

describe("OpenClaw's config, wherever OpenClaw reads it", () => {
  it('takes the path OpenClaw was pointed at, then openclaw.json5 where only that exists', async () => {
    await mkdir(join(home, '.openclaw'));

    expect(openClawConfigPath(home, { OPENCLAW_CONFIG_PATH: '/etc/oc.json' })).toBe(
      '/etc/oc.json',
    );
    expect(openClawConfigPath(home, {})).toBe(join(home, '.openclaw', 'openclaw.json'));
    await writeFile(join(home, '.openclaw', 'openclaw.json5'), '{}', 'utf8');
    expect(openClawConfigPath(home, {})).toBe(join(home, '.openclaw', 'openclaw.json5'));
  });
});
