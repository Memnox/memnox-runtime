/**
 * Where the values of a JSON5 file sit, read without a JSON5 parser, so a few keys can be
 * inserted as text and every comment and bare key the person wrote survives. Each insertion
 * is wrapped in marker comments, which is how it is found and taken back out byte for byte.
 */

/** A value's place in the text, with an object's members by key and an array's items. */
export interface Json5Span {
  start: number;
  end: number;
  members?: ReadonlyMap<string, Json5Span>;
  items?: readonly Json5Span[];
}

const MARK_OPEN = '/* memnox */';
const MARK_CLOSE = '/* /memnox */';

/** Every span this inserted, with the space before it, which is all an insertion added. */
const MARKED = / \/\* memnox \*\/[\s\S]*?\/\* \/memnox \*\//g;

const BARE_KEY = /[A-Za-z_$][\w$]*/y;
/** Numbers, `true`, `null`, `Infinity` and the like: anything up to the next delimiter. */
const BARE_VALUE = /[^\s,\]}/:]+/y;

/** Reads one value at a time; every reader answers null where the text is not one it is sure of. */
class Skimmer {
  private at = 0;

  constructor(private readonly text: string) {}

  root(): Json5Span | null {
    const value = this.value();
    if (value === null || !this.space()) return null;
    return this.at === this.text.length ? value : null;
  }

  /** Past whitespace and comments; false at a block comment that never closes. */
  private space(): boolean {
    for (;;) {
      const rest = this.text.slice(this.at, this.at + 2);
      if (/^[\s﻿]/.test(rest)) {
        this.at += 1;
      } else if (rest === '//') {
        const end = this.text.indexOf('\n', this.at);
        this.at = end === -1 ? this.text.length : end;
      } else if (rest === '/*') {
        const end = this.text.indexOf('*/', this.at + 2);
        if (end === -1) return false;
        this.at = end + 2;
      } else {
        return true;
      }
    }
  }

  private value(): Json5Span | null {
    if (!this.space()) return null;
    const char = this.text[this.at];
    if (char === '{') return this.object();
    if (char === '[') return this.array();
    if (char === '"' || char === "'") return this.string();
    return this.bare(BARE_VALUE);
  }

  private bare(pattern: RegExp): Json5Span | null {
    pattern.lastIndex = this.at;
    const found = pattern.exec(this.text);
    if (found === null) return null;
    const start = this.at;
    this.at += found[0].length;
    return { start, end: this.at };
  }

  private string(): Json5Span | null {
    const start = this.at;
    const quote = this.text[this.at];
    this.at += 1;
    while (this.at < this.text.length && this.text[this.at] !== quote) {
      this.at += this.text[this.at] === '\\' ? 2 : 1;
    }
    if (this.at >= this.text.length) return null;
    this.at += 1;
    return { start, end: this.at };
  }

  private key(): { name: string } | null {
    const quoted = this.text[this.at] === '"' || this.text[this.at] === "'";
    const span = quoted ? this.string() : this.bare(BARE_KEY);
    if (span === null) return null;
    const trim = quoted ? 1 : 0;
    return { name: this.text.slice(span.start + trim, span.end - trim) };
  }

  private object(): Json5Span | null {
    const start = this.at;
    this.at += 1;
    const members = new Map<string, Json5Span>();
    for (;;) {
      if (!this.space()) return null;
      if (this.text[this.at] === '}') break;
      const key = this.key();
      if (key === null || !this.space() || this.text[this.at] !== ':') return null;
      this.at += 1;
      const value = this.value();
      if (value === null) return null;
      members.set(key.name, value);
      const more = this.separator('}');
      if (more === null) return null;
      if (!more) break;
    }
    this.at += 1;
    return { start, end: this.at, members };
  }

  private array(): Json5Span | null {
    const start = this.at;
    this.at += 1;
    const items: Json5Span[] = [];
    for (;;) {
      if (!this.space()) return null;
      if (this.text[this.at] === ']') break;
      const value = this.value();
      if (value === null) return null;
      items.push(value);
      const more = this.separator(']');
      if (more === null) return null;
      if (!more) break;
    }
    this.at += 1;
    return { start, end: this.at, items };
  }

  /** True after a comma, false at the closing character, null at anything else. */
  private separator(close: string): boolean | null {
    if (!this.space()) return null;
    if (this.text[this.at] === ',') {
      this.at += 1;
      return true;
    }
    return this.text[this.at] === close ? false : null;
  }
}

/** The file's root value as spans, or null where it is not JSON5 this can read with certainty. */
export function skimJson5(text: string): Json5Span | null {
  return new Skimmer(text).root();
}

/** A string item's text, quotes and simple escapes taken off, or null for any other value. */
export function stringOf(text: string, span: Json5Span): string | null {
  const quote = text[span.start];
  if (quote !== '"' && quote !== "'") return null;
  return text.slice(span.start + 1, span.end - 1).replace(/\\(.)/g, '$1');
}

/** One insertion: `body` placed first inside the object or array that opens at `container`. */
export interface Json5Insert {
  container: Json5Span;
  body: string;
}

/**
 * The text with each body inserted just inside its container, ending in a comma, which
 * JSON5 accepts before whatever already follows and before the closing character alike.
 */
export function withInserts(text: string, inserts: readonly Json5Insert[]): string {
  const ordered = [...inserts].sort((a, b) => b.container.start - a.container.start);
  let next = text;
  for (const { container, body } of ordered) {
    const at = container.start + 1;
    next = `${next.slice(0, at)} ${MARK_OPEN} ${body}, ${MARK_CLOSE}${next.slice(at)}`;
  }
  return next;
}

/** The text with every marked insertion taken back out, and nothing else changed. */
export function withoutInserts(text: string): string {
  return text.replace(MARKED, '');
}
