package com.memnox.noise;

// The same native declarations the Android app's Kotlin class makes, so the JNI names are checked here first.
public final class MemnoxNoise {
    static { System.loadLibrary("memnox_noise"); }

    private MemnoxNoise() {}

    public static native byte[] generateKeypair();
    public static native String pairingCode(byte[] handshakeHash);
    public static native long handshakeInitiator(String pattern, byte[] localPrivate, byte[] remotePublic, byte[] psk);
    public static native long handshakeResponder(String pattern, byte[] localPrivate, byte[] psk);
    public static native byte[] handshakeWriteMessage(long handshake, byte[] payload);
    public static native byte[] handshakeReadMessage(long handshake, byte[] message);
    public static native boolean handshakeIsFinished(long handshake);
    public static native byte[] handshakeHash(long handshake);
    public static native byte[] handshakeRemoteStatic(long handshake);
    public static native long handshakeIntoTransport(long handshake);
    public static native void handshakeFree(long handshake);
    public static native byte[] transportEncrypt(long transport, byte[] plaintext);
    public static native byte[] transportDecrypt(long transport, byte[] ciphertext);
    public static native void transportRekeyOutgoing(long transport);
    public static native void transportRekeyIncoming(long transport);
    public static native void transportFree(long transport);
}
