import { describe, expect, it } from 'vitest';
import { appendTextServer, removeTextServer } from '../src/discovery/text-server-entries';
import { CONFIG_FORMAT, readTextServers } from '../src/discovery/wrap-text';

const LAUNCH = {
  command: 'memnox-mcp-proxy',
  args: ['--memnox-wrapped', '--name', 'github', '--', 'npx', '-y', 'server-github'],
  env: { GITHUB_TOKEN: 'memnox-secret:github-token' },
};

const CODEX = [
  '# my codex settings',
  'model = "o4"',
  '',
  '[mcp_servers.notion]',
  'command = "npx"',
  'args = ["notion-mcp"]',
  '',
].join('\n');

const HERMES = [
  'model: claude',
  'mcp_servers:',
  '  notion:',
  '    command: npx',
  '    args:',
  '      - notion-mcp',
  'tools:',
  '  - shell',
  '',
].join('\n');

describe('adding and removing a server in a text config', () => {
  for (const [format, raw] of [
    [CONFIG_FORMAT.TOML, CODEX],
    [CONFIG_FORMAT.YAML, HERMES],
  ] as const) {
    it(`adds a server the reader then finds, beside the person’s own, in ${format}`, () => {
      const added = appendTextServer(format, raw, 'github', LAUNCH);
      const { servers } = readTextServers(format, added);
      expect(servers['github']).toMatchObject({
        command: LAUNCH.command,
        args: LAUNCH.args,
      });
      expect(servers['notion']).toMatchObject({ command: 'npx', args: ['notion-mcp'] });
    });

    it(`removes only that server and gives back every other byte in ${format}`, () => {
      const added = appendTextServer(format, raw, 'github', LAUNCH);
      const removed = removeTextServer(format, added, 'github');
      expect(Object.keys(readTextServers(format, removed).servers)).toEqual(['notion']);
      expect(removed.trimEnd()).toBe(raw.trimEnd());
    });

    it(`leaves the file as it was when the server is not there, in ${format}`, () => {
      expect(removeTextServer(format, raw, 'github')).toBe(raw);
    });
  }

  it('writes the environment as a sub-table Codex reads, and removes it with the server', () => {
    const added = appendTextServer(CONFIG_FORMAT.TOML, CODEX, 'github', LAUNCH);
    expect(added).toContain(
      '[mcp_servers.github.env]\nGITHUB_TOKEN = "memnox-secret:github-token"',
    );
    expect(removeTextServer(CONFIG_FORMAT.TOML, added, 'github')).not.toContain('github');
  });

  it('starts a servers block in a YAML file that has none', () => {
    const added = appendTextServer(
      CONFIG_FORMAT.YAML,
      'model: claude\n',
      'github',
      LAUNCH,
    );
    expect(Object.keys(readTextServers(CONFIG_FORMAT.YAML, added).servers)).toEqual([
      'github',
    ]);
  });

  it('quotes a TOML table name that holds a dot', () => {
    const added = appendTextServer(CONFIG_FORMAT.TOML, '', 'aws.docs', LAUNCH);
    expect(added).toContain('[mcp_servers."aws.docs"]');
  });
});
