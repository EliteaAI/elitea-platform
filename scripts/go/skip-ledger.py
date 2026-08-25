#!/usr/bin/env python3
"""Read `go test -json` on stdin, print a plain `go test` log, and record every
skipped test — with its reason — in a ledger file.

WHY THIS EXISTS (#423)

`go test ./...` prints `ok` for a package whose tests all called `t.Skip`.
Without `-v` the skip never reaches the log, so a job that skips eighteen
suites and a job that runs them look exactly the same. Eighteen suites that
never run are eighteen suites whose green tells you nothing.

`-json` carries a `skip` action per test, so this filter can name every skip
while keeping the human log the size it was before. It is a filter, not a
gate: `scripts/go/workspace-run.sh` reads the ledger and decides.

Log rules — this reproduces what non-verbose `go test ./...` prints:

  * a package that PASSES prints only its result line — `ok  pkg 1.2s` or
    `?   pkg [no test files]`. `go test` in list mode hides the test binary's
    own chatter (`PASS`, a bare `coverage:` line) for a package that passed,
    and so does this;
  * a package that FAILS prints every line it produced, `=== RUN` included,
    because a failure is the moment you want the whole transcript;
  * output that belongs to no package (build errors, toolchain notices)
    always prints.

Every package's lines are held until that package reports its result, so one
package's output never interleaves with another's.

Ledger format — tab separated, appended, `ELITEA_SKIP_LEDGER` names the file:

    SKIP<TAB><package><TAB><test><TAB><reason>
    TOTAL<TAB><run><TAB><skip><TAB><fail>

Exit status is 0 unless stdin cannot be read. The `go test` status travels
through the pipeline (the caller sets `-o pipefail`), and the skip verdict
belongs to the caller.
"""

import json
import os
import sys

# A skip reason longer than this is truncated in the ledger. The full text is
# still in the transcript of a failing package; the ledger wants one readable
# line per skip.
REASON_LIMIT = 200


def skip_reason(lines: list[str]) -> str:
    """Pick the `t.Skip` message out of a test's output lines.

    `go test` prints the message as `    file.go:23: set FOO to run ...` just
    before `--- SKIP:`. Take the last such line: a helper may log first.
    """
    for line in reversed(lines):
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith("=== ") or stripped.startswith("--- "):
            continue
        _, separator, message = stripped.partition(": ")
        chosen = message if separator else stripped
        chosen = chosen.strip().replace("\t", " ")
        if not chosen:
            continue
        if len(chosen) > REASON_LIMIT:
            chosen = chosen[: REASON_LIMIT - 3] + "..."
        return chosen
    return "(no reason printed)"


def main() -> int:
    ledger_path = os.environ.get("ELITEA_SKIP_LEDGER", "")

    # Output events interleave across packages, so buffer per package and
    # flush when the package reports its own result.
    package_lines: dict[str, list[str]] = {}
    test_lines: dict[tuple[str, str], list[str]] = {}
    failed: set[str] = set()
    skips: list[tuple[str, str, str]] = []
    run_count = 0
    skip_count = 0
    fail_count = 0

    for raw in sys.stdin:
        raw = raw.rstrip("\n")
        if not raw:
            continue
        try:
            event = json.loads(raw)
        except (ValueError, TypeError):
            # Not an event. `go` writes a few things outside the stream (a
            # toolchain download, a hard crash). Passing them through is the
            # only safe choice — swallowing them would hide a real message.
            print(raw, flush=True)
            continue
        if not isinstance(event, dict):
            print(raw, flush=True)
            continue

        action = event.get("Action", "")
        package = event.get("Package", "")
        test = event.get("Test", "")
        output = event.get("Output", "")

        # `build-output` carries the COMPILER's message, and it is keyed by
        # ImportPath, not Package. An earlier draft handled `output` alone, so
        # a whole module of `[build failed]` lines arrived with no reason
        # attached anywhere. Print build output the moment it arrives.
        if action == "build-output" or (action == "output" and not package):
            sys.stdout.write(output)
            sys.stdout.flush()
            continue

        if action == "output":
            if test:
                test_lines.setdefault((package, test), []).append(output)
            package_lines.setdefault(package, []).append(output)
            continue

        if action in ("fail", "build-fail"):
            fail_count += 1
            if package:
                failed.add(package)
        elif action == "run" and test:
            run_count += 1
        elif action == "skip" and test:
            skip_count += 1
            skips.append((package, test, skip_reason(test_lines.get((package, test), []))))

        if test:
            if action in ("pass", "fail", "skip"):
                test_lines.pop((package, test), None)
            continue

        if action in ("pass", "fail", "skip") and package:
            lines = package_lines.pop(package, [])
            if package in failed:
                # The whole transcript, `=== RUN` included.
                for buffered in lines:
                    sys.stdout.write(buffered)
            else:
                # What non-verbose `go test ./...` prints for a package that
                # passed: its result line only. The binary's own `PASS` and
                # bare `coverage:` lines are chatter that `go` hides, and a
                # log nobody reads hides the skip ledger too.
                for buffered in lines:
                    if buffered.startswith(("ok  ", "ok\t", "?   ", "?\t", "FAIL")):
                        sys.stdout.write(buffered)
            sys.stdout.flush()

    # Anything still buffered belongs to a package that never reported a
    # result. Print it rather than drop it: a lost transcript is how a real
    # failure becomes invisible.
    for package in sorted(package_lines):
        for buffered in package_lines[package]:
            sys.stdout.write(buffered)
    sys.stdout.flush()

    if ledger_path:
        with open(ledger_path, "a", encoding="utf-8") as ledger:
            for package, test, reason in skips:
                ledger.write(f"SKIP\t{package}\t{test}\t{reason}\n")
            ledger.write(f"TOTAL\t{run_count}\t{skip_count}\t{fail_count}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
