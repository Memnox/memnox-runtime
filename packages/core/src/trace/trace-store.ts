import { randomBytes } from 'node:crypto';
import { appendFile, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { MEMNOX_HOME } from '../config/config';
import type { Span } from './span';

/**
 * Spans written as they finish, one JSON line each, in a file per day under `~/.memnox/traces`.
 * Append only and local: nothing here leaves the machine unless a person exports it.
 */

export const TRACES_DIR = 'traces';

/** A working week, so yesterday's slow answer can still be looked at, and the folder stays small. */
export const TRACE_KEEP_DAYS = 7;

/** OpenTelemetry's sizes, so a span exports as it is: sixteen bytes for a trace, eight for a span. */
export function newTraceId(): string {
  return randomBytes(16).toString('hex');
}

export function newSpanId(): string {
  return randomBytes(8).toString('hex');
}

export class TraceStore {
  private readonly dir: string;

  constructor(home: string) {
    this.dir = join(home, MEMNOX_HOME, TRACES_DIR);
  }

  async append(spans: readonly Span[]): Promise<void> {
    if (spans.length === 0) return;
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const day = spans[0]?.startAt.slice(0, 10) ?? new Date().toISOString().slice(0, 10);
    await appendFile(
      join(this.dir, `${day}.jsonl`),
      spans.map((span) => JSON.stringify(span)).join('\n') + '\n',
      { mode: 0o600 },
    );
  }

  /** Every span of the last few days, newest day first; a torn line is skipped, never fatal. */
  async recent(days: number = TRACE_KEEP_DAYS): Promise<Span[]> {
    const files = (await readdir(this.dir).catch(() => []))
      .filter((name) => name.endsWith('.jsonl'))
      .sort()
      .reverse()
      .slice(0, days);
    const spans: Span[] = [];
    for (const file of files) {
      const text = await readFile(join(this.dir, file), 'utf8').catch(() => '');
      for (const line of text.split('\n')) spans.push(...parsed(line));
    }
    return spans;
  }

  async trace(traceId: string): Promise<Span[]> {
    return (await this.recent()).filter((span) => span.traceId === traceId);
  }

  /** Days older than the window, removed, so the folder never grows without end. */
  async prune(moment: string, keepDays: number = TRACE_KEEP_DAYS): Promise<void> {
    const cutoff = new Date(Date.parse(moment) - keepDays * 86_400_000)
      .toISOString()
      .slice(0, 10);
    for (const name of await readdir(this.dir).catch(() => [])) {
      if (name.endsWith('.jsonl') && name.slice(0, 10) < cutoff) {
        await rm(join(this.dir, name), { force: true });
      }
    }
  }
}

function parsed(line: string): Span[] {
  if (line.trim() === '') return [];
  try {
    const value: unknown = JSON.parse(line);
    return isSpan(value) ? [value] : [];
  } catch {
    // A line half written when the process stopped is the only kind that fails, and it is skipped.
    return [];
  }
}

function isSpan(value: unknown): value is Span {
  if (value === null || typeof value !== 'object') return false;
  const span = value as Record<string, unknown>;
  return ['traceId', 'spanId', 'name', 'kind', 'startAt', 'endAt', 'status'].every(
    (key) => typeof span[key] === 'string',
  );
}
