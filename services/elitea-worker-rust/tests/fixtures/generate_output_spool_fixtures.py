#!/usr/bin/env python3
"""Regenerate the deterministic Python-worker encrypted spool vector."""

from __future__ import annotations

import hashlib
from pathlib import Path

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF


ROOT = Path(__file__).resolve().parents[2]
BINDING_DOMAIN = b"elitea.runtime.execution-spool.v1\x00"
KEY_DOMAIN = b"elitea.runtime.output-spool-key.v1\x00"
AAD_DOMAIN = b"elitea.runtime.output-spool-aad.v1\x00"
MAGIC = b"ELITEASPOOL1\x00"


def main() -> None:
    values = (
        "tenant-1",
        "resource-2",
        "projection-3",
        "command-4",
        "execution-5",
        "7",
        "producer-6",
    )
    encoded = tuple(value.encode("utf-8") for value in values)
    binding = BINDING_DOMAIN + b"\x00".join(
        len(value).to_bytes(4, "big") + value for value in encoded
    )
    key = HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=None,
        info=KEY_DOMAIN + binding,
    ).derive(bytes(range(32)))
    nonce = bytes(range(12))
    aad = AAD_DOMAIN + binding + b"\x00" + (1).to_bytes(8, "big")
    body = MAGIC + nonce + AESGCM(key).encrypt(nonce, b"sensitive-output", aad)

    output = ROOT / "tests/fixtures/output_spool_vectors.txt"
    output.write_text(
        "\n".join(
            (
                "binding=" + binding.hex(),
                "directory=" + hashlib.sha256(binding).hexdigest(),
                "derived_key=" + key.hex(),
                "fixed_nonce_body=" + body.hex(),
            )
        )
        + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
