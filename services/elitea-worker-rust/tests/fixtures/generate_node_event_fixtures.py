#!/usr/bin/env python3
"""Regenerate exact Python-worker NodeEvent and output-frame vectors."""

from __future__ import annotations

import json
import sys
from pathlib import Path


WORKER_ROOT = Path(__file__).resolve().parents[2]
PLATFORM_ROOT = WORKER_ROOT.parents[1]
sys.path.insert(0, str(PLATFORM_ROOT / "libs/proto/gen/python"))
sys.path.insert(0, str(PLATFORM_ROOT / "services/elitea-worker-python/src"))

from elitea.runtime.v1 import common_pb2, envelope_pb2  # noqa: E402
from elitea_worker.protocol.codec import (  # noqa: E402
    TestOnlyConformanceHmacAuthenticator,
    VerifiedWorkerCommand,
    build_node_event_output_frame,
    parse_and_verify_signed_command,
)
from elitea_worker.protocol.node_event import (  # noqa: E402
    decode_current_node_event_json,
    encode_current_node_event_json,
)


def main() -> None:
    corpus_path = (
        PLATFORM_ROOT
        / "testdata/proto/runtime/v1/node-event/current-parity-corpus.json"
    )
    corpus = json.loads(corpus_path.read_text(encoding="utf-8"))
    event_raw = json.dumps(
        corpus["cases"][1]["event"],
        ensure_ascii=False,
        allow_nan=False,
        separators=(",", ":"),
    ).encode()
    event = decode_current_node_event_json(event_raw)

    vectors = {}
    for line in (WORKER_ROOT / "tests/fixtures/agent_command_vectors.txt").read_text().splitlines():
        name, value = line.split("=", 1)
        vectors[name] = bytes.fromhex(value)
    signed, command = parse_and_verify_signed_command(
        vectors["application_hmac"],
        authenticator=TestOnlyConformanceHmacAuthenticator(),
    )
    fence = common_pb2.ExecutionFenceV1(
        workload_session_id="workload-session-1",
        claim_attempt=3,
        lease_epoch=7,
        producer_id="rust-worker-fixture",
        fence_token=b"f" * 32,
    )
    verified = VerifiedWorkerCommand(
        envelope=envelope_pb2.WorkerExecutionEnvelopeV1(
            signed_command=signed,
            fence=fence,
        ),
        command=command,
    )
    frame = build_node_event_output_frame(
        verified,
        event,
        sequence=9,
        occurred_at_unix_millis=1_786_940_222_654,
        claim_handoff_watermark=4,
    )
    normalization_input = (
        b'{"type":"agent_response","content":'
        b'{"escaped":"\\u0061","float":1e0,"negative_zero":-0}}'
    )
    python_normalized = decode_current_node_event_json(normalization_input)

    output = WORKER_ROOT / "tests/fixtures/node_event_vectors.txt"
    output.write_text(
        "\n".join(
            [
                "browser_json=" + encode_current_node_event_json(event).hex(),
                "node_event_proto=" + event.SerializeToString(deterministic=True).hex(),
                "output_frame=" + frame.SerializeToString(deterministic=True).hex(),
                "normalization_input=" + normalization_input.hex(),
                "python_normalized_proto="
                + python_normalized.SerializeToString(deterministic=True).hex(),
                "python_normalized_browser_json="
                + encode_current_node_event_json(python_normalized).hex(),
            ]
        )
        + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
