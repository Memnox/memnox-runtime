import {
  REMOTE_OUTCOME,
  type AudioPiece,
  type DaemonRequest,
  type DaemonResponse,
} from '@memnox/core';
import { readVoice } from '../remote/remote-files';
import { write, type Peer } from './socket-write';

/**
 * One line said in the person's Kokoro voice by the Mac app's own server and streamed back as PCM,
 * so a phone whose app is in the background, where iOS allows no GPU, still speaks in that voice.
 */

/** The Mac app's Kokoro server; the port is the one memnox-desktop/macos starts it on in Kokoro.swift. */
export const KOKORO_PORT = 8723;

/** Loopback only, so a line said for the person never leaves this machine. */
const KOKORO_BASE = `http://127.0.0.1:${KOKORO_PORT}`;

/** How long a check that a voice is there may take, since a device asks it before every reply. */
const PRESENCE_TIMEOUT_MS = 500;

/**
 * Whether a Kokoro server answers here at all, so a device whose machine has none speaks with its
 * own voice at once rather than asking and being refused on every sentence.
 */
export async function kokoroAnswers(render: Render = fetch): Promise<boolean> {
  const answer = await render(KOKORO_BASE, {
    signal: AbortSignal.timeout(PRESENCE_TIMEOUT_MS),
  }).catch(() => null);
  // Any answer means a server is listening; only a refused or silent port means none is.
  return answer !== null;
}

/** The server's own MOST_CHARACTERS, since it cuts anything longer and one sentence is the ask. */
export const MOST_SPOKEN_CHARACTERS = 1_000;

/** As long as the Mac app itself waits, enough for a long sentence on a slow Mac. */
const RENDER_TIMEOUT_MS = 10_000;

/** The Mac's unhurried pace from Kokoro.swift, and the range any asked speed is held to. */
export const USUAL_SPEED = 0.85;
export const SLOWEST_SPEED = 0.5;
export const FASTEST_SPEED = 1.5;

/** Well under the relay's 65000 byte line, and small enough that the first sound comes fast. */
export const MOST_PIECE_BASE64 = 48_000;
/** Three bytes become four base64 characters, and 36000 bytes is a whole number of samples. */
const MOST_PIECE_BYTES = (MOST_PIECE_BASE64 / 4) * 3;

/** A Kokoro voice id as the Mac keeps it, so nothing else reaches the server's voice field. */
const VOICE_ID = /^[a-z]{2}_[a-z0-9]{1,32}$/;

const PCM_FORMAT = 1;
const MONO = 1;
const SIXTEEN_BITS = 16;
const RIFF_HEADER_BYTES = 12;
const CHUNK_HEADER_BYTES = 8;
const FMT_BYTES = 16;

/** Where the line is rendered: fetch against the Mac's Kokoro, or a stand in from a test. */
export type Render = typeof fetch;

interface SpeakDeps {
  home: string;
  render?: Render;
}

/** The samples of a WAV and the rate they play at. */
interface Wav {
  rate: number;
  pcm: Buffer;
}

/** Walks the chunks rather than assuming a 44 byte header, since a writer may put others first. */
export function parseWav(bytes: Buffer): Wav | null {
  if (bytes.length < RIFF_HEADER_BYTES) return null;
  if (
    bytes.toString('ascii', 0, 4) !== 'RIFF' ||
    bytes.toString('ascii', 8, 12) !== 'WAVE'
  )
    return null;
  let rate: number | null = null;
  for (let at = RIFF_HEADER_BYTES; at + CHUNK_HEADER_BYTES <= bytes.length;) {
    const id = bytes.toString('ascii', at, at + 4);
    const size = bytes.readUInt32LE(at + 4);
    const body = at + CHUNK_HEADER_BYTES;
    if (id === 'fmt ') rate = size < FMT_BYTES ? null : pcmRate(bytes, body);
    // A streamed WAV may claim more data than arrived, so the data ends where the bytes do.
    if (id === 'data')
      return rate === null ? null : { rate, pcm: bytes.subarray(body, body + size) };
    if (id === 'fmt ' && rate === null) return null;
    // Chunks are padded to an even length.
    at = body + size + (size % 2);
  }
  return null;
}

/** The rate of a format chunk that is plain 16 bit mono PCM, else null. */
function pcmRate(bytes: Buffer, body: number): number | null {
  if (body + FMT_BYTES > bytes.length) return null;
  const format = bytes.readUInt16LE(body);
  const channels = bytes.readUInt16LE(body + 2);
  const bits = bytes.readUInt16LE(body + 14);
  if (format !== PCM_FORMAT || channels !== MONO || bits !== SIXTEEN_BITS) return null;
  return bytes.readUInt32LE(body + 4);
}

/** The PCM as pieces of base64 in order, the last one marked, and one empty piece for silence. */
export function audioPieces(wav: Wav): AudioPiece[] {
  const whole = wav.pcm.subarray(0, wav.pcm.length - (wav.pcm.length % 2));
  const count = Math.max(1, Math.ceil(whole.length / MOST_PIECE_BYTES));
  return Array.from({ length: count }, (_, index) => ({
    rate: wav.rate,
    samples: whole
      .subarray(index * MOST_PIECE_BYTES, (index + 1) * MOST_PIECE_BYTES)
      .toString('base64'),
    last: index === count - 1,
  }));
}

export function clampSpeed(speed: number | undefined): number {
  if (speed === undefined || !Number.isFinite(speed)) return USUAL_SPEED;
  return Math.min(FASTEST_SPEED, Math.max(SLOWEST_SPEED, speed));
}

function refusal(request: DaemonRequest, reason: string): DaemonResponse {
  return {
    id: request.id,
    ok: false,
    outcome: REMOTE_OUTCOME.REFUSED,
    reason,
    error: reason,
  };
}

/** The line rendered as pieces, or the plain reason it could not be. */
async function speakPieces(
  request: DaemonRequest,
  deps: SpeakDeps,
): Promise<AudioPiece[] | string> {
  const line = (request.line ?? '').trim().slice(0, MOST_SPOKEN_CHARACTERS);
  if (line === '') return 'There is nothing to say.';
  const voice = request.voice ?? (await readVoice(deps.home));
  if (!VOICE_ID.test(voice)) return `${voice} is not a Kokoro voice.`;
  const render = deps.render ?? fetch;
  const answer = await render(`${KOKORO_BASE}/speak`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: line, voice, speed: clampSpeed(request.speed) }),
    signal: AbortSignal.timeout(RENDER_TIMEOUT_MS),
  }).catch(() => null);
  if (answer === null)
    return 'No Kokoro voice is running on this machine. On a Mac, open Memnox.';
  // The server answers 400 for a voice it does not have, since the line is never empty here.
  if (!answer.ok) return `Kokoro on this machine does not know the voice ${voice}.`;
  const bytes = await answer.arrayBuffer().catch(() => null);
  const wav = bytes === null ? null : parseWav(Buffer.from(bytes));
  return wav === null
    ? 'Kokoro on this machine answered with no sound.'
    : audioPieces(wav);
}

/** Streams the pieces on the request's id, or one refusal with its reason. */
export async function speak(
  peer: Peer,
  request: DaemonRequest,
  deps: SpeakDeps,
): Promise<void> {
  const pieces = await speakPieces(request, deps);
  if (typeof pieces === 'string') return write(peer, refusal(request, pieces));
  for (const audio of pieces) write(peer, { id: request.id, ok: true, audio });
}
