from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from elitea.runtime.v1 import node_event_pb2
from elitea_worker.protocol.node_event import (
    MAX_CURRENT_NODE_EVENT_JSON_BYTES,
    InvalidCurrentNodeEvent,
    decode_current_node_event_json,
    encode_current_node_event_json,
)


_SERVICE_ROOT = Path(__file__).resolve().parents[2]
_PLATFORM_ROOT = _SERVICE_ROOT.parents[1]
_CORPUS_PATH = (
    _PLATFORM_ROOT / "testdata/proto/runtime/v1/node-event/current-parity-corpus.json"
)
_CURRENT_FIELDS = {
    "type",
    "stream_id",
    "message_id",
    "question_id",
    "content",
    "thinking",
    "response_metadata",
    "references",
    "sio_event",
    "created_at",
    "parent_message_id",
    "agent_name",
    "execution_generation",
}


def test_current_node_event_parity_corpus_round_trips_without_ui_changes() -> None:
    corpus = json.loads(_CORPUS_PATH.read_text(encoding="utf-8"))
    assert corpus["contract_revision"] == "elitea.runtime.node-event.v1"
    assert len(corpus["cases"]) >= 2
    assert len(corpus["current_event_types"]) == 35
    assert len(set(corpus["current_event_types"])) == 35
    for event_type in corpus["current_event_types"]:
        assert decode_current_node_event_json(_canonical({"type": event_type})).type == event_type

    for case in corpus["cases"]:
        raw = _canonical(case["event"])
        event = decode_current_node_event_json(raw)
        wire = event.SerializeToString(deterministic=True)
        assert len(wire) < 64 * 1024
        assert case["wire_sha256"]
        assert hashlib.sha256(wire).hexdigest() == case["wire_sha256"]

        encoded = encode_current_node_event_json(event)
        assert json.loads(encoded) == case["event"]
        assert set(json.loads(encoded)) == _CURRENT_FIELDS


def test_current_node_event_codec_applies_defaults_and_strict_bounds() -> None:
    event = decode_current_node_event_json(
        b'{"type":"agent_exception","content":"safe failure"}'
    )
    encoded = json.loads(encode_current_node_event_json(event))
    assert set(encoded) == _CURRENT_FIELDS
    assert encoded["response_metadata"] == {}
    assert encoded["references"] == []
    assert encoded["stream_id"] is None

    deep = (
        b'{"type":"agent_response","content":'
        + b"[" * 65
        + b"null"
        + b"]" * 65
        + b"}"
    )
    oversized = (
        b'{"type":"agent_response","content":"'
        + b"x" * MAX_CURRENT_NODE_EVENT_JSON_BYTES
        + b'"}'
    )
    invalid = [
        b"[]",
        b'{"content":null}',
        b'{"type":"agent_response","unknown":true}',
        b'{"type":"agent_response","type":"agent_exception"}',
        b'{"type":"agent_response","response_metadata":[]}',
        b'{"type":"agent_response","references":{}}',
        b'{"type":"agent_response","created_at":"not-a-time"}',
        b'{"type":"agent_response","stream_id":"unsafe\\nroom"}',
        b'{"type":"agent_response","content":NaN}',
        b'{"type":"agent_response","response_metadata":{"state":"first","state":"second"}}',
        deep,
        oversized,
    ]
    for raw in invalid:
        with pytest.raises(InvalidCurrentNodeEvent):
            decode_current_node_event_json(raw)


def test_current_node_event_encoder_rejects_bad_fragments_and_size() -> None:
    with pytest.raises(InvalidCurrentNodeEvent):
        encode_current_node_event_json(
            node_event_pb2.NodeEventV1(
                type="agent_response",
                content=b"null",
                response_metadata=b"[]",
                references=b"[]",
            )
        )

    with pytest.raises(InvalidCurrentNodeEvent):
        encode_current_node_event_json(
            node_event_pb2.NodeEventV1(
                type="agent_response",
                content=b"null",
                thinking="x" * MAX_CURRENT_NODE_EVENT_JSON_BYTES,
                response_metadata=b"{}",
                references=b"[]",
            )
        )

    with pytest.raises(InvalidCurrentNodeEvent):
        encode_current_node_event_json(
            node_event_pb2.NodeEventV1(
                type="agent_response",
                content=b"null",
                response_metadata=b'{"state":"first","state":"second"}',
                references=b"[]",
            )
        )


def _canonical(value: object) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        allow_nan=False,
        separators=(",", ":"),
    ).encode("utf-8")
