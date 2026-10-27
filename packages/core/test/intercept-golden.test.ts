import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { decodeRequest, encodeInterceptLine, INTERCEPT_METHOD } from '../src/index';

/** The same two files the native wrapper's `cargo test` reads, so neither side drifts alone. */
const FIXTURES = new URL('../../../native/intercept/fixtures/', import.meta.url);

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(name, FIXTURES)), 'utf8');
}

interface GoldenInput {
  argv: string[];
  env: [string, string][];
  cwd: string;
  ppid: number;
}

describe('the line the native wrapper sends', () => {
  it('is byte for byte the golden fixture', () => {
    const input = JSON.parse(fixture('intercept-request.input.json')) as GoldenInput;
    expect(encodeInterceptLine(input)).toBe(fixture('intercept-request.golden'));
  });

  it('decodes as the daemon reads it', () => {
    const request = decodeRequest(fixture('intercept-request.golden').trim());
    expect(request?.method).toBe(INTERCEPT_METHOD.INTERCEPT);
    expect(request?.argv?.[3]).toBe('say "hi"\tand\\then\nnew line');
    expect(request?.env?.['QUOTED']).toBe('it\'s "quoted"');
  });
});
