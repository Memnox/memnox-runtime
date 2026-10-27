use napi::bindgen_prelude::Buffer;
use napi::{Error, Result};
use napi_derive::napi;

use crate::core;

fn js(e: core::Error) -> Error {
    Error::from_reason(e.to_string())
}

#[napi(object)]
pub struct Keypair {
    pub public_key: Buffer,
    pub private_key: Buffer,
}

#[napi]
pub fn generate_keypair() -> Result<Keypair> {
    let pair = core::generate_keypair().map_err(js)?;
    Ok(Keypair { public_key: pair.public.into(), private_key: pair.private.into() })
}

#[napi]
pub fn pairing_code(handshake_hash: Buffer) -> Result<String> {
    core::pairing_code(&handshake_hash).map_err(js)
}

#[napi]
pub struct Handshake {
    inner: core::Handshake,
}

#[napi]
impl Handshake {
    #[napi(factory)]
    pub fn initiator(
        pattern: String,
        local_private: Buffer,
        remote_public: Option<Buffer>,
        psk: Option<Buffer>,
    ) -> Result<Self> {
        let pattern = core::Pattern::parse(&pattern).map_err(js)?;
        let inner = core::Handshake::initiator(pattern, &local_private, remote_public.as_deref(), psk.as_deref())
            .map_err(js)?;
        Ok(Handshake { inner })
    }

    #[napi(factory)]
    pub fn responder(pattern: String, local_private: Buffer, psk: Option<Buffer>) -> Result<Self> {
        let pattern = core::Pattern::parse(&pattern).map_err(js)?;
        let inner = core::Handshake::responder(pattern, &local_private, psk.as_deref()).map_err(js)?;
        Ok(Handshake { inner })
    }

    #[napi]
    pub fn write_message(&mut self, payload: Buffer) -> Result<Buffer> {
        self.inner.write_message(&payload).map(Buffer::from).map_err(js)
    }

    #[napi]
    pub fn read_message(&mut self, message: Buffer) -> Result<Buffer> {
        self.inner.read_message(&message).map(Buffer::from).map_err(js)
    }

    #[napi]
    pub fn is_finished(&self) -> Result<bool> {
        self.inner.is_finished().map_err(js)
    }

    #[napi]
    pub fn handshake_hash(&self) -> Result<Buffer> {
        self.inner.handshake_hash().map(Buffer::from).map_err(js)
    }

    #[napi]
    pub fn remote_static(&self) -> Result<Option<Buffer>> {
        self.inner.remote_static().map(|k| k.map(Buffer::from)).map_err(js)
    }

    // A JS object cannot be consumed, so the handshake hands its state over and answers Consumed after.
    #[allow(clippy::wrong_self_convention)]
    #[napi]
    pub fn into_transport(&mut self) -> Result<Transport> {
        self.inner.into_transport().map(|inner| Transport { inner }).map_err(js)
    }
}

#[napi]
pub struct Transport {
    inner: core::Transport,
}

#[napi]
impl Transport {
    #[napi]
    pub fn encrypt(&mut self, plaintext: Buffer) -> Result<Buffer> {
        self.inner.encrypt(&plaintext).map(Buffer::from).map_err(js)
    }

    #[napi]
    pub fn decrypt(&mut self, ciphertext: Buffer) -> Result<Buffer> {
        self.inner.decrypt(&ciphertext).map(Buffer::from).map_err(js)
    }

    #[napi]
    pub fn rekey_outgoing(&mut self) {
        self.inner.rekey_outgoing();
    }

    #[napi]
    pub fn rekey_incoming(&mut self) {
        self.inner.rekey_incoming();
    }
}
