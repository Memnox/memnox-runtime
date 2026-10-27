/**
 * Splits a stream into whole newline-delimited lines, holding back the partial one, since
 * a partial write is normal on a pipe and treating it as a message corrupts the stream.
 */
export class LineBuffer {
  private pending = '';
  private over = false;

  /** A line longer than `most`, finished or not, is no message, and nothing after it is read. */
  constructor(private readonly most: number = Number.POSITIVE_INFINITY) {}

  /** The whole lines this chunk completed. Blank lines are not messages. */
  push(chunk: string): string[] {
    if (this.over) return [];
    this.pending += chunk;
    const lines = this.pending.split('\n');
    this.pending = lines.pop() ?? '';
    if (
      this.pending.length > this.most ||
      lines.some((line) => line.length > this.most)
    ) {
      this.over = true;
      this.pending = '';
      return [];
    }
    return lines.filter((line) => line.trim().length > 0);
  }

  /** A line ran past the limit, so the reader should hang up rather than wait for more. */
  get overflowed(): boolean {
    return this.over;
  }
}
