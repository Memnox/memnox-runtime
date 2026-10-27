import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ACTOR_TYPE,
  DECISION_EFFECT,
  ENFORCEMENT_MODE,
  EVENT_SCHEMA_VERSION,
  EVENT_SURFACE,
  ledgerWork,
  SqliteEventStore,
  TOOL_CLASS,
  type MemnoxEvent,
} from '@memnox/core';
import { strainHolding } from '../src/breaker-seam';

/**
 * What the ledger costs a seam that reads it before every command, on a machine that has
 * been busy: ten thousand rows over fifty sessions. The wrapper's whole budget is ten
 * milliseconds, so the read in front of each command has to be a small part of it.
 */
const ROWS = 10_000;
const SESSIONS = 50;
const RUNS = 50;
/** Before every command, so a fraction of the wrapper's budget. */
const STRAIN_TARGET_MS = 5;
/** Once per held call, while a person is about to read it. */
const EVIDENCE_TARGET_MS = 50;

function row(n: number): MemnoxEvent {
  return {
    id: `evt_${n}`,
    schemaVersion: EVENT_SCHEMA_VERSION,
    at: new Date(Date.parse('2026-10-07T00:00:00.000Z') + n * 1000).toISOString(),
    sessionId: `ses_${n % SESSIONS}`,
    agent: 'claude-code',
    actorType: ACTOR_TYPE.AGENT,
    surface: EVENT_SURFACE.SHELL,
    operation: n % 7 === 0 ? 'npm.test' : 'filesystem.write',
    target: `src/file-${n % 40}.ts`,
    class: n % 7 === 0 ? TOOL_CLASS.READ : TOOL_CLASS.WRITE,
    effect: DECISION_EFFECT.ALLOW,
    mode: ENFORCEMENT_MODE.ENFORCE,
    reason: 'ran',
    exitCode: n % 11 === 0 ? 1 : 0,
  };
}

async function busyMachine(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'memnox-seam-bench-'));
  const store = SqliteEventStore.forHome(home);
  for (let n = 0; n < ROWS; n += 1) await store.append(row(n));
  store.close();
  return home;
}

async function median(times: number, work: () => Promise<unknown>): Promise<number> {
  const spans: number[] = [];
  for (let n = 0; n < times; n += 1) {
    const started = performance.now();
    await work();
    spans.push(performance.now() - started);
  }
  spans.sort((a, b) => a - b);
  return spans[Math.floor(spans.length / 2)] ?? 0;
}

describe('the ledger read in front of a command', () => {
  it(`reads a session's strain in under ${STRAIN_TARGET_MS}ms at the median`, async () => {
    const home = await busyMachine();
    const took = await median(RUNS, () => strainHolding(home, 'ses_7', 'claude-code'));
    // eslint-disable-next-line no-console
    console.log(`  strain read: ${took.toFixed(2)}ms median over ${ROWS} rows`);
    expect(took).toBeLessThan(STRAIN_TARGET_MS);
  }, 120_000);

  it(`gathers a held call's evidence in under ${EVIDENCE_TARGET_MS}ms`, async () => {
    const home = await busyMachine();
    const read = ledgerWork(home);
    const took = await median(RUNS, () => read('ses_7', '2026-10-08T00:00:00.000Z'));
    // eslint-disable-next-line no-console
    console.log(`  held call evidence: ${took.toFixed(2)}ms median over ${ROWS} rows`);
    expect(took).toBeLessThan(EVIDENCE_TARGET_MS);
  }, 120_000);
});
