import { describe, expect, it } from 'vitest';
import { alertsFor, ALERT } from '../src/discovery/alerts';
import { CHANGE_DIRECTION, CHANGE_SUBJECT } from '../src/discovery/discovery.constants';
import {
  describeHooks,
  discoverHooks,
  foreignHooks,
  HOOK_HOST,
  programOf,
} from '../src/discovery/hooks';
import type { EnvironmentSnapshot, SnapshotHook } from '../src/discovery/snapshot';
import { compareSnapshots } from '../src/discovery/snapshot-changes';
import { FakeMachine } from './fake-machine';

const HOME = '/home/dev';
const PROJECT = '/srv/app';

function settings(hooks: Record<string, unknown>, extra: object = {}): string {
  return JSON.stringify({ ...extra, hooks });
}

const ECC_PLUGIN_HOOKS = JSON.stringify({
  hooks: {
    PreToolUse: [
      {
        matcher: 'Bash',
        hooks: [
          {
            type: 'command',
            command: 'node ${CLAUDE_PLUGIN_ROOT}/scripts/hooks/pre-bash-dev-server.js',
          },
        ],
      },
    ],
    SessionStart: [
      {
        hooks: [
          {
            type: 'command',
            command: 'node ${CLAUDE_PLUGIN_ROOT}/scripts/session-start.js',
          },
        ],
      },
    ],
    Stop: [
      {
        hooks: [
          { type: 'command', command: 'node ${CLAUDE_PLUGIN_ROOT}/scripts/cost.js' },
        ],
      },
    ],
  },
});

describe('hooks the agents here run on their own', () => {
  it('reads Claude Code settings, and sorts what can stop a call from what only watches', async () => {
    const machine = FakeMachine.from({
      [`${HOME}/.claude/settings.json`]: settings({
        PreToolUse: [
          { matcher: 'Bash', hooks: [{ type: 'command', command: './guard.sh' }] },
        ],
        PostToolUse: [
          {
            matcher: 'Edit',
            hooks: [{ type: 'command', command: 'npx prettier --write' }],
          },
        ],
        UserPromptSubmit: [
          { hooks: [{ type: 'command', command: 'python3 inject.py' }] },
        ],
      }),
    });

    const found = await discoverHooks(machine);

    expect(
      found.map((hook) => [hook.event, hook.program, hook.gate, hook.feedsModel]),
    ).toEqual([
      ['PreToolUse', 'guard.sh', true, false],
      ['PostToolUse', 'npx prettier', false, false],
      ['UserPromptSubmit', 'python3 inject.py', true, true],
    ]);
    expect(found[0]?.matcher).toBe('Bash');
    expect(found.every((hook) => hook.host === HOOK_HOST.CLAUDE_CODE)).toBe(true);
  });

  it('never keeps the command line, which is where a token would sit', async () => {
    const line = 'API_TOKEN=sk-live-123 curl -H "x" https://hooks.example.com';
    const machine = FakeMachine.from({
      [`${HOME}/.claude/settings.json`]: settings({
        Stop: [{ hooks: [{ type: 'command', command: line }] }],
      }),
    });

    const [hook] = await discoverHooks(machine);

    expect(hook?.program).toBe('curl');
    expect(JSON.stringify(hook)).not.toContain('sk-live-123');
  });

  it('counts a plugin only when a settings file enables it', async () => {
    const plugins = `${HOME}/.claude/plugins`;
    const machine = FakeMachine.from({
      [`${HOME}/.claude/settings.json`]: JSON.stringify({
        enabledPlugins: { 'ecc@ecc': true, 'idle@market': false },
      }),
      [`${plugins}/cache/ecc/ecc/2.2.3/hooks/hooks.json`]: ECC_PLUGIN_HOOKS,
      [`${plugins}/cache/ecc/ecc/2.10.0/hooks/hooks.json`]: ECC_PLUGIN_HOOKS,
      [`${plugins}/marketplaces/market/plugins/idle/hooks/hooks.json`]: ECC_PLUGIN_HOOKS,
    });

    const found = await discoverHooks(machine);

    expect(found).toHaveLength(3);
    expect(new Set(found.map((hook) => hook.plugin))).toEqual(new Set(['ecc@ecc']));
    // The newest installed version, ordered as numbers rather than as text.
    expect(found[0]?.declaredIn).toContain('/2.10.0/');
    expect(describeHooks(found)).toContain('from ecc@ecc');
  });

  it('reads the flat shape Cursor and Windsurf share, project files included', async () => {
    const machine = FakeMachine.from({
      [`${PROJECT}/.cursor/hooks.json`]: JSON.stringify({
        version: 1,
        hooks: { beforeShellExecution: [{ command: 'bash ./audit.sh' }] },
      }),
      [`${HOME}/.codeium/windsurf/hooks.json`]: JSON.stringify({
        hooks: { post_write_code: [{ command: 'node log.js' }] },
      }),
    });

    const found = await discoverHooks(machine, [PROJECT]);

    expect(found.map((hook) => [hook.host, hook.program, hook.gate])).toEqual([
      [HOOK_HOST.CURSOR, 'bash audit.sh', true],
      [HOOK_HOST.WINDSURF, 'node log.js', false],
    ]);
  });

  it('marks its own hook as the seam, so it is never counted against the machine', async () => {
    const machine = FakeMachine.from({
      [`${HOME}/.claude/settings.json`]: settings({
        PreToolUse: [
          {
            matcher: '*',
            hooks: [
              {
                type: 'command',
                command: 'memnox-edit-hook --policy --agent claude-code',
              },
              { type: 'command', command: './other.sh' },
            ],
          },
        ],
      }),
    });

    const found = await discoverHooks(machine);

    expect(found.find((hook) => hook.program === 'memnox-edit-hook')?.own).toBe(true);
    expect(foreignHooks(found).map((hook) => hook.program)).toEqual(['other.sh']);
  });

  it('reads nothing from a file that does not parse, rather than guessing', async () => {
    const machine = FakeMachine.from({
      [`${HOME}/.claude/settings.json`]: '{ "hooks": ',
    });
    expect(await discoverHooks(machine)).toEqual([]);
  });
});

describe('the program a hook runs', () => {
  it.each([
    ['./scripts/guard.sh --strict', 'guard.sh'],
    ['node /opt/x/session-start.js', 'node session-start.js'],
    ['bash -c "rm -rf $TMP/x"', 'bash'],
    ['FOO=1 BAR=2 python3 -u tools/check.py', 'python3 check.py'],
    ['npx -y @memnox/mcp hook precommit', 'npx @memnox/mcp'],
    ['   ', 'unknown'],
  ])('names %s as %s', (command, program) => {
    expect(programOf(command)).toBe(program);
  });
});

describe('hooks between two scans', () => {
  const hook = (id: string, overrides: Partial<SnapshotHook> = {}): SnapshotHook => ({
    id,
    host: HOOK_HOST.CLAUDE_CODE,
    event: 'PreToolUse',
    program: 'guard.sh',
    declaredIn: `${HOME}/.claude/settings.json`,
    gate: true,
    feedsModel: false,
    own: false,
    ...overrides,
  });
  const snapshot = (hooks?: SnapshotHook[]): EnvironmentSnapshot => ({
    takenAt: '2026-10-03T00:00:00.000Z',
    agents: [],
    servers: [],
    resources: [],
    ...(hooks === undefined ? {} : { hooks }),
  });

  it('reports an arrival as a widening, with an alert naming the next verb', () => {
    const changes = compareSnapshots(
      snapshot([]),
      snapshot([hook('hook_a', { plugin: 'ecc@ecc' })]),
    );

    expect(changes).toEqual([
      expect.objectContaining({
        subject: CHANGE_SUBJECT.HOOK,
        name: 'guard.sh',
        direction: CHANGE_DIRECTION.WIDENS,
        detail: 'runs on claude-code PreToolUse · can stop a tool call · from ecc@ecc',
      }),
    ]);
    expect(alertsFor(changes).map((alert) => alert.kind)).toEqual([ALERT.NEW_HOOK]);
  });

  it('reports a removal as a narrowing, which raises no alert', () => {
    const changes = compareSnapshots(snapshot([hook('hook_a')]), snapshot([]));
    expect(changes.map((change) => change.direction)).toEqual([CHANGE_DIRECTION.NARROWS]);
    expect(alertsFor(changes)).toEqual([]);
  });

  it('says nothing when the earlier scan never read hooks, so an upgrade is not an alarm', () => {
    expect(compareSnapshots(snapshot(), snapshot([hook('hook_a')]))).toEqual([]);
  });

  it('leaves Memnox installing its own hook out of drift', () => {
    expect(
      compareSnapshots(snapshot([]), snapshot([hook('hook_m', { own: true })])),
    ).toEqual([]);
  });
});
