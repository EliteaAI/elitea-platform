from __future__ import annotations

import subprocess
import sys
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


if __name__ == "__main__":
    unittest.main()
