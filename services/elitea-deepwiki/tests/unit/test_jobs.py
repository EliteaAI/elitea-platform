"""The Kubernetes-Job manifest — ADR-0022 decision 7.

No cluster was available, so nothing here creates a real Job. What is asserted
is the **manifest**, which is the artifact the ADR constrains:

    the licence-credential init container that cloned the plugin source at Job
    start [is dropped] (the engine is baked into the published image), and
    secret material in Job environment variables [does not survive]
    (projected files only)

Both are structural properties of a manifest and are checkable without a
cluster. What is *not* checked is that a cluster accepts and runs it — stated
plainly in `jobs.py` and again here, because a green suite here is not evidence
of a working Job.

The kubernetes client is faked rather than installed: the real library's model
classes are constructors that record their arguments, which is all the manifest
assertions need, and faking them keeps this suite free of a heavyweight
dependency that the shell image does not carry.
"""

from __future__ import annotations

import pytest

from elitea_deepwiki.jobs import (
    CREDENTIALS_MOUNT_PATH,
    WORKER_MODULE,
    PortedJobManager,
    _is_secret_env,
)


class FakeModel:
    """Records its keyword arguments, like the kubernetes client's models do."""

    def __init__(self, **kwargs):
        self.__dict__.update(kwargs)

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"{type(self).__name__}({self.__dict__})"


class FakeClient:
    """Every ``V1*`` name resolves to a recording constructor."""

    def __getattr__(self, name: str):
        if not name.startswith("V1"):
            raise AttributeError(name)
        return type(name, (FakeModel,), {})


class FakeDelegate:
    """The copied manager, reduced to the attributes the builder reads."""

    namespace = "deepwiki"
    ttl_seconds = 3600
    worker_image = "ghcr.io/eliteaai/elitea-deepwiki:1.2.3"
    image_pull_policy = "IfNotPresent"
    base_path = "/var/scratch/deepwiki"
    resources = {"requests": {"cpu": "1"}, "limits": {"cpu": "2"}}


@pytest.fixture
def client() -> FakeClient:
    return FakeClient()


@pytest.fixture
def manager() -> PortedJobManager:
    return PortedJobManager(FakeDelegate())


@pytest.fixture
def secured_manager() -> PortedJobManager:
    return PortedJobManager(FakeDelegate(), credentials_secret="deepwiki-callback")


def pod_spec(job):
    return job.spec.template.spec


def container(job):
    return pod_spec(job).containers[0]


# ---------------------------------------------------------------------------
# the init container
# ---------------------------------------------------------------------------


def test_there_is_no_init_container(manager, client):
    """ADR-0022 decision 7, first named retirement.

    The legacy one git-cloned deepwiki_plugin from GitHub with a licence
    credential and pip-installed its requirements, on every job. That made
    every generation depend on GitHub being reachable and on a long-lived
    credential in the controller's environment.
    """
    job = manager.build_job(client, "job-1")
    assert pod_spec(job).init_containers is None


# ---------------------------------------------------------------------------
# the worker command
# ---------------------------------------------------------------------------


def test_the_worker_runs_an_installed_module(manager, client):
    """Not a probed file path.

    The legacy command was a shell that tried /data/plugins/... then
    /app/deepwiki_plugin/... and executed whichever existed. Neither path
    exists in this image, and a shell falling through to a second guess turns
    a missing engine into a confusing failure instead of an ImportError that
    names the module.
    """
    job = manager.build_job(client, "job-1")
    worker = container(job)

    assert worker.command == ["python", "-m", WORKER_MODULE]
    assert worker.args == ["--job-id=job-1"]

    rendered = " ".join(worker.command + worker.args)
    assert "/bin/sh" not in rendered
    assert "/data/plugins" not in rendered
    assert "/app/deepwiki_plugin" not in rendered


def test_the_module_named_is_the_one_that_exists():
    """A typo here would only surface as a Job that fails to start."""
    import importlib.util

    assert importlib.util.find_spec(WORKER_MODULE) is not None


# ---------------------------------------------------------------------------
# secrets
# ---------------------------------------------------------------------------


def test_credentials_arrive_on_a_projected_volume(secured_manager, client):
    """ADR-0022 decision 7, second named retirement: projected files only."""
    job = secured_manager.build_job(client, "job-1")

    volumes = {volume.name: volume for volume in pod_spec(job).volumes}
    assert "credentials" in volumes

    projected = volumes["credentials"].projected
    assert projected.sources[0].secret.name == "deepwiki-callback"
    # Owner-readable only: the pod runs as one user, and anything wider is a
    # group- or world-readable token.
    assert projected.default_mode == 0o400

    mount = next(
        m for m in container(job).volume_mounts if m.name == "credentials"
    )
    assert mount.mount_path == CREDENTIALS_MOUNT_PATH
    assert mount.read_only is True


def test_the_worker_is_told_where_to_read_them(secured_manager, client):
    env = {item.name: item.value for item in container(secured_manager.build_job(client, "j")).env}
    assert env["ELITEA_DEEPWIKI_CREDENTIALS_DIR"] == CREDENTIALS_MOUNT_PATH


def test_no_secret_looking_variable_reaches_the_job(manager, client, monkeypatch):
    """The legacy manager forwarded every DEEPWIKI_* variable wholesale.

    That is convenient for feature flags and catastrophic for tokens: an
    environment variable is readable by every process in the pod, shows up in
    `kubectl describe`, and is captured by crash reporters. The pass-through
    is kept; the deny-list is new.
    """
    monkeypatch.setenv("DEEPWIKI_ENABLE_FTS5", "1")
    monkeypatch.setenv("DEEPWIKI_ARTIFACT_TOKEN", "a-real-looking-token")
    monkeypatch.setenv("DEEPWIKI_CALLBACK_SECRET", "shhh")
    monkeypatch.setenv("DEEPWIKI_API_KEY", "sk-live-xxxx")
    monkeypatch.setenv("DEEPWIKI_DB_PASSWORD", "hunter2")

    env = {item.name: item.value for item in container(manager.build_job(client, "j")).env}

    assert env["DEEPWIKI_ENABLE_FTS5"] == "1", "feature flags must still pass through"
    for leaked in (
        "DEEPWIKI_ARTIFACT_TOKEN",
        "DEEPWIKI_CALLBACK_SECRET",
        "DEEPWIKI_API_KEY",
        "DEEPWIKI_DB_PASSWORD",
    ):
        assert leaked not in env, f"{leaked} was copied into the Job spec"

    # And no *value* of a secret appears anywhere in the env, whatever the key.
    values = set(env.values())
    for secret in ("a-real-looking-token", "shhh", "sk-live-xxxx", "hunter2"):
        assert secret not in values


@pytest.mark.parametrize(
    "name,secret",
    [
        ("DEEPWIKI_ARTIFACT_TOKEN", True),
        ("DEEPWIKI_X_SECRET", True),
        ("DEEPWIKI_API_KEY", True),
        ("DEEPWIKI_DB_PASSWORD", True),
        ("DEEPWIKI_LICENSE_CREDENTIAL", True),
        ("DEEPWIKI_ENABLE_FTS5", False),
        ("DEEPWIKI_MAX_CONCURRENT_JOBS", False),
        ("DEEPWIKI_NAMESPACE", False),
    ],
)
def test_the_secret_name_heuristic(name: str, secret: bool):
    assert _is_secret_env(name) is secret


def test_without_a_configured_secret_there_is_no_credentials_volume(manager, client):
    """A deployment that has not set one gets no volume, not an empty one."""
    job = manager.build_job(client, "job-1")
    assert [v.name for v in pod_spec(job).volumes] == ["data"]
    assert [m.name for m in container(job).volume_mounts] == ["data"]


# ---------------------------------------------------------------------------
# the rest of the manifest
# ---------------------------------------------------------------------------


def test_labels_match_what_slot_accounting_selects_on(manager, client):
    """`/slots` counts Jobs with `app=deepwiki-worker`.

    A manifest that stopped carrying the label would make every running Job
    invisible to capacity accounting — the service would report full
    availability while the cluster was saturated.
    """
    job = manager.build_job(client, "job-7")
    assert job.metadata.labels["app"] == "deepwiki-worker"
    assert job.metadata.labels["job-id"] == "job-7"
    assert job.spec.template.metadata.labels["app"] == "deepwiki-worker"


def test_the_job_does_not_retry(manager, client):
    """backoff_limit 0: a retry would re-clone and re-index from scratch."""
    assert manager.build_job(client, "j").spec.backoff_limit == 0


def test_the_worker_runs_unprivileged(manager, client):
    worker = container(manager.build_job(client, "j"))
    assert worker.security_context.run_as_user == 33
    assert worker.security_context.allow_privilege_escalation is False
    assert pod_spec(manager.build_job(client, "j")).security_context.run_as_user == 33


def test_the_image_and_namespace_come_from_the_delegate(manager, client):
    job = manager.build_job(client, "j")
    assert container(job).image == FakeDelegate.worker_image
    assert job.metadata.namespace == FakeDelegate.namespace


def test_everything_else_is_delegated(manager):
    """Status, logs, results and cleanup are the copied manager's.

    Re-implementing 800 working lines to change 200 would be the wrong trade,
    and this asserts the delegation actually happens rather than the methods
    quietly not existing.
    """
    delegate = manager._delegate
    delegate.get_job_status = lambda job_id: {"status": "Running", "id": job_id}
    delegate.cleanup_job = lambda *a, **k: True

    assert manager.get_job_status("abc") == {"status": "Running", "id": "abc"}
    assert manager.cleanup_job("abc") is True


# ---------------------------------------------------------------------------
# the substitution
# ---------------------------------------------------------------------------


def test_installing_repoints_the_engine_module():
    """`tool_operations._run_wiki_job` imports get_job_manager from the engine.

    It does so inside the function, so replacing the attribute is enough and
    no import ordering matters — but only if the name is replaced on the
    module the tool layer actually imports from.
    """
    from elitea_deepwiki import jobs
    from elitea_deepwiki.engine import k8s_job_manager

    original = k8s_job_manager.get_job_manager
    try:
        jobs.install()
        assert k8s_job_manager.get_job_manager is jobs.get_job_manager
    finally:
        k8s_job_manager.get_job_manager = original


def test_the_tool_layer_imports_the_name_we_replace():
    """Guards the substitution against an engine re-sync moving the import."""
    from pathlib import Path

    from elitea_deepwiki import tool_operations

    source = Path(tool_operations.__file__).read_text(encoding="utf-8")
    assert "from .engine.k8s_job_manager import get_job_manager" in source


def test_the_worker_module_actually_starts_under_dash_m():
    """The command the manifest issues, executed.

    `find_spec` only proves the module is importable. This runs exactly what
    the Job's command runs — `python -m <module> --help` — which additionally
    proves the module has a `__main__` guard and parses `--job-id`. Without a
    guard, `-m` would import the module and exit 0 having done nothing, and
    the Job would report success while generating no wiki.

    The engine's own docstring documents `python -m ... --job-id=<id>` as the
    intended invocation; the legacy Job manager was the thing running it as a
    file instead.
    """
    import subprocess
    import sys

    result = subprocess.run(
        [sys.executable, "-m", WORKER_MODULE, "--help"],
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert result.returncode == 0, result.stderr
    assert "--job-id" in result.stdout


def test_the_manifest_passes_the_flag_the_worker_parses():
    """command + args must compose into the worker's actual CLI.

    Kubernetes appends `args` to `command`, so the process sees
    `python -m <module> --job-id=<id>`. Splitting them the other way round —
    or passing `--job_id` — would only fail inside a cluster.
    """
    manager = PortedJobManager(FakeDelegate())
    job = manager.build_job(FakeClient(), "abc123")
    worker = container(job)

    argv = worker.command + worker.args
    assert argv[:2] == ["python", "-m"]
    assert argv[-1] == "--job-id=abc123"
