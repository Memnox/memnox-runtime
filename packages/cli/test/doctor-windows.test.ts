import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { registerDoctorCommand } from '../src/commands/doctor.command';
import { runCommand } from './cli-harness';
import { FakeMachine, HOME, MemorySnapshots } from './machine-harness';

/**
 * On Windows a seam that exists only on macOS or Linux is a gap, and a doctor that said
 * nothing about it would report a clean machine. Driven here with the platform injected.
 */
const MACHINE = {
  [`${HOME}/.claude.json`]: JSON.stringify({
    mcpServers: { github: { command: 'npx', args: ['github-mcp'] } },
  }),
};

async function doctorOn(platform: NodeJS.Platform, args: string[]): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-docwin-'));
  const { out } = await runCommand(
    (program, context) =>
      registerDoctorCommand(program, context, {
        buildReader: () => FakeMachine.from(MACHINE),
        buildSnapshots: () => new MemorySnapshots(),
        home: () => home,
        platform: () => platform,
      }),
    args,
  );
  return out.text;
}

describe('memnox doctor on Windows', () => {
  it('names what governs each agent natively and what is not available there', async () => {
    const text = await doctorOn('win32', ['doctor']);
    expect(text).toContain('What can govern each agent on Windows');
    expect(text).toContain(
      'native on Windows: MCP proxy, PATH interceptors, Claude Code hook',
    );
    expect(text).toContain('not available on Windows: kernel guard');
  });

  it('carries the same answer in --json, so a script reads it rather than the screen', async () => {
    const text = await doctorOn('win32', ['doctor', '--json']);
    const parsed: unknown = JSON.parse(text);
    expect(parsed).toHaveProperty('windows');
  });

  it('puts the same list above the wiring checks', async () => {
    const text = await doctorOn('win32', ['doctor', '--wiring']);
    expect(text).toContain('What can govern each agent on Windows');
    expect(text).toContain('What is actually gating');
  });

  it('says nothing about Windows anywhere else', async () => {
    const text = await doctorOn('darwin', ['doctor']);
    expect(text).not.toContain('on Windows');
  });
});
