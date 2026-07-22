"""Real CLI subprocess lifecycle with fake unavailable Redis.

This verifies production config/trust bootstrap, retry and SIGTERM handling. It
does not claim to be the Go/Python/PostgreSQL/Redis/TLS cross-process E2E test.
"""

from __future__ import annotations

import base64
import json
import os
import signal
import subprocess
import sys
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ed25519, rsa
from cryptography.x509.oid import NameOID

from elitea_worker.constants import LIMITS_REVISION
from elitea_worker.config import load_deploy_config
from elitea_worker.security import RuntimeTrustMaterial


_ROOT = Path(__file__).parents[4]


def test_serve_subprocess_retries_safely_then_drains_on_sigterm(tmp_path: Path) -> None:
    fake_packages = tmp_path / "fake-packages"
    redis_package = fake_packages / "redis"
    redis_asyncio = redis_package / "asyncio"
    redis_asyncio.mkdir(parents=True)
    (redis_package / "__init__.py").write_text("", encoding="utf-8")
    (redis_package / "exceptions.py").write_text(
        "class ResponseError(Exception):\n    pass\n",
        encoding="utf-8",
    )
    (redis_asyncio / "__init__.py").write_text(
        """
class ConnectionPool:
    def __init__(self, **kwargs):
        self.kwargs = kwargs
    async def aclose(self):
        return None

class _UnavailableRedis:
    def __init__(self, *, connection_pool):
        self.connection_pool = connection_pool
    async def ping(self):
        raise OSError("simulated unavailable Redis")
    async def aclose(self):
        return None

Redis = _UnavailableRedis
""".lstrip(),
        encoding="utf-8",
    )
    (redis_asyncio / "connection.py").write_text(
        """
class Connection:
    def _connection_arguments(self):
        return {"host": "redis.invalid", "port": 6379}

class SSLConnection(Connection):
    pass
""".lstrip(),
        encoding="utf-8",
    )

    config_path = _write_runtime_material(tmp_path)
    trust = RuntimeTrustMaterial.load(load_deploy_config(config_path))
    # The private-plane context contains only the deployment CA, not the host
    # machine's system trust store.
    assert len(trust.http_client_context().get_ca_certs()) == 1
    python_path = os.pathsep.join(
        (
            str(fake_packages),
            str(_ROOT / "services/elitea-worker-python/src"),
            str(_ROOT / "libs/proto/gen/python"),
        )
    )
    environment = os.environ.copy()
    environment["PYTHONPATH"] = python_path
    process = subprocess.Popen(
        [sys.executable, "-m", "elitea_worker", "serve", "--config", str(config_path)],
        cwd=_ROOT,
        env=environment,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    try:
        time.sleep(0.5)
        assert process.poll() is None, process.stderr.read() if process.stderr else ""
        process.send_signal(signal.SIGTERM)
        stdout, stderr = process.communicate(timeout=5)
    finally:
        if process.poll() is None:
            process.kill()
            process.wait(timeout=5)

    assert process.returncode == 0
    assert stdout == ""
    assert '"event":"redis_startup_unavailable"' in stderr
    assert '"safe_message":"A required runtime dependency is unavailable."' in stderr
    assert "simulated unavailable Redis" not in stderr
    assert "Traceback" not in stderr


def _write_runtime_material(root: Path) -> Path:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "worker.test")])
    now = datetime.now(UTC)
    certificate = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(minutes=1))
        .not_valid_after(now + timedelta(days=1))
        .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
        .sign(key, hashes.SHA256())
    )
    certificate_pem = certificate.public_bytes(serialization.Encoding.PEM)
    private_key_pem = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    ca_path = root / "ca.pem"
    certificate_path = root / "worker.pem"
    private_key_path = root / "worker-key.pem"
    ca_path.write_bytes(certificate_pem)
    certificate_path.write_bytes(certificate_pem)
    private_key_path.write_bytes(private_key_pem)
    private_key_path.chmod(0o600)

    signing_key = ed25519.Ed25519PrivateKey.generate()
    signing_public = signing_key.public_key().public_bytes(
        serialization.Encoding.Raw,
        serialization.PublicFormat.Raw,
    )
    keyring_path = root / "command-keys.json"
    keyring_path.write_text(
        json.dumps(
            {
                "schema_version": "elitea.runtime-ed25519-keyring.v1",
                "keys": [
                    {
                        "key_id": "runtime-signing-1",
                        "public_key_base64": base64.b64encode(signing_public).decode(),
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    spool_key_path = root / "spool.key"
    spool_key_path.write_bytes(os.urandom(32))
    spool_key_path.chmod(0o600)
    redis_password_path = root / "redis-password"
    redis_password_path.write_bytes(b"test-redis-password")
    redis_password_path.chmod(0o600)
    spool_root = root / "spool"
    spool_root.mkdir(mode=0o700)

    config = {
        "schema_version": "elitea.runtime-deploy.v1",
        "limits_revision": LIMITS_REVISION,
        "workload_session_id": "session-1",
        "producer_id": "producer-1",
        "consumer_id": "consumer-1",
        "redis_url": "rediss://elitea-worker@redis.invalid:6379/0",
        "redis_password_path": str(redis_password_path),
        "redis_stream": "runtime.commands.v1",
        "redis_group": "python-workers",
        "control_target": "control.invalid:8443",
        "output_target": "output.invalid:8444",
        "content_origin": "https://content.invalid",
        "platform_origin": "https://elitea.invalid",
        "ca_path": str(ca_path),
        "certificate_path": str(certificate_path),
        "private_key_path": str(private_key_path),
        "ed25519_keyring_path": str(keyring_path),
        "spool_root": str(spool_root),
        "spool_key_path": str(spool_key_path),
        "limits": {
            "redis_read_batch": 1,
            "redis_block_millis": 100,
            "redis_reclaim_idle_millis": 60000,
            "redis_reclaim_interval_millis": 100,
            "dependency_retry_millis": 100,
            "delivery_max_concurrency": 1,
            "delivery_queue_capacity": 1,
            "sync_max_workers": 1,
            "sync_max_in_flight": 1,
            "admission_timeout_millis": 100,
            "grpc_deadline_millis": 100,
            "content_timeout_millis": 100,
            "http_max_connections": 1,
            "http_max_keepalive_connections": 1,
            "output_max_queued_frames": 1,
            "output_max_queued_bytes": 65536,
            "output_max_sessions": 1,
            "output_ack_timeout_millis": 100,
            "output_stream_deadline_millis": 100,
            "lease_poll_interval_millis": 100,
            "shutdown_timeout_millis": 1000,
        },
    }
    config_path = root / "runtime.json"
    config_path.write_text(json.dumps(config), encoding="utf-8")
    config_path.chmod(0o600)
    return config_path
