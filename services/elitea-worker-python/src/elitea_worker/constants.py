"""Immutable build and first-slice compatibility pins."""

from __future__ import annotations

CONFIGURATION_VALIDATION_CAPABILITY_ID = "configuration.validate.v1"
TOOLKIT_AVAILABLE_TOOLS_CAPABILITY_ID = "toolkit.available_tools.v1"
INDEX_INGEST_CAPABILITY_ID = "index.ingest.v1"
# Backward-compatible name used by the first validation slice.
CAPABILITY_ID = CONFIGURATION_VALIDATION_CAPABILITY_ID
RUNTIME_IMPLEMENTATION = "elitea-worker-python"
RUNTIME_VERSION = "0.1.0"

# The current Pylon Indexer baseline is distribution 0.8.30. The standalone
# worker admits the exact source revision installed by the current runtime,
# rather than a floating branch or a later same-version source artifact.
SDK_SOURCE_REVISION = "48c51a16634a9924f6c5d5313c3bacedb0b5b56b"
SDK_DISTRIBUTION_VERSION = "0.8.30"
SDK_SOURCE_ARCHIVE_SHA256 = (
    "85e8b2396dc86ea8e7d2098a41e12b228fa1995a0be8ff0143af6d3df49b6d61"
)
SDK_PACKAGE_TREE_SHA256 = (
    "c3e756b2c57cb86f8776a5c3e087ad8aeaa6459096d16d6dd7969a16d553eb87"
)
# SDK 0.8.30 preserves the exact admitted configuration catalog and index-type
# source from 0.8.26. Keep those independently versioned immutable projections
# stable instead of forcing unrelated Main snapshot churn.
CONFIGURATION_CATALOG_REVISION = "a78d3654f99d8ff89ca7233f20a66d676e564f79"
CONFIGURATION_CATALOG_SHA256 = (
    "4a96e3ab8e3842ebf2645a851aeb12e3e2343f28e7d024c1a2960eb4ec254351"
)
INDEX_TYPES_SOURCE_REVISION = CONFIGURATION_CATALOG_REVISION

JSON_MEDIA_TYPES = frozenset({"application/json", "application/json; charset=utf-8"})
MAX_ENVELOPE_BYTES = 64 * 1024
MAX_WORKER_COMMAND_BYTES = 32 * 1024
MAX_SIGNED_ENVELOPE_BYTES = 48 * 1024
MAX_MANIFEST_BYTES = 64 * 1024
MAX_GRPC_REQUEST_BYTES = 64 * 1024
MAX_GRPC_RESPONSE_BYTES = 80 * 1024
MAX_SETTINGS_BYTES = 256 * 1024
MAX_BUNDLE_ENTRIES = 16
MAX_ISSUES = 64
MAX_JSON_DEPTH = 64
MAX_STRING_BYTES = 64 * 1024
MAX_SAFE_STRING_BYTES = 256

ENVELOPE_SCHEMA_REVISION = "elitea.runtime.signed-worker-command.v1"
PROTOCOL_REVISION = "elitea.runtime.v1"
CAPABILITY_VERSION = "1"
LIMITS_REVISION = "elitea.runtime.limits.conformance.v1"
CLAIM_LEASE_TTL_MILLIS = 30_000
MAX_LEASE_POLL_INTERVAL_MILLIS = 10_000
MIN_REDIS_RECLAIM_IDLE_MILLIS = 2 * CLAIM_LEASE_TTL_MILLIS
OUTPUT_SCHEMA_REVISION = "elitea.runtime.execution-output.v1"
CONFORMANCE_HMAC_KEY_ID = "elitea-runtime-v1-conformance-hmac"
CONFORMANCE_HMAC_KEY = b"ELITEA_RUNTIME_V1_TEST_ONLY_NOT_A_SECRET"
CONFORMANCE_OCCURRED_AT_UNIX_MILLIS = 1_700_000_000_000
