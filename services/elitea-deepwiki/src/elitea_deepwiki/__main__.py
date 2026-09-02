"""``python -m elitea_deepwiki`` — run the service with uvicorn."""

from __future__ import annotations

from typing import Any


def uvicorn_ssl_options(settings) -> dict[str, Any]:
    """The TLS options for ``uvicorn.run``, derived from the settings.

    Kept apart from :func:`main` so a test can pin the one fact the mTLS
    middleware relies on: ``ssl_cert_reqs`` is ``CERT_REQUIRED`` exactly when
    :func:`elitea_deepwiki.config.terminates_mtls` says this process is the
    terminus. Uvicorn enforces the client certificate at the handshake; the
    app never sees it, and must not need to.
    """
    from .config import terminates_mtls  # noqa: PLC0415

    ssl: dict[str, Any] = {}
    if settings.tls_certfile and settings.tls_keyfile:
        ssl = {
            "ssl_certfile": settings.tls_certfile,
            "ssl_keyfile": settings.tls_keyfile,
        }
        if settings.tls_ca_file:
            import ssl as _ssl  # noqa: PLC0415

            # THE mTLS terminus. Without CERT_REQUIRED the server would accept
            # any client and the middleware's check would be the only control,
            # which is defence in depth standing alone.
            ssl["ssl_ca_certs"] = settings.tls_ca_file
            ssl["ssl_cert_reqs"] = _ssl.CERT_REQUIRED
    assert bool(ssl.get("ssl_cert_reqs")) == terminates_mtls(settings)
    return ssl


def main() -> None:
    import uvicorn  # noqa: PLC0415

    from .config import Settings  # noqa: PLC0415

    settings = Settings.from_env()  # fail fast on a bad environment
    uvicorn.run(
        "elitea_deepwiki.app:asgi_factory",
        factory=True,
        host="0.0.0.0",  # noqa: S104 - cluster-internal service
        port=8080,
        **uvicorn_ssl_options(settings),
    )


if __name__ == "__main__":
    main()
