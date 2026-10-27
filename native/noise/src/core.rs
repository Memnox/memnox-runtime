use std::fmt;

use snow::params::NoiseParams;
use snow::{Builder, HandshakeState, TransportState};

/// Every handshake binds this, so a session can never be replayed into another protocol.
pub const PROLOGUE: &[u8] = b"memnox-remote:v1";

/// The largest Noise message, fixed by the spec and enforced by snow.
pub const MAX_MESSAGE: usize = 65535;

pub const KEY_LEN: usize = 32;
pub const PSK_LEN: usize = 32;

const IK: &str = "Noise_IK_25519_ChaChaPoly_BLAKE2s";
const XXPSK0: &str = "Noise_XXpsk0_25519_ChaChaPoly_BLAKE2s";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Pattern {
    IK,
    XXpsk0,
}

impl Pattern {
    pub fn parse(name: &str) -> Result<Self, Error> {
        match name {
            "IK" => Ok(Pattern::IK),
            "XXpsk0" => Ok(Pattern::XXpsk0),
            _ => Err(Error::InvalidArgument("pattern must be IK or XXpsk0")),
        }
    }

    fn params(self) -> NoiseParams {
        let name = match self {
            Pattern::IK => IK,
            Pattern::XXpsk0 => XXPSK0,
        };
        // Both names are constants that snow's default resolver supports.
        name.parse().expect("a supported Noise protocol name")
    }
}

#[derive(Debug)]
pub enum Error {
    InvalidArgument(&'static str),
    /// The handshake was already turned into a transport, so it has nothing left to do.
    Consumed,
    Noise(snow::Error),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::InvalidArgument(why) => write!(f, "invalid argument: {why}"),
            Error::Consumed => write!(f, "the handshake was already turned into a transport"),
            Error::Noise(e) => write!(f, "noise: {e}"),
        }
    }
}

impl std::error::Error for Error {}

impl From<snow::Error> for Error {
    fn from(e: snow::Error) -> Self {
        Error::Noise(e)
    }
}

pub struct Keypair {
    pub public: Vec<u8>,
    pub private: Vec<u8>,
}

pub fn generate_keypair() -> Result<Keypair, Error> {
    let pair = Builder::new(Pattern::IK.params()).generate_keypair()?;
    Ok(Keypair { public: pair.public, private: pair.private })
}

fn key<'a>(bytes: &'a [u8], why: &'static str) -> Result<&'a [u8], Error> {
    if bytes.len() == KEY_LEN { Ok(bytes) } else { Err(Error::InvalidArgument(why)) }
}

fn psk(bytes: Option<&[u8]>) -> Result<[u8; PSK_LEN], Error> {
    let bytes = bytes.ok_or(Error::InvalidArgument("XXpsk0 needs the 32 byte psk"))?;
    bytes.try_into().map_err(|_| Error::InvalidArgument("psk must be 32 bytes"))
}

pub struct Handshake {
    // An option so that turning it into a transport can move the state out of a borrowed handle.
    state: Option<HandshakeState>,
}

impl Handshake {
    pub fn initiator(
        pattern: Pattern,
        local_private: &[u8],
        remote_public: Option<&[u8]>,
        psk_bytes: Option<&[u8]>,
    ) -> Result<Self, Error> {
        let local = key(local_private, "local private key must be 32 bytes")?;
        let builder = Builder::new(pattern.params()).prologue(PROLOGUE)?.local_private_key(local)?;
        let state = match pattern {
            Pattern::IK => {
                if psk_bytes.is_some() {
                    return Err(Error::InvalidArgument("IK takes no psk"));
                }
                let remote = remote_public
                    .ok_or(Error::InvalidArgument("IK initiator needs the remote public key"))?;
                let remote = key(remote, "remote public key must be 32 bytes")?;
                builder.remote_public_key(remote)?.build_initiator()?
            }
            Pattern::XXpsk0 => {
                if remote_public.is_some() {
                    return Err(Error::InvalidArgument("XXpsk0 learns the remote key in the handshake"));
                }
                let secret = psk(psk_bytes)?;
                builder.psk(0, &secret)?.build_initiator()?
            }
        };
        Ok(Handshake { state: Some(state) })
    }

    pub fn responder(pattern: Pattern, local_private: &[u8], psk_bytes: Option<&[u8]>) -> Result<Self, Error> {
        let local = key(local_private, "local private key must be 32 bytes")?;
        let builder = Builder::new(pattern.params()).prologue(PROLOGUE)?.local_private_key(local)?;
        let state = match pattern {
            Pattern::IK => {
                if psk_bytes.is_some() {
                    return Err(Error::InvalidArgument("IK takes no psk"));
                }
                builder.build_responder()?
            }
            Pattern::XXpsk0 => {
                let secret = psk(psk_bytes)?;
                builder.psk(0, &secret)?.build_responder()?
            }
        };
        Ok(Handshake { state: Some(state) })
    }

    fn state(&self) -> Result<&HandshakeState, Error> {
        self.state.as_ref().ok_or(Error::Consumed)
    }

    fn state_mut(&mut self) -> Result<&mut HandshakeState, Error> {
        self.state.as_mut().ok_or(Error::Consumed)
    }

    pub fn write_message(&mut self, payload: &[u8]) -> Result<Vec<u8>, Error> {
        let mut out = vec![0u8; MAX_MESSAGE];
        let n = self.state_mut()?.write_message(payload, &mut out)?;
        out.truncate(n);
        Ok(out)
    }

    pub fn read_message(&mut self, message: &[u8]) -> Result<Vec<u8>, Error> {
        let mut out = vec![0u8; MAX_MESSAGE];
        let n = self.state_mut()?.read_message(message, &mut out)?;
        out.truncate(n);
        Ok(out)
    }

    pub fn is_finished(&self) -> Result<bool, Error> {
        Ok(self.state()?.is_handshake_finished())
    }

    pub fn handshake_hash(&self) -> Result<Vec<u8>, Error> {
        Ok(self.state()?.get_handshake_hash().to_vec())
    }

    pub fn remote_static(&self) -> Result<Option<Vec<u8>>, Error> {
        Ok(self.state()?.get_remote_static().map(<[u8]>::to_vec))
    }

    // Takes a borrow because the bindings hold the handshake behind a handle they cannot give up.
    #[allow(clippy::wrong_self_convention)]
    pub fn into_transport(&mut self) -> Result<Transport, Error> {
        let state = self.state.take().ok_or(Error::Consumed)?;
        if !state.is_handshake_finished() {
            // Put it back so an early call does not destroy a handshake still in flight.
            self.state = Some(state);
            return Err(Error::InvalidArgument("the handshake has not finished"));
        }
        Ok(Transport { state: state.into_transport_mode()? })
    }
}

pub struct Transport {
    state: TransportState,
}

impl Transport {
    pub fn encrypt(&mut self, plaintext: &[u8]) -> Result<Vec<u8>, Error> {
        let mut out = vec![0u8; MAX_MESSAGE];
        let n = self.state.write_message(plaintext, &mut out)?;
        out.truncate(n);
        Ok(out)
    }

    pub fn decrypt(&mut self, ciphertext: &[u8]) -> Result<Vec<u8>, Error> {
        let mut out = vec![0u8; MAX_MESSAGE];
        let n = self.state.read_message(ciphertext, &mut out)?;
        out.truncate(n);
        Ok(out)
    }

    pub fn rekey_outgoing(&mut self) {
        self.state.rekey_outgoing();
    }

    pub fn rekey_incoming(&mut self) {
        self.state.rekey_incoming();
    }
}

/// The 6 digits both screens show, so a person can see the two ends finished one handshake.
pub fn pairing_code(handshake_hash: &[u8]) -> Result<String, Error> {
    let head: [u8; 4] = handshake_hash
        .get(..4)
        .and_then(|b| b.try_into().ok())
        .ok_or(Error::InvalidArgument("handshake hash must be at least 4 bytes"))?;
    Ok(format!("{:06}", u32::from_be_bytes(head) % 1_000_000))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pair() -> Keypair {
        generate_keypair().unwrap()
    }

    fn run(initiator: &mut Handshake, responder: &mut Handshake) {
        let mut sender_is_initiator = true;
        while !(initiator.is_finished().unwrap() && responder.is_finished().unwrap()) {
            let (from, to) = if sender_is_initiator {
                (&mut *initiator, &mut *responder)
            } else {
                (&mut *responder, &mut *initiator)
            };
            let message = from.write_message(b"").unwrap();
            to.read_message(&message).unwrap();
            sender_is_initiator = !sender_is_initiator;
        }
    }

    fn ik_pair() -> (Transport, Transport) {
        let (phone, runtime) = (pair(), pair());
        let mut i = Handshake::initiator(Pattern::IK, &phone.private, Some(&runtime.public), None).unwrap();
        let mut r = Handshake::responder(Pattern::IK, &runtime.private, None).unwrap();
        run(&mut i, &mut r);
        (i.into_transport().unwrap(), r.into_transport().unwrap())
    }

    #[test]
    fn ik_round_trip_reveals_the_phone_key_and_agrees_on_the_hash() {
        let (phone, runtime) = (pair(), pair());
        let mut i = Handshake::initiator(Pattern::IK, &phone.private, Some(&runtime.public), None).unwrap();
        let mut r = Handshake::responder(Pattern::IK, &runtime.private, None).unwrap();
        let m1 = i.write_message(b"hello").unwrap();
        assert_eq!(r.read_message(&m1).unwrap(), b"hello");
        let m2 = r.write_message(b"welcome").unwrap();
        assert_eq!(i.read_message(&m2).unwrap(), b"welcome");
        assert!(i.is_finished().unwrap() && r.is_finished().unwrap());
        assert_eq!(i.handshake_hash().unwrap(), r.handshake_hash().unwrap());
        assert_eq!(r.remote_static().unwrap().unwrap(), phone.public);
        assert_eq!(i.remote_static().unwrap().unwrap(), runtime.public);
        let (mut it, mut rt) = (i.into_transport().unwrap(), r.into_transport().unwrap());
        assert_eq!(rt.decrypt(&it.encrypt(b"ping").unwrap()).unwrap(), b"ping");
        assert_eq!(it.decrypt(&rt.encrypt(b"pong").unwrap()).unwrap(), b"pong");
    }

    #[test]
    fn xxpsk0_round_trip_exchanges_both_static_keys() {
        let (phone, runtime) = (pair(), pair());
        let secret = [7u8; 32];
        let mut i = Handshake::initiator(Pattern::XXpsk0, &phone.private, None, Some(&secret)).unwrap();
        let mut r = Handshake::responder(Pattern::XXpsk0, &runtime.private, Some(&secret)).unwrap();
        let m1 = i.write_message(b"").unwrap();
        r.read_message(&m1).unwrap();
        let m2 = r.write_message(br#"{"machine":"mac"}"#).unwrap();
        assert_eq!(i.read_message(&m2).unwrap(), br#"{"machine":"mac"}"#);
        assert_eq!(i.remote_static().unwrap().unwrap(), runtime.public);
        let m3 = i.write_message(br#"{"name":"phone"}"#).unwrap();
        assert_eq!(r.read_message(&m3).unwrap(), br#"{"name":"phone"}"#);
        assert!(i.is_finished().unwrap() && r.is_finished().unwrap());
        assert_eq!(r.remote_static().unwrap().unwrap(), phone.public);
        assert_eq!(i.handshake_hash().unwrap(), r.handshake_hash().unwrap());
        let (mut it, mut rt) = (i.into_transport().unwrap(), r.into_transport().unwrap());
        assert_eq!(rt.decrypt(&it.encrypt(b"proof").unwrap()).unwrap(), b"proof");
    }

    #[test]
    fn xxpsk0_with_a_wrong_psk_fails_on_the_first_message() {
        let (phone, runtime) = (pair(), pair());
        let mut i = Handshake::initiator(Pattern::XXpsk0, &phone.private, None, Some(&[1u8; 32])).unwrap();
        let mut r = Handshake::responder(Pattern::XXpsk0, &runtime.private, Some(&[2u8; 32])).unwrap();
        let m1 = i.write_message(b"").unwrap();
        assert!(matches!(r.read_message(&m1), Err(Error::Noise(_))));
    }

    #[test]
    fn ik_against_the_wrong_runtime_key_fails() {
        let (phone, runtime, impostor) = (pair(), pair(), pair());
        let mut i = Handshake::initiator(Pattern::IK, &phone.private, Some(&impostor.public), None).unwrap();
        let mut r = Handshake::responder(Pattern::IK, &runtime.private, None).unwrap();
        let m1 = i.write_message(b"").unwrap();
        assert!(matches!(r.read_message(&m1), Err(Error::Noise(_))));
    }

    #[test]
    fn transport_rejects_a_tampered_or_replayed_message() {
        let (mut a, mut b) = ik_pair();
        let mut sealed = a.encrypt(b"line").unwrap();
        let replay = sealed.clone();
        assert_eq!(b.decrypt(&sealed).unwrap(), b"line");
        assert!(b.decrypt(&replay).is_err());
        sealed = a.encrypt(b"next").unwrap();
        sealed[0] ^= 1;
        assert!(b.decrypt(&sealed).is_err());
    }

    #[test]
    fn rekey_in_step_keeps_working_and_out_of_step_fails() {
        let (mut a, mut b) = ik_pair();
        a.rekey_outgoing();
        b.rekey_incoming();
        assert_eq!(b.decrypt(&a.encrypt(b"after").unwrap()).unwrap(), b"after");
        b.rekey_outgoing();
        let sealed = b.encrypt(b"skipped").unwrap();
        assert!(a.decrypt(&sealed).is_err());
    }

    #[test]
    fn both_sides_show_the_same_pairing_code() {
        let (phone, runtime) = (pair(), pair());
        let secret = [9u8; 32];
        let mut i = Handshake::initiator(Pattern::XXpsk0, &phone.private, None, Some(&secret)).unwrap();
        let mut r = Handshake::responder(Pattern::XXpsk0, &runtime.private, Some(&secret)).unwrap();
        run(&mut i, &mut r);
        let code = pairing_code(&i.handshake_hash().unwrap()).unwrap();
        assert_eq!(code, pairing_code(&r.handshake_hash().unwrap()).unwrap());
        assert_eq!(code.len(), 6);
    }

    #[test]
    fn pairing_code_is_the_first_four_bytes_mod_a_million() {
        assert_eq!(pairing_code(&[0, 0, 0, 7, 0xff]).unwrap(), "000007");
        assert_eq!(pairing_code(&[0xff, 0xff, 0xff, 0xff]).unwrap(), "967295");
        assert!(pairing_code(&[1, 2, 3]).is_err());
    }

    #[test]
    fn arguments_are_checked_before_snow_sees_them() {
        let k = pair();
        assert!(Handshake::initiator(Pattern::IK, &k.private, None, None).is_err());
        assert!(Handshake::initiator(Pattern::XXpsk0, &k.private, None, None).is_err());
        assert!(Handshake::initiator(Pattern::XXpsk0, &k.private, None, Some(&[0u8; 31])).is_err());
        assert!(Handshake::responder(Pattern::IK, &k.private[..31], None).is_err());
        assert!(Pattern::parse("NN").is_err());
    }

    #[test]
    fn an_unfinished_handshake_stays_usable_after_an_early_into_transport() {
        let (phone, runtime) = (pair(), pair());
        let mut i = Handshake::initiator(Pattern::IK, &phone.private, Some(&runtime.public), None).unwrap();
        assert!(i.into_transport().is_err());
        assert!(i.write_message(b"").is_ok());
    }
}
