#!/usr/bin/env python3
"""Run one command under a process-group deadline without leaking its arguments."""

from __future__ import annotations

import os
import signal
import subprocess
import sys
import time


_TERMINATION_GRACE_SECONDS = 10.0
_OWNER_FILE_ENV = "ELITEA_TIMEOUT_OWNER_FILE"


def _signal_process_group(process: subprocess.Popen[bytes], signum: int) -> None:
    try:
        os.killpg(process.pid, signum)
    except ProcessLookupError:
        pass


def _terminate_process_group(process: subprocess.Popen[bytes]) -> None:
    _signal_process_group(process, signal.SIGTERM)
    try:
        process.wait(timeout=_TERMINATION_GRACE_SECONDS)
    except subprocess.TimeoutExpired:
        pass
    # The process-group leader can exit before one of its descendants. Always
    # send the final signal to the original group, even after wait() returns.
    _signal_process_group(process, signal.SIGKILL)
    process.wait()


def _create_owner_file(process_group: int) -> str | None:
    path = os.environ.get(_OWNER_FILE_ENV)
    if path is None:
        return None
    if not os.path.isabs(path) or "\x00" in path:
        raise OSError("owner file must be absolute")
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    flags |= getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(path, flags, 0o600)
    try:
        os.write(descriptor, f"{process_group}\n".encode("ascii"))
    finally:
        os.close(descriptor)
    return path


def _remove_owner_file(path: str | None) -> None:
    if path is None:
        return
    try:
        os.unlink(path)
    except FileNotFoundError:
        pass


def main() -> int:
    if len(sys.argv) < 3:
        return 2
    try:
        timeout_seconds = int(sys.argv[1])
    except ValueError:
        return 2
    if timeout_seconds < 1:
        return 2

    process = subprocess.Popen(sys.argv[2:], start_new_session=True)
    try:
        owner_file = _create_owner_file(process.pid)
    except OSError:
        _terminate_process_group(process)
        return 2
    received_signal: int | None = None

    def forward_signal(signum: int, _frame: object) -> None:
        nonlocal received_signal
        received_signal = signum
        _signal_process_group(process, signum)

    previous_handlers = {
        signum: signal.signal(signum, forward_signal)
        for signum in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP)
    }
    try:
        deadline = time.monotonic() + timeout_seconds
        while True:
            if received_signal is not None:
                _terminate_process_group(process)
                return 128 + received_signal
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                _terminate_process_group(process)
                return 124
            try:
                child_status = process.wait(timeout=min(remaining, 0.2))
                if received_signal is not None:
                    _terminate_process_group(process)
                    return 128 + received_signal
                return child_status
            except subprocess.TimeoutExpired:
                continue
    finally:
        _remove_owner_file(owner_file)
        for signum, previous_handler in previous_handlers.items():
            signal.signal(signum, previous_handler)


if __name__ == "__main__":
    raise SystemExit(main())
