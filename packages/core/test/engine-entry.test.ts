import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PolicyEngine,
  classifyToolCall,
  policiesFrom,
  recommendedAnswers,
  type ActionRequest,
} from '../src/engine';

const SRC = join(import.meta.dirname, '..', 'src');
const IO = /^(node:)?(fs|fs\/promises|child_process|os|net|http|https)$|^better-sqlite3$/;
const IMPORT =
  /^(?:import|export)\s+(?!type\s)[^'"]*?from\s+['"]([^'"]+)['"]|^import\s+['"]([^'"]+)['"]/gm;

function fileFor(from: string, spec: string): string | null {
  const base = resolve(dirname(from), spec.replace(/\.js$/, ''));
  for (const candidate of [`${base}.ts`, join(base, 'index.ts')]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Every io module the entry can reach, with the chain of files that reaches it. */
function ioReachedFrom(entry: string): string[] {
  const seen = new Set<string>();
  const found: string[] = [];
  const pending: { file: string; chain: string[] }[] = [{ file: entry, chain: [] }];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (seen.has(next.file)) continue;
    seen.add(next.file);
    const chain = [...next.chain, next.file.slice(SRC.length + 1)];
    for (const match of readFileSync(next.file, 'utf8').matchAll(IMPORT)) {
      const spec = match[1] ?? match[2] ?? '';
      if (IO.test(spec)) found.push(`${chain.join(' > ')} > ${spec}`);
      const file = spec.startsWith('.') ? fileFor(next.file, spec) : null;
      if (file !== null) pending.push({ file, chain });
    }
  }
  return found;
}

describe('the engine entry', () => {
  it('reaches no disk, process or database module, so a cloud agent can load it anywhere', () => {
    expect(ioReachedFrom(join(SRC, 'engine.ts'))).toEqual([]);
  });

  it('decides a call in well under a millisecond with the recommended rules', () => {
    const engine = new PolicyEngine(policiesFrom(recommendedAnswers()));
    const calls: ActionRequest[] = [
      {
        action: 'mcp.stripe.create_refund',
        target: 'pi_3Qx8',
        toolClass: classifyToolCall('create_refund').class,
      },
      { action: 'git.push', target: 'origin/main' },
      { action: 'filesystem.read', target: '/srv/app/config/settings.json' },
      {
        action: 'mcp.linear.list_issues',
        toolClass: classifyToolCall('list_issues').class,
      },
    ];
    const rounds = 4_000;
    // The fastest of several batches, so a machine busy with other test workers measures the engine.
    let perCall = Infinity;
    for (let batch = 0; batch < 5; batch += 1) {
      const started = performance.now();
      for (let index = 0; index < rounds; index += 1) {
        const call = calls[index % calls.length] ?? { action: 'noop' };
        engine.evaluate(call, { agentName: 'support-bot' });
      }
      perCall = Math.min(perCall, (performance.now() - started) / rounds);
    }
    // A tenth of a millisecond each is ten thousand decisions inside the second a person would notice.
    expect(perCall).toBeLessThan(0.1);
  });
});
