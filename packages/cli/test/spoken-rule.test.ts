import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ConfirmKeys,
  confirmationMessage,
  DAEMON_METHOD,
  PolicyEngine,
  remoteCapabilityFor,
  REMOTE_CAPABILITY,
  RULE_SCOPE,
  writeAccount,
  type SpokenRuleAnswer,
} from '@memnox/core';
import { confirmAnswer } from '../src/daemon/confirm';
import { answerRule } from '../src/daemon/rule-calls';
import { rulesInForce } from '../src/protect/written-rules';
import { readLocalDecisions } from '../src/sync/local-decisions';
import { pushDecisions } from '../src/sync/push';
import { CloudUnreachable, type CloudResponse } from '../src/sync/client';
import type { CloudCall } from '../src/sync/rule-draft-cloud';
import { callOperatorTool } from '../src/session-tools/operator-tools';
import type { SessionToolDeps } from '../src/session-tools/read-tools';
import type { RewindSeams } from '../src/session-tools/rewind-tool';

/**
 * Any rule a person says, on the Mac or the phone: read back, signed, in force on this machine from
 * the next call, and on an enrolled machine offered to the team, where a second admin approves it.
 */

const NOW = new Date('2026-10-23T12:00:00.000Z');
const AT = NOW.toISOString();

const SEAMS: RewindSeams = {
  build: () => {
    throw new Error('no milestones here');
  },
  unattended: () => true,
  terminal: () => false,
  confirm: async () => null,
};

const PRIVATE_KEY = generateKeyPairSync('ed25519')
  .privateKey.export({ type: 'pkcs8', format: 'pem' })
  .toString();

const homes: string[] = [];

async function depsAt(): Promise<SessionToolDeps> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-spoken-rule-'));
  homes.push(home);
  return {
    home,
    cwd: home,
    agent: 'claude-code',
    env: {},
    now: () => NOW,
    readStatus: async () => ({ mode: 'enforce' }),
    milestonesAt: async () => [],
    brief: async () => null,
    runMemnox: async () => ({ exitCode: 0, output: '' }),
  };
}

async function enrol(home: string): Promise<void> {
  await writeAccount(home, {
    version: 1,
    baseUrl: 'https://cloud.test',
    workspaceId: 'acme',
    machineId: 'mch_1',
    token: 'machine-token',
    privateKey: PRIVATE_KEY,
    enrolledAt: '2026-09-24T09:00:00.000Z',
  });
}

/** A key registered as the Mac's, standing in for Touch ID. */
async function touchId(
  home: string,
): Promise<(subject: string, answer: string) => string> {
  const { publicKey, privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  });
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  await new ConfirmKeys(home).register(
    spki.subarray(spki.length - 65).toString('base64'),
    AT,
  );
  return (subject, answer) => signWith(privateKey, subject, answer);
}

function signWith(key: KeyObject, subject: string, answer: string): string {
  return sign('sha256', Buffer.from(confirmationMessage(subject, answer)), key).toString(
    'base64',
  );
}

async function gate(home: string): Promise<PolicyEngine> {
  return new PolicyEngine(await rulesInForce([], home));
}

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(
    homes.splice(0).map((home) => rm(home, { recursive: true, force: true })),
  );
});

describe('a rule said to the voice', () => {
  it('is read back, written on Touch ID, and denies the very next matching call', async () => {
    const deps = await depsAt();
    const signed = await touchId(deps.home);
    const answer = (await callOperatorTool(deps, SEAMS, 'propose_rule', {
      sentence: 'Codex may not touch the payments database',
    })) as { proposed: string; readBack: string; said: string; offeredToTeam: boolean };
    expect(answer.readBack).toBe('Codex-cli may not touch anything named payments.');
    expect(answer.said).toContain('Touch ID');
    expect(answer.offeredToTeam).toBe(false);

    const query = { action: 'sql.query', target: 'postgres://db/payments' };
    // Nothing holds before the person signs.
    expect(
      (await gate(deps.home)).evaluate(query, { agentName: 'codex' }).matchedPolicies,
    ).toEqual([]);

    expect(
      await confirmAnswer(deps.home, {
        subject: answer.proposed,
        answer: RULE_SCOPE.MACHINE,
        signature: signed(answer.proposed, RULE_SCOPE.MACHINE),
        at: AT,
      }),
    ).toEqual({ ok: true, outcome: 'confirmed' });
    const engine = await gate(deps.home);
    expect(engine.evaluate(query, { agentName: 'codex' }).effect).toBe('deny');
    expect(engine.evaluate(query, { agentName: 'claude-code' }).matchedPolicies).toEqual(
      [],
    );
    // Works with no account at all, so nothing waits to be offered.
    expect(await readLocalDecisions(deps.home)).toEqual([]);
  });

  it('asks which destinations are approved before anything is proposed', async () => {
    const deps = await depsAt();
    const sentence =
      'never let an agent send customer records to an unapproved destination';
    const asked = (await callOperatorTool(deps, SEAMS, 'propose_rule', { sentence })) as {
      proposed?: string;
      openQuestions: string[];
    };
    expect(asked.proposed).toBeUndefined();
    expect(asked.openQuestions).toHaveLength(1);

    const answered = (await callOperatorTool(deps, SEAMS, 'propose_rule', {
      sentence,
      approved: 'api.stripe.com, ourcompany.com',
    })) as { proposed?: string; rule: { targets: string[] } };
    expect(answered.proposed).toMatch(/^prp_/);
    expect(answered.rule.targets).toEqual(['*', '!api.stripe.com', '!ourcompany.com']);
  });

  it('on an enrolled machine holds here at once and goes to the team with every field', async () => {
    const deps = await depsAt();
    await enrol(deps.home);
    const signed = await touchId(deps.home);
    const answer = (await callOperatorTool(deps, SEAMS, 'propose_rule', {
      sentence: 'never send secrets except to api.stripe.com, open a ticket instead',
    })) as { proposed: string; said: string };
    expect(answer.said).toContain('second admin');

    const confirmed = await confirmAnswer(deps.home, {
      subject: answer.proposed,
      answer: 'confirmed',
      signature: signed(answer.proposed, 'confirmed'),
      at: AT,
    });
    expect(confirmed).toMatchObject({
      ok: true,
      outcome: expect.stringContaining('second admin'),
    });
    expect(
      (await gate(deps.home)).evaluate(
        { action: 'http.request', target: 'paste.example', dataClassification: 'secret' },
        { agentName: 'cursor' },
      ).effect,
    ).toBe('deny');

    const posted: { events: { kind: string; payload: Record<string, unknown> }[] }[] = [];
    vi.stubGlobal('fetch', (async (_url: string | URL, init?: RequestInit) => {
      posted.push(JSON.parse(String(init?.body ?? '{}')));
      return new Response(JSON.stringify({ accepted: 1, duplicates: 0 }), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch);
    const account = {
      version: 1 as const,
      baseUrl: 'https://cloud.test',
      workspaceId: 'acme',
      machineId: 'mch_1',
      token: 'machine-token',
      privateKey: PRIVATE_KEY,
      enrolledAt: '2026-09-24T09:00:00.000Z',
    };
    await pushDecisions(deps.home, account);
    expect(posted[0]?.events[0]).toMatchObject({
      kind: 'policy.decided_locally',
      payload: {
        operation: '*',
        effect: 'deny',
        dataClassifications: ['secret'],
        targets: ['*', '!api.stripe.com'],
        alternative: { action: 'open a ticket', note: 'open a ticket' },
      },
    });
  });

  it('refuses a sentence it cannot read and says how to say it', async () => {
    const deps = await depsAt();
    const answer = (await callOperatorTool(deps, SEAMS, 'propose_rule', {
      sentence: 'make everything nicer',
    })) as { refused: string };
    expect(answer.refused).toContain('never push to main');
    expect(existsSync(join(deps.home, '.memnox', 'proposals'))).toBe(false);
  });
});

type CloudRequest = Parameters<CloudCall>[0];

describe('the rule method a phone calls', () => {
  const offline: CloudCall = async () => {
    throw new CloudUnreachable('no network here');
  };

  function answering(
    status: number,
    body: unknown,
    asked: CloudRequest[] = [],
  ): CloudCall {
    return async <T>(request: CloudRequest): Promise<CloudResponse<T>> => {
      asked.push(request);
      return { status, body: body as T };
    };
  }

  it('drafts with the grammar here when offline, then proposes once the question is answered', async () => {
    const { home } = await depsAt();
    await enrol(home);
    const sentence =
      'never let an agent send customer records to an unapproved destination';
    const first = await answerRule(
      home,
      { id: 1, method: DAEMON_METHOD.RULE, said: sentence },
      AT,
      offline,
    );
    expect(first.ok).toBe(true);
    expect(first.rule).toMatchObject({ draftedBy: 'pattern', offeredToTeam: true });
    expect(first.rule?.openQuestions).toHaveLength(1);
    expect(first.rule?.proposed).toBeUndefined();

    const second = await answerRule(
      home,
      { id: 2, method: DAEMON_METHOD.RULE, said: sentence, approved: 'api.stripe.com' },
      AT,
      offline,
    );
    expect(second.rule?.proposed).toMatch(/^prp_/);
    expect(second.proposed).toBe(second.rule?.proposed);
  });

  it('asks the workspace on an enrolled machine, and keeps only what validates here', async () => {
    const { home } = await depsAt();
    await enrol(home);
    const asked: CloudRequest[] = [];
    const drafted = await answerRule(
      home,
      {
        id: 1,
        method: DAEMON_METHOD.RULE,
        said: 'patient files stay with a person in the loop',
      },
      AT,
      answering(
        200,
        {
          draft: { effect: 'ask', operation: '*', dataClassifications: ['health'] },
          readBack: 'ignored, since it is said back here',
          openQuestions: [],
          draftedBy: 'model',
        },
        asked,
      ),
    );
    const rule = drafted.rule as SpokenRuleAnswer;
    expect(rule).toMatchObject({ draftedBy: 'model', offeredToTeam: true });
    expect(rule.readBack).toBe(
      'A person is asked before an agent can send health records.',
    );
    expect(asked[0]?.path).toMatch(/\/policies\/proposals\/from-sentence$/);
    expect(asked[0]?.body).toEqual({
      sentence: 'patient files stay with a person in the loop',
    });

    const bad = await answerRule(
      home,
      { id: 2, method: DAEMON_METHOD.RULE, said: 'something odd' },
      AT,
      answering(200, { draft: { effect: 'block', operation: '*' }, readBack: '' }),
    );
    expect(bad).toMatchObject({ ok: false });
  });

  it('says the plan refusal, and never drafts on its own past it', async () => {
    const { home } = await depsAt();
    await enrol(home);
    const refused = await answerRule(
      home,
      { id: 1, method: DAEMON_METHOD.RULE, said: 'keep things tidy' },
      AT,
      answering(402, {
        error: 'rule_drafting_locked',
        message: 'The fixed grammar could not read that sentence, or upgrade to Pro.',
      }),
    );
    expect(refused).toMatchObject({
      ok: false,
      reason: 'The fixed grammar could not read that sentence, or upgrade to Pro.',
      upgrade: true,
    });
  });

  it('reads with the grammar here and asks nobody on a machine with no account', async () => {
    const { home } = await depsAt();
    const asked: CloudRequest[] = [];
    const drafted = await answerRule(
      home,
      { id: 1, method: DAEMON_METHOD.RULE, said: 'never push to main' },
      AT,
      answering(200, {}, asked),
    );
    expect(drafted.rule).toMatchObject({ draftedBy: 'pattern', offeredToTeam: false });
    expect(asked).toEqual([]);
  });

  it('may be asked from afar by a phone that may ask, and only proposes', () => {
    expect(remoteCapabilityFor(DAEMON_METHOD.RULE)).toBe(REMOTE_CAPABILITY.ASK);
  });
});
