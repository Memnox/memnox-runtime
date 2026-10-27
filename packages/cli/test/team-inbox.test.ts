import { createPublicKey, verify } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { confirmationMessage, PendingApprovals, type HoldRequest } from '@memnox/core';
import { CliContext } from '../src/cli-context';
import { RecordedOutput } from '../src/cli-output';
import { registerApprovalsCommand } from '../src/commands/approvals.command';
import { registerInboxCommand } from '../src/commands/inbox.command';
import { plainStyle } from '../src/style';
import { enrolPerson, readPerson } from '../src/sync/person';

const NOW = new Date('2026-10-06T10:00:00.000Z');
const BASE = 'https://api.memnox.test';

interface Sent {
  method: string;
  path: string;
  auth?: string;
  body?: Record<string, unknown>;
}

/** A control plane answering by path, keeping every request it was sent. */
function cloud(answers: Record<string, unknown>): Sent[] {
  const sent: Sent[] = [];
  vi.stubGlobal('fetch', async (url: URL, init: RequestInit) => {
    const headers = init.headers as Record<string, string>;
    const path = new URL(String(url)).pathname;
    sent.push({
      method: init.method ?? 'GET',
      path,
      ...(headers['authorization'] === undefined
        ? {}
        : { auth: headers['authorization'] }),
      ...(typeof init.body === 'string'
        ? { body: JSON.parse(init.body) as Record<string, unknown> }
        : {}),
    });
    const key = Object.keys(answers).find((each) => path.endsWith(each));
    return new Response(JSON.stringify(key === undefined ? {} : answers[key]), {
      status: 200,
    });
  });
  return sent;
}

afterEach(() => {
  vi.unstubAllGlobals();
  process.exitCode = undefined;
});

async function signedIn(): Promise<{ home: string; sent: Sent[] }> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-team-'));
  const sent = cloud({
    '/v1/me': {
      workspaces: [
        { id: 'ws_other', orgId: 'org_x' },
        { id: 'ws_1', orgId: 'org_1' },
      ],
    },
    '/v1/me/devices': { id: 'pdv_term' },
  });
  await enrolPerson(home, BASE, {
    token: 'tok',
    personId: 'usr_ana',
    name: 'Ana',
    orgId: 'org_1',
  });
  return { home, sent };
}

describe('a person signed in from a terminal', () => {
  it("registers this terminal's own key in the person's organisation's workspace", async () => {
    const { home, sent } = await signedIn();
    const person = await readPerson(home);

    expect(person).toMatchObject({
      workspaceId: 'ws_1',
      deviceId: 'pdv_term',
      name: 'Ana',
    });
    const register = sent.find((each) => each.path === '/v1/me/devices');
    expect(register?.body).toMatchObject({ kind: 'desktop' });
    expect(Buffer.from(String(register?.body?.['signingPoint']), 'base64')).toHaveLength(
      65,
    );
  });

  it('answers a team question with a yes signed over the words a phone signs, and a no unsigned', async () => {
    const { home } = await signedIn();
    const sent = cloud({ '/held/apr_team': { id: 'apr_team', status: 'answered' } });
    const run = async (args: string[]): Promise<void> => {
      const program = new Command();
      registerApprovalsCommand(
        program,
        new CliContext(new RecordedOutput(), plainStyle),
        {
          home: () => home,
          now: () => NOW,
          who: () => 'ana',
        },
      );
      await program.parseAsync(args, { from: 'user' });
    };

    await run(['approve', 'apr_team']);
    await run(['deny', 'apr_team']);

    const [yes, no] = sent.filter(
      (each) => each.path === '/v1/workspaces/ws_1/me/held/apr_team',
    );
    expect(yes?.body).toMatchObject({ answer: 'once', deviceId: 'pdv_term' });
    expect(no?.body).toEqual({ answer: 'deny', deviceId: 'pdv_term' });
    const person = await readPerson(home);
    const publicKey = createPublicKey(person?.privateKey ?? '');
    expect(
      verify(
        'sha256',
        Buffer.from(confirmationMessage('apr_team', 'once')),
        { key: publicKey, dsaEncoding: 'der' },
        Buffer.from(String(yes?.body?.['signature']), 'base64'),
      ),
    ).toBe(true);
  });
});

describe('memnox inbox', () => {
  it('lists what this machine holds and what the team routed here, with counts', async () => {
    const { home } = await signedIn();
    const request: HoldRequest = {
      sessionId: 'ses_1',
      agent: 'claude-code',
      operation: 'git.push',
      target: 'main',
      fingerprint: 'abc12345',
      reason: 'a person approves pushes to main',
    };
    await new PendingApprovals(home).raise(request, NOW.toISOString(), 120_000);
    cloud({
      '/me/held': [
        {
          id: 'apr_team',
          machineId: 'mch_1',
          machineLabel: 'build-box',
          agent: 'Hermes',
          operation: 'deploy.run',
          summary: 'deploy billing',
          reason: 'deploys need a person',
          expiresAt: '2026-10-06T10:10:00.000Z',
          escalated: true,
          approvalsNeeded: 2,
        },
      ],
    });
    const out = new RecordedOutput();
    const program = new Command();
    registerInboxCommand(program, new CliContext(out, plainStyle), {
      home: () => home,
      now: () => NOW,
    });

    await program.parseAsync(['inbox'], { from: 'user' });

    expect(out.text).toContain('2 waiting: 1 here, 1 from your team');
    expect(out.text).toContain('Hermes on build-box wants to deploy billing');
    expect(out.text).toContain('asked of your team, needs 2 people');
  });
});
