from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from elitea.runtime.v1 import common_pb2, input_pb2

from elitea_worker.execution.errors import InvalidInput, ResourceExhausted
from elitea_worker.fixtures.bundle import (
    CANONICALIZATION,
    PROFILE,
    SCHEMA_VERSION,
    FixtureBundle,
    project_input_manifest_entries,
)


def _canonical(value: object) -> bytes:
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()


def _write_bundle(
    root: Path,
    settings: bytes = b"{}\n",
    **content_changes: object,
) -> tuple[Path, bytes, int, str]:
    digest = hashlib.sha256(settings).hexdigest()
    blob = root / "blobs" / "sha256" / digest
    blob.parent.mkdir(parents=True)
    blob.write_bytes(settings)
    version = "configuration-revision-v1"
    content = {
        "content_id": "configuration-settings-v1",
        "immutable_version": version,
        "media_type": "application/json",
        "byte_length": len(settings),
        "digest": f"sha256:{digest}",
        "classification": "synthetic",
        "required_grant_audience": "elitea.runtime.input.read.v1",
        "blob_name": f"blobs/sha256/{digest}",
    }
    content.update(content_changes)
    input_bundle = input_pb2.ExecutionInputBundleV1(
        input_bundle_id="bundle-1",
        immutable_version=version,
        entries=[
            input_pb2.ExecutionInputEntryV1(
                entry_id="settings",
                immutable_version=version,
                semantic_role="configuration.settings",
                content=input_pb2.ScopedContentReferenceV1(
                    content_id="configuration-settings-v1",
                    immutable_version=version,
                    media_type="application/json",
                    byte_length=len(settings),
                    digest=common_pb2.DigestV1(
                        algorithm=common_pb2.DIGEST_ALGORITHM_V1_SHA256,
                        value=bytes.fromhex(digest),
                    ),
                    classification="synthetic",
                    required_grant_audience="elitea.runtime.input.read.v1",
                ),
            )
        ],
    )
    input_bundle_raw = input_bundle.SerializeToString(deterministic=True)
    (root / "input-bundle.pb").write_bytes(input_bundle_raw)
    manifest_digest = hashlib.sha256(input_bundle_raw).hexdigest()
    locator = {
        "schema_version": SCHEMA_VERSION,
        "profile": PROFILE,
        "canonicalization": CANONICALIZATION,
        "input_bundle_manifest": {
            "blob_name": "input-bundle.pb",
            "media_type": "application/x-protobuf",
            "byte_length": len(input_bundle_raw),
            "digest": f"sha256:{manifest_digest}",
        },
        "entries": [
            {
                "entry_id": "settings",
                "immutable_version": version,
                "semantic_role": "configuration.settings",
                "content": content,
            }
        ],
    }
    path = root / "fixture-bundle.json"
    raw = _canonical(locator)
    path.write_bytes(raw)
    return path, bytes.fromhex(manifest_digest), len(input_bundle_raw), version


def test_resolves_exact_content_addressed_canonical_json(tmp_path: Path) -> None:
    path, digest, length, version = _write_bundle(tmp_path)

    bundle = FixtureBundle.load(
        path,
        expected_bundle_id="bundle-1",
        expected_digest=digest,
        expected_bundle_version=version,
        expected_byte_length=length,
    )
    result = bundle.resolve_json("settings")

    assert result.json_value == {}
    assert result.content == b"{}\n"
    assert result.bundle_digest == digest


def test_manifest_digest_is_checked_before_parsing(tmp_path: Path) -> None:
    path, digest, length, version = _write_bundle(tmp_path)
    (tmp_path / "input-bundle.pb").write_bytes(b"not-protobuf")

    with pytest.raises(InvalidInput, match="immutable descriptor"):
        FixtureBundle.load(
            path,
            expected_bundle_id="bundle-1",
            expected_digest=digest,
            expected_bundle_version=version,
            expected_byte_length=length,
        )


def test_rejects_noncanonical_or_duplicate_json(tmp_path: Path) -> None:
    path, _, _, _ = _write_bundle(tmp_path)
    raw = path.read_bytes().replace(b'"entries":', b'"entries":[],"entries":')
    path.write_bytes(raw)

    with pytest.raises(InvalidInput, match="malformed"):
        FixtureBundle.load(
            path,
            expected_bundle_id="bundle-1",
            expected_digest=b"x" * 32,
            expected_bundle_version="configuration-revision-v1",
            expected_byte_length=1,
        )


def test_rejects_traversal_even_when_manifest_digest_matches(tmp_path: Path) -> None:
    path, digest, length, version = _write_bundle(tmp_path, blob_name="../settings.json")

    with pytest.raises(InvalidInput, match="content-addressed"):
        FixtureBundle.load(
            path,
            expected_bundle_id="bundle-1",
            expected_digest=digest,
            expected_bundle_version=version,
            expected_byte_length=length,
        )


def test_rejects_symlinked_blob(tmp_path: Path) -> None:
    path, digest, length, version = _write_bundle(tmp_path)
    bundle = FixtureBundle.load(
        path,
        expected_bundle_id="bundle-1",
        expected_digest=digest,
        expected_bundle_version=version,
        expected_byte_length=length,
    )
    target = next((tmp_path / "blobs" / "sha256").iterdir())
    target.unlink()
    outside = tmp_path / "outside"
    outside.write_bytes(b"{}\n")
    target.symlink_to(outside)

    with pytest.raises(InvalidInput, match="unsafe"):
        bundle.resolve_json("settings")


def test_rejects_symlinked_intermediate_blob_directory(tmp_path: Path) -> None:
    path, digest, length, version = _write_bundle(tmp_path)
    bundle = FixtureBundle.load(
        path,
        expected_bundle_id="bundle-1",
        expected_digest=digest,
        expected_bundle_version=version,
        expected_byte_length=length,
    )
    blobs = tmp_path / "blobs"
    moved = tmp_path / "outside-blobs"
    blobs.rename(moved)
    blobs.symlink_to(moved, target_is_directory=True)

    with pytest.raises(InvalidInput, match="unsafe"):
        bundle.resolve_json("settings")


def test_rejects_entry_above_settings_limit_before_read(tmp_path: Path) -> None:
    path, digest, length, version = _write_bundle(tmp_path, byte_length=256 * 1024 + 1)

    with pytest.raises(ResourceExhausted):
        FixtureBundle.load(
            path,
            expected_bundle_id="bundle-1",
            expected_digest=digest,
            expected_bundle_version=version,
            expected_byte_length=length,
        )


def test_online_settings_reject_exponent_overflow() -> None:
    from elitea_worker.fixtures.bundle import parse_settings_json

    with pytest.raises(InvalidInput, match="non-finite"):
        parse_settings_json(b'{"extension":1e9999}')


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("input_bundle_id", "x" * 129),
        ("immutable_version", "v" * 129),
    ],
)
def test_manifest_identity_fields_are_bounded_to_128_characters(
    field: str,
    value: str,
) -> None:
    manifest = _manifest()
    setattr(manifest, field, value)
    with pytest.raises(InvalidInput):
        project_input_manifest_entries(manifest)


def test_manifest_rejects_zero_length_content() -> None:
    manifest = _manifest()
    manifest.entries[0].content.byte_length = 0
    with pytest.raises(InvalidInput, match="byte length"):
        project_input_manifest_entries(manifest)


def _manifest() -> input_pb2.ExecutionInputBundleV1:
    return input_pb2.ExecutionInputBundleV1(
        input_bundle_id="bundle-1",
        immutable_version="version-1",
        entries=[
            input_pb2.ExecutionInputEntryV1(
                entry_id="settings",
                immutable_version="version-1",
                semantic_role="configuration.settings",
                content=input_pb2.ScopedContentReferenceV1(
                    content_id="content-1",
                    immutable_version="version-1",
                    media_type="application/json",
                    byte_length=1,
                    digest=common_pb2.DigestV1(
                        algorithm=common_pb2.DIGEST_ALGORITHM_V1_SHA256,
                        value=b"d" * 32,
                    ),
                    classification="synthetic",
                    required_grant_audience="elitea.runtime.input.read.v1",
                ),
            )
        ],
    )
