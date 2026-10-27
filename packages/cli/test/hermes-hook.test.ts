import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { holdsPolicyHook, runsCurrentHook } from '../src/protect/claude-hook';
import {
  HERMES_ALLOWLIST,
  HERMES_CONFIG,
  hermesHookCommand,
  installHermesHook,
  removeHermesHook,
  withHermesHook,
  withoutHermesHook,
} from '../src/protect/hermes-hook';

/* Hermes declares shell hooks in its own config.yaml, a file people edit by hand, and a
   gateway skips any hook missing from its allowlist because it has nobody to ask. */

const CONFIG = [
  '# my Hermes',
  'model: anthropic/claude',
  'hooks:',
  '  post_tool_call:',
  '    - matcher: "write_file|patch"',
  '      command: "~/.hermes/agent-hooks/auto-format.sh"',
  '',
].join('\n');

const AT = '2026-10-17T00:00:00.000Z';

describe('the Hermes hook in config.yaml', () => {
  it('adds the hook on every event and keeps the comments and hooks already there', () => {
    const next = withHermesHook(CONFIG, hermesHookCommand()) ?? '';
    const parsed = parse(next) as { hooks: Record<string, { command: string }[]> };

    expect(next).toContain('# my Hermes');
    expect(parsed.hooks['post_tool_call']?.map((each) => each.command)).toEqual([
      '~/.hermes/agent-hooks/auto-format.sh',
      hermesHookCommand(),
    ]);
    expect(Object.keys(parsed.hooks).sort()).toEqual([
      'on_session_end',
      'on_session_finalize',
      'post_tool_call',
      'pre_llm_call',
      'pre_tool_call',
    ]);
  });

  it('changes nothing the second time', () => {
    const once = withHermesHook(CONFIG, hermesHookCommand()) ?? '';

    expect(withHermesHook(once, hermesHookCommand())).toBe(once);
  });

  it('spells the command the way the keeper finds a current hook', () => {
    /* The keeper looks for the command as JSON spells it. A YAML that quoted it any
       other way would read as an old install and be rewritten on every pass. */
    const next = withHermesHook(CONFIG, hermesHookCommand()) ?? '';

    expect(runsCurrentHook(next)).toBe(true);
    expect(holdsPolicyHook(next, 'hermes')).toBe(true);
  });

  it('gives a question routed to a person the longest Hermes allows', () => {
    const parsed = parse(withHermesHook('', hermesHookCommand()) ?? '') as {
      hooks: Record<string, { timeout?: number }[]>;
    };

    expect(parsed.hooks['pre_tool_call']?.[0]?.timeout).toBe(300);
  });

  it('takes out only what it wrote', () => {
    const next = withHermesHook(CONFIG, hermesHookCommand()) ?? '';

    expect(parse(withoutHermesHook(next) ?? '')).toEqual(parse(CONFIG));
  });

  it('leaves a config with YAML errors alone', () => {
    expect(withHermesHook('hooks: [unclosed', hermesHookCommand())).toBeNull();
  });
});

describe('installing it', () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'memnox-hermes-'));
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it('does nothing where Hermes is not installed', async () => {
    expect(await installHermesHook(home, () => AT)).toBe(false);
  });

  it('approves exactly its own commands, so a gateway registers them', async () => {
    await mkdir(join(home, '.hermes'));
    await writeFile(join(home, HERMES_CONFIG), CONFIG, 'utf8');
    await writeFile(
      join(home, HERMES_ALLOWLIST),
      JSON.stringify({ approvals: [{ event: 'post_tool_call', command: 'theirs' }] }),
      'utf8',
    );

    expect(await installHermesHook(home, () => AT)).toBe(true);

    const allow = JSON.parse(await readFile(join(home, HERMES_ALLOWLIST), 'utf8')) as {
      approvals: { event: string; command: string }[];
    };
    expect(allow.approvals[0]).toEqual({ event: 'post_tool_call', command: 'theirs' });
    expect(
      allow.approvals.filter((each) => each.command === hermesHookCommand()),
    ).toHaveLength(5);
  });

  it('puts the config and the allowlist back on removal, keeping what was theirs', async () => {
    await mkdir(join(home, '.hermes'));
    await writeFile(join(home, HERMES_CONFIG), CONFIG, 'utf8');
    await installHermesHook(home, () => AT);

    expect(await removeHermesHook(home)).toBe(true);

    expect(parse(await readFile(join(home, HERMES_CONFIG), 'utf8'))).toEqual(
      parse(CONFIG),
    );
    const allow = JSON.parse(await readFile(join(home, HERMES_ALLOWLIST), 'utf8')) as {
      approvals: unknown[];
    };
    expect(allow.approvals).toEqual([]);
  });
});
