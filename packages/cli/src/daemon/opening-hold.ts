/**
 * The first words of a reply, held a moment: a brain that holds for the rest of what the person
 * says often writes "I am listening" first, which would talk over them, so those are dropped.
 */

/** About a breath of streaming: long enough to see whether the brain is holding, short enough not to be heard. */
const HOLD_MS = 250;
/** Past this the reply is an answer under way, not a few words ahead of a hold. */
const MOST_HELD_CHARS = 60;

/**
 * How a reply that only waits for the person begins. These are the brain's own words, matched so
 * a hold it wrote out instead of calling for is still a hold, and never anything the person said.
 */
const LISTENING_OPENERS: readonly string[] = [
  'i am listening',
  "i'm listening",
  'listening',
  'i am still listening',
  'go on',
  'please go on',
  'please continue',
  'do continue',
  'carry on',
  'standing by',
  'i am here',
  'take your time',
];

/** Where the first sentence of the held words ends and a second one begins. */
const SECOND_SENTENCE = /[.!?]\s+(?=\S)/;

export class OpeningHold {
  private text = '';
  private holding = true;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly say: (text: string) => void,
    private readonly holdMs = HOLD_MS,
  ) {}

  push(text: string): void {
    if (text === '') return;
    if (!this.holding) return this.say(text);
    this.text += text;
    if (listeningLike(this.text)) {
      // Waited out to the end: the timer would say it, and it is exactly what talks over them.
      this.cancelTimer();
      const second = SECOND_SENTENCE.exec(this.text);
      if (second !== null) this.releaseFrom(second.index + second[0].length);
      return;
    }
    if (this.text.length >= MOST_HELD_CHARS) return this.release();
    if (this.timer === null) {
      this.timer = setTimeout(() => this.release(), this.holdMs);
      this.timer.unref();
    }
  }

  /** Says what was held, and everything after it as it comes. */
  release(): void {
    this.releaseFrom(0);
  }

  /**
   * A tool started or the turn ended: what was held is said, unless the tool is a hold, when none
   * of it is. True when the turn ended on only a line that waits for the person, which is
   * dropped, so the caller can treat the turn as the hold the brain meant.
   */
  settle(holding: boolean, ended = false): boolean {
    if (holding) {
      this.drop();
      return false;
    }
    if (ended && this.holding && isListening(this.text)) {
      this.drop();
      return true;
    }
    this.release();
    return false;
  }

  /** The brain held for the rest of what the person is saying, so nothing it wrote is said. */
  drop(): void {
    this.stop();
    this.text = '';
  }

  private releaseFrom(at: number): void {
    if (!this.holding) return;
    this.stop();
    const held = this.text.slice(at);
    this.text = '';
    if (held !== '') this.say(held);
  }

  private stop(): void {
    this.holding = false;
    this.cancelTimer();
  }

  private cancelTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}

/** Whether the words so far are, or could still become, a line that only waits for the person. */
function listeningLike(text: string): boolean {
  const said = normalized(text);
  if (said === '') return false;
  return LISTENING_OPENERS.some(
    (opener) => opener.startsWith(said) || said.startsWith(opener),
  );
}

/** Whether the words are one whole line that waits, such as "I am listening for the rest." */
function isListening(text: string): boolean {
  const said = normalized(text);
  return (
    !SECOND_SENTENCE.test(text.trim()) &&
    LISTENING_OPENERS.some((opener) => said.startsWith(opener))
  );
}

function normalized(text: string): string {
  return text.trim().toLowerCase().replace(/[’]/g, "'");
}
