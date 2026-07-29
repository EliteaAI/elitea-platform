from __future__ import annotations

from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

import pytest

from elitea_worker.execution.errors import InvalidInput, ResourceExhausted
from elitea_worker.transport.output_spool import EncryptedOutputSpool


def _spool(root: Path, **limits: int) -> EncryptedOutputSpool:
    return EncryptedOutputSpool(
        root,
        key=b"k" * 32,
        stream_aad=b"execution-1/generation-1/producer-1",
        max_frames=limits.get("max_frames", 2),
        max_bytes=limits.get("max_bytes", 4096),
        max_frame_bytes=limits.get("max_frame_bytes", 1024),
    )


def test_spool_encrypts_replays_idempotently_and_cleans_on_ack(tmp_path: Path) -> None:
    spool = _spool(tmp_path / "spool")
    spool.put(1, b"sensitive-output")
    spool.put(1, b"sensitive-output")

    raw = next((tmp_path / "spool").iterdir()).read_bytes()
    assert b"sensitive-output" not in raw
    assert [(item.sequence, item.payload) for item in spool.pending()] == [(1, b"sensitive-output")]

    spool.acknowledge_through(1)
    assert spool.pending() == ()


def test_sequence_digest_cannot_change(tmp_path: Path) -> None:
    spool = _spool(tmp_path / "spool")
    spool.put(1, b"first")

    with pytest.raises(InvalidInput, match="cannot change"):
        spool.put(1, b"second")


def test_exact_cancellation_replacement_is_atomic_and_idempotently_recoverable(
    tmp_path: Path,
) -> None:
    spool = _spool(tmp_path / "spool")
    spool.put(1, b"success-frame")

    spool.replace_exact(1, b"success-frame", b"cancelled-frame")

    assert [(item.sequence, item.payload) for item in spool.pending()] == [
        (1, b"cancelled-frame")
    ]
    raw = next((tmp_path / "spool").iterdir()).read_bytes()
    assert b"success-frame" not in raw
    assert b"cancelled-frame" not in raw


def test_cancellation_replacement_mismatch_or_bound_failure_preserves_original(
    tmp_path: Path,
) -> None:
    spool = _spool(tmp_path / "spool", max_frame_bytes=16)
    spool.put(1, b"success-frame")

    with pytest.raises(InvalidInput, match="changed"):
        spool.replace_exact(1, b"other-frame", b"cancelled-frame")
    with pytest.raises(ResourceExhausted, match="replacement"):
        spool.replace_exact(1, b"success-frame", b"x" * 17)

    assert [(item.sequence, item.payload) for item in spool.pending()] == [
        (1, b"success-frame")
    ]


def test_spool_is_bounded_by_frames_and_bytes(tmp_path: Path) -> None:
    spool = _spool(tmp_path / "spool", max_frames=1)
    spool.put(1, b"first")

    with pytest.raises(ResourceExhausted, match="full"):
        spool.put(2, b"second")


def test_concurrent_puts_cannot_overbook_capacity(tmp_path: Path) -> None:
    spool = _spool(tmp_path / "spool", max_frames=1)

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [
            executor.submit(spool.put, sequence, f"frame-{sequence}".encode())
            for sequence in (1, 2)
        ]
    outcomes = []
    for future in futures:
        try:
            future.result()
            outcomes.append("stored")
        except ResourceExhausted:
            outcomes.append("full")
    assert sorted(outcomes) == ["full", "stored"]
    assert len(spool.pending()) == 1


def test_incomplete_atomic_publish_residue_is_cleaned_at_startup(tmp_path: Path) -> None:
    root = tmp_path / "spool"
    root.mkdir()
    temporary = root / (".tmp-" + "a" * 32)
    temporary.write_bytes(b"partial-ciphertext")

    spool = _spool(root)

    assert spool.pending() == ()
    assert not temporary.exists()


def test_sequence_is_bounded_to_uint64(tmp_path: Path) -> None:
    spool = _spool(tmp_path / "spool")

    with pytest.raises(InvalidInput):
        spool.put(1 << 64, b"frame")
