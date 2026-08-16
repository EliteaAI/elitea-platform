"""The pylon-indexer half of the centry vault round trip. Issue #418.

This runs INSIDE the pylon base image, the same image
services/pylon-indexer/Containerfile builds on. It is the other service in the
round trip: it derives its master key the way pylon-indexer really derives it,
and it reads and writes centry vault rows the way centry's database secret
engine really does.

WHY THE KEY IS DERIVED HERE AND NOT PASSED IN. The defect issue #418 reports is
a key MISMATCH between two services. A test that hands both sides the same key
cannot see a mismatch — it proves only that Fernet is symmetric. So this script
takes the repository's real services/pylon-indexer/configs/shared.yml, expands
it with pylon's own expander (pylon.core.tools.config.env_vars_expansion, the
function pylon runs on that file's bytes before the YAML parse), and reads
`settings.secrets_master_key` out of the result. A committed default, a second
key source, or a config the parse drops all show up as a different key here,
and the round trip then fails.

  `${VAR:default}` is pylon's syntax. The shell form `${VAR:-default}` is not:
  pylon keeps the "-" and makes it the first character of the default.

WHAT A ROW LOOKS LIKE (legacy/plugins/shared/tools/secret_engines/database.py,
_write_key / _write):

    key  = Fernet.generate_key()
    row  = key                            # no master key
    row  = Fernet(master).encrypt(key)    # with a master key
    data = Fernet(key).encrypt(json.dumps(vault))

The script proves it implements that format before it does anything else: the
`selfcheck` step opens testdata/centry/vault-key-format.json, which was written
by Python, not by any code in this round trip.

It talks over stdin and stdout in JSON. It never touches a database — the Go
half owns every row. It never prints a key.

Steps:
  selfcheck            check this file's format against the shared fixture
  masterkey            report the derived key's fingerprint, never the key
  write                stdin {"vault": {...}} -> stdout {"key_row", "data_row"}
  read                 stdin {"key_row", "data_row"} -> stdout {"vault": {...}}
"""

import base64
import hashlib
import json
import os
import pathlib
import sys

import yaml
from cryptography.fernet import Fernet

from pylon.core.tools.config import env_vars_expansion

CONFIG = pathlib.Path("/repo/services/pylon-indexer/configs/shared.yml")
FIXTURE = pathlib.Path("/repo/testdata/centry/vault-key-format.json")


def derive_master_key():
    """Return the master key pylon-indexer's `shared` plugin would hold.

    Mirrors legacy/plugins/shared/tools/config.py `load_settings`: a setting
    that is absent takes the schema default, which is None for
    SECRETS_MASTER_KEY; a setting that is present is coerced with str().
    Then secret_engines/database.py: master_key is None, or value.encode().
    """
    expanded = env_vars_expansion(CONFIG.read_bytes())
    settings = (yaml.load(expanded, Loader=yaml.SafeLoader) or {}).get("settings", {})
    if "secrets_master_key" not in settings:
        return None
    value = settings["secrets_master_key"]
    value = value if isinstance(value, str) else str(value)
    return value.encode()


def fingerprint(material):
    """A stable, non-reversible name for a key, so a mismatch is reportable."""
    if material is None:
        return "none"
    return hashlib.sha256(material).hexdigest()[:16]


def selfcheck():
    fixture = json.loads(FIXTURE.read_text())
    master = fixture["master_key_env_value"].encode()
    project_key = Fernet(master).decrypt(fixture["secrets_key_row_wrapped"].encode())
    if project_key != fixture["secrets_key_row_unwrapped"].encode():
        raise SystemExit("selfcheck: unwrapping the fixture key row gave other bytes")
    plaintext = Fernet(project_key).decrypt(fixture["secrets_data_row"].encode())
    if plaintext.decode() != fixture["vault_plaintext"]:
        raise SystemExit("selfcheck: the fixture data row did not open")
    return {"ok": True}


def write(payload, master):
    project_key = Fernet.generate_key()
    key_row = project_key if master is None else Fernet(master).encrypt(project_key)
    data_row = Fernet(project_key).encrypt(json.dumps(payload["vault"]).encode())
    return {"key_row": key_row.decode(), "data_row": data_row.decode()}


def read(payload, master):
    key_row = payload["key_row"].encode()
    project_key = key_row if master is None else Fernet(master).decrypt(key_row)
    plaintext = Fernet(project_key).decrypt(payload["data_row"].encode())
    return {"vault": json.loads(plaintext.decode())}


def main():
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    step = sys.argv[1]

    if step == "selfcheck":
        print(json.dumps(selfcheck()))
        return

    master = derive_master_key()
    if master is not None:
        # Same rule the container entrypoint applies, and the same rule Fernet
        # applies. A malformed key must be named, not hidden inside a decrypt
        # failure that reads like a data fault.
        try:
            decoded = base64.urlsafe_b64decode(master)
        except Exception:
            raise SystemExit("the derived master key is not URL-safe base64")
        if len(decoded) != 32:
            raise SystemExit(
                "the derived master key decodes to %d bytes; Fernet needs 32"
                % len(decoded)
            )

    if step == "masterkey":
        print(
            json.dumps(
                {
                    "fingerprint": fingerprint(master),
                    "env_fingerprint": fingerprint(
                        os.environ["SECRETS_MASTER_KEY"].encode()
                        if os.environ.get("SECRETS_MASTER_KEY")
                        else None
                    ),
                }
            )
        )
        return

    payload = json.loads(sys.stdin.read())
    if step == "write":
        print(json.dumps(write(payload, master)))
    elif step == "read":
        print(json.dumps(read(payload, master)))
    else:
        raise SystemExit("unknown step: %s" % step)


if __name__ == "__main__":
    main()
