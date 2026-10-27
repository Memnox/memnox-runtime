import { DEVICE_KIND } from '../gate/devices';
import { REMOTE_CAPABILITY } from '../gate/capabilities';
import { HOLD_ANSWER } from '../gate/hold';
import { PROPOSAL_ANSWER } from '../gate/proposals';
import { confirmationMessage } from '../gate/confirm-key';
import { ASK_ENDS, DAEMON_EVENT, DAEMON_METHOD, encode } from './protocol';
import {
  deviceProofMessage,
  driveMessage,
  FOLLOW_UP_OUTCOME,
  followUpMessage,
  grantMessage,
  pairMessage,
} from './remote';

/** One signed message: what went in, and the exact text a key must sign for it. */
export interface MessageVector {
  name: string;
  inputs: Record<string, string | null>;
  message: string;
}

/** One frame on the socket, written as the daemon writes it. */
export interface FrameVector {
  name: string;
  frame: string;
}

/** Every value a mirror of the protocol must know, so a client that misses one fails its own test. */
export interface ProtocolVectors {
  version: 1;
  messages: MessageVector[];
  signature: {
    point: string;
    message: string;
    der: string;
    p1363: string;
  };
  values: Record<string, string[]>;
  frames: FrameVector[];
}

// Bytes 0 to 31, so the base64 of a handshake hash is checked without a real handshake.
const HANDSHAKE_HASH = Buffer.from(Array.from({ length: 32 }, (_, index) => index));

// Signed once with a throwaway key: ECDSA is randomised, so a signature made each run would never match a file.
const SIGNATURE = {
  point:
    'BMI5mMngh3KqxEfAfXuQwf30QgFuWXZi1VIy1QiEMSMlLJNB9jw8f6Db1OqegwLdAUJnz4dT8SN9VZfuNkSqJ6M=',
  message: confirmationMessage('apr_vectors', HOLD_ANSWER.ONCE),
  der: 'MEUCIQDeeejRtCXDvBnoWXha6Z4cfVBkzLV3bENhM9jKSmLBmAIgGT08sZyAejqhwnW2F8thxDwX4z+gCYUPjxAAhNDysNA=',
  p1363:
    '3nno0bQlw7wZ6Fl4WumeHH1QZMy1d2xDYTPYykpiwZgZPTyxnIB6OqHCdbYXy2HEPBfjP6AJhQ+PEACE0PKw0A==',
};

function message(
  name: string,
  inputs: Record<string, string | null>,
  text: string,
): MessageVector {
  return { name, inputs, message: text };
}

/** Every confirmation a key signs, a rewritten draft and an empty rewrite included. */
function confirmVectors(): MessageVector[] {
  const draft = 'Shipped: the deploy is out.\nThanks, Bo 🎉';
  return [
    message(
      'confirm',
      { subject: 'apr_1', answer: HOLD_ANSWER.ONCE, edited: null },
      confirmationMessage('apr_1', HOLD_ANSWER.ONCE),
    ),
    message(
      'confirm-proposal',
      { subject: 'prp_1', answer: PROPOSAL_ANSWER.CONFIRMED, edited: null },
      confirmationMessage('prp_1', PROPOSAL_ANSWER.CONFIRMED),
    ),
    message(
      'confirm-rewritten',
      { subject: 'prp_2', answer: PROPOSAL_ANSWER.CONFIRMED, edited: draft },
      confirmationMessage('prp_2', PROPOSAL_ANSWER.CONFIRMED, draft),
    ),
    // Empty words are still a rewrite, so this is v2 and never the v1 an absent edit gives.
    message(
      'confirm-rewritten-empty',
      { subject: 'prp_3', answer: PROPOSAL_ANSWER.CONFIRMED, edited: '' },
      confirmationMessage('prp_3', PROPOSAL_ANSWER.CONFIRMED, ''),
    ),
    readdressedVector(draft),
  ];
}

/** A mail sent to addresses the person typed on its card signs those addresses and the words together. */
function readdressedVector(draft: string): MessageVector {
  const to = 'moise@memnox.com,bo@acme.test';
  return message(
    'confirm-readdressed',
    { subject: 'prp_4', answer: PROPOSAL_ANSWER.CONFIRMED, edited: draft, editedTo: to },
    confirmationMessage('prp_4', PROPOSAL_ANSWER.CONFIRMED, draft, to),
  );
}

/** Every message a paired device or the Mac signs about devices, drives and sessions. */
function deviceVectors(): MessageVector[] {
  const words = 'run the tests: then push';
  const until = '2026-10-17T10:15:00.000Z';
  return [
    message(
      'pair',
      { pairingId: 'pr_1', fingerprint: 'fp_1' },
      pairMessage('pr_1', 'fp_1'),
    ),
    message(
      'grant',
      { deviceId: 'dev_1', capability: REMOTE_CAPABILITY.MAC },
      grantMessage('dev_1', REMOTE_CAPABILITY.MAC),
    ),
    message('drive', { deviceId: 'dev_1', until }, driveMessage('dev_1', until)),
    message('follow-up', { sessionId: 'ses_1', words }, followUpMessage('ses_1', words)),
    message(
      'device-proof',
      { handshakeHash: HANDSHAKE_HASH.toString('base64') },
      deviceProofMessage(HANDSHAKE_HASH),
    ),
  ];
}

function valueVectors(): Record<string, string[]> {
  return {
    methods: Object.values(DAEMON_METHOD),
    events: Object.values(DAEMON_EVENT),
    askEnds: [...ASK_ENDS],
    holdAnswers: Object.values(HOLD_ANSWER),
    proposalAnswers: Object.values(PROPOSAL_ANSWER),
    followUpOutcomes: Object.values(FOLLOW_UP_OUTCOME),
    capabilities: Object.values(REMOTE_CAPABILITY),
    deviceKinds: Object.values(DEVICE_KIND),
  };
}

/** The fixtures every client is tested against, written to `vectors/protocol.json` by `pnpm vectors`. */
export function protocolVectors(): ProtocolVectors {
  return {
    version: 1,
    messages: [...confirmVectors(), ...deviceVectors()],
    signature: SIGNATURE,
    values: valueVectors(),
    frames: [
      { name: 'request', frame: encode({ id: 1, method: DAEMON_METHOD.PING }) },
      { name: 'response', frame: encode({ id: 1, ok: true, version: '0.0.0' }) },
    ],
  };
}

/** The vectors as the committed file holds them, so writing and checking agree byte for byte. */
export function protocolVectorsJson(): string {
  return `${JSON.stringify(protocolVectors(), null, 2)}\n`;
}
