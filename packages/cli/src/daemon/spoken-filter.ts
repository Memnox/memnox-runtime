/**
 * What the brain writes, kept to what should be heard. A model sometimes echoes a system
 * reminder into its answer, and after a tool returns it sometimes writes the sentence it
 * already said; both are said aloud otherwise, so both are taken out here as the text streams.
 */

const REMINDER_OPEN = '<system-reminder';
const REMINDER_CLOSE = '</system-reminder>';

export class SpokenFilter {
  /**
   * @param unsaid phrases taken out where they address the person, such as ", Moïse" once they
   * were addressed by name already, since a name in every reply sounds like a script.
   */
  constructor(private readonly unsaid: readonly string[] = []) {}

  /** Text held back because it may be the start of a reminder, or the end of one being dropped. */
  private tail = '';
  private inReminder = false;
  /** Each stretch of text already said this turn, between tool calls, in comparable form. */
  private readonly said: string[] = [];
  private segment = '';
  /** Text after a tool call that so far only repeats something already said. */
  private held = '';
  private holding = false;
  /** The last few characters said, so a cut address knows whether it opened a sentence. */
  private last = '';
  /** Set when "Moïse, " opened a sentence and was cut, so the word now opening it takes the capital. */
  private capital = false;

  /** What to say of this piece now, which is empty while it is held. */
  text(piece: string): string {
    const clean = this.withoutReminders(piece);
    return clean === '' ? '' : this.withoutRepeats(clean);
  }

  /** A tool call: what was said becomes what a repeat is checked against, and a held repeat is dropped. */
  tool(): void {
    const said = comparable(this.segment);
    if (said !== '') this.said.push(said);
    this.segment = '';
    this.held = '';
    this.holding = this.said.length > 0;
  }

  /** The turn is over: what was held for a reminder is said, and a held repeat never is. */
  end(): string {
    const tail = withoutClosingAddress(this.tail, this.unsaid);
    const rest = this.inReminder ? '' : this.capital ? this.withCapital(tail) : tail;
    this.tail = '';
    if (rest === '' || this.holding) return '';
    this.segment += rest;
    return rest;
  }

  private withoutReminders(piece: string): string {
    let buffer = this.tail + piece;
    let out = '';
    for (;;) {
      if (this.capital && !this.inReminder) buffer = this.withCapital(buffer);
      if (this.inReminder) {
        const close = buffer.indexOf(REMINDER_CLOSE);
        if (close < 0) {
          this.tail = buffer.slice(-(REMINDER_CLOSE.length - 1));
          return this.noted(out);
        }
        buffer = buffer.slice(close + REMINDER_CLOSE.length);
        this.inReminder = false;
        continue;
      }
      const open = buffer.indexOf(REMINDER_OPEN);
      const { phrase, waitFrom } = this.firstUnsaid(buffer, this.last + out);
      if (phrase !== null && (open < 0 || phrase.at < open)) {
        out += buffer.slice(0, phrase.at);
        buffer = buffer.slice(phrase.at + phrase.text.length);
        if (phrase.text.endsWith(', ') && opensSentence(this.last + out))
          this.capital = true;
        continue;
      }
      if (open >= 0) {
        out += buffer.slice(0, open);
        buffer = buffer.slice(open);
        this.inReminder = true;
        continue;
      }
      const kept = Math.max(
        buffer.length - waitFrom,
        partialTail(buffer, REMINDER_OPEN),
        ...this.unsaid.map((each) => partialTail(buffer, each)),
      );
      this.tail = buffer.slice(buffer.length - kept);
      return this.noted(out + buffer.slice(0, buffer.length - kept));
    }
  }

  private noted(text: string): string {
    this.last = (this.last + text).slice(-LAST_KEPT);
    return text;
  }

  /** The first letter capitalised once one arrives, so a sentence never starts in lower case. */
  private withCapital(buffer: string): string {
    const first = /^(\s*)(\S)/u.exec(buffer);
    if (first === null) return buffer;
    this.capital = false;
    const [whole, space = '', letter = ''] = first;
    return space + letter.toUpperCase() + buffer.slice(whole.length);
  }

  /** The first phrase that addresses them, and where one waits on the next piece to tell. */
  private firstUnsaid(buffer: string, before: string): Unsaid {
    let phrase: { at: number; text: string } | null = null;
    let waitFrom = buffer.length;
    for (const text of this.unsaid) {
      for (let at = buffer.indexOf(text); at >= 0; at = buffer.indexOf(text, at + 1)) {
        const verdict = addressing(text, buffer, at, before);
        if (verdict === 'wait') waitFrom = Math.min(waitFrom, at);
        if (verdict !== 'yes') continue;
        if (phrase === null || at < phrase.at) phrase = { at, text };
        break;
      }
    }
    return { phrase, waitFrom };
  }

  private withoutRepeats(text: string): string {
    if (!this.holding) {
      this.segment += text;
      return text;
    }
    this.held += text;
    const so = comparable(this.held);
    if (so === '' || this.said.some((earlier) => earlier.startsWith(so))) return '';
    this.holding = false;
    const out = this.held;
    this.held = '';
    this.segment += out;
    return out;
  }
}

/** The first address to cut, and from where the buffer waits because the next piece decides. */
interface Unsaid {
  phrase: { at: number; text: string } | null;
  waitFrom: number;
}

/** What may follow ", Moïse" when it calls the person, rather than naming somebody in a list. */
const ADDRESS_ENDS = /^[.,!?;]/;

/**
 * Whether the phrase here calls the person, since cutting "assigned to Moïse, and" left "assigned
 * to and": ", Moïse" must close its clause and "Moïse, " must open its sentence.
 */
function addressing(
  text: string,
  buffer: string,
  at: number,
  before: string,
): 'yes' | 'no' | 'wait' {
  if (text.startsWith(', ')) {
    const next = buffer.slice(at + text.length);
    if (next === '') return 'wait';
    return ADDRESS_ENDS.test(next) ? 'yes' : 'no';
  }
  if (text.endsWith(', '))
    return opensSentence(before + buffer.slice(0, at)) ? 'yes' : 'no';
  return 'yes';
}

/** A trailing ", Moïse" held for the next piece calls them when the reply ends on it. */
function withoutClosingAddress(tail: string, unsaid: readonly string[]): string {
  const closing = unsaid.find((each) => each.startsWith(', ') && tail.endsWith(each));
  return closing === undefined ? tail : tail.slice(0, -closing.length);
}

/** Enough of what was said to see the end of the sentence before a cut address. */
const LAST_KEPT = 4;

/** Whether text that comes next would open a sentence: nothing said yet, or a sentence just ended. */
function opensSentence(before: string): boolean {
  const said = before.trimEnd();
  return said === '' || /[.!?:]$/.test(said);
}

/** How long a tail of the text could be the start of the marker, so it waits for the next piece. */
function partialTail(text: string, marker: string): number {
  for (let length = Math.min(marker.length - 1, text.length); length > 0; length -= 1) {
    if (text.endsWith(marker.slice(0, length))) return length;
  }
  return 0;
}

/** Words only, so "My apologies; the" and "My apologies, the" read as the same sentence. */
function comparable(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '');
}
