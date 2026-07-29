# Centry hybrid PoV deployment

This deployment keeps the current Centry stack as the compatibility baseline.
PostgreSQL, Redis, `pylon_auth`, `pylon_main`, `pylon_indexer`, the current UI
and the current LiteLLM path continue to own every capability that has not
passed an explicit Go/worker cutover gate.

The overlay adds:

- one `elitea-main` process sharing Centry PostgreSQL and authenticated Redis;
- one loopback-only Traefik edge sharing `pylon_main`'s network namespace;
- exact route selection, initially limited to Go `/healthz`; and
- a catch-all current-Pylon route for UI, APIs, Socket.IO and static content.

Current Main is rewritten to bind to loopback inside its container namespace,
and its original host port is replaced with
`https://localhost:${ELITEA_HYBRID_HTTPS_PORT:-18443}`. Traefik uses its
generated local default certificate in this PoV. Production certificate
delivery, rotation and trust are separate release gates.

## Validate

From the `elitea-platform` repository:

```bash
task hybrid:config
```

The default assumes the repositories are siblings:

```text
projects/
├── centry/
└── elitea-platform/
```

For another layout, pass an absolute or repository-relative Centry path:

```bash
task hybrid:config CENTRY_DIR=/path/to/centry
```

The command merges the current Centry Compose model with this overlay and runs
`docker compose config --quiet`; it does not start or recreate containers.

## Start

```bash
task hybrid:up
```

This is deliberately a mixed deployment. Do not remove `pylon_auth`,
`pylon_main` or `pylon_indexer`, and do not add a product route to
`traefik/base.yml` merely because a prototype handler exists. A selected route
must carry its current HTTP/DTO behavior, exact permission/project policy,
tenant derivation, database effects, browser evidence and rollback gate.

The first integration keeps LiteLLM and all model/provider execution on the
current path. Bifrost and NATS worker transport are separate compatibility and
architecture slices.
