//! The JNI binding Android links, the same operations as the Node binding over opaque handles.

// Every entry point is named for the Kotlin class `com.memnox.noise.MemnoxNoise` that declares it.
#![allow(non_snake_case)]

use std::panic::{catch_unwind, AssertUnwindSafe};

use jni::objects::{JByteArray, JClass, JString};
use jni::sys::{jboolean, jbyteArray, jlong, jstring, JNI_FALSE, JNI_TRUE};
use jni::JNIEnv;

use crate::core::{self, Handshake, Pattern, Transport};

const ILLEGAL_STATE: &str = "java/lang/IllegalStateException";
const ILLEGAL_ARGUMENT: &str = "java/lang/IllegalArgumentException";

/// Why a call failed, with the exception class Kotlin sees it as.
struct Failure {
    class: &'static str,
    message: String,
}

impl From<core::Error> for Failure {
    fn from(e: core::Error) -> Self {
        let class = match e {
            core::Error::InvalidArgument(_) => ILLEGAL_ARGUMENT,
            core::Error::Consumed | core::Error::Noise(_) => ILLEGAL_STATE,
        };
        Failure { class, message: e.to_string() }
    }
}

impl From<jni::errors::Error> for Failure {
    fn from(e: jni::errors::Error) -> Self {
        Failure { class: ILLEGAL_STATE, message: e.to_string() }
    }
}

fn argument(message: &str) -> Failure {
    Failure { class: ILLEGAL_ARGUMENT, message: message.to_string() }
}

// A panic must never unwind into the JVM, and a failure becomes the exception Kotlin catches.
fn guard<T>(env: &mut JNIEnv, empty: T, f: impl FnOnce(&mut JNIEnv) -> Result<T, Failure>) -> T {
    let outcome = catch_unwind(AssertUnwindSafe(|| f(env)));
    let failure = match outcome {
        Ok(Ok(value)) => return value,
        Ok(Err(failure)) => failure,
        Err(_) => Failure { class: ILLEGAL_STATE, message: "memnox-noise panicked".to_string() },
    };
    // A throw that fails leaves an exception pending already, which the JVM raises either way.
    let _ = env.throw_new(failure.class, failure.message);
    empty
}

fn bytes(env: &JNIEnv, array: &JByteArray) -> Result<Vec<u8>, Failure> {
    if array.is_null() {
        return Err(argument("a byte array was null"));
    }
    Ok(env.convert_byte_array(array)?)
}

fn optional_bytes(env: &JNIEnv, array: &JByteArray) -> Result<Option<Vec<u8>>, Failure> {
    if array.is_null() { Ok(None) } else { bytes(env, array).map(Some) }
}

fn array(env: &JNIEnv, value: &[u8]) -> Result<jbyteArray, Failure> {
    Ok(env.byte_array_from_slice(value)?.into_raw())
}

fn pattern(env: &mut JNIEnv, name: &JString) -> Result<Pattern, Failure> {
    if name.is_null() {
        return Err(argument("the pattern was null"));
    }
    let name: String = env.get_string(name)?.into();
    Ok(Pattern::parse(&name)?)
}

// A handle is a pointer Rust boxed, so Kotlin holds it as a long and hands it back to free it.
fn handshake<'a>(handle: jlong) -> Result<&'a mut Handshake, Failure> {
    let pointer = handle as *mut Handshake;
    // SAFETY: a non zero handle was made by Box::into_raw below and is freed only by handshakeFree.
    unsafe { pointer.as_mut() }.ok_or_else(|| argument("the handshake handle was 0"))
}

fn transport<'a>(handle: jlong) -> Result<&'a mut Transport, Failure> {
    let pointer = handle as *mut Transport;
    // SAFETY: a non zero handle was made by Box::into_raw below and is freed only by transportFree.
    unsafe { pointer.as_mut() }.ok_or_else(|| argument("the transport handle was 0"))
}

fn boxed<T>(value: T) -> jlong {
    Box::into_raw(Box::new(value)) as jlong
}

/// The public key then the private key, 32 bytes each.
#[no_mangle]
pub extern "system" fn Java_com_memnox_noise_MemnoxNoise_generateKeypair(
    mut env: JNIEnv,
    _class: JClass,
) -> jbyteArray {
    guard(&mut env, std::ptr::null_mut(), |env| {
        let pair = core::generate_keypair()?;
        array(env, &[pair.public, pair.private].concat())
    })
}

#[no_mangle]
pub extern "system" fn Java_com_memnox_noise_MemnoxNoise_pairingCode(
    mut env: JNIEnv,
    _class: JClass,
    handshake_hash: JByteArray,
) -> jstring {
    guard(&mut env, std::ptr::null_mut(), |env| {
        let code = core::pairing_code(&bytes(env, &handshake_hash)?)?;
        Ok(env.new_string(code)?.into_raw())
    })
}

#[no_mangle]
pub extern "system" fn Java_com_memnox_noise_MemnoxNoise_handshakeInitiator(
    mut env: JNIEnv,
    _class: JClass,
    name: JString,
    local_private: JByteArray,
    remote_public: JByteArray,
    psk: JByteArray,
) -> jlong {
    guard(&mut env, 0, |env| {
        let pattern = pattern(env, &name)?;
        let local = bytes(env, &local_private)?;
        let remote = optional_bytes(env, &remote_public)?;
        let psk = optional_bytes(env, &psk)?;
        Ok(boxed(Handshake::initiator(pattern, &local, remote.as_deref(), psk.as_deref())?))
    })
}

#[no_mangle]
pub extern "system" fn Java_com_memnox_noise_MemnoxNoise_handshakeResponder(
    mut env: JNIEnv,
    _class: JClass,
    name: JString,
    local_private: JByteArray,
    psk: JByteArray,
) -> jlong {
    guard(&mut env, 0, |env| {
        let pattern = pattern(env, &name)?;
        let local = bytes(env, &local_private)?;
        let psk = optional_bytes(env, &psk)?;
        Ok(boxed(Handshake::responder(pattern, &local, psk.as_deref())?))
    })
}

#[no_mangle]
pub extern "system" fn Java_com_memnox_noise_MemnoxNoise_handshakeWriteMessage(
    mut env: JNIEnv,
    _class: JClass,
    handle: jlong,
    payload: JByteArray,
) -> jbyteArray {
    guard(&mut env, std::ptr::null_mut(), |env| {
        let payload = bytes(env, &payload)?;
        let message = handshake(handle)?.write_message(&payload)?;
        array(env, &message)
    })
}

#[no_mangle]
pub extern "system" fn Java_com_memnox_noise_MemnoxNoise_handshakeReadMessage(
    mut env: JNIEnv,
    _class: JClass,
    handle: jlong,
    message: JByteArray,
) -> jbyteArray {
    guard(&mut env, std::ptr::null_mut(), |env| {
        let message = bytes(env, &message)?;
        let payload = handshake(handle)?.read_message(&message)?;
        array(env, &payload)
    })
}

#[no_mangle]
pub extern "system" fn Java_com_memnox_noise_MemnoxNoise_handshakeIsFinished(
    mut env: JNIEnv,
    _class: JClass,
    handle: jlong,
) -> jboolean {
    guard(&mut env, JNI_FALSE, |_| {
        Ok(if handshake(handle)?.is_finished()? { JNI_TRUE } else { JNI_FALSE })
    })
}

#[no_mangle]
pub extern "system" fn Java_com_memnox_noise_MemnoxNoise_handshakeHash(
    mut env: JNIEnv,
    _class: JClass,
    handle: jlong,
) -> jbyteArray {
    guard(&mut env, std::ptr::null_mut(), |env| {
        let hash = handshake(handle)?.handshake_hash()?;
        array(env, &hash)
    })
}

/// Null until the handshake has learned the other end's key.
#[no_mangle]
pub extern "system" fn Java_com_memnox_noise_MemnoxNoise_handshakeRemoteStatic(
    mut env: JNIEnv,
    _class: JClass,
    handle: jlong,
) -> jbyteArray {
    guard(&mut env, std::ptr::null_mut(), |env| match handshake(handle)?.remote_static()? {
        Some(key) => array(env, &key),
        None => Ok(std::ptr::null_mut()),
    })
}

/// The handshake hands its state over and answers Consumed after, so it is still freed on its own.
#[no_mangle]
pub extern "system" fn Java_com_memnox_noise_MemnoxNoise_handshakeIntoTransport(
    mut env: JNIEnv,
    _class: JClass,
    handle: jlong,
) -> jlong {
    guard(&mut env, 0, |_| Ok(boxed(handshake(handle)?.into_transport()?)))
}

#[no_mangle]
pub extern "system" fn Java_com_memnox_noise_MemnoxNoise_handshakeFree(
    _env: JNIEnv,
    _class: JClass,
    handle: jlong,
) {
    if handle != 0 {
        // SAFETY: the handle came from Box::into_raw and Kotlin frees each one once.
        drop(unsafe { Box::from_raw(handle as *mut Handshake) });
    }
}

#[no_mangle]
pub extern "system" fn Java_com_memnox_noise_MemnoxNoise_transportEncrypt(
    mut env: JNIEnv,
    _class: JClass,
    handle: jlong,
    plaintext: JByteArray,
) -> jbyteArray {
    guard(&mut env, std::ptr::null_mut(), |env| {
        let plaintext = bytes(env, &plaintext)?;
        let ciphertext = transport(handle)?.encrypt(&plaintext)?;
        array(env, &ciphertext)
    })
}

#[no_mangle]
pub extern "system" fn Java_com_memnox_noise_MemnoxNoise_transportDecrypt(
    mut env: JNIEnv,
    _class: JClass,
    handle: jlong,
    ciphertext: JByteArray,
) -> jbyteArray {
    guard(&mut env, std::ptr::null_mut(), |env| {
        let ciphertext = bytes(env, &ciphertext)?;
        let plaintext = transport(handle)?.decrypt(&ciphertext)?;
        array(env, &plaintext)
    })
}

#[no_mangle]
pub extern "system" fn Java_com_memnox_noise_MemnoxNoise_transportRekeyOutgoing(
    mut env: JNIEnv,
    _class: JClass,
    handle: jlong,
) {
    guard(&mut env, (), |_| {
        transport(handle)?.rekey_outgoing();
        Ok(())
    })
}

#[no_mangle]
pub extern "system" fn Java_com_memnox_noise_MemnoxNoise_transportRekeyIncoming(
    mut env: JNIEnv,
    _class: JClass,
    handle: jlong,
) {
    guard(&mut env, (), |_| {
        transport(handle)?.rekey_incoming();
        Ok(())
    })
}

#[no_mangle]
pub extern "system" fn Java_com_memnox_noise_MemnoxNoise_transportFree(
    _env: JNIEnv,
    _class: JClass,
    handle: jlong,
) {
    if handle != 0 {
        // SAFETY: the handle came from Box::into_raw and Kotlin frees each one once.
        drop(unsafe { Box::from_raw(handle as *mut Transport) });
    }
}
