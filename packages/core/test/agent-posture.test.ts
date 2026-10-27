import { describe, expect, it } from 'vitest';
import {
  agentHostOf,
  HOST_LOCATION,
  HOST_SIGNATURE,
  locationOf,
} from '../src/discovery/agent-host';
import { agentLifecycle } from '../src/discovery/agent-lifecycle';
import { APPROVAL_STATE, approvalPostureOf } from '../src/discovery/approval-posture';
import { discover } from '../src/discovery/discover';
import { DISCOVERED_AGENT_KIND } from '../src/discovery/discovery.constants';
import { INVENTORY_VERSION, inventoryOf } from '../src/discovery/inventory';
import { parseCodesign } from '../src/discovery/node-host-inspector';
import { bandFor, RISK_RULE } from '../src/discovery/risk';
import type { EnvironmentSnapshot } from '../src/discovery/snapshot';
import { FakeMachine } from './fake-machine';

const HOME = '/home/dev';
const PROJECT = '/work/app';
const NOW = '2026-10-03T09:00:00.000Z';

const settings = (permissions: Record<string, unknown>): string =>
  JSON.stringify({ permissions });

describe('whether Claude Code asks before it acts', () => {
  it('acts without asking under bypassPermissions, and names the file that says so', async () => {
    const machine = FakeMachine.from({
      [`${HOME}/.claude/settings.json`]: settings({ defaultMode: 'bypassPermissions' }),
    });
    const posture = await approvalPostureOf(
      DISCOVERED_AGENT_KIND.CLAUDE_CODE,
      machine,
      [],
    );
    expect(posture).toEqual({
      state: APPROVAL_STATE.AUTO,
      setting: 'defaultMode = "bypassPermissions"',
      declaredIn: `${HOME}/.claude/settings.json`,
    });
  });

  it('lets the project mode outrank the user mode, as Claude Code does', async () => {
    const machine = FakeMachine.from({
      [`${HOME}/.claude/settings.json`]: settings({ defaultMode: 'bypassPermissions' }),
      [`${PROJECT}/.claude/settings.json`]: settings({ defaultMode: 'default' }),
    });
    const posture = await approvalPostureOf(DISCOVERED_AGENT_KIND.CLAUDE_CODE, machine, [
      PROJECT,
    ]);
    expect(posture.state).toBe(APPROVAL_STATE.ASKS);
    expect(posture.declaredIn).toBe(`${PROJECT}/.claude/settings.json`);
  });

  it('counts an unscoped shell allowed in any file, since allow lists merge', async () => {
    const machine = FakeMachine.from({
      [`${HOME}/.claude/settings.json`]: settings({ defaultMode: 'default' }),
      [`${PROJECT}/.claude/settings.local.json`]: settings({ allow: ['Read', 'Bash'] }),
    });
    const posture = await approvalPostureOf(DISCOVERED_AGENT_KIND.CLAUDE_CODE, machine, [
      PROJECT,
    ]);
    expect(posture.state).toBe(APPROVAL_STATE.AUTO);
    expect(posture.setting).toBe('allow includes "Bash"');
  });

  it('does not count a shell allowed for one command pattern', async () => {
    const machine = FakeMachine.from({
      [`${HOME}/.claude/settings.json`]: settings({ allow: ['Bash(npm test:*)'] }),
    });
    const posture = await approvalPostureOf(
      DISCOVERED_AGENT_KIND.CLAUDE_CODE,
      machine,
      [],
    );
    expect(posture.state).toBe(APPROVAL_STATE.ASKS);
  });

  /* Under `auto` a model answers the permission prompt. That is neither asking a person
     nor acting alone, and folding it into either would hide the one fact worth printing. */
  it('says a model approves under auto, and names the file that says so', async () => {
    const machine = FakeMachine.from({
      [`${HOME}/.claude/settings.json`]: settings({ defaultMode: 'auto' }),
    });
    const posture = await approvalPostureOf(
      DISCOVERED_AGENT_KIND.CLAUDE_CODE,
      machine,
      [],
    );
    expect(posture).toEqual({
      state: APPROVAL_STATE.MODEL_REVIEWED,
      setting: 'defaultMode = "auto"',
      declaredIn: `${HOME}/.claude/settings.json`,
    });
  });

  it('is unknown with no settings file, and with one that does not parse', async () => {
    const none = FakeMachine.from({});
    const broken = FakeMachine.from({ [`${HOME}/.claude/settings.json`]: '{ nope' });
    for (const machine of [none, broken]) {
      const posture = await approvalPostureOf(
        DISCOVERED_AGENT_KIND.CLAUDE_CODE,
        machine,
        [],
      );
      expect(posture.state).toBe(APPROVAL_STATE.UNKNOWN);
    }
  });
});

describe('whether Codex asks before it acts', () => {
  const codex = (toml: string): FakeMachine =>
    FakeMachine.from({ [`${HOME}/.codex/config.toml`]: toml });

  it('never asks under approval_policy "never"', async () => {
    const posture = await approvalPostureOf(
      DISCOVERED_AGENT_KIND.CODEX_CLI,
      codex('approval_policy = "never"\nsandbox_mode = "danger-full-access"\n'),
      [],
    );
    expect(posture.state).toBe(APPROVAL_STATE.AUTO);
    expect(posture.setting).toBe(
      'approval_policy = "never", sandbox_mode = "danger-full-access"',
    );
  });

  it('reads the active profile ahead of the top level', async () => {
    const posture = await approvalPostureOf(
      DISCOVERED_AGENT_KIND.CODEX_CLI,
      codex(
        'profile = "fast"\napproval_policy = "on-request"\n[profiles.fast]\napproval_policy = "never"\n',
      ),
      [],
    );
    expect(posture.state).toBe(APPROVAL_STATE.AUTO);
  });

  it('asks when the policy is unset, which is the product default', async () => {
    const posture = await approvalPostureOf(
      DISCOVERED_AGENT_KIND.CODEX_CLI,
      codex('model = "o4"\n'),
      [],
    );
    expect(posture.state).toBe(APPROVAL_STATE.ASKS);
  });

  it('is unknown for a product it has no reader for', async () => {
    const posture = await approvalPostureOf(DISCOVERED_AGENT_KIND.CURSOR, codex(''), []);
    expect(posture.state).toBe(APPROVAL_STATE.UNKNOWN);
  });
});

describe('the binary an agent runs as', () => {
  it('is the first match on PATH, as a shell would resolve it', async () => {
    const machine = FakeMachine.from({
      '/opt/homebrew/bin/claude': '',
      '/usr/local/bin/claude': '',
    });
    const host = await agentHostOf(DISCOVERED_AGENT_KIND.CLAUDE_CODE, machine, {
      path: '/usr/bin:/opt/homebrew/bin:/usr/local/bin',
      projectDirs: [],
    });
    expect(host?.path).toBe('/opt/homebrew/bin/claude');
    expect(host?.location).toBe(HOST_LOCATION.INSTALLED);
    expect(host?.signature.state).toBe(HOST_SIGNATURE.UNKNOWN);
  });

  it('asks the inspector who signed it when one is given', async () => {
    const machine = FakeMachine.from({ '/usr/local/bin/codex': '' });
    const host = await agentHostOf(DISCOVERED_AGENT_KIND.CODEX_CLI, machine, {
      path: '/usr/local/bin',
      projectDirs: [],
      inspector: {
        inspect: async () => ({ state: HOST_SIGNATURE.SIGNED, signer: 'Developer ID' }),
      },
    });
    expect(host?.signature).toEqual({
      state: HOST_SIGNATURE.SIGNED,
      signer: 'Developer ID',
    });
  });

  it('calls temp, Downloads and the work itself places nothing installs to', () => {
    expect(locationOf('/tmp/claude', HOME, [])).toBe(HOST_LOCATION.UNUSUAL);
    expect(locationOf(`${HOME}/Downloads/claude`, HOME, [])).toBe(HOST_LOCATION.UNUSUAL);
    expect(locationOf(`${PROJECT}/bin/claude`, HOME, [PROJECT])).toBe(
      HOST_LOCATION.UNUSUAL,
    );
    expect(locationOf(`${HOME}/.local/bin/claude`, HOME, [PROJECT])).toBe(
      HOST_LOCATION.INSTALLED,
    );
  });

  it('is absent when nothing is on PATH or the product installs no command', async () => {
    const machine = FakeMachine.from({});
    expect(
      await agentHostOf(DISCOVERED_AGENT_KIND.CLAUDE_CODE, machine, {
        path: '/usr/bin',
        projectDirs: [],
      }),
    ).toBeNull();
    expect(
      await agentHostOf(DISCOVERED_AGENT_KIND.VS_CODE, machine, {
        path: '/usr/bin',
        projectDirs: [],
      }),
    ).toBeNull();
  });
});

describe('what codesign printed', () => {
  it('names the leaf authority of a signed binary', () => {
    const output = [
      'Executable=/usr/local/bin/claude',
      'Authority=Developer ID Application: Example Inc (ABCDE12345)',
      'Authority=Developer ID Certification Authority',
    ].join('\n');
    expect(parseCodesign(output)).toEqual({
      state: HOST_SIGNATURE.SIGNED,
      signer: 'Developer ID Application: Example Inc (ABCDE12345)',
    });
  });

  it('tells ad-hoc from unsigned, and nothing printed from either', () => {
    expect(parseCodesign('Signature=adhoc\n').state).toBe(HOST_SIGNATURE.AD_HOC);
    expect(parseCodesign('x: code object is not signed at all\n').state).toBe(
      HOST_SIGNATURE.UNSIGNED,
    );
    expect(parseCodesign(null).state).toBe(HOST_SIGNATURE.UNKNOWN);
  });
});

describe('an agent that approves its own actions, in the scan', () => {
  const machine = (): FakeMachine =>
    FakeMachine.from({
      [`${HOME}/.claude.json`]: '{}',
      [`${HOME}/.claude/settings.json`]: settings({ defaultMode: 'bypassPermissions' }),
      [`${HOME}/.aws/credentials`]: '[default]\naws_access_key_id = AKIA0000\n',
      '/tmp/evil/claude': '',
    });

  it('fires critical when the agent can also read a secret', async () => {
    const report = await discover(machine(), {
      now: NOW,
      env: { PATH: '/tmp/evil:/usr/bin' },
    });
    const band = bandFor(report);
    const fired = band.fired.find((rule) => rule.rule === RISK_RULE.AUTO_APPROVE);
    expect(fired?.contributes).toBe('critical');
    expect(fired?.because).toMatch(/act without asking and can read \d+ sensitive/);
  });

  it('fires on a binary resolved from temp', async () => {
    const report = await discover(machine(), {
      now: NOW,
      env: { PATH: '/tmp/evil:/usr/bin' },
    });
    expect(bandFor(report).fired.map((rule) => rule.rule)).toContain(
      RISK_RULE.HOST_OUTSIDE_INSTALL,
    );
  });

  it('carries the posture and the binary into the inventory', async () => {
    const report = await discover(machine(), {
      now: NOW,
      env: { PATH: '/tmp/evil:/usr/bin' },
    });
    const inventory = inventoryOf(report, NOW);
    expect(inventory.version).toBe(INVENTORY_VERSION);
    const claude = inventory.agents.find((agent) => agent.kind === 'claude-code');
    expect(claude?.approval?.state).toBe(APPROVAL_STATE.AUTO);
    expect(claude?.host).toEqual({
      path: '/tmp/evil/claude',
      location: HOST_LOCATION.UNUSUAL,
      signature: HOST_SIGNATURE.UNKNOWN,
    });
  });
});

describe('when an agent arrived and whether it is still here', () => {
  const snapshot = (takenAt: string, ids: string[]): EnvironmentSnapshot => ({
    takenAt,
    agents: ids.map((id) => ({ id, kind: id.replace('agt_', ''), surfaces: [] })),
    servers: [],
    resources: [],
  });

  it('dates an arrival after the oldest scan, and not one the oldest already held', () => {
    const lifecycle = agentLifecycle(
      [{ id: 'agt_claude-code' }, { id: 'agt_codex-cli' }],
      [
        snapshot('2026-09-01', ['agt_claude-code']),
        snapshot('2026-09-20', ['agt_claude-code', 'agt_codex-cli']),
      ],
    );
    expect(lifecycle.present).toEqual([
      { id: 'agt_claude-code' },
      { id: 'agt_codex-cli', since: '2026-09-20' },
    ]);
  });

  it('names an agent an earlier scan held and this one does not, with when it was last seen', () => {
    const lifecycle = agentLifecycle(
      [{ id: 'agt_claude-code' }],
      [
        snapshot('2026-09-01', ['agt_claude-code', 'agt_cursor']),
        snapshot('2026-09-15', ['agt_claude-code', 'agt_cursor']),
        snapshot('2026-09-30', ['agt_claude-code']),
      ],
    );
    expect(lifecycle.gone).toEqual([
      { id: 'agt_cursor', kind: 'cursor', lastSeen: '2026-09-15' },
    ]);
  });
});
