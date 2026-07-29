from __future__ import annotations

import os
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("run_with_timeout.py")


class RunWithTimeoutTest(unittest.TestCase):
    def _wait_for_owner(self, path: Path) -> int:
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            if path.exists():
                value = int(path.read_text().strip())
                self.assertGreater(value, 1)
                self.assertNotEqual(value, os.getpgrp())
                return value
            time.sleep(0.02)
        self.fail("timeout wrapper did not publish its owned process group")

    def test_returns_child_status(self) -> None:
        result = subprocess.run(
            [sys.executable, str(SCRIPT), "5", sys.executable, "-c", "raise SystemExit(7)"],
            check=False,
        )
        self.assertEqual(result.returncode, 7)

    def test_returns_124_after_deadline(self) -> None:
        result = subprocess.run(
            [sys.executable, str(SCRIPT), "1", sys.executable, "-c", "import time; time.sleep(30)"],
            check=False,
        )
        self.assertEqual(result.returncode, 124)

    def test_forwards_sigterm_and_does_not_orphan_child_group(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            marker = Path(directory) / "orphaned"
            grandchild = (
                "import pathlib,time;"
                f"time.sleep(1);pathlib.Path({str(marker)!r}).write_text('orphaned')"
            )
            child = (
                "import subprocess,sys,time;"
                f"subprocess.Popen([sys.executable,'-c',{grandchild!r}]);"
                "time.sleep(30)"
            )
            wrapper = subprocess.Popen(
                [sys.executable, str(SCRIPT), "30", sys.executable, "-c", child]
            )
            time.sleep(0.3)
            wrapper.terminate()
            self.assertEqual(wrapper.wait(timeout=5), 128 + 15)
            time.sleep(1.2)
            self.assertFalse(marker.exists())

    def test_owner_file_allows_cleanup_after_wrapper_sigkill(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            owner = Path(directory) / "owner"
            marker = Path(directory) / "orphaned"
            grandchild = (
                "import pathlib,time;"
                f"time.sleep(1);pathlib.Path({str(marker)!r}).write_text('orphaned')"
            )
            child = (
                "import subprocess,sys,time;"
                f"subprocess.Popen([sys.executable,'-c',{grandchild!r}]);"
                "time.sleep(30)"
            )
            environment = dict(os.environ)
            environment["ELITEA_TIMEOUT_OWNER_FILE"] = str(owner)
            wrapper = subprocess.Popen(
                [sys.executable, str(SCRIPT), "30", sys.executable, "-c", child],
                env=environment,
            )
            process_group = self._wait_for_owner(owner)
            wrapper.kill()
            wrapper.wait(timeout=5)
            os.killpg(process_group, signal.SIGTERM)
            time.sleep(0.1)
            try:
                os.killpg(process_group, signal.SIGKILL)
            except ProcessLookupError:
                pass
            time.sleep(1.1)
            self.assertFalse(marker.exists())
            self.assertTrue(owner.exists())


if __name__ == "__main__":
    unittest.main()
