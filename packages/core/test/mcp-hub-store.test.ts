import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  emptyHub,
  HUB_TRANSPORT,
  hubPathFor,
  readHub,
  readHubHealth,
  withServer,
  writeHub,
  writeHubHealth,
} from '../src/index';
import { MCP_HEALTH } from '../src/daemon/mcp-hub';

/** The hub file under the Memnox home: empty until written, and never torn into a half hub. */

async function scratchHome(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'memnox-hub-store-'));
}

describe('the hub store', () => {
  it('reads an empty hub before anything was written', async () => {
    expect(await readHub(await scratchHome())).toEqual(emptyHub());
  });

  it('reads back what it wrote, as names and references only', async () => {
    const home = await scratchHome();
    const hub = withServer(emptyHub(), {
      name: 'github',
      transport: HUB_TRANSPORT.STDIO,
      command: 'npx',
      args: ['-y', 'server-github'],
      env: {},
      secrets: { GITHUB_TOKEN: 'github-token' },
    });
    await writeHub(home, hub);
    expect(await readHub(home)).toEqual(hub);
    expect(hubPathFor(home)).toBe(join(home, '.memnox', 'mcp-hub.json'));
    expect(await readFile(hubPathFor(home), 'utf8')).toContain('github-token');
  });

  it('reads a torn or foreign file as an empty hub rather than throwing', async () => {
    const home = await scratchHome();
    await mkdir(dirname(hubPathFor(home)), { recursive: true });
    await writeFile(hubPathFor(home), '{"version": 1, "servers": ');
    expect(await readHub(home)).toEqual(emptyHub());
    await writeFile(hubPathFor(home), '{"version": 99, "servers": []}');
    expect(await readHub(home)).toEqual(emptyHub());
  });

  it('keeps each server last test apart from the hub', async () => {
    const home = await scratchHome();
    expect(await readHubHealth(home)).toEqual({});
    const health = { github: { state: MCP_HEALTH.HEALTHY, checkedAt: 'now' } };
    await writeHubHealth(home, health);
    expect(await readHubHealth(home)).toEqual(health);
    expect(await readHub(home)).toEqual(emptyHub());
  });
});
