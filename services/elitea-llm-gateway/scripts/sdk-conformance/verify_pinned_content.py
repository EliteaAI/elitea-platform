#!/usr/bin/env python3
"""Verify that an SDK checkout holds the CONTENT the gateway pin names.

ISSUE #567. Both elitea-sdk compatibility tiers identified the checkout by
``git rev-parse HEAD`` and stopped there. That answers WHICH commit is checked
out, not WHAT the working tree holds, and it fails in two ways:

  1. A DIRTY tree keeps the pinned HEAD, so uncommitted SDK edits are invisible.
  2. ``git rev-parse`` walks UP to an enclosing repository, so a hand-authored
     directory inside a pinned clone reports the pinned revision too.

Either one lets an operator mint a fresh pin from a green run that measured
other bytes. ``internal/sdkpin/sdk-pin.json`` therefore records the sha256 of
every SDK file the gates read, and this script compares those digests with the
checkout.

THE CHECK IS SCOPED TO THE PINNED FILES ON PURPOSE. ``.github/workflows/
ci-python.yml`` applies two patch revisions with ``git cherry-pick --no-commit``,
so the CI tree is deliberately dirty. A whole-tree cleanliness check would fail
every CI run. Those patches touch ``elitea_sdk/runtime/toolkits/mcp.py``,
``elitea_sdk/runtime/utils/mcp_adapter.py`` and ``tests/`` only, and none of
them is a file the gates read.

It also holds the pin and the tier 2 gate together: every file
``conformance.py`` names in PROVENANCE_FILES must be pinned here. A gate input
nobody pinned is a gate input nobody measured.

Run it directly:

    python3 verify_pinned_content.py \
      --pin ../../internal/sdkpin/sdk-pin.json \
      --sdk-source-root /path/to/elitea-sdk \
      --gate conformance.py

It exits 0 when every digest matches, and 1 with the difference otherwise.
"""

from __future__ import annotations

import argparse
import ast
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Dict, List, NoReturn

SHA256_DIGEST = re.compile(r"^[0-9a-f]{64}$")

# The name conformance.py gives the SDK files it reads.
GATE_FILE_LIST = "PROVENANCE_FILES"


def abort(message: str) -> NoReturn:
    print("ERROR: " + message, file=sys.stderr)
    raise SystemExit(1)


def pinned_contents(pin_file: Path) -> Dict[str, str]:
    """Read the digest the pin records for each SDK file the gates read.

    An absent, empty or malformed list ABORTS. A gate with nothing to hash
    passes for every tree, dirty or not, which is the hole this list closes.
    """
    try:
        pin = json.loads(pin_file.read_text(encoding="utf-8"))
    except OSError as error:
        abort("cannot read the gateway SDK pin {0}: {1}".format(pin_file, error))
    except ValueError as error:
        abort("{0} does not parse as JSON: {1}".format(pin_file, error))

    entries = (pin.get("verified_against") or {}).get("contents")
    if not isinstance(entries, list) or not entries:
        abort(
            "{0} carries no verified_against.contents.\n"
            "       This gate must compare the CONTENT of the SDK files it reads, not\n"
            "       only the revision: a dirty checkout keeps the pinned revision and\n"
            "       would read as pinned (#567).".format(pin_file)
        )

    digests: Dict[str, str] = {}
    for entry in entries:
        path = str((entry or {}).get("path") or "")
        digest = str((entry or {}).get("sha256") or "")
        if not path or not SHA256_DIGEST.match(digest):
            abort(
                "{0} carries the contents entry {1!r}, which is not a path with a\n"
                "       64-character lowercase sha256.".format(pin_file, entry)
            )
        if path in digests:
            abort(
                "{0} lists {1} twice; two digests for one file cannot both "
                "hold.".format(pin_file, path)
            )
        digests[path] = digest
    return digests


def _string_parts(node: ast.AST) -> List[str]:
    """Give every string constant under a node, in SOURCE order.

    ``ast.walk`` is breadth-first, so it returns the segments of
    ``Path("a") / "b" / "c"`` in the wrong order. This walks the children in
    order and reports each node after its own children, which is the order the
    operands are written in.
    """
    parts: List[str] = []
    for child in ast.iter_child_nodes(node):
        parts.extend(_string_parts(child))
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        parts.append(node.value)
    return parts


def gate_files(gate_file: Path) -> List[str]:
    """Read the SDK files conformance.py declares it reads.

    The list is read from the SOURCE with ast, never imported: importing
    conformance.py needs the installed SDK, and this check must run before the
    harness starts.

    An unreadable list ABORTS rather than returning an empty one. An empty list
    would make the comparison in main() trivially true, which is the shape this
    repository keeps mistaking for a pass.
    """
    try:
        tree = ast.parse(gate_file.read_text(encoding="utf-8"))
    except (OSError, SyntaxError) as error:
        abort("cannot read {0}: {1}".format(gate_file, error))

    for node in tree.body:
        if not isinstance(node, ast.Assign):
            continue
        names = [t.id for t in node.targets if isinstance(t, ast.Name)]
        if GATE_FILE_LIST not in names:
            continue
        collected: List[str] = []
        for element in getattr(node.value, "elts", []):
            # Each element is `Path("elitea_sdk") / "runtime" / "<file>.py"`.
            # The string parts, in source order, are the path segments.
            segments = _string_parts(element)
            if not segments:
                abort(
                    "{0} declares a {1} entry this check cannot read".format(
                        gate_file, GATE_FILE_LIST
                    )
                )
            collected.append("/".join(segments))
        if not collected:
            abort(
                "{0} declares an empty {1}; the tier 2 gate would then verify the\n"
                "       provenance of no file at all.".format(gate_file, GATE_FILE_LIST)
            )
        return collected

    abort(
        "{0} declares no {1}. Either it was renamed — update this check in the same\n"
        "       change — or the tier 2 provenance check is gone.".format(
            gate_file, GATE_FILE_LIST
        )
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pin", required=True, help="path to sdk-pin.json")
    parser.add_argument(
        "--sdk-source-root", required=True, help="root of the SDK checkout to verify"
    )
    parser.add_argument(
        "--gate",
        required=False,
        help="path to conformance.py; its PROVENANCE_FILES must all be pinned",
    )
    args = parser.parse_args()

    pin_file = Path(args.pin)
    root = Path(args.sdk_source_root)
    pinned = pinned_contents(pin_file)

    if args.gate:
        declared = gate_files(Path(args.gate))
        unpinned = sorted(set(declared) - set(pinned))
        if unpinned:
            abort(
                "the tier 2 gate reads {0} and {1} does not state their content.\n"
                "       The run would measure bytes the pin never recorded.".format(
                    unpinned, pin_file.name
                )
            )

    failures = 0
    for relative in sorted(pinned):
        path = root / Path(relative)
        if not path.is_file():
            print(
                "ERROR: {0} pins the content of {1}, and it is not in the checkout.\n"
                "       {2}".format(pin_file.name, relative, path),
                file=sys.stderr,
            )
            failures += 1
            continue
        actual = hashlib.sha256(path.read_bytes()).hexdigest()
        if actual != pinned[relative]:
            print(
                "ERROR: the checkout holds the pinned revision, and {0} does NOT hold\n"
                "       the pinned content.\n"
                "         {1}\n"
                "           is        sha256 {2}\n"
                "           pinned as sha256 {3}".format(
                    relative, path, actual, pinned[relative]
                ),
                file=sys.stderr,
            )
            failures += 1
            continue
        print("   content ok: {0}".format(relative))

    if failures:
        print(
            "\nERROR: {0} pinned file(s) differ. A revision names which commit is checked\n"
            "       out. It says nothing about what the working tree holds, so an edited\n"
            "       or hand-authored file keeps the pinned revision and would otherwise\n"
            "       read as pinned. Restore the files, or — if the SDK moved on purpose —\n"
            "       re-run both compatibility gates and update the pin AFTER they "
            "pass.".format(failures),
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
