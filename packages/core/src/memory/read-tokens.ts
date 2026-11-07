/**
 * What memory reads cost agents on this machine, kept as running totals so the Memory page says
 * how much cheaper finding is with numbers measured here. Only the tool's name and two counts are
 * kept for a read: never the question, the answer or a word of either.
 */
import { join } from 'node:path';

import { MEMNOX_HOME } from '../config/config';
import { readJsonFile, writeJsonFile } from '../store/json-records';
import { estimateTokens } from './read-budget';

const READ_TOKENS_FILE = 'memory-read-tokens.json';

/** One tool's totals, or every tool's. */
export interface ReadTokenTotals {
  reads: number;
  /** Tokens the answers handed to agents, estimated. */
  returned: number;
  /** Tokens the whole text would have cost minus what was handed, never below nothing a read. */
  avoided: number;
}

export interface ReadTokenLedger extends ReadTokenTotals {
  tools: Record<string, ReadTokenTotals>;
}

/** One read measured: the text handed over against the whole text it was cut from. */
export interface ReadMeasure {
  /** The tool's name, such as `memory` or `brief`; the only thing said about the read. */
  tool: string;
  returnedText: string;
  fullText: string;
}

function ledgerPathFor(home: string): string {
  return join(home, MEMNOX_HOME, READ_TOKENS_FILE);
}

function emptyTotals(): ReadTokenTotals {
  return { reads: 0, returned: 0, avoided: 0 };
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function totalsOf(value: unknown): ReadTokenTotals {
  if (value === null || typeof value !== 'object') return emptyTotals();
  // Narrowed here, field by field, because the file may be torn or older than this shape.
  const row = value as Record<string, unknown>;
  return {
    reads: count(row['reads']),
    returned: count(row['returned']),
    avoided: count(row['avoided']),
  };
}

/** The totals so far, or nothing measured where the file is missing or torn. */
export async function readReadTokens(home: string): Promise<ReadTokenLedger> {
  const found = await readJsonFile<unknown>(ledgerPathFor(home));
  const tools =
    found !== null && typeof found === 'object' && 'tools' in found
      ? (found as { tools: unknown }).tools
      : {};
  return {
    ...totalsOf(found),
    tools: Object.fromEntries(
      Object.entries(tools !== null && typeof tools === 'object' ? tools : {}).map(
        ([name, each]) => [name, totalsOf(each)],
      ),
    ),
  };
}

/** The tokens one read handed over and the tokens it spared, as the ledger adds them. */
export function measureRead(measure: ReadMeasure): ReadTokenTotals {
  const returned = estimateTokens(measure.returnedText);
  return {
    reads: 1,
    returned,
    avoided: Math.max(0, estimateTokens(measure.fullText) - returned),
  };
}

function plus(a: ReadTokenTotals, b: ReadTokenTotals): ReadTokenTotals {
  return {
    reads: a.reads + b.reads,
    returned: a.returned + b.returned,
    avoided: a.avoided + b.avoided,
  };
}

/** One read added to the totals; a failed write loses one read's count and never fails the read. */
export async function noteRead(home: string, measure: ReadMeasure): Promise<void> {
  const ledger = await readReadTokens(home);
  const read = measureRead(measure);
  const next: ReadTokenLedger = {
    ...plus(ledger, read),
    tools: {
      ...ledger.tools,
      [measure.tool]: plus(ledger.tools[measure.tool] ?? emptyTotals(), read),
    },
  };
  await writeJsonFile(ledgerPathFor(home), next).catch(() => undefined);
}
