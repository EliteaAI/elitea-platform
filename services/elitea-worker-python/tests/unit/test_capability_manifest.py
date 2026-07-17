import json

import pytest

from elitea_worker.capabilities import capability_document, capability_json, capability_message
from elitea_worker.constants import SDK_SOURCE_REVISION


def test_capability_document_is_deterministic_and_pinned() -> None:
    first = capability_json()
    second = capability_json()

    assert first == second
    assert json.dumps(json.loads(first), sort_keys=True, separators=(",", ":")) == first
    document = capability_document()
    assert document["sdkFrameworkCompatibility"]["eliteaSdkRevision"] == SDK_SOURCE_REVISION
    assert document["capabilities"][0]["capabilityId"] == "configuration.validate.v1"
    assert "credential-free" in document["capabilities"][0]["featureFlags"]
    toolkit = document["capabilities"][1]
    assert toolkit["capabilityId"] == "toolkit.available_tools.v1"
    assert toolkit["interactionModel"] == "contract_handler_parity"
    assert "artifact-reference-output" in toolkit["featureFlags"]
    assert "production-delivery-not-wired" in toolkit["featureFlags"]
    assert document["runtimeConstraints"]["artifactSupport"] is True
    assert document["protocolCompatibility"]["signatureProfiles"] == [
        "SIGNATURE_PROFILE_V1_TEST_ONLY_HMAC_SHA256"
    ]


def test_serve_manifest_cannot_advertise_public_conformance_signature() -> None:
    with pytest.raises(ValueError, match="production signature"):
        capability_message(startup_mode="serve")
