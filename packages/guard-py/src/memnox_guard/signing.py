"""Ed25519 checks over what the control plane signs: the rules, and a person's answer to a held call.

Without the `cryptography` package nothing signed is believed, so a guard fails closed rather than open.
"""

from __future__ import annotations

import base64
from typing import Mapping, Optional


def verifies(public_key_spki_b64: str, message: bytes, signature_b64: str) -> bool:
    try:
        from cryptography.exceptions import InvalidSignature
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
        from cryptography.hazmat.primitives.serialization import load_der_public_key
    except ImportError:
        return False
    try:
        key = load_der_public_key(base64.b64decode(public_key_spki_b64))
        if not isinstance(key, Ed25519PublicKey):
            return False
        key.verify(base64.b64decode(signature_b64), message)
        return True
    except (InvalidSignature, ValueError, TypeError):
        # A signature or key that will not parse proves nothing.
        return False


def bundle_signed(signature: Optional[str], body: str, keys: Mapping[str, str]) -> bool:
    """`<keyId>:<base64>` over the body's bytes, checked against the plane's published keys."""
    if signature is None:
        return False
    at = signature.find(":")
    if at <= 0:
        return False
    key = keys.get(signature[:at])
    if key is None:
        return False
    return verifies(key, body.encode("utf-8"), signature[at + 1:])
