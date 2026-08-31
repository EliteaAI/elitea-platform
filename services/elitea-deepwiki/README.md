# elitea-deepwiki

The standalone DeepWiki provider service — the ADR-0022 port of the legacy
`deepwiki_plugin` Pylon module.

**Status: the SPI shell. The analysis engine has not moved yet.** This service
serves the whole frozen provider contract and refuses every actual tool
invocation with a readable error. That is deliberate — see
[The engine seam](#the-engine-seam).

## What is here

```
services/elitea-deepwiki/
├── src/elitea_deepwiki/
│   ├── app.py           the ASGI application — the Pylon shim's replacement
│   ├── descriptor.py    the frozen provider descriptor
│   ├── invocations.py   invocation registry + job manager (arbiter's successor)
│   ├── toolkits.py      toolkit/tool admission, including the legacy aliases
│   ├── slots.py         GET /slots capacity accounting
│   ├── errors.py        the two error shapes
│   ├── engine.py        the seam the analysis engine plugs into
│   └── config.py        strict-parsed settings
├── tests/
│   ├── conformance/     replays the P0 fixtures against the real app
│   └── unit/            settings parsing, invocation lifecycle
├── conformance/         the phase-P0 golden fixtures (see its own README)
└── Containerfile
```

## The SPI

| Method | Path |
| --- | --- |
| GET | `/descriptor` |
| GET | `/health` |
| GET | `/slots` |
| POST | `/tools/{toolkit_name}/{tool_name}/invoke` |
| GET | `/tools/{toolkit_name}/{tool_name}/invocations/{invocation_id}` |
| DELETE | `/tools/{toolkit_name}/{tool_name}/invocations/{invocation_id}` |

The poll and cancel paths carry the toolkit and tool segments — that is the
wire path the legacy service served and the form the legacy SPI OpenAPI
declares.

Invocation is **asynchronous unconditionally**. Every tool in the descriptor
advertises `sync_invocation_supported: true` and the legacy route never
consulted it; the Python provider worker depends on getting an id back and
polling, so the port keeps that exactly.

Two response shapes cross the boundary and both are frozen:

* a **tool** failure is HTTP 200 with `status: "Error"` plus `error_category`
  and `error_type`;
* a **transport** failure is a non-2xx `{"errorCode", "message", "details"}`.

## The engine seam

`engine.py` defines a one-method `Engine` protocol. Everything above it is the
SPI; everything below it is the ~90k-LOC analysis engine, which arrives in the
next slice of P1. The default implementation is `UnavailableEngine`, which
**refuses** every tool with a `resource_not_found` error.

That default is a choice: a shell that answered `Completed` with an empty
artifact set would let the elitea-main facade (P2) and the UI (P4) be built
against a fake success and look finished. Refusing makes the missing engine
visible in every response and in `GET /health`
(`extra_info.engine == "unavailable"`).

## Deliberate differences from the legacy service

Everything else is ported verbatim; these are the exceptions, each one
recorded as a finding in the P0 fixtures.

1. **A jobs-mode capacity failure refuses instead of reporting per-pod
   numbers.** Legacy `_get_k8s_job_slots` caught every Kubernetes failure and
   returned the *subprocess* numbers with HTTP 200, so a cluster outage read as
   healthy capacity. This build answers `mode: "jobs"`, `can_start: false` and
   an `error` string. Jobs mode itself is not implemented in this slice, so
   configuring it is an explicit unavailable answer rather than a silent
   downgrade.
2. **Tracebacks stay server-side.** The legacy `include_traceback=True` path
   put a full Python stack trace into a caller-visible message for unknown
   toolkits, unknown tools and unhandled exceptions. `error_category` and
   `error_type` survive; the trace is logged.
3. **Settings are strict-parsed at startup.** A malformed
   `DEEPWIKI_MAX_PARALLEL_WORKERS` is a boot failure, not a request-time
   `mode: "error"` with zero capacity.
4. **`GET /health` reports `extra_info.durable_invocations`.** It is `false`
   today: the invocation store is in-process, so a restart loses accepted
   operations. spec-provider-service requires durable provider-side operation
   state, and saying so is better than being silent about it. The flag flips
   when the PostgreSQL store lands.

Legacy environment variable names (`DEEPWIKI_JOBS_ENABLED`,
`DEEPWIKI_MAX_PARALLEL_WORKERS`, `DEEPWIKI_MAX_CONCURRENT_JOBS`,
`DEEPWIKI_NAMESPACE`) are still read so an existing deployment's environment
keeps working through cutover; the `ELITEA_DEEPWIKI_*` names take precedence.

## Running

```bash
cd services/elitea-deepwiki && python -m pip install -e ".[test]" && python -m pytest
```

```bash
cd services/elitea-deepwiki && python -m elitea_deepwiki
```

```bash
podman build -f services/elitea-deepwiki/Containerfile -t elitea-deepwiki .
```

## Still to do in P1

- [ ] **Move the engine** — `plugin_implementation/` plus its tests, wired
      behind the `Engine` seam. The composed `generate_wiki` result set is
      already pinned by `conformance/fixtures/generation/composed_result.json`.
- [ ] **The storage port** — a backend interface over `unified_db.py` /
      `bm25_disk.py` / the docstore, then the PostgreSQL implementation
      (pgvector HNSW, `tsvector` + GIN, tables keyed by `wiki_id`, a `wikis`
      registry table) with service-owned migrations against a dedicated
      `deepwiki` database. Ranking parity is gated by
      `conformance/fixtures/retrieval/`.
- [ ] **Durable invocation state** — a PostgreSQL `InvocationStore`, so a
      restart does not lose accepted operations and `custom_events` survive a
      missed poll.
- [ ] **Kubernetes Jobs mode and real slot accounting**, replacing the current
      explicit refusal.
- [ ] **mTLS terminus, health/readiness split, and the git-host egress
      allowlist** enforced before any credential is used.
- [ ] **Artifact client with explicit base URL and token inputs** — stop
      deriving them from the LLM URL, and drop the `X-SECRET` header entirely.
- [ ] **`docker-bake.hcl` target** (outside the default group — torch-sized)
      plus `publish.yml` and `ci-image-scan.yml` entries.
