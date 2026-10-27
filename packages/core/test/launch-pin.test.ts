import { describe, expect, it } from 'vitest';
import { floats, launchPinOf } from '../src/discovery/launch-pin';
import { wrapLaunch } from '../src/discovery/wrap';

const line = (command: string, ...args: string[]) => ({ command, args });

describe('whether a server launch is pinned', () => {
  it.each([
    [
      line('npx', '-y', '@modelcontextprotocol/server-github'),
      '@modelcontextprotocol/server-github',
      false,
    ],
    [
      line('npx', '-y', '@modelcontextprotocol/server-github@latest'),
      '@modelcontextprotocol/server-github@latest',
      false,
    ],
    [line('npx', '-y', 'some-server@^1.2.0'), 'some-server@^1.2.0', false],
    [
      line('npx', '-y', '@scope/server@1.4.2', '--port', '3'),
      '@scope/server@1.4.2',
      true,
    ],
    [line('npx', '--package', 'tool@2.0.0', 'tool-bin'), 'tool@2.0.0', true],
    [line('/usr/local/bin/bunx', 'mcp-thing'), 'mcp-thing', false],
    [line('pnpm', 'dlx', 'mcp-thing@3.1.0-beta.2'), 'mcp-thing@3.1.0-beta.2', true],
    [line('uvx', 'mcp-server-fetch'), 'mcp-server-fetch', false],
    [line('uvx', 'mcp-server-fetch==0.6.2'), 'mcp-server-fetch==0.6.2', true],
    [
      line('uvx', '-p', '3.12', '--from', 'git-mcp>=1.0', 'git-mcp'),
      'git-mcp>=1.0',
      false,
    ],
    [line('pipx', 'run', '--spec', 'srv==1.0.0', 'srv'), 'srv==1.0.0', true],
    [line('uv', 'tool', 'run', 'srv@1.0.0'), 'srv@1.0.0', true],
  ])('reads %j as %s, pinned %s', (launch, spec, pinned) => {
    expect(launchPinOf(launch)).toEqual(expect.objectContaining({ spec, pinned }));
  });

  it('names nothing for a line that fetches nothing', () => {
    expect(launchPinOf(line('/opt/bin/github-mcp'))).toBeNull();
    expect(launchPinOf(line('node', 'dist/server.js'))).toBeNull();
    expect(launchPinOf(line('pnpm', 'run', 'server'))).toBeNull();
    expect(launchPinOf(line('uv', 'tool', 'install', 'srv'))).toBeNull();
    expect(launchPinOf(line('constructor', 'x'))).toBeNull();
  });

  it('reads through the proxy, which carries the original line after it', () => {
    const wrapped = wrapLaunch('github', line('npx', '-y', '@x/github-mcp'));
    expect(launchPinOf(wrapped)).toEqual({
      runner: 'npx',
      spec: '@x/github-mcp',
      pinned: false,
    });
  });

  it('floats only for a line that fetches and names no exact version', () => {
    expect(floats(launchPinOf(line('npx', '-y', 'a')))).toBe(true);
    expect(floats(launchPinOf(line('npx', '-y', 'a@1.0.0')))).toBe(false);
    expect(floats(launchPinOf(line('/bin/a')))).toBe(false);
  });
});
