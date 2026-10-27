import { describe, expect, it } from 'vitest';
import { appLaunch, bundleOf, editorNamed, type SessionStart } from '@memnox/core';

function start(
  agent: SessionStart['agent'],
  app?: string,
  task = 'review my changes\nand the tests',
): SessionStart {
  return {
    id: 'stt_1',
    agent,
    command: app ?? agent,
    repository: '/Users/me/Documents/my repo',
    task,
    ...(app === undefined ? {} : { app }),
    proposedAt: '2026-10-04T12:00:00.000Z',
    expiresAt: '2026-10-04T12:05:00.000Z',
  };
}

describe('opening an agent desktop app on a repository', () => {
  it('opens a new Codex thread on the folder, and types the task in to send it', () => {
    expect(appLaunch(start('codex', '/Applications/ChatGPT.app'))).toEqual({
      appPath: '/Applications/ChatGPT.app',
      links: ['codex://threads/new?path=%2FUsers%2Fme%2FDocuments%2Fmy%20repo'],
      typed: 'review my changes and the tests',
    });
  });

  it('opens a Claude Code session in the Claude app on the folder', () => {
    expect(appLaunch(start('claude-code')).links).toEqual([
      'claude://code/new?folder=%2FUsers%2Fme%2FDocuments%2Fmy%20repo',
    ]);
  });

  it('fills Cursor chat through its prompt link, since typing after a folder opens lands in the code', () => {
    const launch = appLaunch(start('cursor'));
    expect(launch.links).toEqual([
      'cursor://file/Users/me/Documents/my%20repo/',
      'cursor://anysphere.cursor-deeplink/prompt?text=review%20my%20changes%20and%20the%20tests&workspace=my%20repo',
    ]);
    expect(launch.typed).toBeUndefined();
  });

  it('opens Hermes on the folder it reads from its environment, then types the task', () => {
    expect(appLaunch(start('hermes', '/x/Hermes.app'))).toEqual({
      appPath: '/x/Hermes.app',
      env: { HERMES_DESKTOP_CWD: '/Users/me/Documents/my repo' },
      links: [],
      typed: 'review my changes and the tests',
    });
  });

  it('opens a chat on no folder when the person named none, rather than one of their projects', () => {
    const { repository: _none, ...chat } = start(
      'claude-code',
      '/Applications/Claude.app',
    );
    expect(appLaunch(chat)).toEqual({
      appPath: '/Applications/Claude.app',
      links: [],
      typed: 'review my changes and the tests',
    });
    const { repository: _also, ...cursor } = start('cursor');
    expect(appLaunch(cursor).links).toEqual([
      'cursor://anysphere.cursor-deeplink/prompt?text=review%20my%20changes%20and%20the%20tests',
    ]);
  });

  it('only opens the app when there is nothing to ask it yet', () => {
    expect(appLaunch(start('hermes', '/x/Hermes.app', '')).typed).toBeUndefined();
  });

  it('takes the app a found place sits inside as the app', () => {
    expect(bundleOf('/Applications/ChatGPT.app/Contents/Resources/codex-cli')).toBe(
      '/Applications/ChatGPT.app',
    );
    expect(bundleOf('/Applications/Cursor.app')).toBe('/Applications/Cursor.app');
  });
});

describe('the editor a person names', () => {
  it('reads VS Code however the recognizer spelled it, and nothing else as an editor', () => {
    expect(editorNamed('VS Code')).toBe('vscode');
    expect(editorNamed('Visual Studio Code')).toBe('vscode');
    expect(editorNamed('code')).toBe('vscode');
    expect(editorNamed('the Cursor editor')).toBe('cursor');
    expect(editorNamed('Windsurf')).toBe('windsurf');
    expect(editorNamed('iTerm')).toBeNull();
  });
});
