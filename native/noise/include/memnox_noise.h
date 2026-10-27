/* The C ABI of native/noise. Every Noise mechanic comes from snow; this only moves bytes and handles. */
#ifndef MEMNOX_NOISE_H
#define MEMNOX_NOISE_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Every function that can fail returns one of these, and zero always means it worked. */
#define MEMNOX_NOISE_OK 0
#define MEMNOX_NOISE_INVALID_ARGUMENT 1
#define MEMNOX_NOISE_FAILED 2
#define MEMNOX_NOISE_CONSUMED 3
#define MEMNOX_NOISE_NULL_POINTER 4
#define MEMNOX_NOISE_PANIC 5

/* Noise_IK_25519_ChaChaPoly_BLAKE2s for every connection after pairing. */
#define MEMNOX_NOISE_PATTERN_IK 0
/* Noise_XXpsk0_25519_ChaChaPoly_BLAKE2s for pairing, with the 32 byte secret from the QR. */
#define MEMNOX_NOISE_PATTERN_XXPSK0 1

#define MEMNOX_NOISE_KEY_LEN 32
#define MEMNOX_NOISE_PSK_LEN 32
#define MEMNOX_NOISE_MAX_MESSAGE 65535

typedef struct MemnoxNoiseHandshake MemnoxNoiseHandshake;
typedef struct MemnoxNoiseTransport MemnoxNoiseTransport;

/* Owned by the library, so release it with memnox_noise_buffer_free and never with free. ptr is NULL when len is 0. */
typedef struct MemnoxNoiseBuffer {
    uint8_t *ptr;
    size_t len;
} MemnoxNoiseBuffer;

/* Writes 32 bytes to each output. */
int32_t memnox_noise_generate_keypair(uint8_t *public_out, uint8_t *private_out);

/* remote_public is required for IK and must be NULL with length 0 for XXpsk0; psk is the reverse. */
int32_t memnox_noise_handshake_initiator(uint32_t pattern,
                                         const uint8_t *local_private, size_t local_private_len,
                                         const uint8_t *remote_public, size_t remote_public_len,
                                         const uint8_t *psk, size_t psk_len,
                                         MemnoxNoiseHandshake **handshake_out);

int32_t memnox_noise_handshake_responder(uint32_t pattern,
                                         const uint8_t *local_private, size_t local_private_len,
                                         const uint8_t *psk, size_t psk_len,
                                         MemnoxNoiseHandshake **handshake_out);

int32_t memnox_noise_handshake_write_message(MemnoxNoiseHandshake *handshake,
                                             const uint8_t *payload, size_t payload_len,
                                             MemnoxNoiseBuffer *message_out);

int32_t memnox_noise_handshake_read_message(MemnoxNoiseHandshake *handshake,
                                            const uint8_t *message, size_t message_len,
                                            MemnoxNoiseBuffer *payload_out);

int32_t memnox_noise_handshake_is_finished(const MemnoxNoiseHandshake *handshake, bool *finished_out);

int32_t memnox_noise_handshake_hash(const MemnoxNoiseHandshake *handshake, MemnoxNoiseBuffer *hash_out);

/* key_out comes back with length 0 while the remote static key is still unknown. */
int32_t memnox_noise_handshake_remote_static(const MemnoxNoiseHandshake *handshake, MemnoxNoiseBuffer *key_out);

/* Moves the finished state into a transport; the handshake handle must still be freed and answers CONSUMED after. */
int32_t memnox_noise_handshake_into_transport(MemnoxNoiseHandshake *handshake, MemnoxNoiseTransport **transport_out);

void memnox_noise_handshake_free(MemnoxNoiseHandshake *handshake);

int32_t memnox_noise_transport_encrypt(MemnoxNoiseTransport *transport,
                                       const uint8_t *plaintext, size_t plaintext_len,
                                       MemnoxNoiseBuffer *ciphertext_out);

int32_t memnox_noise_transport_decrypt(MemnoxNoiseTransport *transport,
                                       const uint8_t *ciphertext, size_t ciphertext_len,
                                       MemnoxNoiseBuffer *plaintext_out);

/* Call after every 1048576 messages sent, in step with the peer's rekey_incoming. */
int32_t memnox_noise_transport_rekey_outgoing(MemnoxNoiseTransport *transport);

/* Call after every 1048576 messages received, in step with the peer's rekey_outgoing. */
int32_t memnox_noise_transport_rekey_incoming(MemnoxNoiseTransport *transport);

void memnox_noise_transport_free(MemnoxNoiseTransport *transport);

void memnox_noise_buffer_free(MemnoxNoiseBuffer buffer);

/* Writes six digits and a terminating zero, so code_out needs 7 bytes. */
int32_t memnox_noise_pairing_code(const uint8_t *hash, size_t hash_len, char *code_out);

#ifdef __cplusplus
}
#endif

#endif
