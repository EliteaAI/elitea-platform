#!/usr/bin/env python3
"""Drives a REAL elitea_sdk EliteAClient against a running standalone stack.

Run it through deploy/scripts/sdk-client-check.sh. That wrapper resolves the
driver credential and the seeded model names, and starts this file inside the
one container image in the stack that carries the locked SDK.

── Why this file exists ──────────────────────────────────────────────────────

Every other compatibility claim about the SDK in this repository rests on
READING the SDK source and reproducing its logic in Go, or on a probe that
speaks HTTP the way we believe the SDK speaks it. Nothing ran the SDK.

That is how the shipped budget defect survived. The gateway wrote a
correct-looking 402 whose SCOPE sat in error.type; elitea_sdk matches on
error.type alone and reads the scope out of error.code, so budget_exceeded_from
returned None, no typed exception was raised, and a policy refusal reached the
model as ordinary message content. Every unit test passed. Nothing failed.

This file removes the reproduction. It imports elitea_sdk, constructs the same
EliteAClient an agent turn constructs, and asserts on what the SDK's OWN
objects return. A failure here is a failure the SDK itself would have.

── The four SDK paths ────────────────────────────────────────────────────────

EliteAClient.__init__ builds exactly two /llm prefixes:

    llm_path  = "/llm/v1"   chat/completions, embeddings, images/generations
    allm_path = "/llm"      ChatAnthropic appends /v1/messages

This check drives chat/completions (get_llm) and embeddings (get_embeddings).
It does NOT drive images/generations or the Anthropic dialect: the stack seeds
no image model and no Anthropic credential, so a probe for either would measure
the seed rather than the SDK. Read the report, not the silence.

── Reading the result ────────────────────────────────────────────────────────

The last line reports how many assertions RAN and how many failed. A run that
makes fewer assertions than EXPECTED_ASSERTIONS exits non-zero even when
nothing failed: an assertion that reports nothing is not a passed assertion.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.request

# Every assertion this file is written to make, with budget enforcement off.
# The budget arm adds one when the gateway reports enforcement ON — see
# assert_budget_contract. Move this number when you add or remove an assertion;
# do not lower it to make a run agree.
EXPECTED_ASSERTIONS = 15

# The mock's default width, and text-embedding-3-small's. Overridden with
# --embedding-dim for a provider that answers another width. The assertion is
# on the exact width and not on "more than zero": a vector of the wrong width
# fails much later, at insert time inside the worker, where the cause is gone.
DEFAULT_EMBEDDING_DIM = 1536


class Result:
    """Assertion accounting. Three numbers, because "nothing failed" and
    "everything was measured" are different statements and only the second is
    a pass."""

    def __init__(self) -> None:
        self.ran = 0
        self.failed = 0

    def ok(self, message: str) -> None:
        self.ran += 1
        print(f"  ✓ {message}", flush=True)

    def fail(self, message: str) -> None:
        self.ran += 1
        self.failed += 1
        print(f"  ✗ {message}", file=sys.stderr, flush=True)

    def note(self, message: str) -> None:
        """Printed, never counted. Used for a decision, not for a result."""
        print(f"  · {message}", flush=True)


def abort(message: str) -> None:
    """A precondition this file cannot assert around. It exits non-zero rather
    than reporting a skip: a run that could not start measured nothing."""
    print(f"ERROR: {message}", file=sys.stderr, flush=True)
    raise SystemExit(1)


def describe(error: BaseException, limit: int = 240) -> str:
    """One readable line for an exception, with the HTTP status and the body
    when the client carries them. A bare repr() of an openai error loses the
    status and the provider's message, which are the two things an operator
    needs to tell a routing fault from a credential fault."""
    parts = [f"{type(error).__module__}.{type(error).__name__}"]
    status = getattr(error, "status_code", None)
    if status is not None:
        parts.append(f"HTTP {status}")
    body = getattr(error, "body", None)
    if body is not None:
        parts.append(f"body={json.dumps(body, default=str)[:limit]}")
    parts.append(str(error)[:limit])
    return " | ".join(parts)


# ── The mock's request journal ───────────────────────────────────────────────
#
# The journal is the ONLY record of what went on the wire upstream of the
# gateway. A 200 from the platform proves that the platform answered; it does
# not prove that a provider was called, which model name the call carried, or
# whose credential paid for it. Those three facts separate "the SDK reached the
# model" from "something answered the SDK".
#
# Read from inside the compose network, so this file never depends on the
# mock's published host port.


def journal_reset(mock_origin: str) -> None:
    request = urllib.request.Request(f"{mock_origin}/__journal", method="DELETE")
    try:
        urllib.request.urlopen(request, timeout=10).read()
    except Exception as error:  # noqa: BLE001 - the reason must reach the operator
        abort(f"could not reset the mock journal at {mock_origin}: {describe(error)}")


def journal_rows(mock_origin: str, path: str) -> list[dict]:
    try:
        payload = json.loads(urllib.request.urlopen(f"{mock_origin}/__journal", timeout=10).read())
    except Exception as error:  # noqa: BLE001
        abort(f"could not read the mock journal at {mock_origin}: {describe(error)}")
    return [row for row in payload.get("data") or [] if row.get("path") == path]


def assert_catalogue(result: Result, client, chat_model: str, embedding_model: str) -> None:
    """get_available_models() — the catalogue read the SDK actually performs.

    It is NOT GET /llm/v1/models. The SDK reads elitea-main's
    /api/v2/configurations/models/{project}?include_shared=true, which serves
    the `llm` section alone. The two lists differ on purpose, and the
    difference is what the second assertion pins.
    """
    print("→ the SDK's model catalogue (GET /api/v2/configurations/models):")
    try:
        models = client.get_available_models()
    except Exception as error:  # noqa: BLE001
        abort(f"get_available_models() raised: {describe(error)}")

    # get_available_models swallows a failed request and returns []. So an
    # empty list is indistinguishable from "the route answered 401" here, and
    # BOTH must fail. Naming the count in the message is what tells them apart
    # for whoever reads the failure.
    names = [str(model.get("name")) for model in models]
    if chat_model in names:
        result.ok(f"the catalogue lists the seeded chat model '{chat_model}'")
    else:
        result.fail(
            f"the catalogue does not list '{chat_model}'. get_available_models() returned "
            f"{len(models)} item(s): {json.dumps(names)[:240]}. An EMPTY list is what this "
            f"call returns when the request fails, so check the PAT and the "
            f"configurations.configurations.list permission before the seed."
        )

    # The embedding model must NOT be here. It lives in the `embedding`
    # section, and this route serves `llm`. If it appears, the section
    # separation has collapsed and the web model picker — which reads this same
    # route — offers an embedding model as a chat model. That row cannot serve
    # a chat turn, so every agent that picks it fails at the model call.
    if embedding_model and embedding_model in names:
        result.fail(
            f"the catalogue lists the embedding model '{embedding_model}' as a chat model. "
            f"The `embedding` section has leaked into the `llm` section, and the model "
            f"picker now offers a model no chat turn can use."
        )
    else:
        result.ok("the catalogue keeps the embedding model out of the chat model list")


def assert_chat(result: Result, client, chat_model: str, wire_model: str,
                credential: str, mock_origin: str) -> None:
    """get_llm(...).invoke(...) — the path an agent turn takes to the model."""
    print("→ the SDK's chat model (client.get_llm(...).invoke(...)):")
    # Unique per run, and echoed by the mock. Finding it in the answer proves
    # THIS call produced the answer, rather than a cached, replayed or
    # misrouted one. A "the answer was not empty" assertion cannot tell those
    # apart.
    nonce = f"sdk-client-check-{int(time.time() * 1000)}"
    journal_reset(mock_origin)

    # model_config is left at the SDK's own defaults apart from the two values
    # every caller sets. streaming defaults to True inside get_llm, so this
    # exercises the streamed path the product uses, not a unary shortcut.
    llm = client.get_llm(chat_model, {"temperature": 0.1, "max_tokens": 256})
    try:
        answer = llm.invoke(nonce)
    except Exception as error:  # noqa: BLE001
        result.fail(f"invoke() raised on the seeded model '{chat_model}': {describe(error)}")
        result.fail("invoke() raised, so the answer could not echo this run's nonce")
        result.fail("invoke() raised, so no upstream call could be counted")
        result.fail("invoke() raised, so no upstream model name could be read")
        result.fail("invoke() raised, so no upstream credential could be read")
        return

    content = answer.content if isinstance(answer.content, str) else json.dumps(answer.content)
    if content.strip():
        result.ok(f"invoke() returned content ({len(content)} chars)")
    else:
        result.fail(
            f"invoke() returned EMPTY content for '{chat_model}'. The call succeeded and "
            f"carried no answer, which an agent turn renders as a blank reply."
        )
    if nonce in content:
        result.ok("the answer echoes this run's nonce, so this call produced it")
    else:
        result.fail(
            f"the answer does not carry this run's nonce {nonce!r}, so it cannot be "
            f"attributed to this call: {content[:160]!r}"
        )

    rows = journal_rows(mock_origin, "/v1/chat/completions")
    if len(rows) == 1:
        result.ok("the SDK's invoke() produced exactly one upstream completion call")
    else:
        result.fail(
            f"the SDK's invoke() produced {len(rows)} upstream completion call(s), expected 1. "
            f"Zero means the platform answered without calling a provider; more than one means "
            f"a retry or an amplification the caller cannot see."
        )

    seen_models = sorted({str(row.get("model")) for row in rows})
    if wire_model in seen_models:
        result.ok(f"the upstream call carried the wire model name '{wire_model}'")
    else:
        result.fail(
            f"the upstream call carried {seen_models or 'nothing'}, not '{wire_model}'. "
            f"The gateway strips the provider prefix before it dispatches, so this is the "
            f"name the provider must see. A content assertion would not have shown this."
        )

    seen_credentials = sorted({str(row.get("credential")) for row in rows})
    if credential in seen_credentials:
        result.ok(f"the upstream call used this project's own credential ({credential})")
    else:
        result.fail(
            f"the upstream call used {seen_credentials or 'no credential'}, not {credential}. "
            f"The gateway resolved another project's credential, which is a tenant-isolation "
            f"fault rather than a routing one."
        )


def assert_embeddings(result: Result, client, embedding_model: str, wire_model: str,
                      credential: str, mock_origin: str, expected_dim: int) -> None:
    """get_embeddings(...).embed_query / .embed_documents — the index path.

    This is NOT the same wire request `standalone-stack.sh check` makes. That
    probe pins encoding_format to `float` and posts a plain string. The SDK's
    OpenAIEmbeddings asks for base64 and tokenizes with tiktoken, so it posts
    ARRAYS OF TOKEN IDS. Both arms have to work, and only this file exercises
    the second one.
    """
    print("→ the SDK's embeddings (client.get_embeddings(...)):")
    journal_reset(mock_origin)
    embeddings = client.get_embeddings(embedding_model)

    try:
        vector = embeddings.embed_query("hi")
    except Exception as error:  # noqa: BLE001
        result.fail(f"embed_query() raised on '{embedding_model}': {describe(error)}")
        result.fail("embed_query() raised, so the batch arm was not reached")
        result.fail("embed_query() raised, so no upstream model name could be read")
        result.fail("embed_query() raised, so no upstream credential could be read")
        return

    if len(vector) == expected_dim:
        result.ok(f"embed_query() returned a {expected_dim}-wide vector")
    else:
        result.fail(
            f"embed_query() returned a {len(vector)}-wide vector, expected {expected_dim}. "
            f"Nothing in the platform pins a width, so a wrong one surfaces only much later "
            f"as an operator error between two differently sized vectors in one collection. "
            f"Pass --embedding-dim for a provider that answers another width."
        )

    # The batch arm, which is the arm an index run uses. embed_documents also
    # averages per-chunk vectors and divides by the norm, so a degenerate
    # (all-zero) vector surfaces here as NaN rather than as a width.
    try:
        batch = embeddings.embed_documents(["alpha", "beta"])
    except Exception as error:  # noqa: BLE001
        result.fail(f"embed_documents() raised on '{embedding_model}': {describe(error)}")
        batch = []
    if len(batch) == 2 and all(len(item) == expected_dim for item in batch):
        result.ok(f"embed_documents() returned 2 vectors, each {expected_dim} wide")
    elif batch:
        result.fail(
            f"embed_documents(['alpha','beta']) returned {len(batch)} vector(s) of widths "
            f"{[len(item) for item in batch]}, expected 2 of {expected_dim}. The index path "
            f"uses this arm, not embed_query."
        )

    rows = journal_rows(mock_origin, "/v1/embeddings")
    seen_models = sorted({str(row.get("model")) for row in rows})
    if wire_model in seen_models:
        result.ok(f"the upstream embedding calls carried the wire model name '{wire_model}'")
    else:
        result.fail(
            f"the upstream embedding calls carried {seen_models or 'nothing'}, not "
            f"'{wire_model}'. A vector width identifies no model."
        )

    seen_credentials = sorted({str(row.get("credential")) for row in rows})
    if credential in seen_credentials:
        result.ok(f"the upstream embedding calls used this project's own credential ({credential})")
    else:
        result.fail(
            f"the upstream embedding calls used {seen_credentials or 'no credential'}, not "
            f"{credential} — the gateway resolved the wrong project."
        )


def assert_unknown_model_refused(result: Result, client, unknown_chat: str,
                                 unknown_embedding: str, mock_origin: str):
    """The negative control, and the reason the positive assertions above are
    not enough on their own.

    "invoke() returned content" also passes on a gateway that quietly
    substitutes some other model for one it cannot resolve. So ask for a name
    no row holds, and require two things: the SDK raises rather than returning
    content, AND nothing was dispatched upstream.

    Returns the raised error so the budget arm can read a REAL refusal body.
    """
    print("→ negative control — a model name no row holds:")
    journal_reset(mock_origin)
    raised: BaseException | None = None
    try:
        client.get_llm(unknown_chat, {"temperature": 0.1, "max_tokens": 64, "max_retries": 0}) \
              .invoke("negative control")
        result.fail(
            f"the SDK returned content for '{unknown_chat}', which no configuration row "
            f"holds. Some other model was silently substituted."
        )
    except Exception as error:  # noqa: BLE001
        raised = error
        status = getattr(error, "status_code", None)
        body = getattr(error, "body", None)
        code = body.get("code") if isinstance(body, dict) else None
        if status == 404 and code == "model_not_found":
            result.ok("an unknown chat model raises 404 model_not_found in the SDK")
        else:
            result.fail(
                f"an unknown chat model raised the wrong shape. The SDK caller keys on the "
                f"status and the code, so both matter: {describe(error)}"
            )

    rows = journal_rows(mock_origin, "/v1/chat/completions")
    if not rows:
        result.ok("the refused chat model made NO upstream call")
    else:
        result.fail(
            f"the refused chat model still reached the provider {len(rows)} time(s) as "
            f"{sorted({str(row.get('model')) for row in rows})} — a different model was "
            f"substituted, and a refusal that dispatches is worse than one that does not."
        )

    # The embeddings arm has its own resolver and its own catalogue section, so
    # "chat refuses an unknown model" says nothing about it.
    try:
        client.get_embeddings(unknown_embedding).embed_query("negative control")
        result.fail(
            f"the SDK returned a vector for '{unknown_embedding}', which no configuration "
            f"row holds. An index run would store vectors from an unknown model."
        )
    except Exception as error:  # noqa: BLE001
        status = getattr(error, "status_code", None)
        if status == 404:
            result.ok("an unknown embedding model raises 404 in the SDK")
        else:
            result.fail(f"an unknown embedding model raised the wrong shape: {describe(error)}")

    return raised


def assert_budget_contract(result: Result, posture: str, refusal: BaseException | None) -> int:
    """The budget refusal contract, as far as this stack can measure it.

    THE HALF THAT RUNS. elitea_sdk's budget_exceeded_from is the ONE place any
    SDK caller decides whether an error is a budget rejection. Feed it a REAL
    refusal body this gateway just produced for a NON-budget reason and require
    None. That is not a restatement of the reader: a reader that over-matched —
    on the status alone, or on any 4xx — would turn every model_not_found into
    a BudgetExceededError, and an agent would report "budget exhausted" for a
    missing model.

    THE HALF THAT DOES NOT. Driving a real 402 needs budget enforcement, and
    enforcement needs GATEWAY_NATS_URL, which this stack does not set: the
    gateway builds no governance store, Handler.budgetGate stays nil, and
    checkBudget returns "allowed" before it reads anything. So no request on
    this stack can be refused with 402, and the positive half — a 402 whose
    error.code carries the scope, raising BudgetExceededError with that scope —
    is unmeasured here. It is asserted in the gateway's own unit tests
    (TestBudgetRefusalMatchesSDKContract) and nowhere against a live SDK.

    `posture` is READ FROM THE RUNNING GATEWAY's log by the wrapper, never
    assumed. That is what stops this from becoming a permanent silent skip: if
    somebody wires enforcement into this stack, the `on` arm turns the run red
    until the positive half is written.
    """
    print("→ the budget refusal contract (elitea_sdk budget_exceeded_from):")
    try:
        from elitea_sdk.runtime.exceptions import budget_exceeded_from
    except Exception as error:  # noqa: BLE001
        abort(f"could not import elitea_sdk.runtime.exceptions: {describe(error)}")

    if refusal is None:
        result.fail(
            "the negative control produced no error, so the SDK's budget reader was handed "
            "nothing to judge. Read the negative-control lines above."
        )
    elif budget_exceeded_from(refusal) is None:
        result.ok("the SDK's budget reader does NOT match a real non-budget refusal")
    else:
        result.fail(
            "the SDK's budget reader matched a model_not_found refusal as a budget "
            "rejection. Every missing model would be reported to the user as an exhausted "
            "budget. The gateway must not put `budget_exceeded` in error.type for any "
            "refusal that is not one."
        )

    if posture == "off":
        result.note(
            "budget enforcement is OFF on this stack (the gateway logged "
            "'BUDGET ENFORCEMENT DISABLED'), so no request here can be refused with 402 "
            "and the typed-exception scope assertion DID NOT RUN.")
        return 0
    if posture == "on":
        result.fail(
            "the gateway now reports 'budget enforcement ENABLED', so this stack CAN "
            "produce a 402 — and this check still does not drive one. Write the positive "
            "half in deploy/scripts/sdk-client-check.py: exhaust the project ceiling, call "
            "invoke(), and require BudgetExceededError with scope "
            "'project_budget_exceeded'; then the member ceiling with scope "
            "'member_budget_exceeded'. This failure is the coverage claim going stale, not "
            "a broken stack.")
        return 1
    result.fail(
        f"the gateway's budget posture could not be read (wrapper reported {posture!r}). "
        f"It logs exactly one of 'budget enforcement ENABLED' or 'BUDGET ENFORCEMENT "
        f"DISABLED' at startup, so neither line means the gateway was not inspected — and "
        f"an unmeasured posture is not an absent one.")
    return 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", required=True,
                        help="the ONE origin that serves both /llm/v1 and /api/v2")
    parser.add_argument("--project", required=True, type=int)
    parser.add_argument("--auth-token", required=True, help="the PAT bearer the SDK sends")
    parser.add_argument("--chat-model", required=True, help="catalogue name of the chat model")
    parser.add_argument("--embedding-model", required=True, help="catalogue name of the embedding model")
    parser.add_argument("--credential", required=True,
                        help="the credential label the mock journal must record for this project")
    parser.add_argument("--mock-origin", default="http://llm-mock:8090")
    parser.add_argument("--embedding-dim", type=int, default=DEFAULT_EMBEDDING_DIM)
    parser.add_argument("--budget-posture", required=True, choices=("on", "off", "unknown"),
                        help="read from the running gateway's log by the wrapper")
    args = parser.parse_args()

    # Imported here rather than at module scope so --help works without the SDK
    # and so an import failure reports a cause instead of a traceback.
    try:
        from elitea_sdk.runtime.clients.client import EliteAClient
    except Exception as error:  # noqa: BLE001
        abort(f"could not import elitea_sdk: {describe(error)}. This file must run inside "
              f"an image that carries the locked SDK; the wrapper picks the running "
              f"elitea-worker's own image for that reason.")

    # The construction under test. Three arguments, exactly as an agent turn
    # builds it — no extra headers and no keyword overrides, so nothing here
    # can paper over a default that is wrong for the product.
    client = EliteAClient(
        base_url=args.base_url,
        project_id=args.project,
        auth_token=args.auth_token,
    )

    # The gateway strips the provider prefix before it dispatches, so the
    # upstream sees the bare name. Computed the same way embedding-path-check.sh
    # computes it.
    chat_wire = args.chat_model.split("/")[-1]
    embedding_wire = args.embedding_model.split("/")[-1]

    print(f"→ elitea-sdk client check: base_url={args.base_url} project={args.project}")
    print(f"   chat model '{args.chat_model}' -> wire '{chat_wire}'")
    print(f"   embedding model '{args.embedding_model}' -> wire '{embedding_wire}'")

    result = Result()
    assert_catalogue(result, client, args.chat_model, args.embedding_model)
    assert_chat(result, client, args.chat_model, chat_wire, args.credential, args.mock_origin)
    assert_embeddings(result, client, args.embedding_model, embedding_wire, args.credential,
                      args.mock_origin, args.embedding_dim)
    refusal = assert_unknown_model_refused(
        result, client, "vllm/SDK-CHECK-NO-SUCH-MODEL", "SDK-CHECK-NO-SUCH-EMBEDDING",
        args.mock_origin)
    expected = EXPECTED_ASSERTIONS + assert_budget_contract(result, args.budget_posture, refusal)

    print(f"→ elitea-sdk client: {result.ran} assertion(s) ran, {result.failed} failed "
          f"(expected {expected} to run).")
    if result.ran != expected:
        print("→ FAILED: assertions were skipped. An assertion that reports nothing is "
              "not a passed assertion.", file=sys.stderr)
        return 1
    if result.failed:
        return 1
    print("→ elitea-sdk client OK.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
