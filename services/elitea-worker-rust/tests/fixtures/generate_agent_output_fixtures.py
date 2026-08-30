#!/usr/bin/env python3
"""Regenerate exact Python-worker terminal agent output vectors."""

from __future__ import annotations

import sys
from pathlib import Path


WORKER_ROOT = Path(__file__).resolve().parents[2]
PLATFORM_ROOT = WORKER_ROOT.parents[1]
sys.path.insert(0, str(PLATFORM_ROOT / "libs/proto/gen/python"))
sys.path.insert(0, str(PLATFORM_ROOT / "services/elitea-worker-python/src"))

from elitea.runtime.v1 import agent_pb2, common_pb2, envelope_pb2  # noqa: E402
from elitea_worker.execution.errors import ExecutionCancelled  # noqa: E402
from elitea_worker.protocol.codec import (  # noqa: E402
    TestOnlyConformanceHmacAuthenticator,
    VerifiedWorkerCommand,
    build_output_frame,
    parse_and_verify_signed_command,
)


def main() -> None:
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
    result = agent_pb2.AgentExecutionResultV1(
        input_bundle_id="bundle-1",
        input_bundle_digest=common_pb2.DigestV1(
            algorithm=common_pb2.DIGEST_ALGORITHM_V1_SHA256,
            value=b"b" * 32,
        ),
        request_entry_id="agent-request",
        request_immutable_version="v1",
        request_content_digest=common_pb2.DigestV1(
            algorithm=common_pb2.DIGEST_ALGORITHM_V1_SHA256,
            value=b"c" * 32,
        ),
        terminal_state=agent_pb2.AGENT_EXECUTION_TERMINAL_STATE_V1_COMPLETED,
        result_artifact=agent_pb2.AgentExecutionArtifactReferenceV1(
            artifact_id="artifact-1",
            immutable_version="v1",
            media_type="application/vnd.elitea.agent-execution-result.v1+json",
            byte_length=123,
            digest=common_pb2.DigestV1(
                algorithm=common_pb2.DIGEST_ALGORITHM_V1_SHA256,
                value=b"a" * 32,
            ),
            classification="tenant-confidential",
        ),
    )
    completed = build_output_frame(
        verified,
        result,
        sequence=10,
        occurred_at_unix_millis=1_786_940_222_700,
        claim_handoff_watermark=4,
    )
    cancelled = build_output_frame(
        verified,
        ExecutionCancelled(),
        sequence=10,
        occurred_at_unix_millis=1_786_940_222_700,
        claim_handoff_watermark=4,
    )

    output = WORKER_ROOT / "tests/fixtures/agent_output_vectors.txt"
    output.write_text(
        "\n".join(
            [
                "agent_result_proto=" + result.SerializeToString(deterministic=True).hex(),
                "completed_output_frame="
                + completed.SerializeToString(deterministic=True).hex(),
                "cancelled_output_frame="
                + cancelled.SerializeToString(deterministic=True).hex(),
            ]
        )
        + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
