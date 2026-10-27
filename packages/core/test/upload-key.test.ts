import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { carriesPath, hashedRef, uploadedRef, uploadKeyOf } from '../src/sync/upload-key';

let home: string;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'memnox-upload-key-'));
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe('paths leave the machine hashed when the person chose so', () => {
  it('makes one key per machine, owner only, the same however many ask at once', async () => {
    const keys = await Promise.all([
      uploadKeyOf(home),
      uploadKeyOf(home),
      uploadKeyOf(home),
    ]);
    expect(keys[0]?.length).toBe(32);
    expect(keys.every((key) => key.equals(keys[0] ?? Buffer.alloc(0)))).toBe(true);
    const mode = (await stat(join(home, '.memnox', 'upload-key'))).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('hashes a file path and a command so the same one still matches and none can be read', async () => {
    const key = await uploadKeyOf(home);
    const path = 'src/customers/acme-contract.ts';
    const sent = uploadedRef('filesystem.write', path, key);
    expect(sent).toMatch(/^h_[0-9a-f]{24}$/);
    expect(sent).toBe(uploadedRef('filesystem.write', path, key));
    expect(sent).not.toContain('acme');
    expect(uploadedRef('shell.execute', 'cat acme.txt', key)).not.toContain('acme');
  });

  it('leaves the refs the workspace reads by name as they are', async () => {
    const key = await uploadKeyOf(home);
    expect(uploadedRef('mcp.github.merge_pull_request', 'github', key)).toBe('github');
    expect(uploadedRef('git.push', 'origin main', key)).toBe('origin main');
    expect(carriesPath('http.request')).toBe(false);
  });

  it('sends a path as written, masked for secrets, when no key is given', () => {
    expect(uploadedRef('filesystem.write', 'src/a.ts', null)).toBe('src/a.ts');
  });

  it('gives two machines different hashes for one path', () => {
    const one = hashedRef(Buffer.alloc(32, 1), 'src/a.ts');
    const two = hashedRef(Buffer.alloc(32, 2), 'src/a.ts');
    expect(one).not.toBe(two);
  });
});
