#!/usr/bin/env bash
#
# The legacy v0 provider schema documents in libs/provider/legacy/v0/ are
# byte-identical to what the conformance bundle manifest declares.
#
# WHY THESE FILES ARE IN THE REPOSITORY AT ALL. They are the v0 provider
# contract: the descriptor schema a legacy provider publishes, and the SPI
# document and its schema. Until now they existed only in a legacy plugin
# checkout that CI cannot reach, which meant the contract this platform admits
# providers against had no copy anyone could read or diff. Vendoring them makes
# the contract a published artifact — which is the whole point of P1.0 — and it
# only stays true if nothing edits them.
#
# WHY A HASH GATE AND NOT A REVIEW. These are not source files that improve
# with editing. They describe what LEGACY providers already emit, in the field,
# today. A change here does not change any provider; it changes what this
# platform believes providers emit, and the two then disagree with nothing
# reporting it. The manifest's SHA-256s are what make that unrepresentable.
#
# The manifest also records the source revision, so re-deriving them is a
# matter of checking out that revision rather than guesswork.
#
# NOTE ON THE MANIFEST'S `path` FIELD: it reads elitea_core/data/..., where
# `elitea_core` is the REPOSITORY name and not a directory inside it. In a
# legacy checkout the file is at <repo>/data/... — verified while writing this,
# because the first attempt to find them used the literal path and found
# nothing.
set -euo pipefail

cd "$(dirname "$0")/../.."

MANIFEST=conformance/provider/fixtures/deepwiki/descriptor/legacy-v0/bundle.manifest.json

if [ ! -f "$MANIFEST" ]; then
  echo "FAIL: $MANIFEST is missing. It is the only record of what these files" >&2
  echo "      should contain, so without it this check cannot run — and a check" >&2
  echo "      that cannot run must not report success." >&2
  exit 1
fi

python3 - "$MANIFEST" <<'PY'
import hashlib
import json
import pathlib
import sys

manifest = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
documents = manifest.get("legacy_v0_schema_documents") or []

# A FLOOR, because an emptied or reshaped list makes the loop below assert
# nothing and this script would print OK over an unchecked directory.
if len(documents) < 3:
    print(f"FAIL: the manifest declares {len(documents)} legacy document(s); "
          "at least 3 are expected. An emptied list would make this gate pass "
          "while checking nothing.", file=sys.stderr)
    raise SystemExit(1)

failures = 0
checked = set()
for document in documents:
    target = pathlib.Path(document["target"])
    checked.add(target)
    if not target.is_file():
        print(f"FAIL: {target} is declared by the manifest and is not present.",
              file=sys.stderr)
        failures += 1
        continue
    raw = target.read_bytes()
    if len(raw) != document["bytes"]:
        print(f"FAIL: {target} is {len(raw)} bytes, manifest says "
              f"{document['bytes']}.", file=sys.stderr)
        failures += 1
        continue
    digest = hashlib.sha256(raw).hexdigest()
    if digest != document["sha256"]:
        print(f"FAIL: {target} has digest {digest}, manifest says "
              f"{document['sha256']}. These files describe what legacy "
              "providers already emit; editing one makes this platform "
              "disagree with the field.", file=sys.stderr)
        failures += 1
        continue
    print(f"  ok: {target}")

# The other direction: a file in the bundle directory that the manifest does
# not declare. An undeclared document is one nothing verifies, and it reads to
# the next person exactly like a verified one.
bundle = pathlib.Path("libs/provider/legacy/v0")
if bundle.is_dir():
    for present in sorted(bundle.iterdir()):
        if present.is_file() and present not in checked:
            print(f"FAIL: {present} is in the bundle and is not declared by "
                  "the manifest, so nothing verifies it.", file=sys.stderr)
            failures += 1

if failures:
    print(f"\n{failures} problem(s) with the legacy v0 bundle.", file=sys.stderr)
    raise SystemExit(1)
print(f"\nOK: {len(documents)} legacy v0 document(s) match the manifest.")
PY
