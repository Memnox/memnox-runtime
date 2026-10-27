/**
 * The part of the daemon protocol a paired phone brings: pairing, the device registry, the voice
 * a phone speaks with, and driving the Mac. `docs/remote-contract.md` is the description it follows.
 */

export const REMOTE_METHOD = {
  /** Opens a pairing and answers the QR the Mac shows; refused while the machine is not on Memnox Cloud. */
  PAIR_BEGIN: 'pair-begin',
  /** Streams where a pairing stands until it is paired, declined or expired. */
  PAIR_PENDING: 'pair-pending',
  /** The person's yes to a device: signed by the Mac over `pairMessage`, or the device's digits where no Mac key is kept. */
  PAIR_ACCEPT: 'pair-accept',
  /** The person's no to a phone, unsigned since saying no can do no harm. */
  PAIR_DECLINE: 'pair-decline',
  DEVICES_LIST: 'devices-list',
  /** Takes a device's access away, unsigned since it only narrows what is allowed. */
  DEVICE_REVOKE: 'device-revoke',
  /** One more capability for a device, signed by the Mac over `grantMessage` wherever a Mac key is kept. */
  DEVICE_GRANT: 'device-grant',
  /** One capability taken back from a device, unsigned since it only narrows what is allowed. */
  DEVICE_UNGRANT: 'device-ungrant',
  /** The Kokoro voice the person picked on the Mac, handed to a paired phone inside the tunnel. */
  VOICE_CHOICE: 'voice-choice',
  /** A phone driving the Mac until a time it signed for, or stopping when it names none. */
  DRIVE: 'drive',
  /** A phone whose app left the screen handing the voice back to the Mac, unsigned since it only gives power up. */
  VOICE_RELEASE: 'voice-release',
} as const;

/** What a remote or pairing answer settled, in the words the contract names. */
export const REMOTE_OUTCOME = {
  PAIRING: 'pairing',
  PAIRED: 'paired',
  DECLINED: 'declined',
  REVOKED: 'revoked',
  GRANTED: 'granted',
  UNGRANTED: 'ungranted',
  REFUSED: 'refused',
  DRIVING: 'driving',
  STOPPED: 'stopped',
} as const;

export const PAIRING_STATE = {
  /** The QR is up and no phone has reached it yet. */
  WAITING: 'waiting',
  /** A phone finished the handshake and proved its key, and waits on the person. */
  ANSWERED: 'answered',
  PAIRED: 'paired',
  DECLINED: 'declined',
  EXPIRED: 'expired',
} as const;

export type PairingState = (typeof PAIRING_STATE)[keyof typeof PAIRING_STATE];

/** The phone that reached a pairing, with the six digits both screens show. */
export interface PairingPhone {
  name: string;
  fingerprint: string;
  code: string;
}

/** A pairing as the daemon answers it: pair-begin carries the QR, pair-pending the state. */
export interface PairingWire {
  id: string;
  qr?: string;
  expiresAt?: string;
  state?: PairingState;
  /** Who accepts it: the Mac's Touch ID, or the person typing the digits the device shows. */
  approver?: string;
  /** The code is left out when the person accepts by typing it, so only the device's screen has it. */
  phone?: Omit<PairingPhone, 'code'> & { code?: string };
}

/** A device as devices-list shows it; its keys stay in the registry and never travel. */
export interface DeviceWire {
  id: string;
  name: string;
  kind: string;
  fingerprint: string;
  capabilities: string[];
  pairedAt: string;
  revokedAt?: string;
  approvedBy?: string;
}

/** Who drives the Mac and until when, which the Mac island shows the whole time; no until says it ended. */
export interface DrivenBy {
  deviceId: string;
  name: string;
  until?: string;
}

/** A phone's conversation as the Mac island mirrors it: what was said, the answer in pieces, then its end. */
export interface PhoneTurn {
  deviceId: string;
  name: string;
  said?: string;
  answer?: string;
  ended?: boolean;
}

/** The phone that holds the voice: while it drives or talks, it speaks and the Mac only shows. */
export interface VoiceHolder {
  deviceId: string;
  name: string;
}

/** A phone took the voice from the Mac or gave it back, for the Mac island to say where it went. */
export interface VoiceOn extends VoiceHolder {
  holding: boolean;
}

export interface RemoteRequestFields {
  /** On pair-pending, pair-accept and pair-decline. */
  pairingId?: string;
  /** On pair-accept where no Mac key is kept: the six digits the device shows, typed by the person. */
  code?: string;
  /** On device-revoke, device-grant and device-ungrant. */
  deviceId?: string;
  /** On device-grant and device-ungrant. */
  capability?: string;
  /** On voice-choice: the Kokoro voice id; left out only asks which one is set. */
  voice?: string;
  /** On pair-begin: what to call this machine on the device. */
  name?: string;
  /** On drive: when driving ends, at most fifteen minutes ahead; absent stops it. */
  until?: string;
  /** On ask: set by the daemon from the session's principal, never taken from a client. */
  origin?: { deviceId: string };
}

export interface RemoteResponseFields {
  pairing?: PairingWire;
  /** On a device's ping and in the pairing welcome: whether this machine has a Kokoro voice to lend it. */
  speaks?: boolean;
  /** On a device's ping: what this device may do here, so it never offers what would be refused. */
  capabilities?: string[];
  /** On a refused pair-accept with digits: how many more the pairing takes before it closes. */
  triesLeft?: number;
  devices?: DeviceWire[];
  device?: DeviceWire;
  voice?: string;
  /** On drive: when the grant ends. */
  until?: string;
  /** To the device that asked: what the Mac did for it, for the phone to say. */
  done?: { text: string };
}

export interface RemoteEventFields {
  /** On SHOW: only the Mac app can do it, so it goes to the Mac whoever asked. */
  needsMac?: true;
  /** On a NOTICE to the Mac: a phone drives it until then, or stopped when until is absent. */
  drivenBy?: DrivenBy;
  /** On a NOTICE to the Mac app only, never through the relay: a phone's conversation to show without a sound. */
  phoneTurn?: PhoneTurn;
  /** On any event while a phone holds the voice: that phone says it and the Mac shows it without a sound. */
  heardOn?: VoiceHolder;
  /** On a NOTICE to the Mac app only: a phone took the voice or gave it back. */
  voiceOn?: VoiceOn;
  /** On an event done for a phone's ask: the phone that asked, so the Mac stays quiet and that phone hears it. */
  origin?: { deviceId: string };
  /**
   * On a held call or a proposal while a paired phone may answer it: that phone, which puts the yes to Face ID,
   * so the Mac leaves it there rather than putting it to Touch ID, since the person may be far from the Mac.
   */
  answerOn?: VoiceHolder;
}

/** What the Mac signs to let a phone in: the pairing and the phone's two keys. */
export function pairMessage(pairingId: string, fingerprint: string): string {
  return `memnox-pair:v1:${pairingId}:${fingerprint}`;
}

/** What the Mac signs to give a device one more capability. */
export function grantMessage(deviceId: string, capability: string): string {
  return `memnox-grant:v1:${deviceId}:${capability}`;
}

/** What a phone signs to drive the Mac until a time. */
export function driveMessage(deviceId: string, until: string): string {
  return `memnox-drive:v1:${deviceId}:${until}`;
}

/**
 * What a person signs to type their own words into one session, the words included so a signature
 * for one message never carries another. The Mac's key or the asking phone's, after Touch ID or Face ID.
 */
export function followUpMessage(sessionId: string, words: string): string {
  return `memnox-follow-up:v1:${sessionId}:${words}`;
}

/** How a follow up reached its session, for the screen that sent it to say in its own words. */
export const FOLLOW_UP_OUTCOME = {
  /** Working: it reads the words at its next step. */
  QUEUED: 'queued',
  /** Waiting at its prompt: the Mac is typing the words in and sending them. */
  TYPED: 'typed',
  /** Waiting where nothing can type: it reads the words the next time it is prompted. */
  LATER: 'later',
} as const;

export type FollowUpOutcome = (typeof FOLLOW_UP_OUTCOME)[keyof typeof FOLLOW_UP_OUTCOME];

/** What a phone signs at pairing to prove it holds the key it sent. */
export function deviceProofMessage(handshakeHash: Buffer): string {
  return `memnox-device:v1:${handshakeHash.toString('base64')}`;
}
