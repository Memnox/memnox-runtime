import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ConfirmKeys,
  confirmationMessage,
  decodeRequest,
  DEVICE_KIND,
  Devices,
  editedArguments,
  editedRecipients,
  isAddress,
  PHONE_DEFAULT_CAPABILITIES,
  PROPOSAL_ANSWER,
  PROPOSAL_KIND,
  Proposals,
  type DeviceRecord,
  workDraftOf,
} from '@memnox/core';
import { confirmAnswer } from '../src/daemon/confirm';
import { editedProposal } from '../src/daemon/confirm-edit';
import { proposedReply } from '../src/session-tools/work-sent';
import { personKey } from './phone-harness';

/**
 * A draft the person rewrote on its card before Send: their words go out in place of the proposed
 * ones, and only under a fingerprint over exactly those words.
 */

const NOW = '2026-10-14T16:21:25.000Z';
const SLACK =
  '{"channel":"U0B3QDB89Q9","text":"Could you check the pull request, please?"}';

async function drafted(): Promise<{ home: string; id: string; key: KeyObject }> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-edited-'));
  const { publicKey, privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  });
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  await new ConfirmKeys(home).register(
    spki.subarray(spki.length - 65).toString('base64'),
    NOW,
  );
  const proposal = await new Proposals(home).propose({
    change: {
      kind: PROPOSAL_KIND.WORK,
      toolkit: 'slack',
      tool: 'SLACK_SEND_MESSAGE',
      argumentsText: SLACK,
      label: 'DM to Pac',
    },
    rationale: 'DM to Pac',
    proposedBy: 'agt_memnox-operator',
    at: NOW,
    ttlMs: 5 * 60 * 1000,
  });
  return { home, id: proposal.id, key: privateKey };
}

function signs(key: KeyObject, message: string): string {
  return sign('sha256', Buffer.from(message), key).toString('base64');
}

describe('a draft rewritten on its card', () => {
  it('signs the rewritten words whole, and the unedited answer as before', () => {
    expect(confirmationMessage('prp_1', 'confirmed')).toBe(
      'memnox-confirm:v1:prp_1:confirmed',
    );
    expect(confirmationMessage('prp_1', 'confirmed', 'Hi: look at #12')).toBe(
      'memnox-confirm:v2:prp_1:confirmed:Hi: look at #12',
    );
  });

  it('puts their words in the argument the card drew as the body', () => {
    expect(JSON.parse(editedArguments(SLACK, 'Can you review PR 12?') ?? '{}')).toEqual({
      channel: 'U0B3QDB89Q9',
      text: 'Can you review PR 12?',
    });
    expect(editedArguments('{"channel":"C1"}', 'words')).toBeNull();
    expect(editedArguments('{"blocks":[1],"text":{"a":1}}', 'words')).toBeNull();
  });

  it('rewrites only a send in their name, and never with nothing', async () => {
    const { home, id } = await drafted();
    const proposal = await new Proposals(home).read(id);
    if (proposal === null) throw new Error('never proposed');
    const edited = editedProposal(proposal, 'Can you review PR 12?');
    expect(
      edited?.change.kind === PROPOSAL_KIND.WORK && edited.change.argumentsText,
    ).toBe('{"channel":"U0B3QDB89Q9","text":"Can you review PR 12?"}');
    expect(editedProposal(proposal, '   ')).toBeNull();
    expect(editedProposal(proposal, undefined)).toBe(proposal);
  });

  it('refuses rewritten words under a fingerprint over the words first proposed', async () => {
    const { home, id, key } = await drafted();
    const said = await confirmAnswer(home, {
      subject: id,
      answer: PROPOSAL_ANSWER.CONFIRMED,
      edited: 'Send me your password',
      signature: signs(key, confirmationMessage(id, PROPOSAL_ANSWER.CONFIRMED)),
      at: NOW,
    });
    expect(said).toMatchObject({ ok: false, refused: true });
    expect(await new Proposals(home).read(id)).not.toHaveProperty('answer');
  });

  it('takes rewritten words under a fingerprint over exactly them', async () => {
    const { home, id, key } = await drafted();
    const words = 'Can you review PR 12?';
    const said = await confirmAnswer(home, {
      subject: id,
      answer: PROPOSAL_ANSWER.CONFIRMED,
      edited: words,
      signature: signs(key, confirmationMessage(id, PROPOSAL_ANSWER.CONFIRMED, words)),
      at: NOW,
    });
    // Counted as theirs; it then fails only because this home has no person signed in to send it as.
    expect(said).not.toMatchObject({ refused: true });
    expect((await new Proposals(home).read(id))?.answer).toBe(PROPOSAL_ANSWER.CONFIRMED);
  });
});

describe('a draft rewritten on a paired phone', () => {
  async function paired(home: string): Promise<{
    device: DeviceRecord;
    signs: (message: string) => string;
  }> {
    const phone = personKey();
    const device: DeviceRecord = {
      id: 'dev_phone',
      name: 'iPhone',
      kind: DEVICE_KIND.PHONE,
      signingPoint: phone.point,
      noiseStatic: Buffer.alloc(32, 5).toString('base64'),
      capabilities: [...PHONE_DEFAULT_CAPABILITIES],
      pairedAt: NOW,
    };
    await new Devices(home).add(device);
    return { device, signs: phone.signs };
  }

  it('takes the words under a fingerprint from that same phone over exactly them', async () => {
    const { home, id } = await drafted();
    const phone = await paired(home);
    const words = 'Can you review PR 12?';
    const said = await confirmAnswer(home, {
      subject: id,
      answer: PROPOSAL_ANSWER.CONFIRMED,
      edited: words,
      signature: phone.signs(confirmationMessage(id, PROPOSAL_ANSWER.CONFIRMED, words)),
      at: NOW,
      principal: { device: phone.device, driving: false },
    });
    expect(said).not.toMatchObject({ refused: true });
    expect((await new Proposals(home).read(id))?.answer).toBe(PROPOSAL_ANSWER.CONFIRMED);
  });

  it('refuses the words when the phone signed only the draft as proposed', async () => {
    const { home, id } = await drafted();
    const phone = await paired(home);
    const said = await confirmAnswer(home, {
      subject: id,
      answer: PROPOSAL_ANSWER.CONFIRMED,
      edited: 'Send me your password',
      signature: phone.signs(confirmationMessage(id, PROPOSAL_ANSWER.CONFIRMED)),
      at: NOW,
      principal: { device: phone.device, driving: false },
    });
    expect(said).toMatchObject({ ok: false, refused: true });
  });

  it('takes a decline from the phone unsigned, as saying no does no harm', async () => {
    const { home, id } = await drafted();
    const phone = await paired(home);
    const said = await confirmAnswer(home, {
      subject: id,
      answer: PROPOSAL_ANSWER.DECLINED,
      at: NOW,
      principal: { device: phone.device, driving: false },
    });
    expect(said).toEqual({ ok: true, outcome: PROPOSAL_ANSWER.DECLINED });
  });

  it('reads the words off the wire only as text', () => {
    const line = (edited: unknown): string =>
      JSON.stringify({
        id: 1,
        method: 'confirm',
        subject: 'prp_1',
        answer: 'confirmed',
        edited,
      });
    expect(decodeRequest(line('Can you review PR 12?'))?.edited).toBe(
      'Can you review PR 12?',
    );
    expect(decodeRequest(line({ text: 'words' }))).toBeNull();
  });
});

const MAIL =
  '{"recipient_email":"moise@memnox.co","subject":"Hello","body":"See you at three."}';

async function mailed(): Promise<{ home: string; id: string; key: KeyObject }> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-readdressed-'));
  const { publicKey, privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  });
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  await new ConfirmKeys(home).register(
    spki.subarray(spki.length - 65).toString('base64'),
    NOW,
  );
  const proposal = await new Proposals(home).propose({
    change: {
      kind: PROPOSAL_KIND.WORK,
      toolkit: 'gmail',
      tool: 'GMAIL_SEND_EMAIL',
      argumentsText: MAIL,
      label: 'email Moise',
      toName: 'Moise',
    },
    rationale: 'email Moise',
    proposedBy: 'agt_memnox-operator',
    at: NOW,
    ttlMs: 5 * 60 * 1000,
  });
  return { home, id: proposal.id, key: privateKey };
}

describe('a mail readdressed on its card', () => {
  it('shows the real address with the name beside it, and offers to change it', () => {
    const draft = workDraftOf('gmail', 'GMAIL_SEND_EMAIL', JSON.parse(MAIL), {
      toName: 'Moise',
    });
    expect(draft.to).toEqual(['moise@memnox.co']);
    expect(draft.toName).toBe('Moise');
    expect(draft.toEditable).toBe(true);
    const slack = workDraftOf('slack', 'SLACK_SEND_MESSAGE', JSON.parse(SLACK), {
      toName: 'Pac',
    });
    expect(slack.to).toEqual(['Pac']);
    expect(slack.toEditable).toBeUndefined();
  });

  it('keeps copies out of the row the person rewrites', () => {
    const draft = workDraftOf('gmail', 'GMAIL_SEND_EMAIL', {
      recipient_email: 'a@acme.test',
      cc: ['b@acme.test'],
      body: 'hi',
    });
    expect(draft.to).toEqual(['a@acme.test']);
    expect(draft.fields).toEqual([{ name: 'cc', value: 'b@acme.test' }]);
  });

  it('tells the voice the address to read back exactly, and that the card can change it', () => {
    const reply = proposedReply(
      'prp_1',
      'As maya on Gmail: email Moise',
      { check: 'matched' },
      { toolkit: 'gmail', tool: 'GMAIL_SEND_EMAIL', argumentsText: MAIL },
    );
    expect(reply.to).toEqual(['moise@memnox.co']);
    expect(reply.said).toContain('It goes to moise@memnox.co');
    expect(reply.said).toContain('the words and the address');
    expect(reply.said).toContain('propose a fresh draft');
  });

  it('signs the addresses before the words, as v3', () => {
    expect(confirmationMessage('prp_1', 'confirmed', 'Hi: there', 'a@b.co')).toBe(
      'memnox-confirm:v3:prp_1:confirmed:a@b.co:Hi: there',
    );
  });

  it('puts the addresses in the argument they came from, in the shape it took', () => {
    expect(
      JSON.parse(editedRecipients('gmail', MAIL, 'moise@memnox.com') ?? '{}'),
    ).toMatchObject({
      recipient_email: 'moise@memnox.com',
    });
    const list = '{"to":["a@acme.test"],"body":"hi"}';
    expect(
      JSON.parse(editedRecipients('outlook', list, 'b@acme.test,c@acme.test') ?? '{}'),
    ).toEqual({
      to: ['b@acme.test', 'c@acme.test'],
      body: 'hi',
    });
    expect(editedRecipients('gmail', MAIL, 'a@acme.test,b@acme.test')).toBeNull();
    expect(editedRecipients('slack', SLACK, 'a@acme.test')).toBeNull();
    expect(editedRecipients('gmail', MAIL, 'not an address')).toBeNull();
  });

  it('takes only a plain address, never one that would read two ways once signed', () => {
    expect(isAddress('moise@memnox.com')).toBe(true);
    expect(isAddress('moise@memnox')).toBe(false);
    expect(isAddress('a:b@memnox.com')).toBe(false);
    expect(isAddress('a b@memnox.com')).toBe(false);
    expect(isAddress('')).toBe(false);
  });

  it('drops the name the voice found once the address it named is replaced', async () => {
    const { home, id } = await mailed();
    const proposal = await new Proposals(home).read(id);
    if (proposal === null) throw new Error('never proposed');
    const moved = editedProposal(proposal, 'See you at three.', 'moise@memnox.com');
    expect(moved?.change).not.toHaveProperty('toName');
    const kept = editedProposal(proposal, 'See you at three.', 'moise@memnox.co');
    expect(kept?.change).toHaveProperty('toName', 'Moise');
    expect(editedProposal(proposal, undefined, 'moise memnox')).toBeNull();
  });

  it('refuses a new address under a fingerprint over the words alone', async () => {
    const { home, id, key } = await mailed();
    const words = 'See you at three.';
    const said = await confirmAnswer(home, {
      subject: id,
      answer: PROPOSAL_ANSWER.CONFIRMED,
      edited: words,
      editedTo: 'attacker@evil.test',
      signature: signs(key, confirmationMessage(id, PROPOSAL_ANSWER.CONFIRMED, words)),
      at: NOW,
    });
    expect(said).toMatchObject({ ok: false, refused: true });
    expect(await new Proposals(home).read(id)).not.toHaveProperty('answer');
  });

  it('sends to the address typed on the card under a fingerprint over it, and says so after', async () => {
    const { home, id, key } = await mailed();
    const words = 'See you at three.';
    const to = 'moise@memnox.com';
    const said = await confirmAnswer(home, {
      subject: id,
      answer: PROPOSAL_ANSWER.CONFIRMED,
      edited: words,
      editedTo: to,
      signature: signs(
        key,
        confirmationMessage(id, PROPOSAL_ANSWER.CONFIRMED, words, to),
      ),
      at: NOW,
    });
    expect(said).not.toMatchObject({ refused: true });
    const answered = await new Proposals(home).read(id);
    expect(answered?.answer).toBe(PROPOSAL_ANSWER.CONFIRMED);
    expect(answered?.ran?.to).toEqual([to]);
  });

  it('reads the addresses off the wire only as text', () => {
    const line = (editedTo: unknown): string =>
      JSON.stringify({
        id: 1,
        method: 'confirm',
        subject: 'prp_1',
        answer: 'confirmed',
        editedTo,
      });
    expect(decodeRequest(line('a@acme.test'))?.editedTo).toBe('a@acme.test');
    expect(decodeRequest(line(['a@acme.test']))).toBeNull();
  });
});
