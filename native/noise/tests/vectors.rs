//! Published Noise vectors for the IK and XX families on our exact suite, run through snow.
//! No public vector set carries plain XXpsk0, so XXpsk0+psk1..3 and XXpsk3 stand in for it.

use serde::Deserialize;
use snow::params::{HandshakeModifier, NoiseParams};
use snow::Builder;

#[derive(Deserialize)]
struct Message {
    payload: String,
    ciphertext: String,
}

#[derive(Deserialize)]
struct Vector {
    source: String,
    protocol_name: String,
    init_prologue: String,
    resp_prologue: String,
    init_psks: Option<Vec<String>>,
    resp_psks: Option<Vec<String>>,
    init_static: Option<String>,
    resp_static: Option<String>,
    init_ephemeral: Option<String>,
    resp_ephemeral: Option<String>,
    init_remote_static: Option<String>,
    resp_remote_static: Option<String>,
    handshake_hash: Option<String>,
    messages: Vec<Message>,
}

#[derive(Deserialize)]
struct Vectors {
    vectors: Vec<Vector>,
}

fn h(s: &str) -> Vec<u8> {
    hex::decode(s).expect("vector hex")
}

fn psk32(s: &str) -> [u8; 32] {
    h(s).try_into().expect("32 byte psk")
}

fn run(v: &Vector) {
    let params: NoiseParams = v.protocol_name.parse().unwrap();
    let mut keys: Vec<Vec<u8>> = Vec::new();
    let store = |keys: &mut Vec<Vec<u8>>, s: &Option<String>| s.as_deref().map(|x| {
        keys.push(h(x));
        keys.len() - 1
    });
    let (is, rs, ie, re, irs, rrs) = (
        store(&mut keys, &v.init_static),
        store(&mut keys, &v.resp_static),
        store(&mut keys, &v.init_ephemeral),
        store(&mut keys, &v.resp_ephemeral),
        store(&mut keys, &v.init_remote_static),
        store(&mut keys, &v.resp_remote_static),
    );
    let (ip, rp) = (h(&v.init_prologue), h(&v.resp_prologue));
    let positions: Vec<u8> = params
        .handshake
        .modifiers
        .list
        .iter()
        .filter_map(|m| if let HandshakeModifier::Psk(n) = m { Some(*n) } else { None })
        .collect();
    let ipsks: Vec<[u8; 32]> = v.init_psks.iter().flatten().map(|s| psk32(s)).collect();
    let rpsks: Vec<[u8; 32]> = v.resp_psks.iter().flatten().map(|s| psk32(s)).collect();

    let mut ib = Builder::new(params.clone()).prologue(&ip).unwrap();
    let mut rb = Builder::new(params).prologue(&rp).unwrap();
    for (k, n) in positions.iter().enumerate() {
        ib = ib.psk(*n, &ipsks[k]).unwrap();
        rb = rb.psk(*n, &rpsks[k]).unwrap();
    }
    if let Some(i) = is { ib = ib.local_private_key(&keys[i]).unwrap(); }
    if let Some(i) = rs { rb = rb.local_private_key(&keys[i]).unwrap(); }
    if let Some(i) = irs { ib = ib.remote_public_key(&keys[i]).unwrap(); }
    if let Some(i) = rrs { rb = rb.remote_public_key(&keys[i]).unwrap(); }
    if let Some(i) = ie { ib = ib.fixed_ephemeral_key_for_testing_only(&keys[i]); }
    if let Some(i) = re { rb = rb.fixed_ephemeral_key_for_testing_only(&keys[i]); }
    let (mut init, mut resp) = (ib.build_initiator().unwrap(), rb.build_responder().unwrap());

    let mut buf = vec![0u8; 65535];
    let mut out = vec![0u8; 65535];
    let mut msgs = v.messages.iter().enumerate();
    while !init.is_handshake_finished() {
        let (i, m) = msgs.next().expect("vector ran out of handshake messages");
        let (s, r) = if i % 2 == 0 { (&mut init, &mut resp) } else { (&mut resp, &mut init) };
        let n = s.write_message(&h(&m.payload), &mut buf).unwrap();
        assert_eq!(hex::encode(&buf[..n]), m.ciphertext, "{} {} handshake message {i}", v.source, v.protocol_name);
        let k = r.read_message(&buf[..n], &mut out).unwrap();
        assert_eq!(hex::encode(&out[..k]), m.payload);
    }
    if let Some(hash) = &v.handshake_hash {
        assert_eq!(hex::encode(init.get_handshake_hash()), *hash);
        assert_eq!(hex::encode(resp.get_handshake_hash()), *hash);
    }
    let (mut it, mut rt) = (init.into_transport_mode().unwrap(), resp.into_transport_mode().unwrap());
    for (i, m) in msgs {
        let (s, r) = if i % 2 == 0 { (&mut it, &mut rt) } else { (&mut rt, &mut it) };
        let n = s.write_message(&h(&m.payload), &mut buf).unwrap();
        assert_eq!(hex::encode(&buf[..n]), m.ciphertext, "{} {} transport message {i}", v.source, v.protocol_name);
        let k = r.read_message(&buf[..n], &mut out).unwrap();
        assert_eq!(hex::encode(&out[..k]), m.payload);
    }
}

#[test]
fn published_vectors_for_our_suite_pass() {
    let all: Vectors = serde_json::from_str(include_str!("vectors/memnox-suite.json")).unwrap();
    assert!(all.vectors.iter().any(|v| v.protocol_name == "Noise_IK_25519_ChaChaPoly_BLAKE2s" && v.source == "cacophony"));
    for v in &all.vectors {
        run(v);
    }
    println!("{} vectors passed", all.vectors.len());
}
