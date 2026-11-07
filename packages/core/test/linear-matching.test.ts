import { describe, expect, it } from 'vitest';
import { isProtectedPath } from '../src/gate/protected-paths';
import { runnerForInstall } from '../src/mcp/install-line';
import { readRange } from '../src/memory/read-budget';
import { withoutWikiLinks, wikiLinksOf } from '../src/memory-sources/markdown';
import { memorySlug, unlinkedLines } from '../src/projects/memory-layers';
import { isInjectedPrompt } from '../src/session/injected-prompt';
import { parseTomlTables } from '../src/discovery/detectors/toml-tables';

/** Long enough that a pattern costing the square of its input runs past the test's timeout. */
const LONG = 200_000;

describe('text read by index rather than a pattern that backtracks', () => {
  it('takes off every host tag, a nested one included, and reads what follows', () => {
    expect(
      isInjectedPrompt(
        '<system-reminder>be brief</system-reminder>\n[Subagent hand-back] done',
      ),
    ).toBe(true);
    expect(
      isInjectedPrompt('<A x="1"><b>in</b></A>\n[memnox, not the person] note'),
    ).toBe(true);
    expect(isInjectedPrompt('<note>never closed\n[memnox, not the person] note')).toBe(
      false,
    );
    expect(isInjectedPrompt('<->'.repeat(LONG))).toBe(false);
    expect(isInjectedPrompt(`<${'-'.repeat(LONG)}`)).toBe(false);
  });

  it('counts a line as linked only where a target sits between `](` and `)`', () => {
    expect(unlinkedLines('see [notes](notes.md)\nplain words\n[empty]()')).toBe(2);
    expect(unlinkedLines(`${']('.repeat(LONG)}`)).toBe(1);
  });

  it('makes a file name of a subject with no dash at either end', () => {
    expect(memorySlug('  Release: the process! ', 'mem_1')).toBe('release-the-process');
    expect(memorySlug('---', 'MEM_1')).toBe('mem-1');
    expect(memorySlug(`a${'-'.repeat(LONG)}`, 'mem_1')).toBe('a');
  });

  it('reads a line range written with spaces anywhere around it', () => {
    const doc = 'one\ntwo\nthree';
    expect(readRange(doc, { lines: ' 2 - 3 ' }, 800)?.text).toBe('two\nthree');
    expect(readRange(doc, { lines: `0${' '.repeat(LONG)}x` }, 800)).toBeNull();
  });

  it('reads a wiki link as its shown words and follows its target', () => {
    expect(withoutWikiLinks('See [[Release process|releases]] and [[Notes#top]].')).toBe(
      'See releases and Notes.',
    );
    expect(wikiLinksOf('[[A]] [[B|b]] [[A#x]]')).toEqual(['A', 'B']);
    expect(wikiLinksOf('[["'.repeat(LONG))).toEqual([]);
  });

  it('names a TOML table without its brackets', () => {
    expect(parseTomlTables('[[servers]]\nname = "a"').tables.has('servers')).toBe(true);
    expect(parseTomlTables(`[x${']'.repeat(LONG)}`).tables.has('x')).toBe(true);
  });

  it('runs a Python package by its name and fetches a spec as written', () => {
    expect(runnerForInstall('pip', ['install', 'comfy-mcp'])?.args).toEqual([
      'comfy-mcp',
    ]);
    expect(runnerForInstall('pip', ['install', 'comfy-mcp[all]==1.0'])?.args).toEqual([
      '--from',
      'comfy-mcp[all]==1.0',
      'comfy-mcp',
    ]);
    expect(runnerForInstall('pip', ['install', 'comfy-mcp\nrm'])).toBeNull();
    expect(runnerForInstall('pip', ['install', `0${'-'.repeat(LONG)}\n`])).toBeNull();
  });

  it('protects a session record under any folder and no other file there', () => {
    expect(
      isProtectedPath('/Users/me/.claude/projects/-Users-me-work/9be31b1c.jsonl'),
    ).toBe(true);
    expect(isProtectedPath('.claude/projects/a.jsonl')).toBe(true);
    expect(isProtectedPath('/Users/me/.claude/projects/.jsonl')).toBe(false);
    expect(isProtectedPath('/Users/me/x.claude/projects/a.jsonl')).toBe(false);
    expect(isProtectedPath('/Users/me/.claude/projects/notes.md')).toBe(false);
    expect(isProtectedPath(`${'/.claude/projects/'.repeat(LONG / 20)}x`)).toBe(false);
  });
});
