from __future__ import annotations

from pathlib import Path

import pytest

from elitea_worker.execution.errors import InvalidInput
from elitea_worker.security import _load_redis_password


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        (b"", None),
        (b"a" * 512, b"a" * 512),
        (b"a" * 513, None),
        (b"a" * 515, None),
        (b"password\n", b"password"),
        (b"b" * 512 + b"\n", b"b" * 512),
        (b"c" * 512 + b"\r\n", b"c" * 512),
        (b"pass\nword", None),
        (b"password\n\n", None),
        (b"password\r", None),
        (b"pass\x00word", None),
        (b"\xff", None),
        ("pässwörd\r\n".encode(), "pässwörd".encode()),
        (b" password \r\n", b" password "),
    ],
    ids=[
        "empty",
        "512-bytes",
        "513-bytes",
        "515-raw-bytes",
        "terminal-lf",
        "512-bytes-terminal-lf",
        "512-bytes-terminal-crlf",
        "embedded-lf",
        "repeated-terminal-lf",
        "lone-terminal-cr",
        "nul",
        "invalid-utf8",
        "utf8-bytes-preserved",
        "spaces-preserved",
    ],
)
def test_redis_password_uses_exact_bounded_cross_language_contract(
    tmp_path: Path,
    raw: bytes,
    expected: bytes | None,
) -> None:
    path = tmp_path / "redis-password"
    path.write_bytes(raw)
    path.chmod(0o600)

    if expected is None:
        with pytest.raises(InvalidInput, match="unavailable or unsafe"):
            _load_redis_password(path)
        return

    assert _load_redis_password(path).encode("utf-8") == expected


def test_redis_password_requires_owner_only_regular_file(tmp_path: Path) -> None:
    path = tmp_path / "redis-password"
    path.write_bytes(b"password")
    path.chmod(0o640)

    with pytest.raises(InvalidInput, match="unavailable or unsafe"):
        _load_redis_password(path)
