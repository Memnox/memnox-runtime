import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DAEMON_METHOD,
  decodeRequest,
  decodeResponse,
  remoteCapabilityFor,
  type DaemonRequest,
  type DaemonResponse,
  type ToolConnection,
} from '@memnox/core';
import {
  answerConnectionCall,
  type ConnectionSeams,
} from '../src/daemon/connection-calls';
import { isVoiceMethod } from '../src/daemon/voice-methods';
import { VoiceSurface } from '../src/daemon/voice-surface';
import {
  connectLink,
  disconnect,
  searchToolkits,
  toolkitsFrom,
} from '../src/sync/connection-work';
import { voicePrompt } from '../src/operator/voice-prompts';
import { PERSONAL_TOOLS } from '../src/session-tools/personal-catalogue';

const NOTION_PAGE = 'https://connect.composio.dev/link/notion';

/** Seams that answer as a signed in person would, recording every page the Mac was asked to open. */
function seamsWith(
  connections: ToolConnection[] = [],
): Partial<ConnectionSeams> & { opened: string[] } {
  const opened: string[] = [];
  return {
    opened,
    list: async () => ({ ok: true, value: connections }),
    link: async () => ({ ok: true, value: NOTION_PAGE }),
    open: async (url) => {
      opened.push(url);
      return true;
    },
  };
}

function signInRequest(fields: Partial<DaemonRequest> = {}): DaemonRequest {
  return {
    id: 4,
    method: DAEMON_METHOD.CONNECTIONS_SIGN_IN,
    toolkit: 'notion',
    ...fields,
  };
}

/** A connection that keeps what it was sent, so the voice's side is tested with no socket. */
class Heard {
  destroyed = false;
  said: DaemonResponse[] = [];
  write(line: string): boolean {
    const response = decodeResponse(line.trim());
    if (response !== null) this.said.push(response);
    return true;
  }
  destroy(): void {
    this.destroyed = true;
  }
}

describe('connections-sign-in, connecting any tool as the person', () => {
  it('opens the page in the Mac browser when asked over the local socket', async () => {
    const seams = seamsWith();
    const response = await answerConnectionCall(
      signInRequest({ toolkit: ' Notion ' }),
      '/nowhere',
      false,
      seams,
    );
    expect(response).toEqual({
      id: 4,
      ok: true,
      signIn: { toolkit: 'notion', url: NOTION_PAGE, opened: true },
    });
    expect(seams.opened).toEqual([NOTION_PAGE]);
  });

  it('hands a paired phone the page to open itself, opening nothing on the Mac', async () => {
    const seams = seamsWith();
    const response = await answerConnectionCall(signInRequest(), '/nowhere', true, seams);
    expect(response.signIn).toEqual({
      toolkit: 'notion',
      url: NOTION_PAGE,
      opened: false,
    });
    expect(seams.opened).toEqual([]);
  });

  it('says a tool already connected is connected, unless asked again for another account', async () => {
    const seams = seamsWith([{ toolkit: 'notion', connected: true }]);
    const twice = await answerConnectionCall(signInRequest(), '/nowhere', false, seams);
    expect(twice).toMatchObject({ id: 4, ok: false });
    expect(twice.error).toMatch(/Notion is already connected/);
    const again = await answerConnectionCall(
      signInRequest({ again: true }),
      '/nowhere',
      false,
      seams,
    );
    expect(again.signIn?.url).toBe(NOTION_PAGE);
  });

  it('passes a refusal on as words, and an unplanned failure as a sentence', async () => {
    const refused = await answerConnectionCall(signInRequest(), '/nowhere', false, {
      ...seamsWith(),
      link: async () => ({ ok: false, said: 'Notion could not be connected. No.' }),
    });
    expect(refused).toEqual({
      id: 4,
      ok: false,
      error: 'Notion could not be connected. No.',
    });
    const broken = await answerConnectionCall(signInRequest(), '/nowhere', false, {
      ...seamsWith(),
      link: async () => {
        throw new Error('boom');
      },
    });
    expect(broken.error).toBe('That tool could not be connected just now.');
  });

  it('refuses over the socket in plain words when the cloud cannot be reached, never asking for an account', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-connect-surface-'));
    const surface = new VoiceSurface({ home, now: () => 'now', log: () => undefined });
    const peer = new Heard();
    await surface.respond(peer, signInRequest());
    surface.close();
    expect(peer.said[0]).toMatchObject({ id: 4, ok: false });
    expect(peer.said[0]?.error).toMatch(/could not reach Memnox Cloud/);
    expect(peer.said[0]?.error).toMatch(/no Memnox account/);
    expect(peer.said[0]?.signIn).toBeUndefined();
  });

  it('asks for a tool by name before reaching the cloud', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-connect-name-'));
    const unnamed = await connectLink(home, '../grants');
    expect(unnamed).toEqual({
      ok: false,
      said: 'Name the tool to connect, such as notion or asana.',
    });
    const unreached = await connectLink(home, 'asana');
    expect(unreached.ok ? '' : unreached.said).toMatch(/could not reach Memnox Cloud/);
  });
});

describe('connections-sign-out, answering the refreshed list', () => {
  it('answers the connections as they stand after the sign out', async () => {
    const after = [{ toolkit: 'gmail', connected: true }];
    const response = await answerConnectionCall(
      { id: 5, method: DAEMON_METHOD.CONNECTIONS_SIGN_OUT, toolkit: 'notion' },
      '/nowhere',
      false,
      { signOut: async () => ({ ok: true, value: after }) },
    );
    expect(response).toEqual({ id: 5, ok: true, connections: after });
  });

  it('has nothing to undo before anything was connected, and registers nothing for it', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-disconnect-'));
    const nobody = await disconnect(home, 'notion');
    expect(nobody.ok ? '' : nobody.said).toBe('Nothing is connected on this Mac yet.');
  });
});

describe('toolkits-search, the catalogue anybody can connect from', () => {
  it('answers what the catalogue matched', async () => {
    const toolkits = [{ slug: 'asana', name: 'Asana' }];
    const response = await answerConnectionCall(
      { id: 6, method: DAEMON_METHOD.TOOLKITS_SEARCH, query: 'asa' },
      '/nowhere',
      true,
      { search: async () => ({ ok: true, value: toolkits }) },
    );
    expect(response).toEqual({ id: 6, ok: true, toolkits });
  });

  it('maps the cloud catalogue to slug, name and logo, thirty at most', () => {
    const items = [
      {
        slug: 'NOTION',
        name: 'Notion',
        logo: 'https://logos/notion.png',
        categories: [],
      },
      { slug: 'jira', name: '' },
      { name: 'No slug' },
      'garbage',
      ...Array.from({ length: 40 }, (_, index) => ({ slug: `tool${index}`, name: 'T' })),
    ];
    const found = toolkitsFrom(items);
    expect(found[0]).toEqual({
      slug: 'notion',
      name: 'Notion',
      logo: 'https://logos/notion.png',
    });
    expect(found[1]).toEqual({ slug: 'jira', name: 'Jira' });
    expect(found).toHaveLength(30);
    expect(toolkitsFrom(undefined)).toEqual([]);
  });

  it('says the menu bar words when the cloud cannot be reached', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-toolkits-'));
    const answer = await searchToolkits(home, 'notion');
    expect(answer.ok ? '' : answer.said).toMatch(/could not reach Memnox Cloud/);
  });
});

describe('who may ask for the connection calls', () => {
  it('lets the Mac ask all three, and a phone see but act only with more', () => {
    for (const method of [
      DAEMON_METHOD.CONNECTIONS_SIGN_IN,
      DAEMON_METHOD.CONNECTIONS_SIGN_OUT,
      DAEMON_METHOD.TOOLKITS_SEARCH,
    ])
      expect(isVoiceMethod(method)).toBe(true);
    expect(remoteCapabilityFor(DAEMON_METHOD.TOOLKITS_SEARCH)).toBe('see');
    expect(remoteCapabilityFor(DAEMON_METHOD.CONNECTIONS_SIGN_IN)).toBe('answer');
    expect(remoteCapabilityFor(DAEMON_METHOD.CONNECTIONS_SIGN_OUT)).toBe('answer');
  });

  it('decodes the new fields and refuses them mistyped', () => {
    const line =
      '{"id":1,"method":"connections-sign-in","toolkit":"notion","again":true}';
    expect(decodeRequest(line)).toMatchObject({ toolkit: 'notion', again: true });
    expect(decodeRequest('{"id":1,"method":"toolkits-search","query":"as"}')?.query).toBe(
      'as',
    );
    expect(
      decodeRequest('{"id":1,"method":"connections-sign-in","again":"yes"}'),
    ).toBeNull();
  });
});

describe('the voice connecting a tool the moment it is asked', () => {
  it('tells the brain any tool can be connected, at once, by anybody', () => {
    const prompt = voicePrompt();
    expect(prompt).toContain('"connect my Notion"');
    expect(prompt).toContain('nobody else has to connect it first');
    const signIn = PERSONAL_TOOLS.find((each) => each.name === 'sign_in');
    expect(signIn?.description).toContain('connect my Notion');
    expect(signIn?.description).toContain('Any tool Memnox Cloud offers');
    expect(signIn?.description).not.toMatch(/admin/);
  });
});
