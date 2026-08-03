from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from elitea_worker.config import load_deploy_config, read_regular_file
from elitea_worker.constants import (
    CLAIM_LEASE_TTL_MILLIS,
    LIMITS_REVISION,
    MAX_LEASE_POLL_INTERVAL_MILLIS,
    MIN_REDIS_RECLAIM_IDLE_MILLIS,
)
from elitea_worker.execution.errors import InvalidInput


def _config(tmp_path: Path) -> dict[str, object]:
    return {
        "schema_version": "elitea.runtime-deploy.v1",
        "limits_revision": LIMITS_REVISION,
        "workload_session_id": "session-1",
        "producer_id": "producer-1",
        "consumer_id": "consumer-1",
        "redis_url": "rediss://elitea-worker@redis.internal:6379/0",
        "redis_password_path": str(tmp_path / "redis-password"),
        "redis_stream": "runtime.commands.v1",
        "redis_group": "python-workers",
        "control_target": "control.internal:8443",
        "output_target": "output.internal:8444",
        "content_origin": "https://content.internal",
        "platform_origin": "https://elitea.internal",
        "ca_path": str(tmp_path / "ca.pem"),
        "certificate_path": str(tmp_path / "worker.pem"),
        "private_key_path": str(tmp_path / "worker-key.pem"),
        "ed25519_keyring_path": str(tmp_path / "command-keys.json"),
        "spool_root": str(tmp_path / "spool"),
        "spool_key_path": str(tmp_path / "spool.key"),
        "agent_checkpoint_connection_path": str(tmp_path / "agent-checkpoint-connection"),
        "limits": {
            "redis_read_batch": 8,
            "redis_block_millis": 1000,
            "redis_reclaim_idle_millis": 60000,
            "redis_reclaim_interval_millis": 5000,
            "dependency_retry_millis": 250,
            "delivery_max_concurrency": 4,
            "delivery_queue_capacity": 8,
            "sync_max_workers": 2,
            "sync_max_in_flight": 4,
            "admission_timeout_millis": 1000,
            "grpc_deadline_millis": 5000,
            "content_timeout_millis": 15000,
            "http_max_connections": 8,
            "http_max_keepalive_connections": 4,
            "output_max_queued_frames": 2,
            "output_max_queued_bytes": 131072,
            "output_max_sessions": 2,
            "output_ack_timeout_millis": 15000,
            "output_stream_deadline_millis": 300000,
            "lease_poll_interval_millis": 10000,
            "shutdown_timeout_millis": 30000,
        },
    }


def _write_config(path: Path, value: dict[str, object]) -> None:
    path.write_text(json.dumps(value), encoding="utf-8")
    path.chmod(0o600)


def test_deploy_config_is_strict_file_only_and_credential_free(tmp_path: Path) -> None:
    path = tmp_path / "runtime.json"
    value = _config(tmp_path)
    _write_config(path, value)

    loaded = load_deploy_config(path)

    assert loaded.redis_url == "rediss://elitea-worker@redis.internal:6379/0"
    assert loaded.workload_session_id == "session-1"
    assert loaded.agent_checkpoint_connection_path == tmp_path / "agent-checkpoint-connection"
    assert loaded.limits.delivery_max_concurrency == 4
    assert loaded.limits.redis_max_entry_bytes == 64 * 1024
    assert loaded.limits.redis_max_field_bytes == 48 * 1024
    assert loaded.limits.grpc_max_request_bytes == 64 * 1024
    assert loaded.limits.grpc_max_response_bytes == 80 * 1024
    assert loaded.limits.content_max_body_bytes == 256 * 1024
    assert loaded.limits.output_max_frame_bytes == 64 * 1024
    assert not {
        "redis_max_entry_bytes",
        "redis_max_field_bytes",
        "grpc_max_request_bytes",
        "grpc_max_response_bytes",
        "content_max_body_bytes",
        "output_max_frame_bytes",
    }.intersection(loaded.limits.model_dump())

    value["redis_password"] = "must-never-be-inline"
    _write_config(path, value)
    with pytest.raises(InvalidInput):
        load_deploy_config(path)


def test_deploy_config_allows_non_agent_pool_without_checkpoint_database(
    tmp_path: Path,
) -> None:
    path = tmp_path / "runtime.json"
    value = _config(tmp_path)
    del value["agent_checkpoint_connection_path"]
    _write_config(path, value)

    loaded = load_deploy_config(path)

    assert loaded.agent_checkpoint_connection_path is None


@pytest.mark.parametrize(
    "redis_url",
    [
        "redis://redis.internal:6379/0",
        "rediss://redis.internal:6379/0",
        "rediss://user:password@redis.internal:6379/0",
        "rediss://elitea-worker@redis.internal:6379/0?token=secret",
        "rediss://elitea-worker@redis.internal/0",
        "rediss://elitea-worker@redis.internal:06379/0",
        "rediss://elitea-worker@redis.internal:6379",
        "rediss://elitea-worker@redis.internal:6379/1",
        "rediss://elitea-worker@redis.internal:6379/01",
        "rediss://elitea%2Dworker@redis.internal:6379/0",
        "rediss://elitea+worker@redis.internal:6379/0",
        "rediss://elitéa-worker@redis.internal:6379/0",
        "rediss://elitea-worker@rédis.internal:6379/0",
        " rediss://elitea-worker@redis.internal:6379/0",
    ],
)
def test_deploy_config_requires_credential_free_tls_redis(
    tmp_path: Path,
    redis_url: str,
) -> None:
    value = _config(tmp_path)
    value["redis_url"] = redis_url
    path = tmp_path / "runtime.json"
    _write_config(path, value)

    with pytest.raises(InvalidInput):
        load_deploy_config(path)


def test_lease_poll_interval_is_bounded_by_claim_authority(tmp_path: Path) -> None:
    assert CLAIM_LEASE_TTL_MILLIS == 30_000
    assert MAX_LEASE_POLL_INTERVAL_MILLIS == 10_000
    assert CLAIM_LEASE_TTL_MILLIS == 3 * MAX_LEASE_POLL_INTERVAL_MILLIS

    value = _config(tmp_path)
    value["limits"]["lease_poll_interval_millis"] = (  # type: ignore[index]
        MAX_LEASE_POLL_INTERVAL_MILLIS
    )
    path = tmp_path / "runtime.json"
    _write_config(path, value)
    assert load_deploy_config(path).limits.lease_poll_interval_millis == 10_000

    value["limits"]["lease_poll_interval_millis"] = (  # type: ignore[index]
        MAX_LEASE_POLL_INTERVAL_MILLIS + 1
    )
    _write_config(path, value)
    with pytest.raises(InvalidInput):
        load_deploy_config(path)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("redis_reclaim_idle_millis", MIN_REDIS_RECLAIM_IDLE_MILLIS - 1),
        (
            "redis_reclaim_interval_millis",
            MAX_LEASE_POLL_INTERVAL_MILLIS + 1,
        ),
    ],
)
def test_pel_heartbeat_and_reclaim_follow_the_claim_lease_profile(
    tmp_path: Path,
    field: str,
    value: int,
) -> None:
    config = _config(tmp_path)
    config["limits"][field] = value  # type: ignore[index]
    path = tmp_path / "runtime.json"
    _write_config(path, config)

    with pytest.raises(InvalidInput):
        load_deploy_config(path)


def test_pel_reclaim_profile_accepts_exact_fixed_boundaries(tmp_path: Path) -> None:
    assert MIN_REDIS_RECLAIM_IDLE_MILLIS == 2 * CLAIM_LEASE_TTL_MILLIS
    config = _config(tmp_path)
    config["limits"]["redis_reclaim_idle_millis"] = (  # type: ignore[index]
        MIN_REDIS_RECLAIM_IDLE_MILLIS
    )
    config["limits"]["redis_reclaim_interval_millis"] = (  # type: ignore[index]
        MAX_LEASE_POLL_INTERVAL_MILLIS
    )
    path = tmp_path / "runtime.json"
    _write_config(path, config)

    limits = load_deploy_config(path).limits
    assert limits.redis_reclaim_idle_millis == 60_000
    assert limits.redis_reclaim_interval_millis == 10_000


def test_config_and_private_material_reject_symlink_and_open_permissions(
    tmp_path: Path,
) -> None:
    real = tmp_path / "real.json"
    _write_config(real, _config(tmp_path))
    linked = tmp_path / "linked.json"
    linked.symlink_to(real)
    with pytest.raises(InvalidInput, match="unsafe"):
        load_deploy_config(linked)

    private = tmp_path / "spool.key"
    private.write_bytes(os.urandom(32))
    private.chmod(0o640)
    with pytest.raises(InvalidInput, match="unsafe"):
        read_regular_file(
            private,
            max_bytes=32,
            private=True,
            description="output spool key",
        )


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("redis_max_entry_bytes", 64 * 1024 - 1),
        ("redis_max_field_bytes", 48 * 1024 - 1),
        ("grpc_max_request_bytes", 128 * 1024),
        ("grpc_max_response_bytes", 128 * 1024),
        ("content_max_body_bytes", 1024 * 1024),
        ("output_max_frame_bytes", 128 * 1024),
    ],
)
def test_fixed_protocol_limits_are_not_deployment_overrides(
    tmp_path: Path,
    field: str,
    value: int,
) -> None:
    config = _config(tmp_path)
    config["limits"][field] = value  # type: ignore[index]
    path = tmp_path / "runtime.json"
    _write_config(path, config)

    with pytest.raises(InvalidInput):
        load_deploy_config(path)
