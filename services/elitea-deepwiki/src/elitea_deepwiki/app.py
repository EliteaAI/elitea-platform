"""The ASGI application — the Pylon shim's replacement.

Serves the frozen SPI (ADR-0022 decision 2):

    GET    /descriptor
    GET    /health
    GET    /slots
    POST   /tools/{toolkit_name}/{tool_name}/invoke
    GET    /tools/{toolkit_name}/{tool_name}/invocations/{invocation_id}
    DELETE /tools/{toolkit_name}/{tool_name}/invocations/{invocation_id}

The poll and cancel paths carry the toolkit and tool segments: that is the wire
path the legacy service served and the form the legacy SPI OpenAPI declares.

Responses are built as explicit ``JSONResponse`` objects rather than returned
models. The legacy bodies are not uniformly shaped — a 404 is
``errorCode/message/details``, a failed tool is HTTP 200 with
``status: "Error"``, a cancel is 204 with no body — and letting FastAPI infer
response models would quietly normalise exactly the differences the
conformance fixtures exist to pin.
"""

from __future__ import annotations

import asyncio
import datetime as dt
import logging
import os
import time
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse

from . import errors
from .config import ConfigError, Settings, terminates_mtls
from .security.egress import EgressPolicy
from .descriptor import provider_descriptor
from .toolrunner import ToolRunner, build_runner
from .invocations import InvocationManager
from .security.middleware import IdentityMiddleware, MutualTLSMiddleware
from .slots import current_slots
from .toolkits import resolve_family, validate_tool

logger = logging.getLogger(__name__)

#: Reported by ``GET /health``. The legacy service hardcoded "1.0.0"; the port
#: keeps a single version string but names itself honestly.
PROVIDER_VERSION = "1.0.0"
SERVICE_NAME = "elitea-deepwiki"


def _build_invocation_store(settings: Settings):
    """The durable store when a database is configured, else the in-process one.

    A service with no database still boots and serves the whole SPI; it just
    cannot claim durability, and ``GET /health`` says so.
    """
    if not settings.database_url:
        return None

    try:
        from .storage.invocation_store import build_store  # noqa: PLC0415

        return build_store(settings.database_url)
    except ModuleNotFoundError as exc:  # the driver, not the server
        # Loud, and at startup. Falling back to the in-process store would
        # leave a deployment that asked for durability running without it —
        # and `/health` would report durable_invocations: false while the
        # operator believed otherwise, which is the worst of both.
        raise ConfigError(
            "ELITEA_DEEPWIKI_DATABASE_URL is set but the PostgreSQL driver is "
            "not installed. Install the 'storage-postgres' extra, or unset the "
            f"variable to run without durable invocation state ({exc})."
        ) from exc


def create_app(
    settings: Settings | None = None,
    runner: ToolRunner | None = None,
) -> FastAPI:
    """Build the ASGI application.

    ``runner`` defaults to whatever ``ELITEA_DEEPWIKI_RUNNER`` selects, which
    is ``UnavailableToolRunner`` unless the engine is explicitly enabled. That
    is the correct default: the SPI is fully served and every actual
    invocation terminates with a readable error, so nothing downstream can be
    built against a fake success.
    """
    settings = settings or Settings.from_env()
    runner = runner or build_runner(settings)
    manager = InvocationManager(
        store=_build_invocation_store(settings),
        retention_seconds=settings.invocation_retention_seconds,
    )
    started_at = time.monotonic()

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        await manager.start()
        logger.info(
            "%s started (runner=%s, durable_invocations=%s)",
            SERVICE_NAME,
            getattr(runner, "name", type(runner).__name__),
            manager.store.durable,
        )
        try:
            yield
        finally:
            await manager.stop()

    app = FastAPI(
        title="ELITEA DeepWiki provider service",
        version=PROVIDER_VERSION,
        lifespan=lifespan,
        # The legacy SPI is the contract; FastAPI's own docs routes are not
        # part of it and would widen the surface the facade proxies.
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    app.state.settings = settings
    app.state.runner = runner
    app.state.invocations = manager

    # Order matters and is outermost-first: identity headers are stripped
    # before anything downstream can read one, and the transport is checked
    # before the identity is even considered. Starlette applies middleware in
    # reverse-registration order, so MutualTLS is added last to run first.
    secret = (settings.identity_secret or "").encode()
    app.add_middleware(
        IdentityMiddleware, secret=secret, required=bool(settings.tls_ca_file)
    )
    app.add_middleware(
        MutualTLSMiddleware,
        required=bool(settings.tls_ca_file),
        verified_at_transport=terminates_mtls(settings),
    )

    # -- descriptor --------------------------------------------------------

    @app.get("/descriptor")
    async def descriptor() -> JSONResponse:
        return JSONResponse(provider_descriptor(settings.service_location_url))

    # -- health ------------------------------------------------------------

    @app.get("/health")
    async def health() -> JSONResponse:
        now = dt.datetime.now(dt.timezone.utc)
        return JSONResponse(
            {
                "status": "UP",
                "providerVersion": PROVIDER_VERSION,
                "uptime": int(time.monotonic() - started_at),
                "timestamp": now.strftime("%Y-%m-%dT%H:%M:%S+00:00"),
                "plugin": SERVICE_NAME,
                "configuration": {
                    "scratch_path": settings.scratch_path,
                    "service_location_url": settings.service_location_url,
                },
                "extra_info": {
                    "hostname": os.environ.get(
                        "HOSTNAME", os.environ.get("POD_NAME", "unknown")
                    ),
                    "pod_ip": os.environ.get("POD_IP", "unknown"),
                    # Named because it is load-bearing and currently False: a
                    # restart loses accepted invocations. The spec requires
                    # durable operation state; until the PostgreSQL store
                    # lands, this says so rather than being silent about it.
                    "durable_invocations": manager.store.durable,
                    "runner": getattr(runner, "name", type(runner).__name__),
                    # Whether this replica can answer about a wiki it did not
                    # build. False means retrieval reads per-wiki scratch
                    # files, so the replica is NOT stateless — the condition
                    # ADR-0022 decision 3 exists to remove.
                    "stateless_reads": bool(settings.database_url),
                    # The security boundary, reported rather than assumed. Both
                    # false is a valid dev stack and an invalid production one.
                    "mtls_required": bool(settings.tls_ca_file),
                    "identity_verified": bool(settings.identity_secret),
                    "git_egress": EgressPolicy.parse(
                        settings.git_allowlist
                    ).describe(),
                },
            }
        )

    @app.get("/ready")
    async def ready() -> JSONResponse:
        """Readiness, separate from the provider's liveness document.

        ``/health`` is the SPI's own document: a frozen shape the platform
        polls, which answers "this provider exists and here is its
        configuration". A Kubernetes readiness probe asks a different
        question — "can this replica serve traffic right now" — and answering
        it from /health would mean either widening a frozen contract or having
        a probe that passes while the service cannot actually work.

        Not ready is 503, which is what takes a replica out of rotation.
        """
        checks: dict[str, Any] = {"invocations": True}
        ok = True

        if settings.database_url:
            # The read path and the durable store both need it, so a replica
            # that cannot reach it must not receive queries.
            try:
                import psycopg  # noqa: PLC0415

                connection = await asyncio.to_thread(
                    psycopg.connect, settings.database_url
                )
                try:
                    await asyncio.to_thread(connection.execute, "SELECT 1")
                finally:
                    connection.close()
                checks["database"] = True
            except Exception as exc:  # noqa: BLE001 - reported, not raised
                logger.warning("readiness: database unreachable: %s", exc)
                checks["database"] = False
                ok = False

        return JSONResponse(
            {"status": "READY" if ok else "NOT_READY", "checks": checks},
            status_code=200 if ok else 503,
        )

    # -- slots -------------------------------------------------------------

    @app.get("/slots")
    async def slots() -> JSONResponse:
        return JSONResponse(current_slots(settings, manager.in_flight()))

    # -- invoke ------------------------------------------------------------

    @app.post("/tools/{toolkit_name}/{tool_name}/invoke")
    async def invoke(
        toolkit_name: str, tool_name: str, request: Request
    ) -> JSONResponse:
        try:
            request_data = await request.json()
        except Exception:
            return JSONResponse(errors.BAD_REQUEST, status_code=400)

        if not isinstance(request_data, dict):
            return JSONResponse(errors.BAD_REQUEST, status_code=400)

        # Toolkit/tool admission is deliberately NOT done here. The legacy
        # route accepted every request, minted an id, and let
        # perform_invoke_request reject the unknown toolkit or tool as the
        # invocation's terminal result. The Python provider worker is built on
        # that: it expects an id and a poll. Answering the rejection
        # synchronously would be tidier and would break it, so admission runs
        # inside the invocation below.
        async def call(context):
            family = resolve_family(toolkit_name)
            validate_tool(family, tool_name)
            return await runner.invoke(
                family=family,
                toolkit_name=toolkit_name,
                tool_name=tool_name,
                request_data=request_data,
                context=context,
            )

        try:
            invocation = await manager.submit(toolkit_name, tool_name, call)
        except Exception:
            logger.exception("failed to accept invocation %s:%s", toolkit_name, tool_name)
            return JSONResponse(errors.INTERNAL_ERROR, status_code=500)

        # Async unconditionally, exactly as the legacy route was: the
        # descriptor's sync_invocation_supported is advertised but never
        # honoured, and the facade depends on the immediate id.
        return JSONResponse(
            {"invocation_id": invocation.invocation_id, "status": "Started"}
        )

    # -- poll / cancel -----------------------------------------------------

    @app.get("/tools/{toolkit_name}/{tool_name}/invocations/{invocation_id}")
    async def poll(
        toolkit_name: str, tool_name: str, invocation_id: str
    ) -> JSONResponse:
        body: dict[str, Any] | None = await manager.poll(
            toolkit_name, tool_name, invocation_id
        )
        if body is None:
            return JSONResponse(errors.NOT_FOUND, status_code=404)
        return JSONResponse(body)

    @app.delete("/tools/{toolkit_name}/{tool_name}/invocations/{invocation_id}")
    async def cancel(
        toolkit_name: str, tool_name: str, invocation_id: str
    ) -> Response:
        if not await manager.cancel(toolkit_name, tool_name, invocation_id):
            return JSONResponse(errors.NOT_FOUND, status_code=404)
        return Response(status_code=204)

    return app


def asgi_factory() -> FastAPI:
    """Entry point for ``uvicorn elitea_deepwiki.app:asgi_factory --factory``."""
    return create_app()
