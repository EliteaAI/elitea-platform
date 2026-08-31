"""``python -m elitea_deepwiki`` — run the service with uvicorn."""

from __future__ import annotations


def main() -> None:
    import uvicorn

    from .config import Settings

    settings = Settings.from_env()  # fail fast on a bad environment

    ssl: dict[str, object] = {}
    if settings.tls_certfile and settings.tls_keyfile:
        import ssl as _ssl

        ssl = {
            "ssl_certfile": settings.tls_certfile,
            "ssl_keyfile": settings.tls_keyfile,
        }
        if settings.tls_ca_file:
            # THE mTLS terminus. Without CERT_REQUIRED the server would accept
            # any client and the middleware's check would be the only control,
            # which is defence in depth standing alone.
            ssl["ssl_ca_certs"] = settings.tls_ca_file
            ssl["ssl_cert_reqs"] = _ssl.CERT_REQUIRED

    uvicorn.run(
        "elitea_deepwiki.app:asgi_factory",
        factory=True,
        host="0.0.0.0",  # noqa: S104 - cluster-internal service
        port=8080,
        **ssl,
    )


if __name__ == "__main__":
    main()
