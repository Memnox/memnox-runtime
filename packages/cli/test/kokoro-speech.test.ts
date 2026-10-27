import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DAEMON_METHOD,
  REMOTE_OUTCOME,
  type DaemonRequest,
  type DaemonResponse,
} from '@memnox/core';
import {
  audioPieces,
  clampSpeed,
  FASTEST_SPEED,
  KOKORO_PORT,
  kokoroAnswers,
  MOST_PIECE_BASE64,
  MOST_SPOKEN_CHARACTERS,
  parseWav,
  SLOWEST_SPEED,
  speak,
  USUAL_SPEED,
  type Render,
} from '../src/daemon/kokoro-speech';
import type { Peer } from '../src/daemon/socket-write';

/**
 * A line said in the person's Kokoro voice on the Mac and streamed to whoever asked as base64 PCM,
 * against a stand in for the Mac app's Kokoro server rather than a real port.
 */

interface Chunk {
  id: string;
  body: Buffer;
}

/** A WAV as the Mac's server writes it, with any chunks put ahead of the data. */
function wav(
  pcm: Buffer,
  options: { rate?: number; channels?: number; bits?: number; before?: Chunk[] } = {},
): Buffer {
  const fmt = Buffer.alloc(16);
  fmt.writeUInt16LE(1, 0);
  fmt.writeUInt16LE(options.channels ?? 1, 2);
  fmt.writeUInt32LE(options.rate ?? 24_000, 4);
  fmt.writeUInt32LE((options.rate ?? 24_000) * 2, 8);
  fmt.writeUInt16LE(2, 12);
  fmt.writeUInt16LE(options.bits ?? 16, 14);
  const chunks = [
    { id: 'fmt ', body: fmt },
    ...(options.before ?? []),
    { id: 'data', body: pcm },
  ].map(({ id, body }) => {
    const header = Buffer.alloc(8);
    header.write(id, 0, 'ascii');
    header.writeUInt32LE(body.length, 4);
    const pad = body.length % 2 === 1 ? Buffer.alloc(1) : Buffer.alloc(0);
    return Buffer.concat([header, body, pad]);
  });
  const riff = Buffer.alloc(12);
  riff.write('RIFF', 0, 'ascii');
  riff.writeUInt32LE(4 + chunks.reduce((sum, each) => sum + each.length, 0), 4);
  riff.write('WAVE', 8, 'ascii');
  return Buffer.concat([riff, ...chunks]);
}

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

/** A Kokoro that answers every line with the same sound and keeps what it was asked. */
function kokoro(answer: () => Response): {
  render: Render;
  asked: unknown[];
  urls: string[];
} {
  const asked: unknown[] = [];
  const urls: string[] = [];
  const render: Render = (url, init) => {
    urls.push(String(url));
    asked.push(JSON.parse(String(init?.body)));
    return Promise.resolve(answer());
  };
  return { render, asked, urls };
}

async function said(
  request: Omit<DaemonRequest, 'id' | 'method'>,
  render: Render,
): Promise<DaemonResponse[]> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-speak-'));
  const peer = new Lines();
  await speak(peer, { id: 9, method: DAEMON_METHOD.SPEAK, ...request }, { home, render });
  return peer.lines;
}

describe('reading the WAV the Mac renders', () => {
  it('finds the rate and the data past other chunks', () => {
    const pcm = Buffer.from([1, 0, 2, 0, 3, 0]);
    const parsed = parseWav(
      wav(pcm, { rate: 22_050, before: [{ id: 'LIST', body: Buffer.from('odd') }] }),
    );

    expect(parsed?.rate).toBe(22_050);
    expect(parsed?.pcm).toEqual(pcm);
  });

  it('refuses anything that is not 16 bit mono PCM', () => {
    const pcm = Buffer.alloc(4);
    expect(parseWav(wav(pcm, { channels: 2 }))).toBeNull();
    expect(parseWav(wav(pcm, { bits: 8 }))).toBeNull();
    expect(parseWav(Buffer.from('{"error":"no"}'))).toBeNull();
  });
});

describe('splitting the sound into pieces', () => {
  it('keeps each piece under the line size and marks only the last', () => {
    const pcm = Buffer.alloc(100_001, 7);
    const pieces = audioPieces({ rate: 24_000, pcm });

    expect(pieces.length).toBe(3);
    expect(pieces.map((each) => each.last)).toEqual([false, false, true]);
    for (const piece of pieces) {
      expect(piece.samples.length).toBeLessThanOrEqual(MOST_PIECE_BASE64);
      expect(piece.rate).toBe(24_000);
    }
    const joined = Buffer.concat(
      pieces.map((each) => Buffer.from(each.samples, 'base64')),
    );
    expect(joined).toEqual(pcm.subarray(0, 100_000));
  });

  it('sends one empty last piece for a line with no samples', () => {
    expect(audioPieces({ rate: 24_000, pcm: Buffer.alloc(0) })).toEqual([
      { rate: 24_000, samples: '', last: true },
    ]);
  });
});

describe('speak', () => {
  it('renders through the Mac Kokoro in the Mac voice and streams the pieces', async () => {
    const pcm = Buffer.alloc(80_000, 1);
    const fake = kokoro(() => new Response(wav(pcm), { status: 200 }));
    const lines = await said({ line: '  Your build passed.  ' }, fake.render);

    expect(fake.urls).toEqual([`http://127.0.0.1:${KOKORO_PORT}/speak`]);
    expect(fake.asked).toEqual([
      { text: 'Your build passed.', voice: 'af_heart', speed: USUAL_SPEED },
    ]);
    expect(lines.map((each) => [each.id, each.ok, each.audio?.last])).toEqual([
      [9, true, false],
      [9, true, false],
      [9, true, true],
    ]);
  });

  it('caps the line, holds the speed to its range, and passes a chosen voice', async () => {
    const fake = kokoro(() => new Response(wav(Buffer.alloc(2)), { status: 200 }));
    await said({ line: 'a'.repeat(5_000), voice: 'bm_george', speed: 9 }, fake.render);

    expect(fake.asked).toEqual([
      {
        text: 'a'.repeat(MOST_SPOKEN_CHARACTERS),
        voice: 'bm_george',
        speed: FASTEST_SPEED,
      },
    ]);
    expect(clampSpeed(0.1)).toBe(SLOWEST_SPEED);
    expect(clampSpeed(Number.NaN)).toBe(USUAL_SPEED);
  });

  it('refuses when no Kokoro voice runs on this machine', async () => {
    const down: Render = () => Promise.reject(new TypeError('fetch failed'));
    const lines = await said({ line: 'Hello.' }, down);

    expect(lines).toEqual([
      expect.objectContaining({ id: 9, ok: false, outcome: REMOTE_OUTCOME.REFUSED }),
    ]);
    expect(lines[0]?.reason).toMatch(/No Kokoro voice is running on this machine/);
  });

  it('refuses a voice Kokoro answers 400 for, and one that is no voice id', async () => {
    const fake = kokoro(
      () => new Response(JSON.stringify({ error: 'needs text' }), { status: 400 }),
    );
    const unknown = await said({ line: 'Hello.', voice: 'zz_nobody' }, fake.render);
    const garbled = await said({ line: 'Hello.', voice: '../etc' }, fake.render);

    expect(unknown[0]).toMatchObject({ ok: false, outcome: REMOTE_OUTCOME.REFUSED });
    expect(unknown[0]?.reason).toMatch(/does not know the voice zz_nobody/);
    expect(garbled[0]?.reason).toMatch(/not a Kokoro voice/);
    expect(fake.asked).toHaveLength(1);
  });

  it('refuses an empty line without asking Kokoro', async () => {
    const fake = kokoro(() => new Response(wav(Buffer.alloc(2)), { status: 200 }));
    const lines = await said({ line: '   ' }, fake.render);

    expect(lines[0]).toMatchObject({ ok: false, reason: 'There is nothing to say.' });
    expect(fake.asked).toEqual([]);
  });
});

describe('whether a Kokoro voice answers here', () => {
  it('is true for any answer at all, and false for a port nothing listens on', async () => {
    const answers = await kokoroAnswers(() =>
      Promise.resolve(new Response('', { status: 404 })),
    );
    const silent = await kokoroAnswers(() => Promise.reject(new Error('ECONNREFUSED')));

    expect(answers).toBe(true);
    expect(silent).toBe(false);
  });
});
