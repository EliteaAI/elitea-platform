"""Fail a CI run in which a named contract gate never reported a pass.

test_sdk_budget_contract.py checks its own SOURCE for the tests it declares in
EXPECTED_TESTS. That check cannot see whether pytest actually RAN them: a skip
marker, an xfail, `-k`, `--deselect` and a collection error all leave the `def`
in place. A module-level `pytestmark = pytest.mark.skip` makes the floor skip
itself, and the run still exits 0.

So count what pytest REPORTED. Under CI, a name in EXPECTED_TESTS that never
produced a passing call phase fails the session.

This is CI-only ON PURPOSE. A developer with no SDK checkout legitimately skips
five of the six tests, and a blanket no-skip rule would break every local run.
"""

from __future__ import annotations

import os

_passed: set[str] = set()


def _ci() -> bool:
    return os.environ.get("CI", "").strip().lower() not in ("", "0", "false", "no")


def pytest_runtest_logreport(report) -> None:
    # `wasxfail` marks an XPASS, which is not a pass for our purposes: the test
    # was declared expected-to-fail, so its assertions are not a guarantee.
    if report.when == "call" and report.passed and not getattr(report, "wasxfail", None):
        _passed.add(report.nodeid.rpartition("::")[2].partition("[")[0])


def pytest_sessionfinish(session, exitstatus) -> None:
    if not _ci():
        return
    try:
        from test_sdk_budget_contract import EXPECTED_TESTS
    except Exception:
        # The module could not be imported at all. That is already a collection
        # error, which fails the run on its own; do not mask it with a second.
        return
    silent = sorted(EXPECTED_TESTS - _passed)
    if silent:
        session.exitstatus = 1
        print(
            "::error::these contract gates were declared but never reported a "
            f"pass: {silent}. A skip, an xfail or a deselect is not a pass, and "
            "a source-level floor cannot tell the difference."
        )
