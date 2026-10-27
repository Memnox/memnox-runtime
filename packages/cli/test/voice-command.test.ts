import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { ConfirmKeys } from '@memnox/core';
import { CliContext } from '../src/cli-context';
import { RecordedOutput } from '../src/cli-output';
import { plainStyle } from '../src/style';
import { registerVoiceCommand } from '../src/commands/voice.command';

function point(): string {
  const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  return spki.subarray(spki.length - 65).toString('base64');
}

async function run(
  home: string,
  args: string[],
  answer = false,
): Promise<{ out: RecordedOutput; asked: string[] }> {
  const out = new RecordedOutput();
  const asked: string[] = [];
  const program = new Command();
  registerVoiceCommand(program, new CliContext(out, plainStyle), {
    home: () => home,
    confirm: async (question) => {
      asked.push(question);
      return answer;
    },
  });
  await program.parseAsync(['voice', ...args], { from: 'user' });
  return { out, asked };
}

async function withKey(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-voice-cli-'));
  await new ConfirmKeys(home).register(point(), '2026-09-30T10:00:00.000Z');
  return home;
}

describe('memnox voice', () => {
  it('says when a key is registered, and never prints the whole of it', async () => {
    const home = await withKey();
    const { out } = await run(home, []);
    expect(out.text).toContain('2026-09-30T10:00:00.000Z');
    const key = await new ConfirmKeys(home).read();
    expect(out.text).not.toContain(key?.point ?? 'x');
  });

  it('keeps the key unless the person says yes, since the next key to register is trusted', async () => {
    const home = await withKey();
    const { out, asked } = await run(home, ['forget-key']);
    expect(asked).toHaveLength(1);
    expect(out.text).toContain('Kept the key');
    expect(await new ConfirmKeys(home).read()).not.toBeNull();
  });

  it('clears it on a yes, so the Mac app can register its own again', async () => {
    const home = await withKey();
    const { out } = await run(home, ['forget-key'], true);
    expect(out.text).toContain('Cleared');
    expect(await new ConfirmKeys(home).read()).toBeNull();
    expect(await new ConfirmKeys(home).register(point(), 'now')).toHaveProperty(
      'registered',
    );
  });

  it('clears it without asking under --yes', async () => {
    const home = await withKey();
    const { asked } = await run(home, ['forget-key', '--yes']);
    expect(asked).toEqual([]);
    expect(await new ConfirmKeys(home).read()).toBeNull();
  });
});
