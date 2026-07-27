#!/usr/bin/env python3
"""Run one command under a process-group deadline without leaking its arguments."""

from __future__ import annotations

import os
import signal
import subprocess
import sys


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
        return process.wait(timeout=timeout_seconds)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGTERM)
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()
        return 124


if __name__ == "__main__":
    raise SystemExit(main())
