#!/usr/bin/env python3
"""Report every test the run skipped, and fail on a skip nobody declared.

WHY THIS EXISTS (#423)

A run that skips eighteen suites and prints `ok` is the defect. The ledger
that `scripts/go/skip-ledger.py` writes names each skip; this script turns
that ledger into a report, and — when `ELITEA_REQUIRE_DECLARED_SKIPS=1` — into
a gate.

Usage:
    skip-gate.py <ledger.tsv> <declared-skips.txt>

The declaration file holds one skip per line:

    <package><TAB><test><TAB><reason it cannot run here>

`<test>` may be `*` for a whole package, or end in `/*` to cover a test and
its subtests. The reason is mandatory: a declaration with no reason is the
same silent skip with a longer paper trail.

Verdicts:

  * a skip that no line declares is UNDECLARED. With
    `ELITEA_REQUIRE_DECLARED_SKIPS=1` that fails the run.
  * a ledger holding no test at all fails unconditionally. "The filter never
    saw a test" and "every test passed" must never read the same.
  * a declaration that matched nothing is printed as STALE. It does not fail:
    a targeted `-run` invocation legitimately matches nothing.
"""

import os
import sys


def load_declarations(path: str) -> list[tuple[str, str, str]]:
    declarations: list[tuple[str, str, str]] = []
    with open(path, encoding="utf-8") as handle:
        for number, line in enumerate(handle, start=1):
            line = line.rstrip("\n")
            if not line.strip() or line.lstrip().startswith("#"):
                continue
            fields = line.split("\t")
            fields = [field.strip() for field in fields if field.strip()]
            if len(fields) < 3:
                sys.exit(
                    f"{path}:{number}: expected "
                    "<package><TAB><test><TAB><reason>, got: " + line
                )
            package, test, reason = fields[0], fields[1], "\t".join(fields[2:])
            declarations.append((package, test, reason))
    return declarations


def matches(declaration: tuple[str, str, str], package: str, test: str) -> bool:
    declared_package, declared_test, _ = declaration
    if declared_package != package:
        return False
    if declared_test == "*":
        return True
    if declared_test.endswith("/*"):
        stem = declared_test[:-2]
        return test == stem or test.startswith(stem + "/")
    return declared_test == test


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        sys.exit("usage: skip-gate.py <ledger.tsv> <declared-skips.txt>")
    ledger_path, declarations_path = argv[1], argv[2]

    declarations = load_declarations(declarations_path)
    used = [False] * len(declarations)

    skips: list[tuple[str, str, str]] = []
    run_total = 0
    skip_total = 0
    fail_total = 0
    saw_total_line = False

    if not os.path.exists(ledger_path):
        print(
            "skip-gate: no ledger at " + ledger_path
            + " — the test run produced no record, so its result cannot be trusted",
            file=sys.stderr,
        )
        return 1

    with open(ledger_path, encoding="utf-8") as handle:
        for line in handle:
            fields = line.rstrip("\n").split("\t")
            if fields[0] == "SKIP" and len(fields) >= 3:
                reason = fields[3] if len(fields) > 3 else ""
                skips.append((fields[1], fields[2], reason))
            elif fields[0] == "TOTAL" and len(fields) >= 4:
                saw_total_line = True
                run_total += int(fields[1])
                skip_total += int(fields[2])
                fail_total += int(fields[3])

    if not saw_total_line:
        print(
            "skip-gate: the ledger holds no TOTAL line — the filter did not "
            "finish, so the run's result cannot be trusted",
            file=sys.stderr,
        )
        return 1
    if run_total == 0:
        print(
            "skip-gate: the ledger recorded 0 tests. An empty run and a "
            "passing run must never read the same; refusing to report success.",
            file=sys.stderr,
        )
        return 1

    print()
    print(
        f"workspace-run skip ledger: {skip_total} skipped, "
        f"{run_total - skip_total} executed, {run_total} started"
    )

    undeclared: list[tuple[str, str, str]] = []
    declared_count = 0
    for package, test, reason in skips:
        index = next(
            (i for i, d in enumerate(declarations) if matches(d, package, test)),
            None,
        )
        if index is None:
            undeclared.append((package, test, reason))
            continue
        used[index] = True
        declared_count += 1

    if declared_count:
        print(f"  DECLARED ({declared_count}) — cannot run here, and says why:")
        shown: set[tuple[str, str]] = set()
        for package, test, reason in skips:
            index = next(
                (i for i, d in enumerate(declarations) if matches(d, package, test)),
                None,
            )
            if index is None:
                continue
            key = (declarations[index][0], declarations[index][1])
            if key in shown:
                continue
            shown.add(key)
            print(f"    {key[0]}\t{key[1]}\n      {declarations[index][2]}")

    stale = [d for d, was_used in zip(declarations, used) if not was_used]
    if stale:
        print(f"  STALE ({len(stale)}) — declared, but this run did not skip them:")
        for package, test, _ in stale:
            print(f"    {package}\t{test}")

    if undeclared:
        print(f"  UNDECLARED ({len(undeclared)}) — skipped with nothing to say why:")
        for package, test, reason in undeclared:
            print(f"    {package}\t{test}\n      {reason}")

    required = os.environ.get("ELITEA_REQUIRE_DECLARED_SKIPS", "") == "1"
    if undeclared and required:
        print()
        print(
            f"skip-gate: {len(undeclared)} test(s) skipped without a declaration. "
            "Give the run what the test needs, or declare the skip with its "
            "reason in " + declarations_path + ". A suite that skips itself in "
            "silence reports nothing (#423).",
            file=sys.stderr,
        )
        return 1
    if undeclared:
        print(
            "  (set ELITEA_REQUIRE_DECLARED_SKIPS=1 to make an undeclared skip "
            "fail the run, as CI does)"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
