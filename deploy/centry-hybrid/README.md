# Centry hybrid PoV deployment

This directory has two mixed-deployment checkpoints:

- `task hybrid:up` is the small routing foundation and selects only Go
  `/healthz`.
- `task hybrid:pov:up` is the reproducible Auth, Configurations and
  `index.ingest.v1` proof used by the integration PR.

Both keep the current Centry stack as the compatibility baseline. PostgreSQL,
Redis, `pylon_auth`, `pylon_main`, `pylon_indexer` and the current UI continue
to own every capability that has not passed an explicit Go/worker cutover gate.

The small foundation overlay adds:

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

## Reproduce the full integration proof

Prerequisites:

- a current Centry checkout with local `envs/override.env`;
- Docker with Compose v2, `jq` and `openssl`;
- registry/network access needed by the pinned container and Python dependency
  builds; and
- the current Centry database/configuration values. The scripts never copy
  them into tracked files or print them.

From this repository, run one command:

```bash
./deploy/centry-hybrid/compose.sh up ../centry
```

For a non-sibling checkout:

```bash
./deploy/centry-hybrid/compose.sh up /absolute/path/to/centry
```

The equivalent convenience alias, when [Task](https://taskfile.dev/) is
installed, is `task hybrid:pov:up`.

The command performs these bounded steps:

1. Reuses the current Centry environment and provisions Auth/runtime PKI and
   credentials under ignored `deploy/centry-hybrid/.runtime/`. Complete
   material is reused; a partial directory or certificate expiring within 24
   hours fails closed rather than being silently replaced.
2. Validates the merged Compose model and requires the exact Go index route,
   version-2 stream/group, Python worker runtime, external LiteLLM mounts and
   standalone LiteLLM build. This catches an empty or wrong route file before
   containers are recreated.
3. Builds Main and the Python worker from the checked-out platform commit.
4. Builds and launches standalone LiteLLM from Centry's
   `hybrid_auth/Containerfile.litellm`. It uses its own `litellm` database,
   generates the Prisma client during the image build, applies the LiteLLM
   schema at startup and is reachable only on the Compose network.
5. Starts the version-1 Redis/group long enough to run the read-only cutover
   preflight. Version-2 Redis admission remains blocked until that gate exits
   successfully.
6. Starts the mixed platform and waits for healthy services.

The current UI remains unchanged except for its SSE client work. Current
Pylon remains the catch-all owner. Only the exact authenticated Configurations,
LiteLLM and index routes in the tracked Traefik files select Go. The independent
worker still executes the current synchronous SDK indexing logic inside its own
process; Redis carries bounded signed command references, while content and
output use their private TLS channels.

Useful checks:

```bash
./deploy/centry-hybrid/compose.sh config ../centry
./deploy/centry-hybrid/compose.sh ps ../centry
./deploy/centry-hybrid/compose.sh preflight ../centry
./deploy/centry-hybrid/compose.sh logs ../centry
```

Override local image tags when needed:

```bash
ELITEA_MAIN_IMAGE=eliteaai/elitea-main:my-tag \
ELITEA_WORKER_IMAGE=eliteaai/elitea-worker-python:my-tag \
./deploy/centry-hybrid/compose.sh up ../centry
```

### LiteLLM and dependency posture

LiteLLM is externalized from `pylon_indexer` for this checkpoint, but its
compatibility implementation is still Centry-owned. `pylon_main`,
`pylon_indexer`, Go Main and the independent worker all use the same standalone
service and master-key contract. Bifrost replacement is intentionally outside
this PR.

The branch builds pinned inputs and does not upgrade dependencies as a
deployment side effect. Main's image scan and the worker's locked SDK/artifact
checks remain active. Remaining SDK/LiteLLM dependency remediation, full SBOM
and image signing are release gates documented in the gap register; they must
be handled as compatibility-tested upgrades rather than unreviewed changes to
this functional proof.
