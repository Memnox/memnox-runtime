//! The C ABI the iPhone links, the same operations as the Node binding over opaque handles.

// The pointer and length contract of every function is written once, in include/memnox_noise.h.
#![allow(clippy::missing_safety_doc)]

use std::os::raw::c_char;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::ptr;

use crate::core::{self, Handshake, Pattern, Transport};

pub const MEMNOX_NOISE_OK: i32 = 0;
pub const MEMNOX_NOISE_INVALID_ARGUMENT: i32 = 1;
pub const MEMNOX_NOISE_FAILED: i32 = 2;
pub const MEMNOX_NOISE_CONSUMED: i32 = 3;
pub const MEMNOX_NOISE_NULL_POINTER: i32 = 4;
pub const MEMNOX_NOISE_PANIC: i32 = 5;

pub const MEMNOX_NOISE_PATTERN_IK: u32 = 0;
pub const MEMNOX_NOISE_PATTERN_XXPSK0: u32 = 1;

/// Bytes Rust allocated, so they must go back through `memnox_noise_buffer_free` and never `free`.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct MemnoxNoiseBuffer {
    pub ptr: *mut u8,
    pub len: usize,
}

pub struct MemnoxNoiseHandshake(Handshake);
pub struct MemnoxNoiseTransport(Transport);

impl MemnoxNoiseBuffer {
    const EMPTY: MemnoxNoiseBuffer = MemnoxNoiseBuffer { ptr: ptr::null_mut(), len: 0 };

    fn from_vec(bytes: Vec<u8>) -> Self {
        if bytes.is_empty() {
            return Self::EMPTY;
        }
        let boxed = bytes.into_boxed_slice();
        let len = boxed.len();
        MemnoxNoiseBuffer { ptr: Box::into_raw(boxed).cast::<u8>(), len }
    }
}

fn code(e: &core::Error) -> i32 {
    match e {
        core::Error::InvalidArgument(_) => MEMNOX_NOISE_INVALID_ARGUMENT,
        core::Error::Consumed => MEMNOX_NOISE_CONSUMED,
        core::Error::Noise(_) => MEMNOX_NOISE_FAILED,
    }
}

// A panic must never unwind into Swift, so every entry point turns one into a code.
fn guard(f: impl FnOnce() -> Result<(), i32>) -> i32 {
    match catch_unwind(AssertUnwindSafe(f)) {
        Ok(Ok(())) => MEMNOX_NOISE_OK,
        Ok(Err(c)) => c,
        Err(_) => MEMNOX_NOISE_PANIC,
    }
}

unsafe fn bytes<'a>(p: *const u8, len: usize) -> Result<&'a [u8], i32> {
    if len == 0 {
        return Ok(&[]);
    }
    if p.is_null() {
        return Err(MEMNOX_NOISE_NULL_POINTER);
    }
    // The caller promises `len` readable bytes at `p` for the length of the call.
    Ok(std::slice::from_raw_parts(p, len))
}

unsafe fn optional<'a>(p: *const u8, len: usize) -> Result<Option<&'a [u8]>, i32> {
    if p.is_null() && len == 0 { Ok(None) } else { bytes(p, len).map(Some) }
}

unsafe fn out<'a, T>(p: *mut T) -> Result<&'a mut T, i32> {
    p.as_mut().ok_or(MEMNOX_NOISE_NULL_POINTER)
}

fn pattern(raw: u32) -> Result<Pattern, i32> {
    match raw {
        MEMNOX_NOISE_PATTERN_IK => Ok(Pattern::IK),
        MEMNOX_NOISE_PATTERN_XXPSK0 => Ok(Pattern::XXpsk0),
        _ => Err(MEMNOX_NOISE_INVALID_ARGUMENT),
    }
}

#[no_mangle]
pub unsafe extern "C" fn memnox_noise_generate_keypair(public_out: *mut u8, private_out: *mut u8) -> i32 {
    guard(|| {
        if public_out.is_null() || private_out.is_null() {
            return Err(MEMNOX_NOISE_NULL_POINTER);
        }
        let pair = core::generate_keypair().map_err(|e| code(&e))?;
        // Both outputs are documented in the header as 32 writable bytes.
        ptr::copy_nonoverlapping(pair.public.as_ptr(), public_out, core::KEY_LEN);
        ptr::copy_nonoverlapping(pair.private.as_ptr(), private_out, core::KEY_LEN);
        Ok(())
    })
}

#[no_mangle]
pub unsafe extern "C" fn memnox_noise_handshake_initiator(
    pattern_raw: u32,
    local_private: *const u8,
    local_private_len: usize,
    remote_public: *const u8,
    remote_public_len: usize,
    psk: *const u8,
    psk_len: usize,
    handshake_out: *mut *mut MemnoxNoiseHandshake,
) -> i32 {
    guard(|| {
        let slot = out(handshake_out)?;
        let hs = Handshake::initiator(
            pattern(pattern_raw)?,
            bytes(local_private, local_private_len)?,
            optional(remote_public, remote_public_len)?,
            optional(psk, psk_len)?,
        )
        .map_err(|e| code(&e))?;
        *slot = Box::into_raw(Box::new(MemnoxNoiseHandshake(hs)));
        Ok(())
    })
}

#[no_mangle]
pub unsafe extern "C" fn memnox_noise_handshake_responder(
    pattern_raw: u32,
    local_private: *const u8,
    local_private_len: usize,
    psk: *const u8,
    psk_len: usize,
    handshake_out: *mut *mut MemnoxNoiseHandshake,
) -> i32 {
    guard(|| {
        let slot = out(handshake_out)?;
        let hs = Handshake::responder(
            pattern(pattern_raw)?,
            bytes(local_private, local_private_len)?,
            optional(psk, psk_len)?,
        )
        .map_err(|e| code(&e))?;
        *slot = Box::into_raw(Box::new(MemnoxNoiseHandshake(hs)));
        Ok(())
    })
}

#[no_mangle]
pub unsafe extern "C" fn memnox_noise_handshake_write_message(
    handshake: *mut MemnoxNoiseHandshake,
    payload: *const u8,
    payload_len: usize,
    message_out: *mut MemnoxNoiseBuffer,
) -> i32 {
    guard(|| {
        let hs = out(handshake)?;
        let slot = out(message_out)?;
        let message = hs.0.write_message(bytes(payload, payload_len)?).map_err(|e| code(&e))?;
        *slot = MemnoxNoiseBuffer::from_vec(message);
        Ok(())
    })
}

#[no_mangle]
pub unsafe extern "C" fn memnox_noise_handshake_read_message(
    handshake: *mut MemnoxNoiseHandshake,
    message: *const u8,
    message_len: usize,
    payload_out: *mut MemnoxNoiseBuffer,
) -> i32 {
    guard(|| {
        let hs = out(handshake)?;
        let slot = out(payload_out)?;
        let payload = hs.0.read_message(bytes(message, message_len)?).map_err(|e| code(&e))?;
        *slot = MemnoxNoiseBuffer::from_vec(payload);
        Ok(())
    })
}

#[no_mangle]
pub unsafe extern "C" fn memnox_noise_handshake_is_finished(
    handshake: *const MemnoxNoiseHandshake,
    finished_out: *mut bool,
) -> i32 {
    guard(|| {
        let hs = handshake.as_ref().ok_or(MEMNOX_NOISE_NULL_POINTER)?;
        *out(finished_out)? = hs.0.is_finished().map_err(|e| code(&e))?;
        Ok(())
    })
}

#[no_mangle]
pub unsafe extern "C" fn memnox_noise_handshake_hash(
    handshake: *const MemnoxNoiseHandshake,
    hash_out: *mut MemnoxNoiseBuffer,
) -> i32 {
    guard(|| {
        let hs = handshake.as_ref().ok_or(MEMNOX_NOISE_NULL_POINTER)?;
        let slot = out(hash_out)?;
        *slot = MemnoxNoiseBuffer::from_vec(hs.0.handshake_hash().map_err(|e| code(&e))?);
        Ok(())
    })
}

#[no_mangle]
pub unsafe extern "C" fn memnox_noise_handshake_remote_static(
    handshake: *const MemnoxNoiseHandshake,
    key_out: *mut MemnoxNoiseBuffer,
) -> i32 {
    guard(|| {
        let hs = handshake.as_ref().ok_or(MEMNOX_NOISE_NULL_POINTER)?;
        let slot = out(key_out)?;
        let key = hs.0.remote_static().map_err(|e| code(&e))?;
        *slot = MemnoxNoiseBuffer::from_vec(key.unwrap_or_default());
        Ok(())
    })
}

#[no_mangle]
pub unsafe extern "C" fn memnox_noise_handshake_into_transport(
    handshake: *mut MemnoxNoiseHandshake,
    transport_out: *mut *mut MemnoxNoiseTransport,
) -> i32 {
    guard(|| {
        let hs = out(handshake)?;
        let slot = out(transport_out)?;
        let transport = hs.0.into_transport().map_err(|e| code(&e))?;
        *slot = Box::into_raw(Box::new(MemnoxNoiseTransport(transport)));
        Ok(())
    })
}

#[no_mangle]
pub unsafe extern "C" fn memnox_noise_handshake_free(handshake: *mut MemnoxNoiseHandshake) {
    if !handshake.is_null() {
        drop(Box::from_raw(handshake));
    }
}

#[no_mangle]
pub unsafe extern "C" fn memnox_noise_transport_encrypt(
    transport: *mut MemnoxNoiseTransport,
    plaintext: *const u8,
    plaintext_len: usize,
    ciphertext_out: *mut MemnoxNoiseBuffer,
) -> i32 {
    guard(|| {
        let t = out(transport)?;
        let slot = out(ciphertext_out)?;
        let sealed = t.0.encrypt(bytes(plaintext, plaintext_len)?).map_err(|e| code(&e))?;
        *slot = MemnoxNoiseBuffer::from_vec(sealed);
        Ok(())
    })
}

#[no_mangle]
pub unsafe extern "C" fn memnox_noise_transport_decrypt(
    transport: *mut MemnoxNoiseTransport,
    ciphertext: *const u8,
    ciphertext_len: usize,
    plaintext_out: *mut MemnoxNoiseBuffer,
) -> i32 {
    guard(|| {
        let t = out(transport)?;
        let slot = out(plaintext_out)?;
        let opened = t.0.decrypt(bytes(ciphertext, ciphertext_len)?).map_err(|e| code(&e))?;
        *slot = MemnoxNoiseBuffer::from_vec(opened);
        Ok(())
    })
}

#[no_mangle]
pub unsafe extern "C" fn memnox_noise_transport_rekey_outgoing(transport: *mut MemnoxNoiseTransport) -> i32 {
    guard(|| {
        out(transport)?.0.rekey_outgoing();
        Ok(())
    })
}

#[no_mangle]
pub unsafe extern "C" fn memnox_noise_transport_rekey_incoming(transport: *mut MemnoxNoiseTransport) -> i32 {
    guard(|| {
        out(transport)?.0.rekey_incoming();
        Ok(())
    })
}

#[no_mangle]
pub unsafe extern "C" fn memnox_noise_transport_free(transport: *mut MemnoxNoiseTransport) {
    if !transport.is_null() {
        drop(Box::from_raw(transport));
    }
}

#[no_mangle]
pub unsafe extern "C" fn memnox_noise_buffer_free(buffer: MemnoxNoiseBuffer) {
    if !buffer.ptr.is_null() {
        // Rebuilds exactly the boxed slice `from_vec` leaked.
        drop(Box::from_raw(ptr::slice_from_raw_parts_mut(buffer.ptr, buffer.len)));
    }
}

#[no_mangle]
pub unsafe extern "C" fn memnox_noise_pairing_code(hash: *const u8, hash_len: usize, code_out: *mut c_char) -> i32 {
    guard(|| {
        if code_out.is_null() {
            return Err(MEMNOX_NOISE_NULL_POINTER);
        }
        let digits = core::pairing_code(bytes(hash, hash_len)?).map_err(|e| code(&e))?;
        // The header documents 7 writable bytes: six digits and the terminating zero.
        ptr::copy_nonoverlapping(digits.as_ptr().cast::<c_char>(), code_out, 6);
        *code_out.add(6) = 0;
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    unsafe fn take(buffer: MemnoxNoiseBuffer) -> Vec<u8> {
        let v = if buffer.len == 0 { Vec::new() } else { std::slice::from_raw_parts(buffer.ptr, buffer.len).to_vec() };
        memnox_noise_buffer_free(buffer);
        v
    }

    #[test]
    fn ik_and_pairing_code_through_the_c_abi() {
        unsafe {
            let (mut ip, mut ik, mut rp, mut rk) = ([0u8; 32], [0u8; 32], [0u8; 32], [0u8; 32]);
            assert_eq!(memnox_noise_generate_keypair(ip.as_mut_ptr(), ik.as_mut_ptr()), 0);
            assert_eq!(memnox_noise_generate_keypair(rp.as_mut_ptr(), rk.as_mut_ptr()), 0);
            let (mut i, mut r) = (ptr::null_mut(), ptr::null_mut());
            let rc = memnox_noise_handshake_initiator(0, ik.as_ptr(), 32, rp.as_ptr(), 32, ptr::null(), 0, &mut i);
            assert_eq!(rc, 0);
            assert_eq!(memnox_noise_handshake_responder(0, rk.as_ptr(), 32, ptr::null(), 0, &mut r), 0);

            let mut buf = MemnoxNoiseBuffer::EMPTY;
            assert_eq!(memnox_noise_handshake_write_message(i, b"hi".as_ptr(), 2, &mut buf), 0);
            let m1 = take(buf);
            assert_eq!(memnox_noise_handshake_read_message(r, m1.as_ptr(), m1.len(), &mut buf), 0);
            assert_eq!(take(buf), b"hi");
            assert_eq!(memnox_noise_handshake_write_message(r, ptr::null(), 0, &mut buf), 0);
            let m2 = take(buf);
            assert_eq!(memnox_noise_handshake_read_message(i, m2.as_ptr(), m2.len(), &mut buf), 0);
            assert!(take(buf).is_empty());

            let mut done = false;
            assert_eq!(memnox_noise_handshake_is_finished(i, &mut done), 0);
            assert!(done);
            assert_eq!(memnox_noise_handshake_remote_static(r, &mut buf), 0);
            assert_eq!(take(buf), ip);

            let (mut hi, mut hr) = (MemnoxNoiseBuffer::EMPTY, MemnoxNoiseBuffer::EMPTY);
            memnox_noise_handshake_hash(i, &mut hi);
            memnox_noise_handshake_hash(r, &mut hr);
            let (hi, hr) = (take(hi), take(hr));
            assert_eq!(hi, hr);
            let (mut ci, mut cr) = ([0 as c_char; 7], [0 as c_char; 7]);
            assert_eq!(memnox_noise_pairing_code(hi.as_ptr(), hi.len(), ci.as_mut_ptr()), 0);
            assert_eq!(memnox_noise_pairing_code(hr.as_ptr(), hr.len(), cr.as_mut_ptr()), 0);
            assert_eq!(ci, cr);
            assert_eq!(ci[6], 0);

            let (mut ti, mut tr) = (ptr::null_mut(), ptr::null_mut());
            assert_eq!(memnox_noise_handshake_into_transport(i, &mut ti), 0);
            assert_eq!(memnox_noise_handshake_into_transport(r, &mut tr), 0);
            assert_eq!(memnox_noise_handshake_into_transport(i, &mut ti), MEMNOX_NOISE_CONSUMED);
            memnox_noise_handshake_free(i);
            memnox_noise_handshake_free(r);

            assert_eq!(memnox_noise_transport_rekey_outgoing(ti), 0);
            assert_eq!(memnox_noise_transport_rekey_incoming(tr), 0);
            assert_eq!(memnox_noise_transport_encrypt(ti, b"line".as_ptr(), 4, &mut buf), 0);
            let sealed = take(buf);
            assert_eq!(memnox_noise_transport_decrypt(tr, sealed.as_ptr(), sealed.len(), &mut buf), 0);
            assert_eq!(take(buf), b"line");
            assert_eq!(memnox_noise_transport_decrypt(tr, sealed.as_ptr(), sealed.len(), &mut buf), MEMNOX_NOISE_FAILED);
            memnox_noise_transport_free(ti);
            memnox_noise_transport_free(tr);
        }
    }

    #[test]
    fn bad_arguments_come_back_as_codes() {
        unsafe {
            let mut h = ptr::null_mut();
            let k = [1u8; 32];
            assert_eq!(memnox_noise_handshake_responder(9, k.as_ptr(), 32, ptr::null(), 0, &mut h), MEMNOX_NOISE_INVALID_ARGUMENT);
            assert_eq!(memnox_noise_handshake_responder(1, k.as_ptr(), 32, ptr::null(), 0, &mut h), MEMNOX_NOISE_INVALID_ARGUMENT);
            assert_eq!(memnox_noise_handshake_responder(0, ptr::null(), 32, ptr::null(), 0, &mut h), MEMNOX_NOISE_NULL_POINTER);
            assert_eq!(memnox_noise_handshake_responder(0, k.as_ptr(), 32, ptr::null(), 0, ptr::null_mut()), MEMNOX_NOISE_NULL_POINTER);
            assert!(h.is_null());
        }
    }
}
