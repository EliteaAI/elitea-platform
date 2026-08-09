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
    validation = document["capabilities"][0]
    assert validation["capabilityId"] == "configuration.validate.v1"
    assert "sdk-registry-validation" in validation["featureFlags"]
    assert "per-type-schema-binding" in validation["featureFlags"]
    assert "credential-free" not in validation["featureFlags"]
    assert "openapi" not in json.dumps(validation).lower()
    toolkit = document["capabilities"][1]
    assert toolkit["capabilityId"] == "toolkit.available_tools.v1"
    assert toolkit["interactionModel"] == "contract_handler_parity"
    assert "current-sdk-delegate" in toolkit["featureFlags"]
    assert "artifact-reference-output" in toolkit["featureFlags"]
    assert "production-delivery-not-wired" in toolkit["featureFlags"]
    index = document["capabilities"][2]
    assert index["capabilityId"] == "index.ingest.v1"
    assert index["capabilityVersion"] == "2"
    assert index["interactionModel"] == "durable_job"
    assert "current-sdk-delegate" in index["featureFlags"]
    assert "claim-bound-runtime-context" in index["featureFlags"]
    assert "bounded-sync-sdk-execution" in index["featureFlags"]
    application = document["capabilities"][3]
    assert application["capabilityId"] == "agent.execute.application.v1"
    assert application["capabilityVersion"] == "1"
    assert application["interactionModel"] == "durable_job"
    assert "durable-checkpoint-resume" in application["featureFlags"]
    assert "toolkit-authorization-continuation" in application["featureFlags"]
    adhoc = document["capabilities"][4]
    assert adhoc["capabilityId"] == "agent.execute.adhoc.v1"
    assert adhoc["capabilityVersion"] == "1"
    assert "toolkit-authorization-continuation" in adhoc["featureFlags"]
    assert document["runtimeConstraints"]["artifactSupport"] is True
    assert "shared-claim-scoped-authority" in document["runtimeConstraints"][
        "isolationClasses"
    ]
    assert "sdk-toolkit-configured" in document["runtimeConstraints"][
        "networkEgressClasses"
    ]
    assert document["protocolCompatibility"]["signatureProfiles"] == [
        "SIGNATURE_PROFILE_V1_TEST_ONLY_HMAC_SHA256"
    ]


def test_serve_manifest_cannot_advertise_public_conformance_signature() -> None:
    with pytest.raises(ValueError, match="production signature"):
        capability_message(startup_mode="serve")


def test_runnable_agent_kernels_are_advertised_as_runtime_capabilities() -> None:
    capability_ids = {
        capability.capability_id
        for capability in capability_message().capabilities
    }

    assert "agent.execute.application.v1" in capability_ids
    assert "agent.execute.adhoc.v1" in capability_ids
