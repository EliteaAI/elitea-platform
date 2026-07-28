from __future__ import annotations

import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("run_with_timeout.py")


class RunWithTimeoutTest(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
