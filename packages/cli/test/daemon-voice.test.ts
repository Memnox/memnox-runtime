import { generateKeyPairSync, sign } from 'node:crypto';
import { connect } from 'node:net';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ASK_ENDS,
  confirmationMessage,
  DAEMON_EVENT,
  DAEMON_METHOD,
  DECISION_EFFECT,
  decodeResponse,
  encode,
  HOLD_ANSWER,
  LineBuffer,
  PendingApprovals,
  PROPOSAL_ANSWER,
  PROPOSAL_KIND,
  Proposals,
  readPolicyDocumentFile,
  socketPathFor,
  type DaemonRequest,
  type DaemonResponse,
  type HoldRequest,
  type Policy,
} from '@memnox/core';
import { FINISHED_NOTE } from '../src/daemon/ask-context';
import { MemnoxDaemon } from '../src/daemon-server';
import { BRAIN_CHUNK, type Brain } from '../src/operator/brain';

const NOW = '2026-09-30T10:00:00.000Z';
const TWO_MINUTES = 120_000;

const HELD: HoldRequest = {
  sessionId: 'ses_1',
  agent: 'claude-code',
  operation: 'git.push',
  target: 'main',
  fingerprint: 'abc123def456',
  reason: 'pushing to main needs a person',
};

const RULE: Policy = {
  name: 'no-railway-deploy',
  match: { actions: ['railway.deploy'] },
  decision: { effect: DECISION_EFFECT.DENY, reason: 'production deploys need a person' },
} as Policy;

function ask(path: string, request: DaemonRequest): Promise<DaemonResponse> {
  return new Promise((resolve, reject) => {
    const socket = connect(path, () => socket.write(encode(request)));
    const reader = new LineBuffer();
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      for (const line of reader.push(chunk)) {
        socket.end();
        const response = decodeResponse(line);
        return response === null ? reject(new Error(line)) : resolve(response);
      }
    });
    socket.on('error', reject);
  });
}

/** A key shaped the way the Secure Enclave hands one over. */
function enclaveLikeKey(): {
  point: string;
  signs: (subject: string, answer: string) => string;
} {
  const { publicKey, privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  });
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  return {
    point: spki.subarray(spki.length - 65).toString('base64'),
    signs: (subject, answer) =>
      sign(
        'sha256',
        Buffer.from(confirmationMessage(subject, answer)),
        privateKey,
      ).toString('base64'),
  };
}

async function running() {
  const home = await mkdtemp(join(tmpdir(), 'memnox-voice-'));
  const daemon = new MemnoxDaemon({ now: () => NOW, log: () => {}, feedIntervalMs: 20 });
  await daemon.listen(home);
  const key = enclaveLikeKey();
  const path = socketPathFor(home);
  await ask(path, { id: 1, method: DAEMON_METHOD.REGISTER_KEY, point: key.point });
  return { home, daemon, path, key };
}

describe('what is waiting on a person', () => {
  it('lists a held call in words that can be spoken', async () => {
    const { home, daemon, path } = await running();
    const held = await new PendingApprovals(home).raise(HELD, NOW, TWO_MINUTES);

    const response = await ask(path, { id: 2, method: DAEMON_METHOD.WAITING });

    expect(response.waiting).toEqual([
      expect.objectContaining({
        kind: DAEMON_EVENT.HELD,
        subject: held.id,
        agent: 'claude-code',
      }),
    ]);
    expect(response.waiting?.[0]?.summary).toContain('claude-code wants to');
    await daemon.close();
  });

  it('tells a subscriber about what was already waiting and then what arrives', async () => {
    const { home, daemon, path } = await running();
    const approvals = new PendingApprovals(home);
    await approvals.raise(HELD, NOW, TWO_MINUTES);

    const heard: DaemonResponse[] = [];
    const socket = connect(path, () =>
      socket.write(encode({ id: 3, method: DAEMON_METHOD.SUBSCRIBE })),
    );
    const reader = new LineBuffer();
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      for (const line of reader.push(chunk)) {
        const response = decodeResponse(line);
        if (response !== null) heard.push(response);
      }
    });

    await until(() => heard.length >= 2);
    await approvals.raise({ ...HELD, fingerprint: 'fedcba987654' }, NOW, TWO_MINUTES);
    await until(() => heard.length >= 3);
    socket.destroy();

    const subjects = heard.flatMap((each) => (each.event ? [each.event.subject] : []));
    expect(subjects).toHaveLength(2);
    expect(new Set(subjects).size).toBe(2);
    await daemon.close();
  });

  it('says when a call was answered elsewhere, so the voice stops asking it', async () => {
    const { home, daemon, path } = await running();
    const approvals = new PendingApprovals(home);
    const held = await approvals.raise(HELD, NOW, TWO_MINUTES);

    const heard: DaemonResponse[] = [];
    const socket = connect(path, () =>
      socket.write(encode({ id: 10, method: DAEMON_METHOD.SUBSCRIBE })),
    );
    const reader = new LineBuffer();
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      for (const line of reader.push(chunk)) {
        const response = decodeResponse(line);
        if (response !== null) heard.push(response);
      }
    });

    await until(() => heard.length >= 2);
    await approvals.answer(held.id, HOLD_ANSWER.ONCE, 'the terminal', NOW);
    await until(() => heard.some((each) => each.event?.kind === DAEMON_EVENT.SETTLED));
    socket.destroy();

    const settled = heard.find((each) => each.event?.kind === DAEMON_EVENT.SETTLED);
    expect(settled?.event?.subject).toBe(held.id);
    await daemon.close();
  });
});

describe('answering by voice', () => {
  it('takes a refusal with no signature, since saying no can do no harm', async () => {
    const { home, daemon, path } = await running();
    const held = await new PendingApprovals(home).raise(HELD, NOW, TWO_MINUTES);

    const response = await ask(path, {
      id: 4,
      method: DAEMON_METHOD.CONFIRM,
      subject: held.id,
      answer: HOLD_ANSWER.DENY,
    });

    expect(response).toMatchObject({ ok: true, outcome: HOLD_ANSWER.DENY });
    expect((await new PendingApprovals(home).read(held.id))?.answeredBy).toBe(
      'person (voice)',
    );
    await daemon.close();
  });

  it('refuses an allow that carries no signature, so a spoken yes alone lets nothing through', async () => {
    const { home, daemon, path } = await running();
    const held = await new PendingApprovals(home).raise(HELD, NOW, TWO_MINUTES);

    const response = await ask(path, {
      id: 5,
      method: DAEMON_METHOD.CONFIRM,
      subject: held.id,
      answer: HOLD_ANSWER.ONCE,
    });

    expect(response.ok).toBe(false);
    expect(response.error).toContain('Touch ID');
    expect((await new PendingApprovals(home).read(held.id))?.answer).toBeUndefined();
    await daemon.close();
  });

  it('allows once when the fingerprint signed for exactly that', async () => {
    const { home, daemon, path, key } = await running();
    const held = await new PendingApprovals(home).raise(HELD, NOW, TWO_MINUTES);

    const response = await ask(path, {
      id: 6,
      method: DAEMON_METHOD.CONFIRM,
      subject: held.id,
      answer: HOLD_ANSWER.ONCE,
      signature: key.signs(held.id, HOLD_ANSWER.ONCE),
    });

    expect(response).toMatchObject({ ok: true, outcome: HOLD_ANSWER.ONCE });
    expect((await new PendingApprovals(home).read(held.id))?.answeredBy).toBe(
      'person (Touch ID)',
    );
    await daemon.close();
  });

  it('never takes a second key in place of the first', async () => {
    const { daemon, path } = await running();
    const response = await ask(path, {
      id: 7,
      method: DAEMON_METHOD.REGISTER_KEY,
      point: enclaveLikeKey().point,
    });
    expect(response).toMatchObject({ ok: false, outcome: 'another key' });
    await daemon.close();
  });
});

describe('confirming a proposed rule', () => {
  it('writes the rule only after a signed confirmation', async () => {
    const { home, daemon, path, key } = await running();
    // A real project folder: a proposal for one that does not exist is refused before Touch ID.
    await mkdir(join(home, 'project'));
    const file = join(home, 'project', 'memnox.policies.toml');
    const proposal = await new Proposals(home).propose({
      change: { kind: PROPOSAL_KIND.RULES, file, rules: [RULE] },
      rationale: 'deny railway deploy',
      proposedBy: 'agt_memnox-operator',
      at: NOW,
      ttlMs: TWO_MINUTES,
    });

    const response = await ask(path, {
      id: 8,
      method: DAEMON_METHOD.CONFIRM,
      subject: proposal.id,
      answer: PROPOSAL_ANSWER.CONFIRMED,
      signature: key.signs(proposal.id, PROPOSAL_ANSWER.CONFIRMED),
    });

    expect(response).toMatchObject({ ok: true, outcome: PROPOSAL_ANSWER.CONFIRMED });
    const written = await readPolicyDocumentFile(file);
    expect(written?.policies.map((each) => each.name)).toEqual(['no-railway-deploy']);
    await daemon.close();
  });

  it('refuses a proposal aimed at any file other than the rule file', async () => {
    const { home, daemon, path, key } = await running();
    const proposal = await new Proposals(home).propose({
      change: { kind: PROPOSAL_KIND.RULES, file: join(home, '.bashrc'), rules: [RULE] },
      rationale: 'deny railway deploy',
      proposedBy: 'agt_memnox-operator',
      at: NOW,
      ttlMs: TWO_MINUTES,
    });

    const response = await ask(path, {
      id: 9,
      method: DAEMON_METHOD.CONFIRM,
      subject: proposal.id,
      answer: PROPOSAL_ANSWER.CONFIRMED,
      signature: key.signs(proposal.id, PROPOSAL_ANSWER.CONFIRMED),
    });

    expect(response.ok).toBe(false);
    expect((await new Proposals(home).read(proposal.id))?.answer).toBeUndefined();
    await daemon.close();
  });
});

async function until(done: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!done()) {
    if (Date.now() > deadline) throw new Error('timed out waiting');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('asking the daemon in your own words', () => {
  const brain: Brain = {
    name: 'claude',
    async *ask(said: string) {
      yield { kind: BRAIN_CHUNK.TOOL, tool: 'mcp__memnox-operator__sessions' };
      yield { kind: BRAIN_CHUNK.TEXT, text: `You asked: ${said}.` };
      yield { kind: BRAIN_CHUNK.DONE };
    },
    close: () => undefined,
    cancel: () => undefined,
    warm: async () => undefined,
  };

  it('streams the answer one chunk per line, ending on done', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-voice-ask-'));
    const daemon = new MemnoxDaemon({
      now: () => NOW,
      log: () => {},
      brain: () => brain,
    });
    await daemon.listen(home);

    const heard: DaemonResponse[] = [];
    await new Promise<void>((resolve, reject) => {
      const socket = connect(socketPathFor(home), () =>
        socket.write(
          encode({ id: 11, method: DAEMON_METHOD.ASK, said: 'what is claude doing' }),
        ),
      );
      const reader = new LineBuffer();
      socket.setEncoding('utf8');
      socket.on('data', (chunk: string) => {
        for (const line of reader.push(chunk)) {
          const response = decodeResponse(line);
          if (response === null) continue;
          heard.push(response);
          if (ASK_ENDS.includes(response.chunk?.kind ?? '')) {
            socket.end();
            resolve();
          }
        }
      });
      socket.on('error', reject);
    });

    expect(heard.map((each) => each.chunk?.kind)).toEqual(['tool', 'text', 'done']);
    // The first words in a while carry the hour ahead of them, so the brain can greet for it.
    expect(heard[1]?.chunk?.text).toMatch(
      /^You asked: \[Memnox, not the person\] It is /,
    );
    expect(heard[1]?.chunk?.text).toMatch(/\nwhat is claude doing\.$/);
    expect(heard.every((each) => each.id === 11)).toBe(true);
    await daemon.close();
  });

  it('tells the brain the words are all of it when the person was waited on and said no more', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-voice-finished-'));
    const echo: Brain = {
      ...brain,
      async *ask(said: string) {
        yield { kind: BRAIN_CHUNK.TEXT, text: said };
        yield { kind: BRAIN_CHUNK.DONE };
      },
    };
    const daemon = new MemnoxDaemon({ now: () => NOW, log: () => {}, brain: () => echo });
    await daemon.listen(home);

    const heard = await ask(socketPathFor(home), {
      id: 13,
      method: DAEMON_METHOD.ASK,
      said: 'open it and show me the session in',
      finished: true,
    });
    expect(heard.chunk?.text).toContain(FINISHED_NOTE);
    await daemon.close();
  });

  it('ends the turn the moment the brain holds for the rest, and stops it writing on', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-voice-hold-'));
    let cancelled = 0;
    const holding: Brain = {
      ...brain,
      async *ask() {
        yield { kind: BRAIN_CHUNK.TOOL, tool: 'mcp__memnox-operator__keep_listening' };
        yield { kind: BRAIN_CHUNK.TEXT, text: 'I am listening for you to finish.' };
        yield { kind: BRAIN_CHUNK.DONE };
      },
      cancel: () => {
        cancelled += 1;
      },
    };
    const daemon = new MemnoxDaemon({
      now: () => NOW,
      log: () => {},
      brain: () => holding,
    });
    await daemon.listen(home);

    const heard: DaemonResponse[] = [];
    await new Promise<void>((resolve, reject) => {
      const socket = connect(socketPathFor(home), () =>
        socket.write(encode({ id: 14, method: DAEMON_METHOD.ASK, said: 'so I was' })),
      );
      const reader = new LineBuffer();
      socket.setEncoding('utf8');
      socket.on('data', (chunk: string) => {
        for (const line of reader.push(chunk)) {
          const response = decodeResponse(line);
          if (response === null) continue;
          heard.push(response);
          // Timed from the end of the turn, so a slow machine still waits for the turn itself.
          if (response.chunk?.kind === BRAIN_CHUNK.DONE) {
            setTimeout(() => {
              socket.end();
              resolve();
            }, 150);
          }
        }
      });
      socket.on('error', reject);
    });

    expect(heard.map((each) => each.chunk?.kind)).toEqual(['tool', 'done']);
    expect(cancelled).toBe(1);
    await daemon.close();
  });

  it('refuses an ask with nothing said, or with no brain configured', async () => {
    const { daemon, path } = await running();
    const response = await ask(path, { id: 12, method: DAEMON_METHOD.ASK, said: 'hi' });
    expect(response).toMatchObject({ ok: false, error: 'no brain is configured' });
    await daemon.close();
  });
});

describe('a method the daemon does not know', () => {
  it('is refused, so a newer client never mistakes silence for support', async () => {
    const { daemon, path } = await running();
    // Not a method the protocol names, which is the point of the test.
    const response = await ask(path, { id: 99, method: 'teleport' as never });
    expect(response).toMatchObject({ ok: false, error: 'no method teleport' });
    await daemon.close();
  });
});
