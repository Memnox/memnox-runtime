/**
 * The part of the daemon protocol that says one line in the person's Kokoro voice, rendered on the
 * Mac and played by whoever asked, so a phone in the background, where iOS allows no GPU, still
 * speaks with the voice the person chose.
 */

export const SPEECH_METHOD = {
  /** One line rendered by the Mac app's Kokoro server, streamed back as pieces of PCM. */
  SPEAK: 'speak',
} as const;

/** A piece of the rendered line: little endian signed 16 bit mono PCM, base64, at `rate`. */
export interface AudioPiece {
  rate: number;
  samples: string;
  /** The line's final piece, which may still carry samples. */
  last: boolean;
}

export interface SpeechRequestFields {
  /** On SPEAK: the one sentence to say. The Kokoro voice is `voice`, absent for the Mac's own. */
  line?: string;
  /** On SPEAK: how fast to say it, held to a sane range; absent is the Mac's unhurried pace. */
  speed?: number;
}

export interface SpeechResponseFields {
  /** On SPEAK, one per line in order until a piece whose `last` is true. */
  audio?: AudioPiece;
}
