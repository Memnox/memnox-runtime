import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VoiceOn } from '@memnox/core';
import {
  nextExpiry,
  VOICE_GRACE_MS,
  VoiceHold,
  voiceHolder,
  type PhoneActivity,
} from '../src/remote/voice-hold';

/**
 * A phone holds the voice while its app is open, while it drives, while its question is answered and for a grace after,
 * so the Mac stays silent the whole time and speaks again once nothing ties the voice to a phone.
 */

const NOW = '2026-10-05T10:00:00.000Z';

function at(offsetMs: number): string {
  return new Date(Date.parse(NOW) + offsetMs).toISOString();
}

function phone(overrides: Partial<PhoneActivity> = {}): PhoneActivity {
  return {
    deviceId: 'dev_phone',
    name: 'iPhone',
    asking: 0,
    subscribed: 0,
    lastActiveAt: at(-60_000),
    ...overrides,
  };
}

describe('which phone holds the voice', () => {
  it('is nobody when no phone did anything lately', () => {
    expect(voiceHolder([], NOW)).toBeNull();
    expect(voiceHolder([phone()], NOW)).toBeNull();
  });

  it('is a phone while its drive grant is live, and not once it ends', () => {
    const driving = phone({ drivingUntil: at(60_000) });
    expect(voiceHolder([driving], NOW)).toEqual({
      deviceId: 'dev_phone',
      name: 'iPhone',
    });
    expect(voiceHolder([driving], at(60_000))).toBeNull();
  });

  it('is a phone while its question is in flight, however long it takes', () => {
    expect(voiceHolder([phone({ asking: 1 })], at(10 * 60_000))).not.toBeNull();
  });

  it('stays with a phone for the grace after its turn ended, then comes back', () => {
    const ended = phone({ endedAt: NOW, lastActiveAt: NOW });
    expect(voiceHolder([ended], at(VOICE_GRACE_MS - 1))).not.toBeNull();
    expect(voiceHolder([ended], at(VOICE_GRACE_MS))).toBeNull();
  });

  it('is a phone while its app is open, however long it stays quiet', () => {
    expect(voiceHolder([phone({ subscribed: 1 })], at(60 * 60_000))).toEqual({
      deviceId: 'dev_phone',
      name: 'iPhone',
    });
  });

  it('goes to the phone that did something last when two are open', () => {
    const open = phone({ subscribed: 1, lastActiveAt: at(-5_000) });
    const asked = phone({
      deviceId: 'dev_pad',
      name: 'iPad',
      subscribed: 1,
      endedAt: at(-1_000),
      lastActiveAt: at(-1_000),
    });
    expect(voiceHolder([open, asked], NOW)?.deviceId).toBe('dev_pad');
  });

  it('goes to the most recently active phone when several qualify', () => {
    const older = phone({ drivingUntil: at(60_000), lastActiveAt: at(-5_000) });
    const newer = phone({
      deviceId: 'dev_pad',
      name: 'iPad',
      asking: 1,
      lastActiveAt: at(-1_000),
    });
    expect(voiceHolder([older, newer], NOW)?.deviceId).toBe('dev_pad');
    expect(voiceHolder([newer, older], NOW)?.deviceId).toBe('dev_pad');
  });

  it('names the next expiry ahead, so a timer notices it with no other event', () => {
    const phones = [
      phone({ drivingUntil: at(90_000) }),
      phone({ deviceId: 'dev_pad', endedAt: at(-10_000) }),
    ];
    expect(nextExpiry(phones, NOW)).toBe(Date.parse(at(VOICE_GRACE_MS - 10_000)));
    expect(nextExpiry([phone()], NOW)).toBeNull();
  });
});

describe('the voice hold as it happens', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function hold(): { hold: VoiceHold; moves: VoiceOn[] } {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse(NOW));
    const moves: VoiceOn[] = [];
    const voice = new VoiceHold(
      () => new Date().toISOString(),
      (each) => void moves.push(each),
    );
    return { hold: voice, moves };
  }

  const iphone = { id: 'dev_phone', name: 'iPhone' };

  it('takes the voice on a question and gives it back once the grace runs out', () => {
    const { hold: voice, moves } = hold();
    voice.began(iphone);
    voice.ended(iphone.id);
    expect(voice.holder()).toEqual({ deviceId: 'dev_phone', name: 'iPhone' });

    vi.advanceTimersByTime(VOICE_GRACE_MS);

    expect(voice.holder()).toBeNull();
    expect(moves).toEqual([
      { deviceId: 'dev_phone', name: 'iPhone', holding: true },
      { deviceId: 'dev_phone', name: 'iPhone', holding: false },
    ]);
    voice.close();
  });

  it('gives the voice back when the drive grant expires on its own', () => {
    const { hold: voice, moves } = hold();
    voice.driven({ deviceId: iphone.id, name: iphone.name, until: at(60_000) });
    vi.advanceTimersByTime(60_000);
    expect(moves.map((each) => each.holding)).toEqual([true, false]);
    voice.close();
  });

  it('gives the voice back at once when the phone is gone, and a late answer does not take it again', () => {
    const { hold: voice, moves } = hold();
    voice.began(iphone);
    voice.forget(iphone.id);
    voice.ended(iphone.id);
    expect(voice.holder()).toBeNull();
    expect(moves.map((each) => each.holding)).toEqual([true, false]);
    voice.close();
  });

  it('holds the voice while the app is open, past the grace, with no question asked', () => {
    const { hold: voice, moves } = hold();
    voice.subscribed(iphone);
    vi.advanceTimersByTime(10 * VOICE_GRACE_MS);
    expect(voice.holder()).toEqual({ deviceId: 'dev_phone', name: 'iPhone' });
    expect(moves).toEqual([{ deviceId: 'dev_phone', name: 'iPhone', holding: true }]);
    voice.close();
  });

  it('keeps the voice for the grace once the app closes its stream, then gives it back', () => {
    const { hold: voice, moves } = hold();
    voice.subscribed(iphone);
    vi.advanceTimersByTime(5 * 60_000);
    voice.unsubscribed(iphone.id);

    vi.advanceTimersByTime(VOICE_GRACE_MS - 1);
    expect(voice.holder()?.deviceId).toBe('dev_phone');
    vi.advanceTimersByTime(1);

    expect(voice.holder()).toBeNull();
    expect(moves.map((each) => each.holding)).toEqual([true, false]);
    voice.close();
  });

  it('keeps holding while a second stream from the same phone is still open', () => {
    const { hold: voice } = hold();
    voice.subscribed(iphone);
    voice.subscribed(iphone);
    voice.unsubscribed(iphone.id);
    vi.advanceTimersByTime(VOICE_GRACE_MS * 2);
    expect(voice.holder()?.deviceId).toBe('dev_phone');
    voice.close();
  });

  it('gives the voice back at once when an open phone is revoked', () => {
    const { hold: voice, moves } = hold();
    voice.subscribed(iphone);
    voice.forget(iphone.id);
    voice.unsubscribed(iphone.id);
    expect(voice.holder()).toBeNull();
    expect(moves.map((each) => each.holding)).toEqual([true, false]);
    voice.close();
  });

  it('moves the voice to the phone that spoke last, saying so once', () => {
    const { hold: voice, moves } = hold();
    voice.driven({ deviceId: iphone.id, name: iphone.name, until: at(60_000) });
    vi.advanceTimersByTime(1_000);
    voice.began({ id: 'dev_pad', name: 'iPad' });
    expect(voice.holder()?.deviceId).toBe('dev_pad');
    expect(moves).toEqual([
      { deviceId: 'dev_phone', name: 'iPhone', holding: true },
      { deviceId: 'dev_pad', name: 'iPad', holding: true },
    ]);
    voice.close();
  });

  it('gives the voice to the Mac when the person speaks to it, until the phone is used again', () => {
    const { hold: voice, moves } = hold();
    voice.subscribed(iphone);
    voice.macTookBack();
    expect(voice.holder()).toBeNull();

    voice.began(iphone);
    expect(voice.holder()).toEqual({ deviceId: 'dev_phone', name: 'iPhone' });
    expect(moves.map((each) => each.holding)).toEqual([true, false, true]);
    voice.close();
  });

  it('keeps the voice on the Mac through a renewed stream, and gives it to a phone whose app opens afresh', () => {
    const { hold: voice } = hold();
    voice.subscribed(iphone);
    voice.macTookBack();
    voice.unsubscribed(iphone.id);
    voice.subscribed(iphone);
    expect(voice.holder()).toBeNull();

    voice.unsubscribed(iphone.id);
    vi.advanceTimersByTime(VOICE_GRACE_MS);
    voice.subscribed(iphone);
    expect(voice.holder()).toEqual({ deviceId: 'dev_phone', name: 'iPhone' });
    voice.close();
  });

  it('gives the voice to the Mac at once when the app leaves the screen, though its stream still looks alive', () => {
    const { hold: voice, moves } = hold();
    voice.subscribed(iphone);
    voice.released(iphone.id);
    expect(voice.holder()).toBeNull();

    voice.released(iphone.id);
    vi.advanceTimersByTime(10 * VOICE_GRACE_MS);
    expect(voice.holder()).toBeNull();
    expect(moves.map((each) => each.holding)).toEqual([true, false]);
    voice.close();
  });

  it('takes the voice back once the app is in front again, by a stream renewed or new, or a question', () => {
    const { hold: voice } = hold();
    voice.subscribed(iphone);
    voice.released(iphone.id);
    voice.renewed(iphone.id);
    expect(voice.holder()?.deviceId).toBe('dev_phone');

    voice.released(iphone.id);
    voice.subscribed(iphone);
    expect(voice.holder()?.deviceId).toBe('dev_phone');

    voice.released(iphone.id);
    voice.began(iphone);
    expect(voice.holder()?.deviceId).toBe('dev_phone');
    voice.close();
  });

  it('never takes back on a renewed stream a voice the person gave the Mac by speaking to it', () => {
    const { hold: voice } = hold();
    voice.subscribed(iphone);
    voice.macTookBack();
    voice.renewed(iphone.id);
    expect(voice.holder()).toBeNull();
    voice.close();
  });
});
