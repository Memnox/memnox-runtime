import { platform } from 'node:os';
import { keyAfter, keyGesture, keyWord, machineWord } from '@memnox/core';

/** Read once here, so no tool's words read the platform themselves. */
const HOST = platform();

/** What the daemon calls the machine it runs on. */
export const MACHINE = machineWord(HOST);

/** The key that signs a yes, said to the person: "Touch ID", or on Linux "your password". */
export const KEY = keyWord(HOST);
/** The same key at the start of a sentence. */
export const KEY_START = `${KEY.charAt(0).toUpperCase()}${KEY.slice(1)}`;
/** The key told to the voice about the person: "Touch ID", or on Linux "their password". */
export const KEY_THEIRS = keyWord(HOST, 'their');
export const THEIR_KEY = keyAfter(HOST, 'their');
export const YOUR_KEY = keyAfter(HOST, 'your');
export const ONE_KEY = keyAfter(HOST, 'one');
export const NO_KEY = keyAfter(HOST, 'no');
export const THE_KEY = keyAfter(HOST, 'the');
export const THIS_MACHINES_KEY = keyAfter(HOST, `this ${MACHINE}'s`);
/** What the person does when the key asks. */
export const KEY_GESTURE = keyGesture(HOST);
