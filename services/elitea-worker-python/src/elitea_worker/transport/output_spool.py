"""Bounded encrypted crash-recovery spool for non-droppable output frames."""

from __future__ import annotations

import os
import re
import secrets
import stat
import threading
from dataclasses import dataclass
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from elitea_worker.execution.errors import InvalidInput, ResourceExhausted

_MAGIC = b"ELITEASPOOL1\x00"
_NONCE_BYTES = 12
_MAX_SEQUENCE = (1 << 64) - 1
_TEMP_NAME = re.compile(r"^\.tmp-[0-9a-f]{32}$")


@dataclass(frozen=True, slots=True)
class SpooledFrame:
    sequence: int
    payload: bytes


class EncryptedOutputSpool:
    def __init__(
        self,
        root: Path,
        *,
        key: bytes,
        stream_aad: bytes,
        max_frames: int,
        max_bytes: int,
        max_frame_bytes: int,
    ) -> None:
        if len(key) != 32 or not stream_aad:
            raise ValueError("a 256-bit spool key and stream binding are required")
        if min(max_frames, max_bytes, max_frame_bytes) < 1:
            raise ValueError("spool limits must be positive")
        root.mkdir(mode=0o700, parents=False, exist_ok=True)
        info = root.lstat()
        if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode):
            raise InvalidInput("The output spool path is not a private directory.")
        os.chmod(root, 0o700)
        self._root = root
        self._cipher = AESGCM(key)
        self._stream_aad = stream_aad
        self._max_frames = max_frames
        self._max_bytes = max_bytes
        self._max_frame_bytes = max_frame_bytes
        self._lock = threading.RLock()
        self._clean_incomplete_temps()

    def put(self, sequence: int, payload: bytes) -> None:
        if sequence < 1 or sequence > _MAX_SEQUENCE:
            raise InvalidInput("Output sequence must be positive.")
        if len(payload) > self._max_frame_bytes:
            raise ResourceExhausted("The output frame exceeds the spool frame limit.")
        with self._lock:
            path = self._path(sequence)
            if path.exists():
                existing = self._read(path, sequence)
                if existing != payload:
                    raise InvalidInput("An output sequence cannot change after allocation.")
                return
            files, total = self._usage()
            nonce = os.urandom(_NONCE_BYTES)
            encrypted = self._cipher.encrypt(nonce, payload, self._aad(sequence))
            body = _MAGIC + nonce + encrypted
            if files + 1 > self._max_frames or total + len(body) > self._max_bytes:
                raise ResourceExhausted("The encrypted output spool is full.")
            temp = self._root / f".tmp-{secrets.token_hex(16)}"
            flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
            if hasattr(os, "O_NOFOLLOW"):
                flags |= os.O_NOFOLLOW
            descriptor = os.open(temp, flags, 0o600)
            try:
                view = memoryview(body)
                while view:
                    written = os.write(descriptor, view)
                    view = view[written:]
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
            try:
                os.link(temp, path, follow_symlinks=False)
                self._fsync_directory()
            except FileExistsError:
                existing = self._read(path, sequence)
                if existing != payload:
                    raise InvalidInput("An output sequence cannot change after allocation.")
            finally:
                temp.unlink(missing_ok=True)
                self._fsync_directory()

    def pending(self) -> tuple[SpooledFrame, ...]:
        with self._lock:
            frames: list[SpooledFrame] = []
            for path in self._paths():
                sequence = int(path.stem)
                frames.append(SpooledFrame(sequence, self._read(path, sequence)))
            return tuple(frames)

    def replace_exact(self, sequence: int, expected: bytes, replacement: bytes) -> None:
        """Atomically replace one exact durable frame after server linearization.

        The caller must already hold an authenticated, frame-bound terminal
        winner response. This compare-and-swap never creates a delete/create
        gap: after any crash, either the original or replacement ciphertext
        remains.
        """

        if sequence < 1 or sequence > _MAX_SEQUENCE:
            raise InvalidInput("Output sequence must be positive.")
        if len(replacement) > self._max_frame_bytes:
            raise ResourceExhausted("The replacement output frame exceeds the spool frame limit.")
        with self._lock:
            path = self._path(sequence)
            if not path.exists() or self._read(path, sequence) != expected:
                raise InvalidInput("The output spool changed before terminal replacement.")

            nonce = os.urandom(_NONCE_BYTES)
            encrypted = self._cipher.encrypt(nonce, replacement, self._aad(sequence))
            body = _MAGIC + nonce + encrypted
            files, total = self._usage()
            if files > self._max_frames or total - path.stat().st_size + len(body) > self._max_bytes:
                raise ResourceExhausted("The encrypted output spool is full.")

            temp = self._root / f".tmp-{secrets.token_hex(16)}"
            flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
            if hasattr(os, "O_NOFOLLOW"):
                flags |= os.O_NOFOLLOW
            descriptor = os.open(temp, flags, 0o600)
            try:
                view = memoryview(body)
                while view:
                    written = os.write(descriptor, view)
                    view = view[written:]
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
            try:
                os.replace(temp, path)
                self._fsync_directory()
            finally:
                temp.unlink(missing_ok=True)
                self._fsync_directory()

    def acknowledge_through(self, sequence: int) -> None:
        with self._lock:
            changed = False
            for path in self._paths():
                if int(path.stem) <= sequence:
                    path.unlink()
                    changed = True
            if changed:
                self._fsync_directory()

    def _path(self, sequence: int) -> Path:
        return self._root / f"{sequence:020d}.frame"

    def _paths(self) -> list[Path]:
        paths: list[Path] = []
        for path in self._root.iterdir():
            if path.is_symlink() or not path.is_file() or len(path.stem) != 20 or path.suffix != ".frame":
                raise InvalidInput("The output spool contains an unexpected entry.")
            try:
                int(path.stem)
            except ValueError as exc:
                raise InvalidInput("The output spool contains an unexpected entry.") from exc
            paths.append(path)
        paths.sort()
        return paths

    def _usage(self) -> tuple[int, int]:
        paths = self._paths()
        return len(paths), sum(path.stat().st_size for path in paths)

    def _read(self, path: Path, sequence: int) -> bytes:
        flags = os.O_RDONLY
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        descriptor = os.open(path, flags)
        try:
            size = os.fstat(descriptor).st_size
            if size > self._max_frame_bytes + len(_MAGIC) + _NONCE_BYTES + 16:
                raise ResourceExhausted("The encrypted spool entry exceeds its approved limit.")
            body = bytearray()
            while len(body) < size:
                chunk = os.read(descriptor, min(64 * 1024, size - len(body)))
                if not chunk:
                    break
                body.extend(chunk)
        finally:
            os.close(descriptor)
        if not body.startswith(_MAGIC) or len(body) < len(_MAGIC) + _NONCE_BYTES + 16:
            raise InvalidInput("The encrypted output spool is corrupt.")
        nonce_start = len(_MAGIC)
        nonce = bytes(body[nonce_start : nonce_start + _NONCE_BYTES])
        ciphertext = bytes(body[nonce_start + _NONCE_BYTES :])
        try:
            return self._cipher.decrypt(nonce, ciphertext, self._aad(sequence))
        except Exception as exc:
            raise InvalidInput("The encrypted output spool is corrupt.") from exc

    def _aad(self, sequence: int) -> bytes:
        return self._stream_aad + b"\x00" + sequence.to_bytes(8, "big")

    def _fsync_directory(self) -> None:
        descriptor = os.open(self._root, os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)

    def _clean_incomplete_temps(self) -> None:
        changed = False
        for path in self._root.iterdir():
            if not _TEMP_NAME.fullmatch(path.name):
                continue
            info = path.lstat()
            if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
                raise InvalidInput("The output spool contains an unsafe temporary entry.")
            path.unlink()
            changed = True
        if changed:
            self._fsync_directory()
