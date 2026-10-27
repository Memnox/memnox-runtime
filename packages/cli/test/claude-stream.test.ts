import { describe, expect, it } from 'vitest';
import { BRAIN_CHUNK } from '../src/operator/brain';
import { readStreamLine } from '../src/operator/claude-stream';

const line = (value: unknown): string => JSON.stringify(value);

describe("reading Claude Code's stream", () => {
  it('keeps the session id so the next conversation can resume it', () => {
    expect(
      readStreamLine(line({ type: 'system', subtype: 'init', session_id: 's-1' }), false),
    ).toEqual({ chunks: [], sessionId: 's-1' });
  });

  it('says text as it is generated', () => {
    const read = readStreamLine(
      line({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'Two ' },
        },
      }),
      false,
    );
    expect(read.chunks).toEqual([{ kind: BRAIN_CHUNK.TEXT, text: 'Two ' }]);
  });

  it('shows a tool being read, and not the text a whole message repeats', () => {
    const read = readStreamLine(
      line({
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'already said' },
            { type: 'tool_use', name: 'mcp__memnox-operator__sessions' },
          ],
        },
      }),
      true,
    );
    expect(read.chunks).toEqual([
      { kind: BRAIN_CHUNK.TOOL, tool: 'mcp__memnox-operator__sessions' },
    ]);
  });

  it('shows a tool the moment it starts, and not again when the whole message repeats it', () => {
    const announced = new Set<string>();
    const start = readStreamLine(
      line({
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          content_block: {
            type: 'tool_use',
            id: 'tu_1',
            name: 'mcp__memnox-operator__show',
          },
        },
      }),
      true,
      announced,
    );
    expect(start.chunks).toEqual([
      { kind: BRAIN_CHUNK.TOOL, tool: 'mcp__memnox-operator__show' },
    ]);
    const whole = readStreamLine(
      line({
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', id: 'tu_1', name: 'mcp__memnox-operator__show' },
            { type: 'tool_use', id: 'tu_2', name: 'mcp__memnox-operator__session' },
          ],
        },
      }),
      true,
      announced,
    );
    expect(whole.chunks).toEqual([
      { kind: BRAIN_CHUNK.TOOL, tool: 'mcp__memnox-operator__session' },
    ]);
  });

  it('ends the turn, saying the answer only when nothing streamed it', () => {
    const done = line({ type: 'result', is_error: false, result: 'All quiet.' });
    expect(readStreamLine(done, true).chunks).toEqual([{ kind: BRAIN_CHUNK.DONE }]);
    expect(readStreamLine(done, false).chunks).toEqual([
      { kind: BRAIN_CHUNK.TEXT, text: 'All quiet.' },
      { kind: BRAIN_CHUNK.DONE },
    ]);
  });

  it('tells a spent plan apart from any other failure', () => {
    const limited = line({
      type: 'result',
      is_error: true,
      result: 'Claude AI usage limit reached',
    });
    const failed = line({ type: 'result', is_error: true, result: 'MCP server crashed' });
    expect(readStreamLine(limited, false).chunks[0]?.kind).toBe(BRAIN_CHUNK.LIMITED);
    expect(readStreamLine(failed, false).chunks[0]?.kind).toBe(BRAIN_CHUNK.FAILED);
  });

  it('ignores a line that is not a message', () => {
    expect(readStreamLine('warning: something', false)).toEqual({ chunks: [] });
    expect(readStreamLine(line([1, 2]), false)).toEqual({ chunks: [] });
  });
});
