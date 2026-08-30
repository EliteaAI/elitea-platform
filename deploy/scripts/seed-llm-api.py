#!/usr/bin/env python3
"""Seed one project's LLM credential and model catalogue THROUGH THE PRODUCT API.

This replaces the hand-written INSERTs that `standalone-stack.sh seed-llm` used
to run against `p_{id}.configuration`. Read the head of that subcommand for what
each row is for; this file is about how they are now written.

WHY THE RAW INSERTS WERE A PROBLEM, beyond being ugly
-----------------------------------------------------
They asserted `status_ok = true`. The column is not a note an operator leaves —
it is the platform's own answer to "may a runtime use this row?", reached by
expanding the row's declared references and redeeming its hidden secrets
(internal/application/configurations/provider_admission.go). Writing it by hand
made a fresh install's seed structurally different from a credential a user
saves in the UI, so the two could drift and only the UI path would notice. The
seed also stored `api_key` straight into the column that
migrations/shared/0072 grants the project VIEWER role to read; the write route
seals a schema-declared secret into the project vault instead.

THE ONE THING THAT IS NOT OPTIONAL: `data.ai_credentials`
---------------------------------------------------------
A model row (section `llm`, `embedding`, `image_generation`, `asr`, `tts`) that
names NO credential is "unmanaged": admission declines to decide, and the
create route's INSERT stores `status_ok = false`. Every reader of a model row —
the gateway's `modelsSQL`, elitea-main's catalogue — selects `status_ok = true`,
so such a row is stored, listed, and never dispatched.

Measured on a running stack, project 1:

    CREATE MODEL (data.ai_credentials set)   201  "status_ok":true
    CREATE MODEL (no ai_credentials)         201  "status_ok":false

So every model row this file writes carries an `ai_credentials` link to the
credential written beside it. That is also what the product's own admin model
surface requires (internal/api/v2/configurations/global_models.go), and the
gateway uses the link to resolve the provider instead of guessing it from a
prefix in the model name.

AUTHENTICATION
--------------
A bearer PAT, exactly as a real operator's API client would send. `--token`
takes one verbatim — the shape an operator gets by minting a token in the UI.
Absent that, `--pat-uuid` + `--signing-key` re-sign an EXISTING active PAT row
with the deployment's own `auth-pat-signing-key`, which is what
deploy/scripts/chat-smoke.py already does. The claims are exactly
{uuid, expires}, mirroring authsvc.SignBaselinePAT.

The caller must hold `configurations.configuration.create` (and `.update`, for a
re-seed) in the target project. The project `admin` and `editor` roles do; a
global admin is NOT required, because these are project rows and not platform
ones.

Exit codes: 0 all rows written and admitted, 1 anything else.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import json
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

# The list page this seeder reads to decide create-vs-update. The route clamps
# `limit`, so this is a request for "one page big enough to hold a seeded
# project's rows", not a promise about the answer: `find_by_title` re-reads with
# an offset until it runs out of rows, so a project with more configurations
# than one page still resolves.
PAGE = 100


class SeedError(RuntimeError):
    """A step did not do what it was asked to do."""


def mint_pat(uuid: str, signing_key: bytes) -> str:
    """Rebuild the current-baseline HS512 bearer for an EXISTING active PAT.

    It creates nothing. `auth_core__token` must already hold an active row with
    this uuid — the issuer re-signs, it does not mint (see the PAT block in
    standalone-stack.sh `seed`).
    """

    def segment(raw: bytes) -> str:
        return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()

    header = segment(json.dumps({"alg": "HS512", "typ": "JWT"}, separators=(",", ":")).encode())
    payload = segment(json.dumps({"uuid": uuid, "expires": None}, separators=(",", ":")).encode())
    signature = segment(hmac.new(signing_key, f"{header}.{payload}".encode(), hashlib.sha512).digest())
    return f"{header}.{payload}.{signature}"


class Client:
    def __init__(self, base: str, token: str, ca: str | None, timeout: int) -> None:
        self.base = base.rstrip("/")
        self.token = token
        self.timeout = timeout
        self.context = ssl.create_default_context(cafile=ca) if ca else None

    def call(self, method: str, path: str, body: object = None) -> tuple[int, object]:
        data = json.dumps(body).encode() if body is not None else None
        headers = {"Authorization": f"Bearer {self.token}"}
        if data is not None:
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(self.base + path, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=self.timeout, context=self.context) as response:
                raw = response.read().decode()
                status = response.status
        except urllib.error.HTTPError as error:
            raw = error.read().decode()
            status = error.code
        except urllib.error.URLError as error:
            raise SeedError(f"{method} {path}: {error.reason}") from error
        if not raw:
            return status, None
        try:
            return status, json.loads(raw)
        except json.JSONDecodeError:
            return status, raw


def row_title(row: dict) -> str:
    """The title key differs between the two routes that answer these paths.

    The READ route answers `elitea_title`; the compatibility write route answers
    the same value as `name`. Reading only one of them silently found nothing,
    which would make every re-seed create a duplicate row.
    """
    for key in ("elitea_title", "name"):
        value = row.get(key)
        if isinstance(value, str) and value:
            return value
    return ""


class Seeder:
    def __init__(self, client: Client, project: str) -> None:
        self.client = client
        self.project = project

    def wait_for_api(self, seconds: int) -> None:
        """Block until the write route answers, or give up with a real message.

        This step used to need only the database container. It now needs
        elitea-main, and its callers — apps/elitea-web/scripts/chat-stream-e2e.sh
        and index-stream-e2e.sh — run `up || true` before seeding, so the
        service can still be starting. Without this wait the first request would
        fail with a bare "Connection refused" that reads like a wrong URL.

        Any HTTP status counts as up, 401 and 403 included: those are answers,
        and an answer means the route is mounted and the wait is over. The
        upsert below reports what an unauthorised answer means.
        """
        deadline = time.monotonic() + seconds
        last = ""
        while True:
            try:
                self.client.call(
                    "GET", f"/api/v2/configurations/configurations/{self.project}?limit=1"
                )
                return
            except SeedError as error:
                last = str(error)
            if time.monotonic() >= deadline:
                raise SeedError(
                    f"the platform did not answer at {self.client.base} within "
                    f"{seconds}s.\n"
                    f"  Last attempt: {last}\n"
                    f"  Is the stack up, and is ELITEA_CONFIGURATIONS_ENABLED set? "
                    f"Without that flag the write route is never mounted."
                )
            time.sleep(1)

    def find_by_title(self, section: str, title: str) -> dict | None:
        offset = 0
        while True:
            query = urllib.parse.urlencode(
                {"section": section, "limit": PAGE, "offset": offset}
            )
            status, body = self.client.call(
                "GET", f"/api/v2/configurations/configurations/{self.project}?{query}"
            )
            if status != 200 or not isinstance(body, dict):
                raise SeedError(
                    f"list section={section} in project {self.project} answered {status}: {body!r}"
                )
            items = body.get("items") or []
            for row in items:
                if isinstance(row, dict) and row_title(row) == title:
                    return row
            if len(items) < PAGE:
                return None
            offset += PAGE

    def upsert(self, row: dict, *, require_status_ok: bool) -> dict:
        """Create the row, or update the one this project already holds.

        The compatibility write path has no upsert of its own — a POST onto a
        title the project holds is a 400 "Configuration already exists" — so the
        read decides. The UPDATE is a PARTIAL one: only the keys sent are
        written, and admission re-runs over the row as stored, so a re-seed
        reaches the same `status_ok` decision a first seed does.
        """
        title = row["elitea_title"]
        section = row["section"]
        existing = self.find_by_title(section, title)
        if existing is None:
            status, body = self.client.call(
                "POST", f"/api/v2/configurations/configurations/{self.project}", row
            )
            action = "created"
            expected = (200, 201)
        else:
            status, body = self.client.call(
                "PUT",
                f"/api/v2/configurations/configuration/{self.project}/{existing['id']}",
                row,
            )
            action = "updated"
            expected = (200,)
        if status not in expected or not isinstance(body, dict):
            raise SeedError(
                f"{action[:-1]} '{title}' (section {section}) in project "
                f"{self.project} answered {status}: {body!r}"
            )
        status_ok = bool(body.get("status_ok"))
        if require_status_ok and not status_ok:
            raise SeedError(
                f"'{title}' (section {section}) in project {self.project} was stored "
                f"with status_ok=false, so every runtime will ignore it.\n"
                f"  The platform refused to admit the row: its declared references did "
                f"not expand, or its hidden secrets did not redeem.\n"
                f"  A model row with no data.ai_credentials link is ALWAYS refused this "
                f"way — see the head of this file.\n"
                f"  Stored row: {body!r}"
            )
        print(
            f"   · {action} {section}/{title} (id {body.get('id')}, "
            f"status_ok={str(status_ok).lower()})"
        )
        return body


def credential_link(title: str) -> dict:
    """The reference shape the expander and the gateway both read.

    `private: false` resolves the title in the row's OWN project, which is where
    the credential written beside it lives. `private: true` would send the
    expander to the AUTHOR's personal project instead — a different project for
    every caller, and the wrong one here.
    """
    return {"elitea_title": title, "private": False}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--ca", default=None)
    parser.add_argument("--project", required=True)
    parser.add_argument("--token", default=None, help="A PAT, verbatim.")
    parser.add_argument("--pat-uuid", default=None)
    parser.add_argument("--signing-key", default=None)
    parser.add_argument("--timeout", type=int, default=60)
    parser.add_argument("--wait-seconds", type=int, default=90)

    parser.add_argument("--credential-title", required=True)
    parser.add_argument("--credential-type", required=True)
    parser.add_argument("--api-key", required=True)
    parser.add_argument("--api-base", default="")
    parser.add_argument("--model", required=True)
    parser.add_argument("--embedding-model", default="")
    # Project 1 only. Two rows under titles no other project holds, one shared
    # and one not, so a check can prove BOTH directions of the platform-shared
    # scope: the shared one must dispatch for any caller, the private one must
    # be invisible to every other project.
    parser.add_argument("--public-embedding-pair", action="store_true")
    arguments = parser.parse_args()

    if arguments.token:
        token = arguments.token
    elif arguments.pat_uuid and arguments.signing_key:
        with open(arguments.signing_key, "rb") as handle:
            token = mint_pat(arguments.pat_uuid, handle.read())
    else:
        print("ERROR: pass --token, or --pat-uuid together with --signing-key.", file=sys.stderr)
        return 1

    client = Client(arguments.base_url, token, arguments.ca, arguments.timeout)
    seeder = Seeder(client, arguments.project)
    link = credential_link(arguments.credential_title)

    try:
        seeder.wait_for_api(arguments.wait_seconds)

        # 1. The credential the gateway's Account reads. An empty api_base means
        #    "the provider's default endpoint", which also keeps a cloud
        #    credential clear of the self-referential-origin guard the write
        #    route applies (selfref.go).
        seeder.upsert(
            {
                "elitea_title": arguments.credential_title,
                "label": arguments.credential_title,
                "type": arguments.credential_type,
                "section": "ai_credentials",
                "data": {"api_key": arguments.api_key, "api_base": arguments.api_base},
                "shared": False,
            },
            require_status_ok=True,
        )

        # 2. The CHAT model. `label` is not decoration: repos/models.go rejects
        #    an unlabelled llm-section row with an ERROR rather than a skip, so
        #    one such row empties the whole catalogue.
        seeder.upsert(
            {
                "elitea_title": arguments.model,
                "label": arguments.model,
                "type": "llm_model",
                "section": "llm",
                "data": {"name": arguments.model, "ai_credentials": link},
                "shared": False,
            },
            require_status_ok=True,
        )

        # 3. The row the web MODEL PICKER reads —
        #    `/configurations/configurations/{project}?section=models`, a
        #    different section again from the two above. Without it the picker
        #    is empty, nothing can be selected, and the send is rejected 400 for
        #    a missing model while every backend row is present and correct
        #    (#292).
        #
        #    It carries the credential by LINK rather than by copying api_key
        #    into a second row. status_ok is not required here and is not
        #    written: `models` is not one of the sections admission decides, and
        #    no reader of this row selects on the column.
        seeder.upsert(
            {
                "elitea_title": f"{arguments.model}-picker",
                "label": arguments.model,
                "type": arguments.credential_type,
                "section": "models",
                "data": {"model": arguments.model, "ai_credentials": link},
                "shared": False,
            },
            require_status_ok=False,
        )

        # 4. The EMBEDDING model. `data` may carry ONLY `name` and optionally
        #    `ai_credentials`: decodeCurrentEmbeddingConfigurationData uses
        #    DisallowUnknownFields, so any extra key is an invalid binding.
        if arguments.embedding_model:
            seeder.upsert(
                {
                    "elitea_title": "standalone-embedding",
                    "label": "standalone-embedding",
                    "type": "embedding_model",
                    "section": "embedding",
                    "data": {"name": arguments.embedding_model, "ai_credentials": link},
                    "shared": True,
                },
                require_status_ok=True,
            )

            if arguments.public_embedding_pair:
                for title, shared in (
                    ("standalone-shared-embedding", True),
                    ("standalone-private-embedding", False),
                ):
                    seeder.upsert(
                        {
                            "elitea_title": title,
                            "label": title,
                            "type": "embedding_model",
                            "section": "embedding",
                            "data": {
                                "name": arguments.embedding_model,
                                "ai_credentials": link,
                            },
                            "shared": shared,
                        },
                        require_status_ok=True,
                    )

        # The advisory the raw-SQL seed used to make with a second psql read.
        #
        # A re-seed with a DIFFERENT model name ADDS a row; it does not replace
        # the one already there, because the upsert keys on the title.
        # Everything that resolves "the" chat model takes `ORDER BY id LIMIT 1`,
        # so the FIRST model ever seeded keeps winning and the re-seed changes
        # nothing a consumer will read. Printed rather than repaired: a project
        # holding several models is legal and some checks depend on it, so which
        # one wins is the operator's call. What is not acceptable is not saying
        # so.
        status, body = client.call(
            "GET",
            f"/api/v2/configurations/configurations/{arguments.project}"
            f"?section=llm&limit={PAGE}&sort_by=id&sort_order=asc",
        )
        if status == 200 and isinstance(body, dict):
            resolved = next(
                (
                    row
                    for row in (body.get("items") or [])
                    if isinstance(row, dict) and row.get("status_ok")
                ),
                None,
            )
            if resolved is not None:
                name = (resolved.get("data") or {}).get("name")
                if name and name != arguments.model:
                    print(
                        f"   ! project {arguments.project} still resolves '{name}', NOT "
                        f"the model just seeded."
                    )
                    print(
                        "     An id-ordered consumer keeps the earlier row. To make "
                        f"'{arguments.model}' the one that wins, delete the earlier one:"
                    )
                    print(
                        f"       DELETE /api/v2/configurations/configuration/"
                        f"{arguments.project}/{resolved.get('id')}"
                    )
    except SeedError as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
