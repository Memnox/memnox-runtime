import { describe, expect, it } from 'vitest';
import { decodeRequest, LineBuffer, MOST_REQUEST_CHARS } from '../src/index';

describe('what the daemon takes off its socket', () => {
  it('reads a request whose fields hold the types the protocol names', () => {
    expect(
      decodeRequest('{"id":1,"method":"confirm","subject":"prp_1","answer":"confirmed"}'),
    ).toEqual({ id: 1, method: 'confirm', subject: 'prp_1', answer: 'confirmed' });
  });

  it('refuses a field of the wrong type rather than handing it on', () => {
    expect(decodeRequest('{"id":1,"method":"confirm","subject":42}')).toBeNull();
    expect(decodeRequest('{"id":1,"method":"record","exitCode":"0"}')).toBeNull();
    expect(decodeRequest('{"id":1,"method":"trace","spans":{}}')).toBeNull();
    expect(decodeRequest('{"id":1,"method":"seen","sight":[]}')).toBeNull();
  });

  it('refuses a line too long to be a request', () => {
    const said = 'a'.repeat(MOST_REQUEST_CHARS);
    expect(decodeRequest(`{"id":1,"method":"ask","said":"${said}"}`)).toBeNull();
  });

  it('stops reading at a line too long to be a message, finished or not', () => {
    const buffer = new LineBuffer(10);
    expect(buffer.push('{"id":1}\n{"id"')).toEqual(['{"id":1}']);
    expect(buffer.overflowed).toBe(false);
    expect(buffer.push('"method":"ask"')).toEqual([]);
    expect(buffer.overflowed).toBe(true);
    expect(buffer.push('\n{"id":2}\n')).toEqual([]);
  });
});
