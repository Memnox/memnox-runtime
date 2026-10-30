/**
 * Personal sync as every screen reads and drives it: one person's servers, skills, projects, rules
 * and verified memory carried blind across their own machines. It runs when asked and after a
 * local change, never on a timer, and the key moves only behind a fingerprint the Mac signs.
 */

export const PERSONAL_SYNC_METHOD = {
  /** Where sync stands here: the key, the last run, what was left out, and any machine waiting. */
  PERSONAL_SYNC_STATUS: 'personal-sync-status',
  /** Pulls what the person's other machines sent, then sends what changed here. */
  PERSONAL_SYNC_NOW: 'personal-sync-now',
  /** The copies a sync replaced without having seen them, opened for the person to choose from. */
  PERSONAL_SYNC_CONFLICTS: 'personal-sync-conflicts',
  /** Keeps one side of a conflict: the copy taken back here, or this machine's own. */
  PERSONAL_SYNC_RESOLVE: 'personal-sync-resolve',
  /** On a machine holding the key: proposes sealing it to a waiting machine whose fingerprint the person compared. */
  PERSONAL_SYNC_KEY_OFFER: 'personal-sync-key-offer',
  /** On a new machine: proposes taking the key sealed to it, once the person compared the same fingerprint. */
  PERSONAL_SYNC_KEY_ACCEPT: 'personal-sync-key-accept',
} as const;

/** Where personal sync stands on this machine. */
export const PERSONAL_SYNC_STATE = {
  /** Not on Memnox Cloud, so there is nowhere to carry anything. */
  OFF: 'off',
  /** No sync key here yet: another of the person's machines has to seal it to this one. */
  WAITING_FOR_KEY: 'waiting-for-key',
  /** A key sealed to this machine arrived and waits for the person to compare and accept it. */
  KEY_ARRIVED: 'key-arrived',
  READY: 'ready',
  /** The plan does not carry personal sync; what is here stays here. */
  NOT_ON_PLAN: 'not-on-plan',
  /** The credential speaks for no person, so it has nothing of its own to sync. */
  NO_PERSON: 'no-person',
} as const;

export type PersonalSyncState =
  (typeof PERSONAL_SYNC_STATE)[keyof typeof PERSONAL_SYNC_STATE];

/** Which side of a conflict to keep. */
export const SYNC_KEEP = {
  /** The copy the cloud kept, put back here and sent as the newest. */
  THEIRS: 'theirs',
  /** What this machine holds now; the kept copy is let go. */
  MINE: 'mine',
} as const;

export type SyncKeep = (typeof SYNC_KEEP)[keyof typeof SYNC_KEEP];

/** One of the person's machines, as far as the sync key goes. */
export interface PersonalSyncMachine {
  machineId: string;
  /** Compared with what the other machine shows before the key moves either way. */
  fingerprint: string;
  /** Another of the person's machines already sealed the key to it. */
  sealed: boolean;
}

/** How many items of one kind this machine carries. */
export interface PersonalSyncKindCount {
  kind: string;
  items: number;
}

export interface PersonalSyncStatus {
  state: PersonalSyncState;
  /** Where it stands, in one sentence a screen shows as it is. */
  said: string;
  /** Which sync key this machine holds, never the key. */
  keyId?: string;
  lastSyncedAt?: string;
  kinds: PersonalSyncKindCount[];
  conflicts: number;
  /** Items left out of the last run, each said: too large, sealed under another key, or waiting on a signature. */
  skipped: string[];
  /** Repositories opened on the person's other machines and not here. */
  openedElsewhere: string[];
  /** On a machine holding the key: the person's machines still waiting for it. */
  waiting: PersonalSyncMachine[];
  /** On a machine waiting: the fingerprint of the key that arrived, to compare before accepting it. */
  arrivedFingerprint?: string;
}

/** A conflict copy opened here, beside what this machine holds of the same item now. */
export interface PersonalSyncConflict {
  id: string;
  kind: string;
  name: string;
  /** Which machine wrote the copy that lost. */
  writtenBy: string;
  keptAt: string;
  /** The copy, as text a screen shows. */
  theirs: string;
  /** What this machine holds now, absent where it holds nothing by that name. */
  mine?: string;
}

export interface PersonalSyncRequestFields {
  /** On RESOLVE. */
  syncConflictId?: string;
  /** On RESOLVE. */
  syncKeep?: SyncKeep;
  /** On KEY_OFFER: the waiting machine to seal the key to. */
  syncMachineId?: string;
  /** On KEY_OFFER and KEY_ACCEPT: the fingerprint the person compared, which must be the one shown. */
  syncFingerprint?: string;
}

export interface PersonalSyncResponseFields {
  /** On every personal sync method, so a screen redraws from one answer. */
  personalSync?: PersonalSyncStatus;
  /** On CONFLICTS. */
  syncConflicts?: PersonalSyncConflict[];
}
