/**
 * A QR code for a pairing link, so `memnox pair` over SSH can put one on a terminal with no
 * dependency. Byte mode at error correction level M only, which is all a link needs.
 */

/** A finished symbol: `modules[y][x]` is true where the module is dark. */
export interface QrCode {
  version: number;
  mask: number;
  size: number;
  modules: readonly (readonly boolean[])[];
}

const MIN_VERSION = 1;
const MAX_VERSION = 40;

/** Level M, by version; index 0 is unused. */
const ECC_CODEWORDS_PER_BLOCK = [
  -1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26,
  28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
];
const ERROR_CORRECTION_BLOCKS = [
  -1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20,
  21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49,
];

/** Level M's two format bits. */
const FORMAT_BITS_M = 0;
const BYTE_MODE = 0x4;

const PENALTY_N1 = 3;
const PENALTY_N2 = 3;
const PENALTY_N3 = 40;
const PENALTY_N4 = 10;

/** The smallest symbol that holds the text as UTF-8, or null when even version 40 cannot. */
export function encodeQr(text: string, options: { mask?: number } = {}): QrCode | null {
  const data = new TextEncoder().encode(text);
  const version = versionFor(data.length);
  if (version === null) return null;
  const codewords = addEccAndInterleave(dataCodewords(data, version), version);
  const symbol = new QrSymbol(version);
  symbol.drawCodewords(codewords);
  const mask = options.mask ?? symbol.bestMask();
  symbol.applyMask(mask);
  symbol.drawFormatBits(mask);
  return { version, mask, size: symbol.size, modules: symbol.modules };
}

function versionFor(length: number): number | null {
  for (let version = MIN_VERSION; version <= MAX_VERSION; version++) {
    const used = 4 + countBits(version) + length * 8;
    if (used <= dataCodewordCount(version) * 8) return version;
  }
  return null;
}

function countBits(version: number): number {
  return version <= 9 ? 8 : 16;
}

function rawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const aligns = Math.floor(version / 7) + 2;
    result -= (25 * aligns - 10) * aligns - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

function dataCodewordCount(version: number): number {
  return (
    Math.floor(rawDataModules(version) / 8) -
    at(ECC_CODEWORDS_PER_BLOCK, version) * at(ERROR_CORRECTION_BLOCKS, version)
  );
}

function dataCodewords(data: Uint8Array, version: number): number[] {
  const bits: number[] = [];
  const append = (value: number, length: number): void => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  append(BYTE_MODE, 4);
  append(data.length, countBits(version));
  for (const byte of data) append(byte, 8);
  const capacity = dataCodewordCount(version) * 8;
  append(0, Math.min(4, capacity - bits.length));
  append(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) append(pad, 8);
  const bytes: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    bytes.push(bits.slice(i, i + 8).reduce((byte, bit) => (byte << 1) | bit, 0));
  }
  return bytes;
}

function addEccAndInterleave(data: readonly number[], version: number): number[] {
  const blocks = at(ERROR_CORRECTION_BLOCKS, version);
  const eccLength = at(ECC_CODEWORDS_PER_BLOCK, version);
  const raw = Math.floor(rawDataModules(version) / 8);
  const shortBlocks = blocks - (raw % blocks);
  const shortLength = Math.floor(raw / blocks);
  const divisor = reedSolomonDivisor(eccLength);
  const all: number[][] = [];
  for (let i = 0, k = 0; i < blocks; i++) {
    const block = data.slice(k, k + shortLength - eccLength + (i < shortBlocks ? 0 : 1));
    k += block.length;
    const ecc = reedSolomonRemainder(block, divisor);
    // A placeholder keeps every block one length, and interleaving skips it.
    if (i < shortBlocks) block.push(0);
    all.push([...block, ...ecc]);
  }
  const result: number[] = [];
  const width = all[0]?.length ?? 0;
  for (let i = 0; i < width; i++) {
    all.forEach((block, j) => {
      if (i !== shortLength - eccLength || j >= shortBlocks) result.push(at(block, i));
    });
  }
  return result;
}

function reedSolomonDivisor(degree: number): number[] {
  const result: number[] = new Array<number>(degree - 1).fill(0);
  result.push(1);
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = multiply(at(result, j), root);
      if (j + 1 < result.length) result[j] = at(result, j) ^ at(result, j + 1);
    }
    root = multiply(root, 0x02);
  }
  return result;
}

function reedSolomonRemainder(
  data: readonly number[],
  divisor: readonly number[],
): number[] {
  const result: number[] = divisor.map(() => 0);
  for (const byte of data) {
    const factor = byte ^ (result.shift() ?? 0);
    result.push(0);
    divisor.forEach((coefficient, i) => {
      result[i] = at(result, i) ^ multiply(coefficient, factor);
    });
  }
  return result;
}

/** Multiplication in GF(2^8) over the QR polynomial 0x11D. */
function multiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

class QrSymbol {
  readonly size: number;
  readonly modules: boolean[][];
  private readonly reserved: boolean[][];

  constructor(private readonly version: number) {
    this.size = version * 4 + 17;
    this.modules = grid(this.size);
    this.reserved = grid(this.size);
    this.drawFunctionPatterns();
  }

  drawCodewords(data: readonly number[]): void {
    let i = 0;
    for (let right = this.size - 1; right >= 1; right -= 2) {
      // The vertical timing line is skipped whole, so the column pairs shift by one past it.
      if (right === 6) right = 5;
      for (let vert = 0; vert < this.size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? this.size - 1 - vert : vert;
          if (!this.isReserved(x, y) && i < data.length * 8) {
            this.set(x, y, ((at(data, i >>> 3) >>> (7 - (i & 7))) & 1) === 1);
            i++;
          }
        }
      }
    }
  }

  applyMask(mask: number): void {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        if (!this.isReserved(x, y) && masked(mask, x, y))
          this.set(x, y, !this.dark(x, y));
      }
    }
  }

  /** The mask with the lowest penalty, tried in place and undone each time. */
  bestMask(): number {
    let best = 0;
    let lowest = Infinity;
    for (let mask = 0; mask < 8; mask++) {
      this.applyMask(mask);
      this.drawFormatBits(mask);
      const penalty = this.penalty();
      if (penalty < lowest) {
        best = mask;
        lowest = penalty;
      }
      this.applyMask(mask);
    }
    return best;
  }

  drawFormatBits(mask: number): void {
    const data = (FORMAT_BITS_M << 3) | mask;
    let remainder = data;
    for (let i = 0; i < 10; i++)
      remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
    const bits = ((data << 10) | remainder) ^ 0x5412;
    const size = this.size;
    for (let i = 0; i <= 5; i++) this.reserve(8, i, bit(bits, i));
    this.reserve(8, 7, bit(bits, 6));
    this.reserve(8, 8, bit(bits, 7));
    this.reserve(7, 8, bit(bits, 8));
    for (let i = 9; i < 15; i++) this.reserve(14 - i, 8, bit(bits, i));
    for (let i = 0; i < 8; i++) this.reserve(size - 1 - i, 8, bit(bits, i));
    for (let i = 8; i < 15; i++) this.reserve(8, size - 15 + i, bit(bits, i));
    this.reserve(8, size - 8, true);
  }

  private drawFunctionPatterns(): void {
    const size = this.size;
    for (let i = 0; i < size; i++) {
      this.reserve(6, i, i % 2 === 0);
      this.reserve(i, 6, i % 2 === 0);
    }
    this.drawFinder(3, 3);
    this.drawFinder(size - 4, 3);
    this.drawFinder(3, size - 4);
    const positions = this.alignmentPositions();
    const last = positions.length - 1;
    positions.forEach((y, i) => {
      positions.forEach((x, j) => {
        const underFinder =
          (i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0);
        if (!underFinder) this.drawAlignment(x, y);
      });
    });
    // Drawn now only to reserve the area; the real bits go in once the mask is chosen.
    this.drawFormatBits(0);
    this.drawVersion();
  }

  private drawFinder(x: number, y: number): void {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && xx < this.size && yy >= 0 && yy < this.size) {
          this.reserve(xx, yy, distance !== 2 && distance !== 4);
        }
      }
    }
  }

  private drawAlignment(x: number, y: number): void {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        this.reserve(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }

  private alignmentPositions(): number[] {
    if (this.version === 1) return [];
    const count = Math.floor(this.version / 7) + 2;
    const step =
      this.version === 32 ? 26 : Math.ceil((this.version * 4 + 4) / (count * 2 - 2)) * 2;
    const result = [6];
    for (let position = this.size - 7; result.length < count; position -= step) {
      result.splice(1, 0, position);
    }
    return result;
  }

  private drawVersion(): void {
    if (this.version < 7) return;
    let remainder = this.version;
    for (let i = 0; i < 12; i++)
      remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
    const bits = (this.version << 12) | remainder;
    for (let i = 0; i < 18; i++) {
      const a = this.size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      this.reserve(a, b, bit(bits, i));
      this.reserve(b, a, bit(bits, i));
    }
  }

  private penalty(): number {
    let result = 0;
    for (let line = 0; line < this.size; line++) {
      result += this.linePenalty((i) => this.dark(i, line));
      result += this.linePenalty((i) => this.dark(line, i));
    }
    for (let y = 0; y < this.size - 1; y++) {
      for (let x = 0; x < this.size - 1; x++) {
        const color = this.dark(x, y);
        if (
          color === this.dark(x + 1, y) &&
          color === this.dark(x, y + 1) &&
          color === this.dark(x + 1, y + 1)
        ) {
          result += PENALTY_N2;
        }
      }
    }
    const dark = this.modules.reduce((sum, row) => sum + row.filter(Boolean).length, 0);
    const total = this.size * this.size;
    const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
    return result + k * PENALTY_N4;
  }

  /** Runs of five or more, and finder-like patterns, along one row or column. */
  private linePenalty(darkAt: (i: number) => boolean): number {
    let result = 0;
    let runColor = false;
    let run = 0;
    const history = [0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < this.size; i++) {
      if (darkAt(i) === runColor) {
        run++;
        if (run === 5) result += PENALTY_N1;
        else if (run > 5) result++;
      } else {
        this.addHistory(run, history);
        if (!runColor) result += finderPatterns(history) * PENALTY_N3;
        runColor = darkAt(i);
        run = 1;
      }
    }
    if (runColor) {
      this.addHistory(run, history);
      run = 0;
    }
    this.addHistory(run + this.size, history);
    return result + finderPatterns(history) * PENALTY_N3;
  }

  /** The light border counts as a run before the first module. */
  private addHistory(run: number, history: number[]): void {
    history.pop();
    history.unshift(history[0] === 0 ? run + this.size : run);
  }

  private dark(x: number, y: number): boolean {
    return this.modules[y]?.[x] === true;
  }

  private isReserved(x: number, y: number): boolean {
    return this.reserved[y]?.[x] === true;
  }

  private set(x: number, y: number, dark: boolean): void {
    const row = this.modules[y];
    if (row !== undefined) row[x] = dark;
  }

  private reserve(x: number, y: number, dark: boolean): void {
    this.set(x, y, dark);
    const row = this.reserved[y];
    if (row !== undefined) row[x] = true;
  }
}

function finderPatterns(history: readonly number[]): number {
  const n = at(history, 1);
  const core =
    n > 0 &&
    at(history, 2) === n &&
    at(history, 3) === n * 3 &&
    at(history, 4) === n &&
    at(history, 5) === n;
  return (
    (core && at(history, 0) >= n * 4 && at(history, 6) >= n ? 1 : 0) +
    (core && at(history, 6) >= n * 4 && at(history, 0) >= n ? 1 : 0)
  );
}

function masked(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0:
      return (x + y) % 2 === 0;
    case 1:
      return y % 2 === 0;
    case 2:
      return x % 3 === 0;
    case 3:
      return (x + y) % 3 === 0;
    case 4:
      return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5:
      return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6:
      return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    case 7:
      return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
    default:
      throw new Error(`A QR mask is 0 to 7, and ${mask} is not.`);
  }
}

function bit(value: number, i: number): boolean {
  return ((value >>> i) & 1) !== 0;
}

function grid(size: number): boolean[][] {
  return Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
}

/** An index the arithmetic above already keeps in range, read without an undefined. */
function at(values: readonly number[], i: number): number {
  return values[i] ?? 0;
}
