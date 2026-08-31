"""``python -m elitea_deepwiki`` — run the service with uvicorn."""

from __future__ import annotations


def main() -> None:
    import uvicorn

    from .config import Settings

    settings = Settings.from_env()  # fail fast on a bad environment
    del settings

    uvicorn.run(
        "elitea_deepwiki.app:asgi_factory",
        factory=True,
        host="0.0.0.0",  # noqa: S104 - cluster-internal service
        port=8080,
    )


if __name__ == "__main__":
    main()
