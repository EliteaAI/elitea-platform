"""Reading the graph back out of the platform artifact bucket.

The engine WRITES nothing here. A completed ingestion returns its graph,
checkpoint and status objects INLINE and the Go host uploads them through
``internal/artifacts`` with the transport the facade handed over — exactly as
DeepWiki's runner does with its wiki objects. One uploader, one place the
Content-Type rule lives, one place a failed upload is reported.

What the engine still needs is the other direction: a query tool has to LOAD a
graph this pod did not build. The legacy code did that with
``EliteAClient.artifact(bucket).get(name)`` built from the plugin's admin
platform token; here the transport is derived from the same per-invocation
``llm_settings`` the LLM and the embeddings come from, mirroring
``elitea_deepwiki.engine.artifacts_platform_client`` — so the read is
authorised as the caller, and a caller who cannot see the bucket gets a 403
instead of someone else's graph.
"""

from __future__ import annotations

import logging
import re
from typing import Any
from urllib.parse import quote

logger = logging.getLogger(__name__)

#: The platform API prefix the artifact routes live under.
DEFAULT_API_PATH = "/api/v2"

#: The bucket a toolkit stores its graph in when it configures none.
DEFAULT_BUCKET = "graphs"

#: ``api_base`` points at the LLM gateway; the artifact routes are on the
#: platform root. The legacy derivation strips this suffix and nothing else.
_LLM_SUFFIX = re.compile(r"/llm(/api)?(/v\d+)?/?$")


class ArtifactTransportMissing(RuntimeError):
    """The request carried no artifact transport, so nothing can be downloaded."""


def extract_settings(llm_settings: dict[str, Any]) -> dict[str, str]:
    """The legacy derivation, verbatim, and the same one the Go host uses.

    ``api_base``/``openai_api_base`` with the ``/llm[/api][/vN]`` suffix
    stripped; ``api_key``/``openai_api_key``; the project from
    ``organization``, ``openai_organization`` or ``project_id``, in that order.
    """
    llm_settings = llm_settings or {}

    def first(*keys: str) -> str:
        for key in keys:
            value = llm_settings.get(key)
            if value:
                return str(value)
        return ""

    return {
        "base_url": _LLM_SUFFIX.sub("", first("api_base", "openai_api_base")),
        "api_key": first("api_key", "openai_api_key"),
        "project_id": first("organization", "openai_organization", "project_id"),
        "api_path": DEFAULT_API_PATH,
        "x_secret": first("x_secret") or "secret",
    }


def resolve_bucket(params: dict[str, Any]) -> str:
    """The artifact bucket for this invocation.

    ``bucket`` is a required field of the toolkit configuration, and the legacy
    handler read it under the UI's ``toolkit_configuration_`` prefix as well as
    bare, because both shapes reached it depending on whether settings came
    from the request or from a platform fetch. Both are still read; only the
    request shape exists now.
    """
    for key in ("bucket", "toolkit_configuration_bucket"):
        value = (params or {}).get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return DEFAULT_BUCKET


class PlatformArtifactClient:
    """Reads objects from one project's artifact buckets, as the caller.

    Deliberately read-only. An upload method here would be a second uploader
    beside the host's, with its own idea of Content-Type — and a manifest
    uploaded as ``application/octet-stream`` is exactly the defect that made a
    complete DeepWiki generation invisible to the browser.
    """

    #: ``ca_file`` comes from the settings, through the runner. It is NOT read
    #: from the environment here as well: a second read of the same variable in
    #: a different place is how one of them silently stops being the one that
    #: applies — and this one would fail open, to the system trust store, with
    #: nothing to say it had.
    def __init__(self, settings: dict[str, str], ca_file: str | None = None) -> None:
        if not settings.get("base_url"):
            raise ArtifactTransportMissing(
                "the request carried no platform base URL (llm_settings.api_base), "
                "so a stored graph cannot be downloaded"
            )
        if not settings.get("api_key"):
            raise ArtifactTransportMissing(
                "the request carried no platform credential (llm_settings.api_key), "
                "so a stored graph cannot be downloaded"
            )
        self.settings = settings
        self.ca_file = ca_file or None

    # -- transport --------------------------------------------------------

    @property
    def _verify(self) -> Any:
        """What ``requests`` should verify the callback hop against.

        The CA file when the deployment configured one, else True. NEVER False:
        the legacy plugin passed ``verify=False`` on every platform call, which
        is how an admin token was handed to whatever answered the address.
        """
        return self.ca_file or True

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.settings['api_key']}"}

    def _objects_url(self, bucket: str) -> str:
        return (
            f"{self.settings['base_url']}{self.settings.get('api_path', DEFAULT_API_PATH)}"
            f"/artifacts/objects/{self.settings['project_id']}/{quote(bucket.lower(), safe='')}"
        )

    def download(self, bucket: str, name: str) -> bytes | None:
        """One object's bytes, or None when the bucket does not hold it.

        None rather than an exception for 404: "this project has no graph yet"
        is the state every toolkit starts in, and the tools above render it as
        "No graph configured". A 403 or a 500 IS raised — those mean the read
        failed, which is not the same as the object being absent, and the
        legacy code conflated them by sniffing the response BODY for the string
        ``"error"`` (``_is_artifact_error``): a graph whose own content happened
        to contain that word in its first 100 characters was silently treated as
        missing.
        """
        import requests  # noqa: PLC0415

        url = f"{self._objects_url(bucket)}/{quote(name, safe='')}"
        response = requests.get(
            url, headers=self._headers(), verify=self._verify, timeout=300
        )
        if response.status_code == 404:
            logger.info("artifact %s/%s is not in the bucket", bucket, name)
            return None
        if response.status_code == 403:
            raise PermissionError(
                f"not authorized to read artifact {bucket}/{name} (HTTP 403): "
                f"{response.text[:200]}"
            )
        if response.status_code not in (200, 201):
            raise RuntimeError(
                f"failed to download artifact {bucket}/{name}: HTTP "
                f"{response.status_code} — {response.text[:500]}"
            )
        return response.content

    def list(self, bucket: str) -> list[str]:
        """The object keys in a bucket; an empty list when there are none."""
        import requests  # noqa: PLC0415

        response = requests.get(
            self._objects_url(bucket),
            headers=self._headers(),
            verify=self._verify,
            timeout=300,
        )
        if response.status_code == 404:
            return []
        if response.status_code not in (200, 201):
            raise RuntimeError(
                f"failed to list artifacts in {bucket}: HTTP "
                f"{response.status_code} — {response.text[:500]}"
            )
        try:
            payload = response.json()
        except ValueError:
            return []
        rows = payload.get("rows") if isinstance(payload, dict) else payload
        if not isinstance(rows, list):
            return []
        keys = []
        for row in rows:
            if isinstance(row, dict):
                name = row.get("name") or row.get("key")
                if name:
                    keys.append(str(name))
            elif isinstance(row, str):
                keys.append(row)
        return keys


def client_from(llm_settings: dict[str, Any], ca_file: str | None = None):
    """The download client for one invocation, or None with no transport.

    None rather than a refusal, because a direct SPI call with no
    ``llm_settings`` is a legitimate shape (the host's own tests make them) and
    the tools above already say "No graph configured" for a graph they cannot
    reach.
    """
    settings = extract_settings(llm_settings or {})
    if not settings["base_url"] or not settings["api_key"]:
        return None
    return PlatformArtifactClient(settings, ca_file)


__all__ = [
    "ArtifactTransportMissing",
    "DEFAULT_API_PATH",
    "DEFAULT_BUCKET",
    "PlatformArtifactClient",
    "client_from",
    "extract_settings",
    "resolve_bucket",
]
