import static com.memnox.noise.MemnoxNoise.*;

import java.nio.charset.StandardCharsets;
import java.util.Arrays;

// Runs the pairing handshake and a few messages through the JNI binding, as the Android app will.
public final class JniRoundTrip {
    private static void check(boolean ok, String what) {
        if (!ok) throw new AssertionError(what);
        System.out.println("ok " + what);
    }

    private static boolean throwsA(Class<? extends Throwable> type, Runnable call) {
        try {
            call.run();
            return false;
        } catch (Throwable thrown) {
            return type.isInstance(thrown);
        }
    }

    public static void main(String[] args) {
        byte[] phone = generateKeypair();
        byte[] mac = generateKeypair();
        check(phone.length == 64 && mac.length == 64, "a keypair is 32 public bytes then 32 private");
        byte[] psk = new byte[32];
        Arrays.fill(psk, (byte) 7);
        long initiator = handshakeInitiator("XXpsk0", Arrays.copyOfRange(phone, 32, 64), null, psk);
        long responder = handshakeResponder("XXpsk0", Arrays.copyOfRange(mac, 32, 64), psk);

        handshakeReadMessage(responder, handshakeWriteMessage(initiator, new byte[0]));
        handshakeReadMessage(initiator, handshakeWriteMessage(responder, new byte[0]));
        handshakeReadMessage(responder, handshakeWriteMessage(initiator, new byte[0]));
        check(handshakeIsFinished(initiator) && handshakeIsFinished(responder), "both ends finish XXpsk0 in three messages");
        check(Arrays.equals(handshakeHash(initiator), handshakeHash(responder)), "both ends hold one handshake hash");
        check(pairingCode(handshakeHash(initiator)).equals(pairingCode(handshakeHash(responder))), "both screens show the same six digits");
        check(Arrays.equals(handshakeRemoteStatic(initiator), Arrays.copyOfRange(mac, 0, 32)), "the phone learned the Mac's key");

        long sending = handshakeIntoTransport(initiator);
        long receiving = handshakeIntoTransport(responder);
        byte[] words = "allow it".getBytes(StandardCharsets.UTF_8);
        check(Arrays.equals(transportDecrypt(receiving, transportEncrypt(sending, words)), words), "a message crosses and decrypts");
        transportRekeyOutgoing(sending);
        transportRekeyIncoming(receiving);
        check(Arrays.equals(transportDecrypt(receiving, transportEncrypt(sending, words)), words), "a message still decrypts after a rekey");

        check(throwsA(IllegalStateException.class, () -> handshakeIntoTransport(initiator)), "a handshake turned into a transport answers consumed");
        check(throwsA(IllegalStateException.class, () -> transportDecrypt(receiving, new byte[40])), "a forged message is refused");
        check(throwsA(IllegalArgumentException.class, () -> handshakeResponder("NN", new byte[32], null)), "an unknown pattern is refused");
        check(throwsA(IllegalArgumentException.class, () -> transportEncrypt(0, words)), "a zero handle is refused rather than read");

        handshakeFree(initiator);
        handshakeFree(responder);
        transportFree(sending);
        transportFree(receiving);
        System.out.println("jni round trip passed");
    }
}
