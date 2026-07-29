from __future__ import annotations

import hashlib
import tempfile
import unittest
from pathlib import Path

from fixture_server import (
    ATTACHMENT_COUNT,
    PROFILE_SCHEMA,
    RECEIPT_SCHEMA,
    SOURCE_PAYLOAD_BYTES,
    Receipt,
    _matches_header_digest,
    _valid_credential_canary,
    _valid_sha256,
    generate_deterministic_png,
    profile_description,
)


class FixtureProfileTest(unittest.TestCase):
    def test_profile_is_exactly_sixty_two_mib(self) -> None:
        profile = profile_description()
        self.assertEqual(profile["schema"], PROFILE_SCHEMA)
        self.assertEqual(profile["attachment_count"], ATTACHMENT_COUNT)
        self.assertEqual(profile["source_payload_bytes"], 62 << 20)
        self.assertEqual(SOURCE_PAYLOAD_BYTES, 62 << 20)

    def test_png_generation_is_exact_and_deterministic(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            first = root / "first.png"
            second = root / "second.png"
            first_digest = generate_deterministic_png(
                first,
                target_bytes=96 * 1024,
                width=128,
                height=240,
                seed=5681,
            )
            second_digest = generate_deterministic_png(
                second,
                target_bytes=96 * 1024,
                width=128,
                height=240,
                seed=5681,
            )
            self.assertEqual(first.stat().st_size, 96 * 1024)
            self.assertEqual(first.read_bytes()[:8], b"\x89PNG\r\n\x1a\n")
            self.assertEqual(first_digest, second_digest)
            self.assertEqual(
                first_digest, hashlib.sha256(first.read_bytes()).hexdigest()
            )

    def test_receipt_discloses_only_aggregate_evidence(self) -> None:
        receipt = Receipt(
            project_id=7,
            small_sha256="a" * 64,
            large_sha256="b" * 64,
        )
        receipt.record_source("diagram-00.png", 3 << 20)
        receipt.record_model(chat=True, byte_length=(32 << 20) + 1)
        receipt.record_model(chat=False, byte_length=1024)
        value = receipt.snapshot()
        self.assertEqual(value["schema"], RECEIPT_SCHEMA)
        self.assertEqual(value["source_completed_bytes"], 3 << 20)
        self.assertEqual(value["max_chat_request_bytes"], (32 << 20) + 1)
        self.assertNotIn("authorization", value)
        self.assertNotIn("project_id", value)

    def test_authorization_uses_only_exact_sha256_fingerprints(self) -> None:
        header = "Bearer fixture-only-value"
        fingerprint = hashlib.sha256(header.encode()).hexdigest()
        self.assertTrue(_valid_sha256(fingerprint))
        self.assertTrue(_matches_header_digest(header, fingerprint))
        self.assertFalse(_matches_header_digest(header + "-other", fingerprint))
        self.assertFalse(_matches_header_digest("", fingerprint))
        self.assertFalse(_valid_sha256("A" * 64))

    def test_credential_canary_is_bounded_and_explicit(self) -> None:
        self.assertTrue(
            _valid_credential_canary("issue-5681-credential-canary-source")
        )
        self.assertFalse(_valid_credential_canary("ordinary-value"))
        self.assertFalse(
            _valid_credential_canary(
                "issue-5681-credential-canary-" + ("x" * 128)
            )
        )


if __name__ == "__main__":
    unittest.main()
