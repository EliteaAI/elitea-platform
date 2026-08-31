"""The Kubernetes-Job launch path, repointed at this service's layout.

ADR-0022 decision 7 keeps execution out of process — subprocess workers for
compose and dev, Kubernetes Jobs for scale — and names two legacy practices
that do **not** survive:

    the licence-credential init container that cloned the plugin source at Job
    start (the engine is baked into the published image), and secret material
    in Job environment variables (projected files only).

Both live in the Job manifest, so this subclasses the copied
:class:`K8sJobManager` and replaces exactly the manifest construction. Slot
accounting, status, failure diagnosis, log streaming, result reading and
cleanup are inherited unchanged — none of them is what the ADR alters, and
re-implementing 800 working lines to change 200 would be the wrong trade.

WHAT CHANGES, AND WHY EACH ONE.
-------------------------------
**No init container.** The legacy one git-cloned ``deepwiki_plugin`` from
GitHub with a licence credential and pip-installed its requirements, at Job
start, on every job. That made every generation depend on GitHub being up and
on a long-lived credential being present in the controller's environment. The
engine and its closure are in the image now, so the container starts with what
it needs.

**A module, not a file path.** The legacy command probed two filesystem
locations for ``plugin_implementation/wiki_job_worker.py`` and executed
whichever it found. Neither exists here. The worker is an installed module and
is run as one, which also means a missing engine fails as an import error
naming the module rather than as a shell falling through to a second guess.

**Secrets as projected files.** The legacy manifest put artifact credentials —
a bearer token among them — into ``V1EnvVar`` values. Environment variables
are readable by every process in the pod, appear in ``kubectl describe``, and
are captured by crash reporters. A projected Secret volume is readable by the
process that opens the file and is what the ADR requires.

WHAT IS NOT VERIFIED.
---------------------
No cluster was available, so this has never created a real Job. What *is*
verified is the manifest, in detail, against a fake Kubernetes client — and
the manifest is the artifact the ADR constrains. That distinction is stated
here rather than left for someone to discover.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any

logger = logging.getLogger(__name__)

#: Where the projected Secret volume is mounted in the worker pod. The worker
#: reads its callback credentials from files here instead of the environment.
CREDENTIALS_MOUNT_PATH = "/var/run/deepwiki/credentials"

#: The installed module the worker runs as.
WORKER_MODULE = "elitea_deepwiki.engine.wiki_job_worker"

#: Environment variables that must never be copied into a Job spec, because
#: they carry secret material. The legacy manager forwarded every ``DEEPWIKI_*``
#: variable wholesale; this is the deny-list that pass-through now honours.
SECRET_ENV_SUFFIXES = ("_TOKEN", "_SECRET", "_KEY", "_PASSWORD", "_CREDENTIAL")


def _is_secret_env(name: str) -> bool:
    upper = name.upper()
    return any(upper.endswith(suffix) for suffix in SECRET_ENV_SUFFIXES)


class PortedJobManager:
    """Builds Job manifests for this service's image layout.

    Composed onto the copied manager rather than replacing it: everything
    except manifest construction is delegated, so the parts the ADR does not
    change keep their tested behaviour.
    """

    def __init__(self, delegate: Any, *, credentials_secret: str | None = None):
        self._delegate = delegate
        self._credentials_secret = credentials_secret or os.environ.get(
            "ELITEA_DEEPWIKI_JOB_CREDENTIALS_SECRET"
        )

    # Everything not overridden below is the copied manager's.
    def __getattr__(self, name: str) -> Any:
        return getattr(self._delegate, name)

    # -- the part ADR-0022 changes ----------------------------------------

    def build_job(self, client, job_id: str) -> Any:
        """Build the Job manifest for ``job_id``.

        Separated from :meth:`create_job` so the manifest can be inspected
        without a cluster — which is how it is tested, and the only way it
        currently can be.
        """
        delegate = self._delegate
        job_name = f"deepwiki-worker-{job_id}"

        volumes = [
            client.V1Volume(name="data", empty_dir=client.V1EmptyDirVolumeSource())
        ]
        volume_mounts = [client.V1VolumeMount(name="data", mount_path="/data")]

        if self._credentials_secret:
            volumes.append(
                client.V1Volume(
                    name="credentials",
                    projected=client.V1ProjectedVolumeSource(
                        sources=[
                            client.V1VolumeProjection(
                                secret=client.V1SecretProjection(
                                    name=self._credentials_secret
                                )
                            )
                        ],
                        # Owner-readable only. The pod runs as a single user;
                        # anything wider is a group- or world-readable token.
                        default_mode=0o400,
                    ),
                )
            )
            volume_mounts.append(
                client.V1VolumeMount(
                    name="credentials",
                    mount_path=CREDENTIALS_MOUNT_PATH,
                    read_only=True,
                )
            )

        return client.V1Job(
            api_version="batch/v1",
            kind="Job",
            metadata=client.V1ObjectMeta(
                name=job_name,
                namespace=delegate.namespace,
                labels={
                    "app": "deepwiki-worker",
                    "job-id": job_id,
                    "created-by": "deepwiki-controller",
                },
            ),
            spec=client.V1JobSpec(
                ttl_seconds_after_finished=delegate.ttl_seconds,
                backoff_limit=0,  # fail fast; a retry would re-clone and re-index
                template=client.V1PodTemplateSpec(
                    metadata=client.V1ObjectMeta(
                        labels={"app": "deepwiki-worker", "job-id": job_id}
                    ),
                    spec=client.V1PodSpec(
                        restart_policy="Never",
                        service_account_name=os.environ.get(
                            "DEEPWIKI_WORKER_SERVICE_ACCOUNT", "deepwiki-worker"
                        ),
                        security_context=client.V1PodSecurityContext(
                            run_as_user=33, run_as_group=33, fs_group=33
                        ),
                        # ADR-0022 decision 7: the engine is baked into the
                        # image, so nothing is cloned at Job start.
                        init_containers=None,
                        containers=[
                            client.V1Container(
                                name="worker",
                                image=delegate.worker_image,
                                image_pull_policy=delegate.image_pull_policy,
                                # An installed module, not a probed file path.
                                command=["python", "-m", WORKER_MODULE],
                                args=[f"--job-id={job_id}"],
                                env=self._job_env(client, job_id),
                                security_context=client.V1SecurityContext(
                                    run_as_user=33,
                                    run_as_group=33,
                                    allow_privilege_escalation=False,
                                    read_only_root_filesystem=False,
                                ),
                                volume_mounts=volume_mounts,
                                resources=client.V1ResourceRequirements(
                                    requests=delegate.resources["requests"],
                                    limits=delegate.resources["limits"],
                                ),
                            )
                        ],
                        volumes=volumes,
                    ),
                ),
            ),
        )

    def _job_env(self, client, job_id: str) -> list:
        """Non-secret environment for the worker.

        The legacy manager forwarded every ``DEEPWIKI_*`` variable from the
        controller so feature flags would be inherited without a hand-kept
        allowlist. That convenience is kept — the flags really are numerous —
        but secret-looking names are now dropped rather than copied, and the
        credentials the worker needs arrive on the projected volume instead.
        """
        delegate = self._delegate
        env = [
            client.V1EnvVar(name="DEEPWIKI_JOB_ID", value=job_id),
            client.V1EnvVar(name="DEEPWIKI_BASE_PATH", value=delegate.base_path),
            client.V1EnvVar(name="PYTHONUNBUFFERED", value="1"),
        ]
        if self._credentials_secret:
            env.append(
                client.V1EnvVar(
                    name="ELITEA_DEEPWIKI_CREDENTIALS_DIR",
                    value=CREDENTIALS_MOUNT_PATH,
                )
            )

        already = {item.name for item in env}
        for name, value in sorted(os.environ.items()):
            if not name.startswith("DEEPWIKI_") or name in already:
                continue
            if _is_secret_env(name):
                logger.info(
                    "not forwarding %s to the worker Job: it looks like a "
                    "secret, and ADR-0022 requires projected files",
                    name,
                )
                continue
            env.append(client.V1EnvVar(name=name, value=value))
        return env

    def create_job(self, job_id: str, input_data: dict[str, Any]) -> dict[str, Any]:
        """Create the Job, after the same slot and input handling as the original."""
        from kubernetes import client  # noqa: PLC0415

        delegate = self._delegate

        slots = delegate.get_slot_availability()
        if not slots["can_start"]:
            return {
                "success": False,
                "error": (
                    f"[SERVICE_BUSY] All {slots['total']} generation slots are "
                    f"in use"
                ),
                "active_workers": slots["active"],
                "max_workers": slots["total"],
            }

        job_dir = delegate.jobs_dir / job_id
        job_dir.mkdir(parents=True, exist_ok=True)
        (job_dir / "input.json").write_text(
            json.dumps(input_data, indent=2), encoding="utf-8"
        )

        if delegate._uses_platform_transport():
            platform_client = delegate._get_platform_client_from_llm_settings(
                input_data.get("llm_settings", {})
            ) or delegate._get_platform_client()
            if not delegate._upload_job_input(
                job_id, input_data, platform_client=platform_client
            ):
                return {
                    "success": False,
                    "error": "Failed to upload job input to platform bucket",
                    "error_category": "platform_upload_failed",
                }

        job = self.build_job(client, job_id)
        batch = delegate._get_batch_api()
        batch.create_namespaced_job(namespace=delegate.namespace, body=job)

        logger.info("created Job deepwiki-worker-%s in %s", job_id, delegate.namespace)
        return {"success": True, "job_id": job_id, "job_name": job.metadata.name}


def get_job_manager(base_path: str | None = None):
    """Drop-in replacement for the engine's ``get_job_manager``.

    Installed by :func:`install`, which is what makes the copied
    ``tool_operations._run_wiki_job`` build the new manifest without either
    file being edited.
    """
    from .engine.k8s_job_manager import K8sJobManager  # noqa: PLC0415

    return PortedJobManager(K8sJobManager(base_path=base_path))


def install() -> None:
    """Point the copied tool layer's Job path at this manager.

    ``tool_operations._run_wiki_job`` imports ``get_job_manager`` from the
    engine module *inside the function*, so replacing the attribute on that
    module is enough and no import ordering matters.
    """
    from .engine import k8s_job_manager  # noqa: PLC0415

    k8s_job_manager.get_job_manager = get_job_manager
    logger.info("Kubernetes Job path repointed at the ported manifest builder")
