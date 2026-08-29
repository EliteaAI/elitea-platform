#!/usr/bin/env python3
"""Tier 2: a REAL elitea_sdk client against the REAL gateway router.

Run it through scripts/sdk-conformance/run.sh, which builds and starts the Go
test server (cmd/sdk-conformance-harness) and passes its address here.

── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────

Every other compatibility claim the gateway makes about elitea-sdk rests on
READING the SDK source and reproducing its logic in Go. That is how the shipped
defect survived: the gateway wrote a correct-looking 402 whose SCOPE sat in
error.type, elitea_sdk matches on error.type ALONE and reads the scope out of
error.code, so budget_exceeded_from returned None, no typed exception was
raised, and a policy refusal reached the model as ordinary message content.
Every Go test passed, because every Go test restated the same wrong literal.

This file removes the reproduction. It imports elitea_sdk, builds the same
EliteAClient an agent turn builds, points it at the gateway's own chi router
over the real llmproxy handler, and asserts on what the SDK's OWN objects
return. A failure here is a failure the SDK itself would have.

── NO GATEWAY LITERAL IS WRITTEN HERE ───────────────────────────────────────

The expected scopes come from the SDK: DEFAULT_BUDGET_SCOPE is the project one
and the remaining member of BUDGET_SCOPES is the member one. Restating the
gateway's own strings would only prove that two copies of one mistake agree,
which is precisely what the Go tests did.

── READING THE RESULT ───────────────────────────────────────────────────────

The last line reports how many assertions RAN and how many failed. A run that
makes fewer assertions than EXPECTED_ASSERTIONS exits non-zero even when
nothing failed: an assertion that reports nothing is not a passed assertion.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

# Every assertion this file is written to make. Move this number when you add
# or remove one; never lower it to make a run agree.
EXPECTED_ASSERTIONS = 29

# The two SDK files whose content this gate depends on. The installed package
# must be byte-identical to the pinned source tree, or the run measured some
# other revision than the one internal/sdkpin/sdk-pin.json names.
PROVENANCE_FILES = (
    Path("elitea_sdk") / "runtime" / "exceptions.py",
    Path("elitea_sdk") / "runtime" / "clients" / "client.py",
)

HTTP_TIMEOUT = 30


class Result:
    """Assertion accounting. "Nothing failed" and "everything was measured" are
    different statements, and only the second is a pass."""

    def __init__(self) -> None:
        self.ran = 0
        self.failed = 0

    def ok(self, message: str) -> None:
        self.ran += 1
        print(f"  PASS {message}", flush=True)

    def fail(self, message: str) -> None:
        self.ran += 1
        self.failed += 1
        print(f"  FAIL {message}", file=sys.stderr, flush=True)

    def check(self, condition: bool, ok_message: str, fail_message: str) -> bool:
        if condition:
            self.ok(ok_message)
        else:
            self.fail(fail_message)
        return condition


def abort(message: str) -> None:
    """A precondition this file cannot assert around. Exits non-zero rather than
    reporting a skip: a run that could not start measured nothing."""
    print(f"ERROR: {message}", file=sys.stderr, flush=True)
    raise SystemExit(2)


def describe(error: BaseException, limit: int = 400) -> str:
    """One readable line for an exception, with the HTTP status and the body the
    client carries. A bare repr() loses both, and those are the two things that
    separate a routing fault from a contract fault."""
    parts = [f"{type(error).__module__}.{type(error).__name__}"]
    status = getattr(error, "status_code", None)
    if status is not None:
        parts.append(f"HTTP {status}")
    body = getattr(error, "body", None)
    if body is not None:
        parts.append(f"body={json.dumps(body, default=str)[:limit]}")
    parts.append(str(error)[:limit])
    return " | ".join(parts)


# ── The harness control surface ──────────────────────────────────────────────


def harness_request(base_url: str, path: str, method: str = "GET", payload=None):
    data = None
    headers = {}
    if payload is not None:
        data = json.dumps(payload).encode()
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(base_url + path, method=method, data=data, headers=headers)
    try:
        return json.loads(urllib.request.urlopen(request, timeout=HTTP_TIMEOUT).read())
    except Exception as error:  # noqa: BLE001 - the reason must reach the operator
        abort(f"the harness control endpoint {method} {path} failed: {describe(error)}")


def set_verdict(base_url: str, verdict: str) -> None:
    """Switch the budget answer, and READ BACK what was applied.

    The harness echoes the verdict it stored. Trusting the request instead would
    let a typo leave the previous verdict in place, and the member-scope
    assertion would then run against a project refusal — a false failure — or
    against a 200 — a false pass."""
    applied = harness_request(base_url, "/__harness/verdict", "POST", {"verdict": verdict})
    if applied.get("verdict") != verdict:
        abort(f"asked the harness for verdict {verdict!r}, it applied {applied.get('verdict')!r}")


def journal_reset(base_url: str) -> None:
    harness_request(base_url, "/__harness/journal", "DELETE")


def journal(base_url: str) -> list[dict]:
    return harness_request(base_url, "/__harness/journal").get("data") or []


def journal_for(base_url: str, path: str) -> list[dict]:
    return [row for row in journal(base_url) if row.get("path") == path]


# ── 0. Provenance ────────────────────────────────────────────────────────────


def assert_provenance(result: Result, sdk_source_root: Path) -> None:
    """The INSTALLED SDK must be the PINNED SDK.

    run.sh has already made two checks. The source tree is at the revision
    internal/sdkpin/sdk-pin.json names, and — through
    verify_pinned_content.py — every file below holds the CONTENT that pin
    records (#567). This closes the last hop: the tree that was checked and the
    package that is imported must be the same bytes. Without it the run could
    pass against a developer's working copy and report a compatibility claim
    about a revision it never loaded.

    The three checks are one chain, and each link is needed. This one alone
    cannot see a source tree that was edited and then installed with `pip
    install -e`: both sides move together and the digests still agree.
    """
    print("-> provenance: the installed elitea_sdk is the pinned one")
    import elitea_sdk

    installed_root = Path(elitea_sdk.__file__).resolve().parent.parent
    for relative in PROVENANCE_FILES:
        pinned = sdk_source_root / relative
        installed = installed_root / relative
        if not pinned.is_file():
            abort(f"{pinned} is missing; --sdk-source-root does not name an SDK checkout")
        if not installed.is_file():
            abort(f"{installed} is missing; the installed elitea_sdk has no {relative}")
        pinned_digest = hashlib.sha256(pinned.read_bytes()).hexdigest()
        installed_digest = hashlib.sha256(installed.read_bytes()).hexdigest()
        result.check(
            pinned_digest == installed_digest,
            f"the installed {relative} matches the pinned tree",
            f"the installed {relative} DIFFERS from the pinned tree.\n"
            f"      installed {installed} sha256 {installed_digest}\n"
            f"      pinned    {pinned} sha256 {pinned_digest}\n"
            f"      This run would report a contract claim about a revision it did not load.",
        )


# ── The SDK's own scope vocabulary ───────────────────────────────────────────


def sdk_scopes():
    """Read the two scope names OUT OF THE SDK.

    The project scope is the SDK's default; the member scope is the other one.
    Deriving them here rather than writing the gateway's strings is what keeps
    this file from becoming a second copy of the gateway's belief.
    """
    from elitea_sdk.runtime.exceptions import BUDGET_SCOPES, DEFAULT_BUDGET_SCOPE

    others = [scope for scope in BUDGET_SCOPES if scope != DEFAULT_BUDGET_SCOPE]
    if len(others) != 1:
        abort(
            f"the pinned SDK declares BUDGET_SCOPES={BUDGET_SCOPES!r} with default "
            f"{DEFAULT_BUDGET_SCOPE!r}. This gate reads the member scope as 'the one that "
            f"is not the default', which needs exactly two scopes. Read the new SDK and "
            f"rewrite this function; do not delete it."
        )
    return DEFAULT_BUDGET_SCOPE, others[0]


# ── 1 and 2. The budget refusals ─────────────────────────────────────────────


def assert_refusal(result: Result, client, base_url: str, verdict: str,
                   want_scope: str, label: str) -> None:
    """Drive a real 402 and require the SDK's own reader to name the ceiling.

    THIS IS THE ASSERTION THE SHIPPED DEFECT WOULD HAVE FAILED. A gateway that
    puts the SCOPE in error.type produces a body whose type is not
    `budget_exceeded`; budget_exceeded_from's structured branch then returns
    None, no typed exception exists, and the caller feeds the refusal to the
    model as content. Every check below is written against that outcome.

    Both dialects run. The OpenAI client strips the "error" wrapper before it
    stores the body and the Anthropic client keeps it, so the SDK reads two
    different shapes and only running both proves it reads both.
    """
    from elitea_sdk.runtime.exceptions import BudgetExceededError, budget_exceeded_from

    print(f"-> the {label} refusal (verdict {verdict}, SDK scope {want_scope!r})")
    set_verdict(base_url, verdict)

    dialects = (
        ("OpenAI", "openai/gpt-4o"),
        ("Anthropic", "anthropic/claude-3-5-sonnet-20241022"),
    )
    for dialect, model in dialects:
        llm = client.get_llm(model, {"temperature": 0.1, "max_tokens": 64, "max_retries": 0})
        try:
            answer = llm.invoke("tier 2 budget probe")
        except Exception as error:  # noqa: BLE001 - the refusal is the measurement
            raised = error
        else:
            result.fail(
                f"[{dialect}] the gateway ADMITTED a request under the {verdict} verdict and "
                f"returned {answer.content!r}. Nothing was refused, so the refusal contract "
                f"could not be read."
            )
            result.fail(f"[{dialect}] no refusal was raised, so no scope could be read")
            continue

        # The refusal must be a 402 WITH A STRUCTURED BODY, and both halves
        # matter.
        #
        # The status separates a budget refusal from any other failure. Without
        # it a 404 on this route — an unmounted handler, a moved SDK path —
        # produces the same "no typed exception" outcome and would be reported
        # as the budget defect, sending the reader to the wrong file.
        #
        # The body must be the parsed dict. The SDK has a second, text-based
        # branch for callers that lose the parsed body, and that branch would
        # answer for the pre-fix shape too: "member_budget_exceeded" contains
        # "budget_exceeded" as a substring, so a text match reports the member
        # scope for the very body this gate exists to reject. Requiring a dict
        # keeps the measurement on the branch the product uses.
        status = getattr(raised, "status_code", None)
        body = getattr(raised, "body", None)
        if not result.check(
            status == 402 and isinstance(body, dict),
            f"[{dialect}] the refusal is a 402 with a structured body",
            f"[{dialect}] the refusal is HTTP {status} with a "
            f"{type(body).__name__} body, want 402 with a dict. A status other than "
            f"402 is not a budget refusal at all — look for a routing or admission "
            f"fault before you look at the budget contract. A non-dict body would "
            f"send the SDK down its text branch, which matches 'budget_exceeded' "
            f"inside 'member_budget_exceeded' and would report a pass for the "
            f"shipped defect: {describe(raised)}",
        ):
            result.fail(f"[{dialect}] the refusal was unusable, so no scope could be read")
            continue

        exception = budget_exceeded_from(raised)
        if not result.check(
            isinstance(exception, BudgetExceededError),
            f"[{dialect}] budget_exceeded_from returns a BudgetExceededError",
            f"[{dialect}] budget_exceeded_from returned {exception!r} for a real 402. "
            f"THIS IS THE SHIPPED DEFECT: no typed exception is raised, so the caller "
            f"treats the refusal as an ordinary provider error and feeds it to the model "
            f"as message content. The SDK matches on error.type ALONE and reads the scope "
            f"from error.code; the gateway body was {json.dumps(body)}",
        ):
            result.fail(f"[{dialect}] no typed exception, so no scope could be read")
            continue

        result.check(
            exception.scope == want_scope,
            f"[{dialect}] the scope is {want_scope!r}",
            f"[{dialect}] the scope is {exception.scope!r}, want {want_scope!r}. The scope "
            f"becomes the agent event's budget_error_code, which is what the front end keys "
            f"its member-versus-project message on, so a wrong scope sends a member who is "
            f"over THEIR cap to a project budget screen they cannot act on. Body: "
            f"{json.dumps(body)}",
        )


def assert_non_budget_error_is_not_a_budget_error(result: Result, base_url: str,
                                                  auth_token: str) -> None:
    """The negative control, and the reason the two assertions above are not
    enough on their own.

    A reader that over-matched — on the 402 status, or on any 4xx — would turn
    every routing failure into a BudgetExceededError, and an agent would report
    "budget exhausted" for a missing route. So take a REAL non-budget refusal
    that this gateway just produced and require None.
    """
    from elitea_sdk.runtime.clients.client import EliteAClient
    from elitea_sdk.runtime.exceptions import budget_exceeded_from

    print("-> negative control: a non-budget refusal is not a budget refusal")
    set_verdict(base_url, "allow")
    # A base_url one path segment off. The SDK builds /nowhere/llm/v1/... and
    # the gateway's own NotFound handler answers, so the error object is a real
    # one this gateway produced rather than a hand-built stand-in.
    stray = EliteAClient(base_url=base_url + "/nowhere", project_id=4242, auth_token=auth_token)
    try:
        stray.get_llm("openai/gpt-4o", {"max_tokens": 16, "max_retries": 0}).invoke("probe")
    except Exception as error:  # noqa: BLE001
        result.check(
            budget_exceeded_from(error) is None,
            "the SDK's budget reader does NOT match a real non-budget refusal",
            f"the SDK's budget reader matched a non-budget refusal as a budget rejection. "
            f"Every routing failure would be reported to the user as an exhausted budget: "
            f"{describe(error)}",
        )
    else:
        result.fail(
            "a request to an unmounted path returned content instead of raising. The "
            "negative control measured nothing, and the assertions above are unguarded "
            "against an over-matching reader."
        )


# ── 3. Chat ──────────────────────────────────────────────────────────────────


def assert_chat(result: Result, client, base_url: str, project_id: int) -> None:
    """get_llm(...).invoke(...) — the path an agent turn takes to the model.

    model_config is left at the SDK's own defaults apart from the two values
    every caller sets, so streaming stays True and this drives the SSE path the
    product uses rather than a unary shortcut.
    """
    print("-> chat: client.get_llm(...).invoke(...)")
    set_verdict(base_url, "allow")
    journal_reset(base_url)

    llm = client.get_llm("openai/gpt-4o", {"temperature": 0.1, "max_tokens": 64})
    try:
        answer = llm.invoke("tier 2 chat probe")
    except Exception as error:  # noqa: BLE001
        result.fail(f"invoke() raised on an admitted request: {describe(error)}")
        result.fail("invoke() raised, so no usage could be read")
        result.fail("invoke() raised, so no request reached the server to inspect")
        result.fail("invoke() raised, so no project selector could be read")
        return
    result.ok("invoke() returns without raising")

    # The harness router stamps a known usage on the final stream chunk. Reading
    # it back proves the whole SSE path ran end to end — the gateway's chunk
    # framing, the openai client's aggregation and LangChain's usage mapping —
    # rather than only that a response arrived. The canned answer carries no
    # text, so a content assertion could not distinguish those.
    usage = getattr(answer, "usage_metadata", None) or {}
    result.check(
        usage.get("input_tokens") == 100 and usage.get("output_tokens") == 50,
        f"the streamed usage trailer survives the round trip ({usage.get('input_tokens')} "
        f"in / {usage.get('output_tokens')} out)",
        f"the streamed usage is {usage!r}, want 100 in / 50 out. Those are the numbers the "
        f"harness router stamps on the final chunk, so a mismatch means the usage-bearing "
        f"chunk was dropped, reordered or never framed — the same loss that silently "
        f"unbills a real stream.",
    )

    rows = journal_for(base_url, client.llm_path + "/chat/completions")
    if not result.check(
        len(rows) == 1,
        "invoke() produced exactly one request on the chat route",
        f"invoke() produced {len(rows)} request(s) on {client.llm_path}/chat/completions, "
        f"want 1. Zero means the SDK posted somewhere else; more than one means a retry "
        f"the caller cannot see.",
    ):
        result.fail("no single chat request to read the project selector from")
        return

    # ASSERTED SERVER-SIDE, from what the SDK put on the wire. The harness
    # records the headers BEFORE its edge shim adds the gateway identity
    # headers, so this is the SDK's own doing.
    selector = rows[0].get("headers", {}).get("openai-organization")
    result.check(
        selector == str(project_id),
        f"the request carried OpenAI-Organization: {project_id}",
        f"the request carried OpenAI-Organization={selector!r}, want {str(project_id)!r}. "
        f"That header is how elitea-main resolves the project, so losing it bills and "
        f"credentials the wrong tenant — or, with no project resolved at all, admits every "
        f"request past the budget ceiling.",
    )


# ── 4. Embeddings ────────────────────────────────────────────────────────────


def assert_embeddings(result: Result, client, base_url: str) -> None:
    """get_embeddings(...).embed_query(...) — the index path, and the base64 arm.

    openai-python injects encoding_format=base64 when the caller omits it, and
    LangChain's OpenAIEmbeddings omits it. The harness answers ONLY in base64,
    so a client that stopped decoding it cannot produce a vector at all.
    """
    print("-> embeddings: client.get_embeddings(...).embed_query(...)")
    set_verdict(base_url, "allow")
    journal_reset(base_url)

    embeddings = client.get_embeddings("openai/text-embedding-3-small")
    try:
        vector = embeddings.embed_query("tier 2 embedding probe")
    except Exception as error:  # noqa: BLE001
        result.fail(f"embed_query() raised: {describe(error)}")
        result.fail("embed_query() raised, so the decoded vector could not be inspected")
        result.fail("embed_query() raised, so no request reached the server to inspect")
        return

    # The harness answers a strictly increasing vector of a known width. Both
    # properties survive any scaling LangChain applies, and both fail loudly on
    # a mis-decode: a float64 read of float32 bytes halves the width, and a
    # byte-order error scrambles the order.
    result.check(
        len(vector) == 8,
        "embed_query() returns a vector of the expected width (8)",
        f"embed_query() returned a {len(vector)}-wide vector, want 8. The harness encodes "
        f"8 little-endian float32 values, so a different width means the base64 payload was "
        f"decoded with the wrong element size or truncated.",
    )
    increasing = len(vector) > 1 and all(
        vector[i] < vector[i + 1] for i in range(len(vector) - 1)
    )
    result.check(
        increasing,
        "the decoded vector keeps the order the harness encoded",
        f"the decoded vector is not strictly increasing: {vector!r}. The harness encodes a "
        f"ramp, so a scrambled order means the base64 bytes were read with the wrong "
        f"endianness or the wrong element type.",
    )

    rows = journal_for(base_url, client.llm_path + "/embeddings")
    body = rows[0].get("body") or {} if rows else {}
    result.check(
        body.get("encoding_format") == "base64",
        "the SDK asked the gateway for encoding_format=base64",
        f"the embeddings request carried encoding_format={body.get('encoding_format')!r}. "
        f"The whole point of this assertion is the base64 arm: with `float` on the wire the "
        f"vector above proves nothing about it, and the gateway's base64 path stays "
        f"unmeasured. Recorded requests: {json.dumps(rows)[:400]}",
    )

    # Pin the RESPONSE form too. The two decode assertions above measure a
    # decode, not base64: swap the harness to answer a plain float array and
    # they both still pass, because the SDK decodes whatever it is given. The
    # request assertion above reads what the SDK ASKED for, which the harness
    # can ignore. Only the wire settles it, so read it directly.
    raw = harness_request(
        base_url,
        client.llm_path + "/embeddings",
        method="POST",
        payload={
            "model": "openai/text-embedding-3-small",
            "input": "tier 2 base64 fixture probe",
            "encoding_format": "base64",
        },
    )
    wire = (raw.get("data") or [{}])[0].get("embedding")
    result.check(
        isinstance(wire, str),
        "the gateway answers the embeddings route in base64",
        f"the embeddings response carried embedding={type(wire).__name__}, want a base64 "
        f"str. The two decode assertions above only measure a decode WHILE base64 is on "
        f"the wire; they pass unchanged against a plain float array.",
    )


# ── 5. The Anthropic dialect ─────────────────────────────────────────────────


def assert_anthropic_route(result: Result, client, base_url: str) -> None:
    """ChatAnthropic must reach {allm_path}/v1/messages, not the OpenAI route.

    The two dialects share the /llm/v1/ prefix, and the exact /llm/v1/messages
    route is registered before the OpenAI catch-all for that reason. A reorder
    misroutes every Anthropic caller, and the SDK would still get an answer —
    from the wrong handler.
    """
    print("-> the Anthropic dialect reaches the Anthropic route")
    set_verdict(base_url, "allow")
    journal_reset(base_url)

    llm = client.get_llm("anthropic/claude-3-5-sonnet-20241022",
                         {"temperature": 0.1, "max_tokens": 64})
    try:
        llm.invoke("tier 2 anthropic probe")
    except Exception as error:  # noqa: BLE001
        result.fail(f"the Anthropic dialect raised on an admitted request: {describe(error)}")
        result.fail("the Anthropic call raised, so no route could be read")
        return
    result.ok("the Anthropic dialect returns without raising")

    want = client.allm_path + "/v1/messages"
    paths = sorted({row.get("path") for row in journal(base_url)})
    result.check(
        paths == [want],
        f"the Anthropic call reached {want}",
        f"the Anthropic call reached {paths}, want [{want!r}]. ChatAnthropic appends "
        f"/v1/messages to allm_path, so anything else means either the SDK moved the base "
        f"path or the router serves that path from the OpenAI catch-all.",
    )


# ── 6. Every SDK path is mounted ─────────────────────────────────────────────


def assert_paths_resolve(result: Result, client, base_url: str) -> None:
    """All four /llm endpoints the SDK builds must be routes the gateway mounts.

    The PREFIX is read off the SDK client at runtime; the per-library suffixes
    are written here, because LangChain appends them to the base_url and there
    is nothing in the SDK to read them from. So this gate moves with the SDK's
    base paths but NOT with a LangChain upgrade that changed a suffix. A 404 or
    a 405 on any of them is a call that reaches an error instead of the model.
    """
    print("-> every /llm path the SDK builds is mounted")
    set_verdict(base_url, "allow")

    prefix = client.base_url
    if not client.image_generation_url.startswith(prefix):
        abort(
            f"the SDK's image_generation_url {client.image_generation_url!r} does not start "
            f"with its base_url {prefix!r}; this gate can no longer derive the path from it."
        )
    wanted = {
        # LangChain appends these two to the base_url the SDK gives ChatOpenAI
        # and OpenAIEmbeddings.
        client.llm_path + "/chat/completions": "ChatOpenAI",
        client.llm_path + "/embeddings": "OpenAIEmbeddings",
        # ChatAnthropic appends this one to allm_path.
        client.allm_path + "/v1/messages": "ChatAnthropic",
        # The SDK builds this one itself.
        client.image_generation_url[len(prefix):]: "EliteAClient.image_generation_url",
    }
    if len(wanted) != 4:
        abort(
            f"expected four distinct SDK paths, derived {sorted(wanted)}. The SDK collapsed "
            f"two of them onto one route, so this gate would report a pass for three."
        )

    for path, origin in sorted(wanted.items()):
        request = urllib.request.Request(
            base_url + path, method="POST", data=b"{}",
            headers={"Content-Type": "application/json", "OpenAI-Organization": "4242"})
        try:
            status = urllib.request.urlopen(request, timeout=HTTP_TIMEOUT).status
        except urllib.error.HTTPError as error:
            status = error.code
        except Exception as error:  # noqa: BLE001
            result.fail(f"{path} ({origin}) could not be reached at all: {describe(error)}")
            continue
        result.check(
            status not in (404, 405),
            f"{path} is mounted ({origin}, HTTP {status})",
            f"{path} answered HTTP {status}. The SDK sends {origin} there, so the call "
            f"reaches an error instead of the model. Either the SDK moved this path or the "
            f"gateway router no longer mounts it.",
        )


# ── main ─────────────────────────────────────────────────────────────────────


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", required=True,
                        help="the harness address, printed by cmd/sdk-conformance-harness")
    parser.add_argument("--project", type=int, default=4242,
                        help="the project id the SDK client selects")
    parser.add_argument("--auth-token", default="tier2-harness-token",
                        help="the bearer the SDK sends; the gateway does not authenticate")
    parser.add_argument("--sdk-source-root", required=True,
                        help="the pinned elitea-sdk checkout, verified by run.sh")
    args = parser.parse_args()

    # Imported after argument parsing so --help works without the SDK and an
    # import failure reports a cause instead of a traceback.
    try:
        from elitea_sdk.runtime.clients.client import EliteAClient
    except Exception as error:  # noqa: BLE001
        abort(f"could not import elitea_sdk: {describe(error)}. This file drives the REAL "
              f"SDK; install the pinned revision before running it.")

    sdk_source_root = Path(args.sdk_source_root).resolve()
    project_scope, member_scope = sdk_scopes()

    print(f"-> tier 2: elitea-sdk against the gateway router at {args.base_url}")
    print(f"   project {args.project}; SDK scopes: project={project_scope!r} "
          f"member={member_scope!r}")

    result = Result()
    assert_provenance(result, sdk_source_root)

    # Three arguments, exactly as an agent turn builds it. No extra headers and
    # no keyword overrides, so nothing here can paper over a default that is
    # wrong for the product.
    client = EliteAClient(
        base_url=args.base_url,
        project_id=args.project,
        auth_token=args.auth_token,
    )

    # The member refusal runs FIRST. It is the one the shipped defect broke.
    assert_refusal(result, client, args.base_url, "member-402", member_scope, "member ceiling")
    assert_refusal(result, client, args.base_url, "project-402", project_scope, "project ceiling")
    assert_non_budget_error_is_not_a_budget_error(result, args.base_url, args.auth_token)
    assert_chat(result, client, args.base_url, args.project)
    assert_embeddings(result, client, args.base_url)
    assert_anthropic_route(result, client, args.base_url)
    assert_paths_resolve(result, client, args.base_url)

    print(f"-> tier 2: {result.ran} assertion(s) ran, {result.failed} failed "
          f"(expected {EXPECTED_ASSERTIONS} to run).")
    if result.ran != EXPECTED_ASSERTIONS:
        print("-> FAILED: the number of assertions that ran is not the number this file "
              "states it makes. An assertion that reports nothing is not a passed assertion.",
              file=sys.stderr)
        return 1
    if result.failed:
        return 1
    print("-> tier 2 OK: the pinned elitea-sdk and the gateway router agree.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
