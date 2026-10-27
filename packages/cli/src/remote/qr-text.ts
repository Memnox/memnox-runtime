import type { QrCode } from '@memnox/core';

/** The four modules of light border a scanner needs around a symbol. */
const QUIET_ZONE = 4;

/** Black on bright white whatever the terminal's theme, since a camera needs dark modules on light. */
const ON = '\u001b[30;107m';
const OFF = '\u001b[0m';

/** Two rows of modules per line of text, so the symbol is close to square in a terminal cell. */
export function qrLines(code: QrCode): string[] {
  const span = code.size + QUIET_ZONE * 2;
  const dark = (x: number, y: number): boolean =>
    code.modules[y - QUIET_ZONE]?.[x - QUIET_ZONE] === true;
  const lines: string[] = [];
  for (let y = 0; y < span; y += 2) {
    let line = '';
    for (let x = 0; x < span; x++) line += halfBlock(dark(x, y), dark(x, y + 1));
    lines.push(`${ON}${line}${OFF}`);
  }
  return lines;
}

function halfBlock(top: boolean, bottom: boolean): string {
  if (top && bottom) return '█';
  if (top) return '▀';
  if (bottom) return '▄';
  return ' ';
}
