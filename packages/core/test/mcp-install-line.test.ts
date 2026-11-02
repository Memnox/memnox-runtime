import { describe, expect, it } from 'vitest';
import { runnerForInstall } from '../src/mcp/install-line';

/** A server typed as the install a README shows is started by the runner that installs it instead. */

describe('a server command typed as a package install', () => {
  it('is started with uvx when it is a Python install', () => {
    expect(runnerForInstall('pip', ['install', 'comfy-mcp'])).toEqual({
      command: 'uvx',
      args: ['comfy-mcp'],
      installs: 'comfy-mcp',
    });
    expect(
      runnerForInstall('python3', ['-m', 'pip', 'install', '-U', 'comfy-mcp'])?.args,
    ).toEqual(['comfy-mcp']);
    expect(runnerForInstall('uv', ['tool', 'install', 'comfy-mcp'])?.command).toBe('uvx');
  });

  it('keeps a pinned or extra Python spec as written and runs it by its name', () => {
    expect(runnerForInstall('pip3', ['install', 'comfy-mcp==1.2.0'])?.args).toEqual([
      '--from',
      'comfy-mcp==1.2.0',
      'comfy-mcp',
    ]);
  });

  it('is started with npx when it is a Node install, global or not', () => {
    expect(runnerForInstall('npm', ['i', '-g', '@scope/server@1.0.0'])).toEqual({
      command: 'npx',
      args: ['-y', '@scope/server@1.0.0'],
      installs: '@scope/server@1.0.0',
    });
    expect(runnerForInstall('/usr/local/bin/npm', ['install', 'server-x'])?.args).toEqual(
      ['-y', 'server-x'],
    );
    expect(runnerForInstall('yarn', ['global', 'add', 'server-x'])?.command).toBe('npx');
  });

  it('is left as typed when it is a start command or more than one install', () => {
    expect(runnerForInstall('npx', ['-y', 'server-x'])).toBeNull();
    expect(runnerForInstall('uvx', ['comfy-mcp'])).toBeNull();
    expect(runnerForInstall('pip', ['install', 'a', 'b'])).toBeNull();
    expect(
      runnerForInstall('pip', ['install', '-i', 'https://example.com', 'a']),
    ).toBeNull();
    expect(runnerForInstall('pip', ['install', 'a', '&&', 'a'])).toBeNull();
    expect(runnerForInstall('pip', ['install'])).toBeNull();
  });
});
