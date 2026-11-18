import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CONFIG_FORMAT,
  describeTrouble,
  DISCOVERED_AGENT_KIND,
  entryDigest,
  entryFor,
  HUB_TRANSPORT,
  hubServerProblems,
  NO_ADDRESS_LINE,
  planSync,
  SERVER_TROUBLE,
  ServerTroubles,
  troubleOfStatus,
  type Hub,
  type HubServer,
} from '../src';

/**
 * A server the agent has to sign in to is written as its address and nothing else, since the proxy
 * can never do that sign in and a line behind it would only ever show as disconnected.
 */

const CLAUDE = DISCOVERED_AGENT_KIND.CLAUDE_CODE;
const DESKTOP = DISCOVERED_AGENT_KIND.CLAUDE_DESKTOP;
const CODEX = DISCOVERED_AGENT_KIND.CODEX_CLI;

const VIDEOS: HubServer = {
  name: 'videos',
  transport: HUB_TRANSPORT.HTTP,
  url: 'https://videos.example.com/mcp',
  direct: true,
  env: {},
  secrets: {},
};

function hubFor(agent: typeof CLAUDE | typeof DESKTOP | typeof CODEX): Hub {
  return {
    version: 1,
    servers: [VIDEOS],
    assignments: [{ server: 'videos', agent }],
    written: [],
  };
}

describe('a hub server the agent signs in to itself', () => {
  it('is written as its address, with no proxy in front', () => {
    expect(entryFor(VIDEOS, CLAUDE)).toEqual({
      type: 'http',
      url: 'https://videos.example.com/mcp',
    });
  });

  it('stays behind the proxy when it is not marked', () => {
    const { direct: _direct, ...proxied } = VIDEOS;
    expect(entryFor(proxied, CLAUDE)).toMatchObject({ command: 'memnox-mcp-proxy' });
  });

  it('replaces the proxy line the hub wrote earlier', () => {
    const { direct: _direct, ...proxied } = VIDEOS;
    const old = entryFor(proxied, CLAUDE);
    const plan = planSync(
      {
        ...hubFor(CLAUDE),
        written: [
          {
            path: '/c.json',
            server: 'videos',
            digest: entryDigest(old, CONFIG_FORMAT.JSON),
          },
        ],
      },
      [
        {
          path: '/c.json',
          format: CONFIG_FORMAT.JSON,
          agent: CLAUDE,
          servers: { videos: old },
        },
      ],
    );

    expect(plan.files[0]?.update).toEqual([
      { name: 'videos', entry: { type: 'http', url: 'https://videos.example.com/mcp' } },
    ]);
  });

  it('is not written for an agent that only starts commands, and says why', () => {
    const plan = planSync(hubFor(DESKTOP), [
      { path: '/d.json', format: CONFIG_FORMAT.JSON, agent: DESKTOP, servers: {} },
    ]);

    expect(plan.files[0]?.add).toEqual([]);
    expect(plan.files[0]?.skipped).toEqual([{ name: 'videos', reason: NO_ADDRESS_LINE }]);
  });

  it('is not written into a text config, which holds launch lines only', () => {
    const plan = planSync(hubFor(CODEX), [
      { path: '/c.toml', format: CONFIG_FORMAT.TOML, agent: CODEX, servers: {} },
    ]);

    expect(plan.files[0]?.add).toEqual([]);
    expect(plan.files[0]?.skipped).toEqual([{ name: 'videos', reason: NO_ADDRESS_LINE }]);
  });

  it('cannot carry a kept secret, which only the proxy could read', () => {
    expect(
      hubServerProblems({
        ...VIDEOS,
        headers: { Authorization: 'Bearer memnox-secret:videos' },
      }),
    ).toEqual([
      'A server the agent signs in to itself cannot carry a kept secret, since only the proxy can read one.',
    ]);
  });

  it('is a remote server and never a local one', () => {
    expect(
      hubServerProblems({
        name: 'local',
        transport: HUB_TRANSPORT.STDIO,
        command: 'node',
        direct: true,
        env: {},
        secrets: {},
      }),
    ).toEqual(['Only a remote server can be left for the agent to sign in to.']);
  });
});

describe('what a refused remote server means', () => {
  it('is a sign in to do when no credential was sent', () => {
    expect(troubleOfStatus(401)).toBe(SERVER_TROUBLE.SIGN_IN);
  });

  it('is a refused credential when one was sent', () => {
    expect(troubleOfStatus(401, true)).toBe(SERVER_TROUBLE.CREDENTIAL);
  });

  it('is a server not answering for anything else', () => {
    expect(troubleOfStatus(503)).toBe(SERVER_TROUBLE.UNREACHABLE);
    expect(troubleOfStatus(undefined)).toBe(SERVER_TROUBLE.UNREACHABLE);
  });

  it('names the secret a server is missing, and never asks for a sign in', () => {
    expect(
      describeTrouble({
        server: 'github',
        kind: SERVER_TROUBLE.MISSING_SECRET,
        secret: 'github-token',
        at: '2026-11-16T10:00:00.000Z',
      }),
    ).toBe(
      "github cannot start in your agent because it needs the secret github-token, which this computer does not hold. Add it on the server's card in the MCP Hub.",
    );
  });
});

describe('trouble kept for a person', () => {
  it('keeps one per server and agent, and forgets it once the server answers', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-trouble-'));
    const troubles = new ServerTroubles(home);
    const at = '2026-11-16T10:00:00.000Z';
    await troubles.note({
      server: 'a b/c',
      agent: CLAUDE,
      kind: SERVER_TROUBLE.SIGN_IN,
      at,
    });
    await troubles.note({
      server: 'a b/c',
      agent: CLAUDE,
      kind: SERVER_TROUBLE.SIGN_IN,
      at,
    });
    await troubles.note({
      server: 'a b/c',
      agent: CODEX,
      kind: SERVER_TROUBLE.SIGN_IN,
      at,
    });

    expect((await troubles.all()).map((each) => each.agent).sort()).toEqual(
      [CLAUDE, CODEX].sort(),
    );
    await troubles.clear('a b/c', CLAUDE);
    expect((await troubles.all()).map((each) => each.agent)).toEqual([CODEX]);
    await troubles.clearServer('a b/c');
    expect(await troubles.all()).toEqual([]);
  });
});
