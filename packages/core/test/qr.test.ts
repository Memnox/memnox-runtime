import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { encodeQr, type QrCode } from '../src';

/**
 * Symbols at level M in byte mode, hashed row by row as 1 for dark. Those with a mask chosen here
 * were drawn by qrcodegen 1.8, whose penalty scoring this follows; those with a mask given were drawn
 * by segno 1.6.6 with its padding corrected, since it adds a zero byte the standard does not.
 */
const LINK =
  'memnox://pair?d=' +
  'eyJ2IjoxLCJtYWNoaW5lSWQiOiJtY2hfYWJjIiwibWFjaGluZSI6Imhvc3RpbmdlciJ9'.repeat(6);

const VECTORS: {
  text: string;
  mask?: number;
  version: number;
  chosen: number;
  sha: string;
}[] = [
  {
    text: 'HELLO',
    version: 1,
    chosen: 4,
    sha: '32fbc389880456d584e32bdf2c31372391c92f9f853e119a75bec5e14c380a23',
  },
  {
    text: 'memnox',
    mask: 3,
    version: 1,
    chosen: 3,
    sha: 'f57fc62f953f6e23bdb342abb08cd174bd76eb5e28169f0e67a79810daf92832',
  },
  {
    text: 'https://memnox.com/pair',
    version: 2,
    chosen: 0,
    sha: 'ef6d3ae2624a9c8f559d7bf4c99dd9ab8ba5370b803d730e80d16191c3f25bd9',
  },
  {
    text: 'é ünïcode ✓',
    mask: 5,
    version: 2,
    chosen: 5,
    sha: '2287f40a9e14b56d2d6b26a4a2c10b99e08f05ddbc9d0603d94f5cca35d259c9',
  },
  {
    text: LINK,
    version: 16,
    chosen: 2,
    sha: 'ed4a444ac47c81189604edfecd722ac47d9abdc1171dfdfff9bd0dff2028548a',
  },
  {
    text: LINK,
    mask: 6,
    version: 16,
    chosen: 6,
    sha: 'b17f171d07046735c238b961b14c76e8e60e3cd4d27ccdfbee6095965f1abf48',
  },
  {
    text: 'x'.repeat(1200),
    version: 29,
    chosen: 0,
    sha: '98f24e3303dc979c8a802b77da01a74959851d3f71baee5d65ed5063a4af3ef5',
  },
];

function digest(code: QrCode): string {
  const rows = code.modules.map((row) => row.map((dark) => (dark ? '1' : '0')).join(''));
  return createHash('sha256').update(rows.join('')).digest('hex');
}

describe('a QR code for a pairing link', () => {
  it.each(VECTORS)(
    'draws $text.length characters as version $version with mask $chosen, module for module',
    ({ text, mask, version, chosen, sha }) => {
      const code = encodeQr(text, mask === undefined ? {} : { mask });

      expect(code).toMatchObject({ version, mask: chosen, size: version * 4 + 17 });
      expect(digest(code as QrCode)).toBe(sha);
    },
  );

  it('is null for text no symbol can hold', () => {
    expect(encodeQr('x'.repeat(2400))).toBeNull();
  });
});
