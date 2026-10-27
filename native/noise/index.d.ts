export function generateKeypair(): { publicKey: Buffer; privateKey: Buffer };
export class Handshake {
  static initiator(pattern: 'IK' | 'XXpsk0', localPrivate: Buffer, remotePublic?: Buffer, psk?: Buffer): Handshake;
  static responder(pattern: 'IK' | 'XXpsk0', localPrivate: Buffer, psk?: Buffer): Handshake;
  writeMessage(payload: Buffer): Buffer;
  readMessage(message: Buffer): Buffer;
  isFinished(): boolean;
  handshakeHash(): Buffer;
  remoteStatic(): Buffer | null;
  intoTransport(): Transport;
}
export class Transport {
  encrypt(plaintext: Buffer): Buffer;
  decrypt(ciphertext: Buffer): Buffer;
  rekeyOutgoing(): void;
  rekeyIncoming(): void;
}
export function pairingCode(handshakeHash: Buffer): string;
