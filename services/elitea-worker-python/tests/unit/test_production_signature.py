from __future__ import annotations

import hashlib
import base64
import json
from pathlib import Path

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from elitea.runtime.v1 import common_pb2, envelope_pb2

from elitea_worker.execution.errors import AuthorizationFailure
from elitea_worker.protocol.codec import (
    Ed25519CommandAuthenticator,
    _ed25519_worker_command_signing_input,
)
from elitea_worker.security import load_ed25519_keyring


class KeyResolver:
    def __init__(self, keys):
        self.keys = keys
        self.requested: list[str] = []

    def resolve_ed25519_public_key(self, key_id: str):
        self.requested.append(key_id)
        return self.keys[key_id]


def test_production_authenticator_uses_exact_rotated_key_and_domain() -> None:
    old_private = Ed25519PrivateKey.generate()
    new_private = Ed25519PrivateKey.generate()
    resolver = KeyResolver(
        {
            "runtime-signing-old": old_private.public_key(),
            "runtime-signing-new": new_private.public_key(),
        }
    )
    command = b"canonical-worker-command"
    signed = _signed("runtime-signing-old", old_private, command)

    Ed25519CommandAuthenticator(resolver).authenticate(signed)

    assert resolver.requested == ["runtime-signing-old"]
    with pytest.raises(AuthorizationFailure):
        signed.signature = old_private.sign(command)
        Ed25519CommandAuthenticator(resolver).authenticate(signed)


def test_production_authenticator_rejects_test_profile_unknown_key_and_tamper() -> None:
    private = Ed25519PrivateKey.generate()
    resolver = KeyResolver({"key-1": private.public_key()})
    authenticator = Ed25519CommandAuthenticator(resolver)

    test_only = _signed("key-1", private, b"command")
    test_only.signature_profile = (
        envelope_pb2.SIGNATURE_PROFILE_V1_TEST_ONLY_HMAC_SHA256
    )
    with pytest.raises(AuthorizationFailure):
        authenticator.authenticate(test_only)
    assert resolver.requested == []

    unknown = _signed("unknown-key", private, b"command")
    with pytest.raises(AuthorizationFailure):
        authenticator.authenticate(unknown)

    tampered = _signed("key-1", private, b"command")
    tampered.signature = bytes([tampered.signature[0] ^ 0xFF]) + tampered.signature[1:]
    with pytest.raises(AuthorizationFailure):
        authenticator.authenticate(tampered)

    wrong_length = _signed("key-1", private, b"command")
    wrong_input = (
        b"elitea.runtime.worker-command.ed25519.v1\x00"
        + (len(b"command") + 1).to_bytes(8, "big")
        + b"command"
    )
    wrong_length.signature = private.sign(wrong_input)
    with pytest.raises(AuthorizationFailure):
        authenticator.authenticate(wrong_length)


def test_ed25519_signature_input_matches_go_vector() -> None:
    private = Ed25519PrivateKey.from_private_bytes(bytes(range(32)))
    command = b"elitea-production-signature-vector-v1"
    public = private.public_key().public_bytes(
        serialization.Encoding.Raw,
        serialization.PublicFormat.Raw,
    )
    assert public.hex() == (
        "03a107bff3ce10be1d70dd18e74bc09967e4d6309ba50d5f1ddc8664125531b8"
    )
    assert private.sign(_ed25519_worker_command_signing_input(command)).hex() == (
        "787b39572ae42d7770697c968300cb772af1844d2a56b354cf580d523c8b2682"
        "da70be4e4e21f951f390f9c8f3d961ab79159c1a7d85effa4935ebd765eb0900"
    )


def test_file_keyring_resolves_only_the_exact_key_id(tmp_path: Path) -> None:
    private = Ed25519PrivateKey.generate()
    public = private.public_key().public_bytes(
        serialization.Encoding.Raw,
        serialization.PublicFormat.Raw,
    )
    path = tmp_path / "command-keys.json"
    path.write_text(
        json.dumps(
            {
                "schema_version": "elitea.runtime-ed25519-keyring.v1",
                "keys": [
                    {
                        "key_id": "runtime-signing-2026-07",
                        "public_key_base64": base64.b64encode(public).decode(),
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    path.chmod(0o644)

    resolver = load_ed25519_keyring(path)

    assert resolver.resolve_ed25519_public_key("runtime-signing-2026-07")
    with pytest.raises(KeyError):
        resolver.resolve_ed25519_public_key("runtime-signing")


def _signed(
    key_id: str,
    private: Ed25519PrivateKey,
    command: bytes,
) -> envelope_pb2.SignedWorkerCommandEnvelopeV1:
    digest = hashlib.sha256(command).digest()
    return envelope_pb2.SignedWorkerCommandEnvelopeV1(
        envelope_schema_revision="elitea.runtime.signed-worker-command.v1",
        signature_profile=envelope_pb2.SIGNATURE_PROFILE_V1_ED25519,
        key_id=key_id,
        worker_command_bytes=command,
        worker_command_digest=common_pb2.DigestV1(
            algorithm=common_pb2.DIGEST_ALGORITHM_V1_SHA256,
            value=digest,
        ),
        signature=private.sign(_ed25519_worker_command_signing_input(command)),
    )
