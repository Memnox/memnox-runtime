import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import {
  DECISION_EFFECT,
  FileRevisions,
  writePolicyDocumentFile,
  type Policy,
} from '@memnox/core';
import { CliContext } from '../src/cli-context';
import { RecordedOutput } from '../src/cli-output';
import { plainStyle } from '../src/style';
import { registerPolicyCommand } from '../src/commands/policy.command';

const rule = (name: string): Policy => ({
  name,
  match: { actions: ['git.push-force'] },
  decision: { effect: DECISION_EFFECT.DENY, reason: 'force pushes rewrite history' },
});

async function changed(): Promise<{ home: string; file: string }> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-policy-history-'));
  const file = join(home, 'memnox.policies.toml');
  const revisions = new FileRevisions(home);
  await writePolicyDocumentFile(
    file,
    { version: 1, policies: [rule('no-force')] },
    revisions,
  );
  await writePolicyDocumentFile(file, { version: 1, policies: [] }, revisions);
  return { home, file };
}

async function run(home: string, args: string[]): Promise<RecordedOutput> {
  const out = new RecordedOutput();
  const program = new Command();
  registerPolicyCommand(program, new CliContext(out, plainStyle), { home: () => home });
  await program.parseAsync(['policy', ...args], { from: 'user' });
  return out;
}

describe('memnox policy history', () => {
  it('lists each change newest first, named by the rules it moved', async () => {
    const { home } = await changed();
    const out = await run(home, ['history']);

    expect(out.text).toContain('removed no-force');
    expect(out.text).toContain('added no-force');
    expect(out.text).toContain('2 change(s) kept.');
  });

  it('puts a file back as it was before a change', async () => {
    const { home, file } = await changed();
    await run(home, ['revert', '2']);

    expect(await readFile(file, 'utf8')).toContain('no-force');
    const after = await run(home, ['history', '--json']);
    expect(after.text).toContain('"n": 3');
  });
});
