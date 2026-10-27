import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  DAEMON_EVENT,
  DAEMON_METHOD,
  DEVICE_KIND,
  Devices,
  DISPLAY,
  PendingApprovals,
  DisplayRequests,
  PHONE_DEFAULT_CAPABILITIES,
  PROPOSAL_KIND,
  Proposals,
  REMOTE_CAPABILITY,
  type DaemonEvent,
  type DaemonResponse,
  type DeviceRecord,
  type DisplayKind,
} from '@memnox/core';
import { NOT_ALLOWED_ON_MAC, OPEN_THE_MAC } from '../src/daemon/done-lines';
import { heardRemotely, markNeedsMac, OriginRouter } from '../src/daemon/origin-routing';
import { askedFromPhone } from '../src/daemon/asked-from';
import type { Peer } from '../src/daemon/socket-write';
import { VoiceSurface } from '../src/daemon/voice-surface';
import { BRAIN_CHUNK, type Brain } from '../src/operator/brain';

/**
 * When a phone asks, words go back to the phone and hands stay on the Mac: a show only the Mac can
 * do goes to the Mac app, and the phone hears one line once it is done, or why it could not be.
 */

const ASKED = '2026-10-05T10:00:00.000Z';
const SHOWN = '2026-10-05T10:00:03.000Z';

class Lines implements Peer {
  destroyed = false;
  readonly lines: DaemonResponse[] = [];
  write(line: string): void {
    this.lines.push(JSON.parse(line) as DaemonResponse);
  }
  destroy(): void {
    this.destroyed = true;
  }
}

function phone(capabilities = [...PHONE_DEFAULT_CAPABILITIES]): DeviceRecord {
  return {
    id: 'dev_phone',
    name: 'iPhone',
    kind: DEVICE_KIND.PHONE,
    signingPoint: '',
    capabilities,
    pairedAt: ASKED,
  };
}

interface Rig {
  home: string;
  router: OriginRouter;
  told: DaemonResponse[];
  show: (display: DisplayKind) => Promise<DaemonEvent>;
}

async function rig(device: DeviceRecord = phone(), driving = false): Promise<Rig> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-origin-'));
  await new Devices(home).add(device);
  const told: DaemonResponse[] = [];
  const router = new OriginRouter({
    home,
    now: () => SHOWN,
    driving: () => driving,
    tell: (_id, response) => told.push(response) > 0,
  });
  async function show(display: DisplayKind): Promise<DaemonEvent> {
    const request = await new DisplayRequests(home).request({
      display,
      sessionId: 'ses_1',
      agent: 'claude-code',
      title: 'Instruction',
      text: 'run the tests',
      at: SHOWN,
    });
    return markNeedsMac({
      kind: DAEMON_EVENT.SHOW,
      subject: request.id,
      agent: request.agent,
      summary: 'run the tests',
      at: SHOWN,
      display,
      title: request.title,
    });
  }
  return { home, router, told, show };
}

describe('a phone asking for something on the Mac', () => {
  it('sends a look to the Mac app and tells the phone once the Mac saw', async () => {
    const at = await rig();
    const mac = new Lines();
    at.router.asked('dev_phone', ASKED);
    const look = await at.show(DISPLAY.LOOK);

    const claimed = await at.router.claim([look], [mac]);
    await at.router.delivered(look.subject, 'seen');

    expect(claimed.has(look.subject)).toBe(true);
    expect(mac.lines).toEqual([
      expect.objectContaining({
        event: expect.objectContaining({ needsMac: true, display: 'look' }),
      }),
    ]);
    expect(at.told).toEqual([
      { id: 0, ok: true, done: { text: 'Looked at your screen' } },
    ]);
  });

  it('answers the phone at once when no Mac app is open, rather than holding', async () => {
    const at = await rig();
    at.router.asked('dev_phone', ASKED);
    const type = await at.show(DISPLAY.TYPE);

    await at.router.claim([type], []);

    expect(at.told).toEqual([{ id: 0, ok: true, done: { text: OPEN_THE_MAC } }]);
    expect((await new DisplayRequests(at.home).deliveryOf(type.subject))?.outcome).toBe(
      'failed',
    );
  });

  it('refuses an action from a phone without mac, and proposes it to one with mac', async () => {
    const without = await rig();
    without.router.asked('dev_phone', ASKED);
    await without.router.claim([await without.show(DISPLAY.TYPE)], [new Lines()]);
    expect(without.told).toEqual([
      { id: 0, ok: true, done: { text: NOT_ALLOWED_ON_MAC } },
    ]);

    const allowed = await rig(
      phone([...PHONE_DEFAULT_CAPABILITIES, REMOTE_CAPABILITY.MAC]),
    );
    const mac = new Lines();
    allowed.router.asked('dev_phone', ASKED);
    const type = await allowed.show(DISPLAY.TYPE);
    await allowed.router.claim([type], [mac]);

    const [proposal] = await new Proposals(allowed.home).open(SHOWN);
    expect(proposal?.change).toMatchObject({
      kind: PROPOSAL_KIND.MAC,
      deviceId: 'dev_phone',
    });
    expect(proposal?.rationale).toContain('Type into');
    expect(mac.lines).toEqual([]);
    expect(
      (await new DisplayRequests(allowed.home).deliveryOf(type.subject))?.outcome,
    ).toBe('waiting');
  });

  it('marks what it does for a phone with that phone as its origin', async () => {
    const at = await rig(
      phone([...PHONE_DEFAULT_CAPABILITIES, REMOTE_CAPABILITY.MAC]),
      true,
    );
    const mac = new Lines();
    at.router.asked('dev_phone', ASKED);

    await at.router.claim([await at.show(DISPLAY.TYPE)], [mac]);

    expect(mac.lines[0]?.event?.origin).toEqual({ deviceId: 'dev_phone' });
  });

  it('sends an action straight to the Mac while that phone drives it, and says it was typed', async () => {
    const at = await rig(
      phone([...PHONE_DEFAULT_CAPABILITIES, REMOTE_CAPABILITY.MAC]),
      true,
    );
    const mac = new Lines();
    at.router.asked('dev_phone', ASKED);
    const type = await at.show(DISPLAY.TYPE);

    await at.router.claim([type], [mac]);
    await at.router.delivered(type.subject, 'typed');

    expect(mac.lines).toHaveLength(1);
    expect(at.told.at(-1)?.done?.text).toMatch(/^Typed it into /);
  });

  it('holds a session start for the Face ID of a phone that may act on the Mac, even one that drives', async () => {
    const at = await rig(
      phone([...PHONE_DEFAULT_CAPABILITIES, REMOTE_CAPABILITY.MAC]),
      true,
    );
    const mac = new Lines();
    at.router.asked('dev_phone', ASKED);
    const launch = await at.show(DISPLAY.LAUNCH);
    const appStart = { ...(await at.show(DISPLAY.APP)), sessionId: 'stt_1' };

    await at.router.claim([launch, appStart], [mac]);

    expect(mac.lines).toEqual([]);
    const proposals = await new Proposals(at.home).open(SHOWN);
    expect(proposals.map((each) => each.change.kind)).toEqual([
      PROPOSAL_KIND.MAC,
      PROPOSAL_KIND.MAC,
    ]);
    const deliveries = new DisplayRequests(at.home);
    expect((await deliveries.deliveryOf(launch.subject))?.outcome).toBe('waiting');
    expect((await deliveries.deliveryOf(appStart.subject))?.outcome).toBe('waiting');
  });

  it('refuses a session start from a phone that may not act on the Mac', async () => {
    const at = await rig();
    at.router.asked('dev_phone', ASKED);
    await at.router.claim([await at.show(DISPLAY.LAUNCH)], [new Lines()]);
    expect(at.told).toEqual([{ id: 0, ok: true, done: { text: NOT_ALLOWED_ON_MAC } }]);
    expect(await new Proposals(at.home).open(SHOWN)).toEqual([]);
  });

  it('still types into a chat already open in an app for a phone that drives', async () => {
    const at = await rig(
      phone([...PHONE_DEFAULT_CAPABILITIES, REMOTE_CAPABILITY.MAC]),
      true,
    );
    const mac = new Lines();
    at.router.asked('dev_phone', ASKED);
    const typed = { ...(await at.show(DISPLAY.APP)), sessionId: 'app_codex' };

    await at.router.claim([typed], [mac]);

    expect(mac.lines).toHaveLength(1);
  });

  it('leaves a show the Mac asked for to the Mac, as before', async () => {
    const at = await rig();
    at.router.asked(undefined, ASKED);
    const type = await at.show(DISPLAY.TYPE);

    expect((await at.router.claim([type], [new Lines()])).has(type.subject)).toBe(false);
    expect(at.told).toEqual([]);
  });

  it("keeps a phone from hearing the Mac's own shows and who drives it", () => {
    const notice: DaemonEvent = {
      kind: DAEMON_EVENT.NOTICE,
      subject: 'n',
      agent: 'a',
      summary: 's',
      at: ASKED,
    };
    expect(heardRemotely(notice)).toBe(true);
    expect(
      heardRemotely({
        ...notice,
        drivenBy: { deviceId: 'd', name: 'iPhone', until: ASKED },
      }),
    ).toBe(false);
    expect(heardRemotely({ ...notice, kind: DAEMON_EVENT.SHOW })).toBe(false);
    expect(
      heardRemotely({
        ...notice,
        phoneTurn: { deviceId: 'd', name: 'iPhone', said: 'hi' },
      }),
    ).toBe(false);
    expect(
      heardRemotely({
        ...notice,
        voiceOn: { deviceId: 'd', name: 'iPhone', holding: true },
      }),
    ).toBe(false);
    expect(
      markNeedsMac({ ...notice, kind: DAEMON_EVENT.SHOW, display: DISPLAY.CARD })
        .needsMac,
    ).toBeUndefined();
  });
});

describe('the voice surface with a phone subscribed', () => {
  it('tells the Mac who drives it, and never the phone', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-origin-voice-'));
    const voice = new VoiceSurface({
      home,
      now: () => ASKED,
      log: () => undefined,
      feedIntervalMs: 60_000,
    });
    const mac = new Lines();
    const remote = new Lines();
    await voice.respond(mac, { id: 1, method: DAEMON_METHOD.SUBSCRIBE });
    await voice.respond(
      remote,
      { id: 1, method: DAEMON_METHOD.SUBSCRIBE },
      { device: phone(), driving: false },
    );

    voice.broadcast({
      kind: DAEMON_EVENT.NOTICE,
      subject: 'drive_dev_phone',
      agent: 'memnox',
      summary: 'Driven from iPhone',
      at: ASKED,
      drivenBy: { deviceId: 'dev_phone', name: 'iPhone', until: SHOWN },
    });
    voice.close();

    expect(mac.lines.some((each) => each.event?.drivenBy !== undefined)).toBe(true);
    expect(remote.lines.some((each) => each.event !== undefined)).toBe(false);
  });
});

/** A brain that answers in two pieces, or fails partway when told to. */
function talkingBrain(fails = false): Brain {
  return {
    name: 'claude',
    async *ask() {
      yield { kind: BRAIN_CHUNK.TEXT, text: 'Claude is running the tests. ' };
      if (fails) throw new Error('the brain fell over');
      yield { kind: BRAIN_CHUNK.TEXT, text: 'Two of them still fail.' };
      yield { kind: BRAIN_CHUNK.DONE };
    },
    close: () => undefined,
    cancel: () => undefined,
    warm: async () => undefined,
  };
}

async function talking(fails = false): Promise<{ voice: VoiceSurface; mac: Lines }> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-phone-turn-'));
  const voice = new VoiceSurface({
    home,
    now: () => ASKED,
    log: () => undefined,
    feedIntervalMs: 60_000,
    brain: () => talkingBrain(fails),
  });
  const mac = new Lines();
  await voice.respond(mac, { id: 1, method: DAEMON_METHOD.SUBSCRIBE });
  return { voice, mac };
}

function turnsOn(lines: Lines): NonNullable<DaemonEvent['phoneTurn']>[] {
  return lines.lines.flatMap((each) =>
    each.event?.phoneTurn === undefined ? [] : [each.event.phoneTurn],
  );
}

describe('a question asked through a phone', () => {
  it('tells the brain and its tools it came from the phone, and a question at the Mac says otherwise', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-phone-asker-'));
    const prompts: string[] = [];
    const voice = new VoiceSurface({
      home,
      now: () => ASKED,
      log: () => undefined,
      feedIntervalMs: 60_000,
      brain: () => ({
        ...talkingBrain(),
        ask: (said: string) => {
          prompts.push(said);
          return talkingBrain().ask(said);
        },
      }),
    });
    const said = { method: DAEMON_METHOD.ASK, said: 'start claude in memnox runtime' };

    await voice.respond(
      new Lines(),
      { id: 1, ...said, finished: true },
      {
        device: phone(),
        driving: false,
      },
    );
    const fromPhone = await askedFromPhone(home, new Date(ASKED));
    await voice.respond(new Lines(), { id: 2, ...said, finished: true });
    voice.close();

    expect(fromPhone).toBe(true);
    expect(await askedFromPhone(home, new Date(ASKED))).toBe(false);
    expect(prompts[0]).toContain('speaking through their phone');
    expect(prompts.at(-1)).not.toContain('speaking through their phone');
  });
});

describe('a phone conversation mirrored on the Mac island', () => {
  it('shows what the phone said, the answer as it streams, and the end, only to the Mac app', async () => {
    const { voice, mac } = await talking();
    const remote = new Lines();
    await voice.respond(
      remote,
      { id: 2, method: DAEMON_METHOD.ASK, said: ' what is claude doing ' },
      { device: phone(), driving: false },
    );
    voice.close();

    const turns = turnsOn(mac);
    const who = { deviceId: 'dev_phone', name: 'iPhone' };
    expect(turns[0]).toEqual({ ...who, said: 'what is claude doing' });
    expect(turns.at(-1)).toEqual({ ...who, ended: true });
    expect(turns.filter((each) => each.ended === true)).toHaveLength(1);
    expect(
      turns
        .map((each) => each.answer ?? '')
        .join('')
        .trim(),
    ).toBe('Claude is running the tests. Two of them still fail.');
    expect(turnsOn(remote)).toEqual([]);
    expect(remote.lines.some((each) => each.chunk?.kind === BRAIN_CHUNK.TEXT)).toBe(true);
  });

  it('still ends the turn on the Mac when the brain fails partway', async () => {
    const { voice, mac } = await talking(true);
    await voice
      .respond(
        new Lines(),
        { id: 2, method: DAEMON_METHOD.ASK, said: 'what is claude doing' },
        { device: phone(), driving: false },
      )
      .catch(() => undefined);
    voice.close();

    expect(turnsOn(mac).at(-1)).toEqual({
      deviceId: 'dev_phone',
      name: 'iPhone',
      ended: true,
    });
  });

  it("mirrors neither the Mac's own question nor a phone's guess", async () => {
    const { voice, mac } = await talking();
    await voice.respond(mac, {
      id: 2,
      method: DAEMON_METHOD.ASK,
      said: 'how is it going',
    });
    await voice.respond(
      new Lines(),
      { id: 3, method: DAEMON_METHOD.ASK, said: 'how is it', speculative: true },
      { device: phone(), driving: false },
    );
    voice.close();

    expect(turnsOn(mac)).toEqual([]);
  });
});

function voiceOnOf(lines: Lines): NonNullable<DaemonEvent['voiceOn']>[] {
  return lines.lines.flatMap((each) =>
    each.event?.voiceOn === undefined ? [] : [each.event.voiceOn],
  );
}

describe('the Mac staying silent while a phone holds the voice', () => {
  const iphone = { deviceId: 'dev_phone', name: 'iPhone' };
  const notice: DaemonEvent = {
    kind: DAEMON_EVENT.NOTICE,
    subject: 'n',
    agent: 'claude-code',
    summary: 'Claude finished',
    at: ASKED,
  };

  async function listening(): Promise<{
    voice: VoiceSurface;
    mac: Lines;
    remote: Lines;
  }> {
    const home = await mkdtemp(join(tmpdir(), 'memnox-voice-hold-'));
    const voice = new VoiceSurface({
      home,
      now: () => ASKED,
      log: () => undefined,
      feedIntervalMs: 60_000,
    });
    const mac = new Lines();
    const remote = new Lines();
    await voice.respond(mac, { id: 1, method: DAEMON_METHOD.SUBSCRIBE });
    await voice.respond(
      remote,
      { id: 1, method: DAEMON_METHOD.SUBSCRIBE },
      { device: phone(), driving: false },
    );
    return { voice, mac, remote };
  }

  it('names the phone on every event to the Mac and the phone while its app is open, and on nothing once revoked', async () => {
    const { voice, mac, remote } = await listening();
    voice.broadcast(notice);
    voice.hold.forget(iphone.deviceId);
    voice.broadcast({ ...notice, subject: 'later' });
    voice.close();

    const heard = (lines: Lines, subject: string): unknown =>
      lines.lines.find((each) => each.event?.subject === subject)?.event?.heardOn;
    expect(heard(mac, 'n')).toEqual(iphone);
    expect(heard(remote, 'n')).toEqual(iphone);
    expect(heard(mac, 'later')).toBeUndefined();
    expect(heard(remote, 'later')).toBeUndefined();
  });

  it('tells only the Mac app where the voice went, in a plain line', async () => {
    const { voice, mac, remote } = await listening();
    voice.hold.forget(iphone.deviceId);
    voice.close();

    expect(voiceOnOf(mac)).toEqual([
      { ...iphone, holding: true },
      { ...iphone, holding: false },
    ]);
    expect(
      mac.lines.flatMap((each) =>
        each.event?.voiceOn === undefined ? [] : [each.event.summary],
      ),
    ).toEqual(['Talking on iPhone', 'Back on the Mac']);
    expect(voiceOnOf(remote)).toEqual([]);
  });

  it('keeps the voice on the phone for the grace after its stream ends', async () => {
    const { voice, mac, remote } = await listening();
    voice.drop(remote);
    voice.broadcast(notice);
    voice.close();

    expect(voiceOnOf(mac)).toEqual([{ ...iphone, holding: true }]);
    expect(mac.lines.at(-1)?.event?.heardOn).toEqual(iphone);
  });

  it('gives the voice back the moment the phone is revoked', async () => {
    const { voice, mac } = await listening();
    voice.hold.driven({ ...iphone, until: SHOWN });
    voice.hold.forget(iphone.deviceId);
    voice.broadcast(notice);
    voice.close();

    expect(voiceOnOf(mac).at(-1)).toEqual({ ...iphone, holding: false });
    expect(mac.lines.at(-1)?.event?.heardOn).toBeUndefined();
  });

  it('gives the voice back to the Mac the moment the person asks the Mac something', async () => {
    const { voice, mac } = await talking();
    await voice.respond(
      new Lines(),
      { id: 1, method: DAEMON_METHOD.SUBSCRIBE },
      { device: phone(), driving: false },
    );
    await voice.respond(new Lines(), {
      id: 2,
      method: DAEMON_METHOD.ASK,
      said: 'what is claude doing',
    });
    voice.broadcast(notice);
    voice.close();

    expect(voiceOnOf(mac)).toEqual([
      { ...iphone, holding: true },
      { ...iphone, holding: false },
    ]);
    expect(mac.lines.at(-1)?.event?.heardOn).toBeUndefined();
  });

  it('asks the Mac again about a held call the phone held, once the voice comes back', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-voice-back-'));
    const voice = new VoiceSurface({
      home,
      now: () => ASKED,
      log: () => undefined,
      feedIntervalMs: 60_000,
    });
    await voice.respond(
      new Lines(),
      { id: 1, method: DAEMON_METHOD.SUBSCRIBE },
      { device: phone(), driving: false },
    );
    await new PendingApprovals(home).raise(
      {
        sessionId: 'ses_1',
        agent: 'claude-code',
        operation: 'git.push',
        target: 'main',
        fingerprint: 'abc123def456',
        reason: 'pushing to main needs a person',
      },
      ASKED,
      120_000,
    );
    const mac = new Lines();
    await voice.respond(mac, { id: 1, method: DAEMON_METHOD.SUBSCRIBE });
    const held = (): DaemonEvent[] =>
      mac.lines.flatMap((each) =>
        each.event?.kind === DAEMON_EVENT.HELD ? [each.event] : [],
      );
    expect(held().map((each) => each.heardOn)).toEqual([iphone]);

    voice.hold.forget(iphone.deviceId);
    await vi.waitFor(() => expect(held()).toHaveLength(2));
    voice.close();

    expect(held()[1]?.heardOn).toBeUndefined();
    expect(held()[1]?.subject).toBe(held()[0]?.subject);
  });

  it('holds the voice on a phone that asks, for the grace after its answer', async () => {
    const { voice, mac } = await talking();
    await voice.respond(
      new Lines(),
      { id: 2, method: DAEMON_METHOD.ASK, said: 'what is claude doing' },
      { device: phone(), driving: false },
    );
    voice.broadcast(notice);
    voice.close();

    expect(voiceOnOf(mac)).toEqual([{ ...iphone, holding: true }]);
    expect(mac.lines.at(-1)?.event?.heardOn).toEqual(iphone);
  });
});

describe('a show the brain raised for a phone that asked', () => {
  it('reaches that phone when it names a session, with its origin, and no other phone', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-phone-show-'));
    await new Devices(home).add(phone());
    await new Devices(home).add({ ...phone(), id: 'dev_other', name: 'iPad' });
    let now = ASKED;
    const voice = new VoiceSurface({
      home,
      now: () => now,
      log: () => undefined,
      feedIntervalMs: 5,
      brain: () => talkingBrain(),
    });
    const mac = new Lines();
    const asker = new Lines();
    const other = new Lines();
    await voice.respond(mac, { id: 1, method: DAEMON_METHOD.SUBSCRIBE });
    await voice.respond(
      asker,
      { id: 1, method: DAEMON_METHOD.SUBSCRIBE },
      { device: phone(), driving: false },
    );
    await voice.respond(
      other,
      { id: 1, method: DAEMON_METHOD.SUBSCRIBE },
      { device: { ...phone(), id: 'dev_other', name: 'iPad' }, driving: false },
    );
    await voice.respond(
      new Lines(),
      { id: 2, method: DAEMON_METHOD.ASK, said: 'show me the tests session' },
      { device: phone(), driving: false },
    );
    now = SHOWN;
    const requests = new DisplayRequests(home);
    const shown = async (display: DisplayKind): Promise<string> =>
      (
        await requests.request({
          display,
          sessionId: 'ses_1',
          agent: 'claude-code',
          title: 'Tests',
          text: 'the tests session',
          at: SHOWN,
        })
      ).id;
    const card = await shown(DISPLAY.CARD);
    const focus = await shown(DISPLAY.FOCUS);
    const sessions = await shown(DISPLAY.SESSIONS);

    const showsOn = (lines: Lines): DaemonEvent[] =>
      lines.lines.flatMap((each) =>
        each.event?.kind === DAEMON_EVENT.SHOW ? [each.event] : [],
      );
    await vi.waitFor(() => expect(showsOn(asker)).toHaveLength(2));
    voice.close();

    expect(
      showsOn(asker)
        .map((each) => each.subject)
        .sort(),
    ).toEqual([card, focus].sort());
    for (const each of showsOn(asker))
      expect(each.origin).toEqual({ deviceId: 'dev_phone' });
    expect(showsOn(other)).toEqual([]);
    expect(showsOn(asker).some((each) => each.subject === sessions)).toBe(false);
    expect(showsOn(mac).find((each) => each.subject === card)?.origin).toEqual({
      deviceId: 'dev_phone',
    });
  });
});

describe('a page or a list asked for from a phone', () => {
  async function linkRouter(listening: boolean): Promise<{
    router: OriginRouter;
    link: DaemonEvent;
  }> {
    const home = await mkdtemp(join(tmpdir(), 'memnox-phone-link-'));
    await new Devices(home).add(phone());
    const router = new OriginRouter({
      home,
      now: () => SHOWN,
      driving: () => false,
      tell: () => true,
      listening: (deviceId) => listening && deviceId === 'dev_phone',
    });
    const link = markNeedsMac({
      kind: DAEMON_EVENT.SHOW,
      subject: 'dsp_link',
      agent: 'memnox',
      summary: '',
      at: SHOWN,
      display: DISPLAY.LINK,
      sessionId: 'all',
      app: { links: ['https://github.com/acme/shop/pull/49'] },
    });
    return { router, link };
  }

  it('keeps a link from the Mac and lets only that phone say how it went', async () => {
    const { router, link } = await linkRouter(true);
    router.asked('dev_phone', ASKED);

    const claimed = await router.claim([link], [new Lines()]);

    expect(link.needsMac).toBeUndefined();
    expect(claimed.has(link.subject)).toBe(true);
    expect(router.sentTo(link.subject, 'dev_other')).toBe(false);
    expect(router.sentTo(link.subject, 'dev_phone')).toBe(true);
    expect(router.sentTo(link.subject, 'dev_phone')).toBe(false);
  });

  it('leaves a link to the Mac when the Mac asked, or when the phone that asked has its app closed', async () => {
    const fromMac = await linkRouter(true);
    fromMac.router.asked(undefined, ASKED);
    expect((await fromMac.router.claim([fromMac.link], [])).has('dsp_link')).toBe(false);

    const closed = await linkRouter(false);
    closed.router.asked('dev_phone', ASKED);
    expect((await closed.router.claim([closed.link], [])).has('dsp_link')).toBe(false);
    expect(closed.router.sentTo('dsp_link', 'dev_phone')).toBe(false);
  });

  it('opens the link on the asking phone alone, puts the list on it, and keeps where the link opened', async () => {
    const home = await mkdtemp(join(tmpdir(), 'memnox-phone-page-'));
    await new Devices(home).add(phone());
    let now = ASKED;
    const voice = new VoiceSurface({
      home,
      now: () => now,
      log: () => undefined,
      feedIntervalMs: 5,
      brain: () => talkingBrain(),
    });
    const mac = new Lines();
    const asker = new Lines();
    const principal = { device: phone(), driving: false };
    await voice.respond(mac, { id: 1, method: DAEMON_METHOD.SUBSCRIBE });
    await voice.respond(asker, { id: 1, method: DAEMON_METHOD.SUBSCRIBE }, principal);
    await voice.respond(
      new Lines(),
      { id: 2, method: DAEMON_METHOD.ASK, said: 'open pull request 49' },
      principal,
    );
    now = SHOWN;
    const requests = new DisplayRequests(home);
    const link = await requests.request({
      display: DISPLAY.LINK,
      sessionId: 'all',
      agent: 'memnox',
      title: 'github.com',
      links: ['https://github.com/acme/shop/pull/49'],
      at: SHOWN,
    });
    const list = await requests.request({
      display: DISPLAY.CARD,
      sessionId: 'all',
      agent: 'memnox',
      title: 'Open pull requests',
      text: '- #49 Fix the relay',
      at: SHOWN,
    });

    const showsOn = (lines: Lines): string[] =>
      lines.lines.flatMap((each) =>
        each.event?.kind === DAEMON_EVENT.SHOW ? [each.event.subject] : [],
      );
    await vi.waitFor(() =>
      expect(showsOn(asker).sort()).toEqual([link.id, list.id].sort()),
    );
    expect(showsOn(mac)).not.toContain(link.id);
    expect(showsOn(mac)).toContain(list.id);

    const refused = new Lines();
    await voice.respond(
      refused,
      { id: 3, method: DAEMON_METHOD.DELIVERED, subject: list.id, answer: 'typed' },
      principal,
    );
    const told = new Lines();
    await voice.respond(
      told,
      { id: 4, method: DAEMON_METHOD.DELIVERED, subject: link.id, answer: 'typed' },
      principal,
    );
    voice.close();

    expect(refused.lines[0]?.ok).toBe(false);
    expect(await requests.deliveryOf(list.id)).toBeNull();
    expect(told.lines[0]?.ok).toBe(true);
    expect(await requests.deliveryOf(link.id)).toMatchObject({
      outcome: 'typed',
      on: 'iPhone',
    });
  });
});
