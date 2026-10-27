import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  brokerPathFor,
  isNamedPipe,
  MEMNOX_HOME,
  pipeNameFor,
  SOCKET_FILE,
  socketPathFor,
} from '../src/index';

/**
 * Windows has no socket file for a peer to open, so the daemon listens on a named pipe
 * there. One function names the address for every caller, so the two never disagree.
 */
describe('where the daemon listens', () => {
  it('stays a socket file under the Memnox home on macOS and Linux', () => {
    expect(socketPathFor('/Users/ada', 'darwin')).toBe(
      join('/Users/ada', MEMNOX_HOME, SOCKET_FILE),
    );
    expect(socketPathFor('/home/ada', 'linux')).toBe(
      join('/home/ada', MEMNOX_HOME, SOCKET_FILE),
    );
  });

  it('is a named pipe carrying the account on Windows', () => {
    const address = socketPathFor('C:\\Users\\ada', 'win32');
    expect(address.startsWith('\\\\.\\pipe\\memnox-ada-')).toBe(true);
    expect(isNamedPipe(address)).toBe(true);
  });

  it('gives two homes on one machine two pipes, so a test never answers for a person', () => {
    expect(socketPathFor('C:\\Users\\ada', 'win32')).not.toBe(
      socketPathFor('C:\\Users\\ada\\other', 'win32'),
    );
    expect(socketPathFor('C:\\Users\\ada', 'win32')).toBe(
      socketPathFor('C:\\Users\\ada', 'win32'),
    );
  });

  it('keeps only characters a pipe name can hold from the account', () => {
    expect(pipeNameFor('C:\\Users\\Ada Lovelace', 'memnox')).toMatch(
      /^\\\\\.\\pipe\\memnox-Ada-Lovelace-[0-9a-f]{8}$/,
    );
  });

  it('never calls a socket file a pipe', () => {
    expect(isNamedPipe(socketPathFor('/Users/ada', 'darwin'))).toBe(false);
  });

  it('puts the credential broker on a pipe per session on Windows too', () => {
    const one = brokerPathFor('C:\\Users\\ada', 'ses_one', 'win32');
    expect(isNamedPipe(one)).toBe(true);
    expect(one).toContain('memnox-broker-ses_one');
    expect(one).not.toBe(brokerPathFor('C:\\Users\\ada', 'ses_two', 'win32'));
    expect(brokerPathFor('/Users/ada', 'ses_one', 'darwin')).toBe(
      join('/Users/ada', MEMNOX_HOME, 'brokers', 'ses_one.sock'),
    );
  });
});
