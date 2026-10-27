/**
 * The daemon's wire format and the exact strings a person signs, for a screen that runs no Node:
 * the Tauri desktop app imports this rather than mirroring it, so its wire cannot drift.
 * Everything reached from here is pure, and `test/wire.test.ts` fails the moment it is not.
 */
export * from './daemon/protocol';
export * from './daemon/delivery';
export * from './daemon/person-standing';
export * from './daemon/session-view';
export * from './daemon/voice-cards';
export * from './daemon/work-cards';
export * from './daemon/files';
export * from './daemon/speech';
export * from './daemon/team-calls';
export * from './daemon/home';
export * from './daemon/intercept';
export * from './daemon/remote';
export {
  MOST_PRESSED_KEYS,
  TERMINAL_KEY,
  terminalKeys,
  type TerminalKey,
} from './daemon/display';
export { REMOTE_CAPABILITY, type RemoteCapability } from './gate/remote-capability';
export {
  HOLD_ANSWER,
  PROPOSAL_ANSWER,
  type HoldAnswer,
  type ProposalAnswer,
} from './gate/answers';
export { confirmationMessage } from './gate/confirm-message';
