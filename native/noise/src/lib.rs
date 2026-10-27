//! The one Noise layer the Memnox runtime, the iPhone and Android share. Every cipher, hash, DH and nonce comes from snow.

pub mod core;

#[cfg(feature = "node")]
mod node;

#[cfg(feature = "ffi")]
pub mod ffi;

#[cfg(feature = "jni")]
mod jni;
