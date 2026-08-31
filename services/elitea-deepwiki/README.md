# elitea-deepwiki

The standalone DeepWiki provider service — the ADR-0022 port of the legacy
`deepwiki_plugin` Pylon module.

**Status: the SPI shell plus the storage layer.** The service serves the whole
frozen provider contract and refuses every actual tool invocation with a
readable error — see [The engine seam](#the-engine-seam). The retrieval
storage layer (ADR-0022 decision 3) is ported and parity-gated; the rest of the
analysis engine has not moved yet.

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
│   ├── config.py        strict-parsed settings
│   └── storage/
│       ├── base.py      the RetrievalBackend interface + the frozen RRF
│       ├── postgres.py  pgvector + tsvector + BM25 term statistics
│       ├── sqlite.py    the legacy file backend, as the reference
│       ├── migrate.py   versioned, checksummed migrations
│       └── legacy/      verbatim copies of four legacy storage modules
├── migrations/          service-owned SQL, applied against the deepwiki DB
├── tests/
│   ├── conformance/     replays the P0 SPI fixtures against the real app
│   ├── storage/         retrieval parity: both backends, live, side by side
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

## The storage layer

ADR-0022 decision 3 replaces the legacy per-wiki files — a SQLite `.wiki.db`
(nodes, edges, FTS5, sqlite-vec), a separate BM25 SQLite, an mmap docstore,
FAISS binaries — with PostgreSQL, so query replicas are stateless.
`storage/base.py` is the seam; two implementations satisfy it.

`storage/legacy/` holds **verbatim copies** of four legacy modules
(`constants.py`, `unified_db.py`, `bm25_disk.py`, `docstore.py`) at revision
`ce679f11`, guarded by digest. `storage/sqlite.py` wraps them as a live
backend. They are not the target — ADR-0022 retires them — they are the
*control*: a parity run compares two working implementations rather than a new
one against a JSON file, and can be re-queried with new queries on new corpora.

### Parity, branch by branch

| branch | parity | why |
| --- | --- | --- |
| dense | **exact** — order and L2 distances | pgvector `<->` is the same metric as sqlite-vec's KNN, and search is an exact scan |
| bm25 | **exact** — order and scores | the tokenizer is a whitespace split and the formula is written down, so both are reproduced over term-statistics tables |
| fts | match set and ordering | PostgreSQL has neither FTS5's tokenizer nor its `bm25()`; magnitudes differ by design and the divergence is reported |
| fused | follows from the components | RRF is arithmetic over two ranked lists, and both backends share one implementation |

Three things this surfaced that were not visible from reading the code:

1. **PostgreSQL's parser eats identifiers.** `self.connection.execute` lexes as
   a single `host` token, so `connection` is never indexed and a query for it
   finds nothing. FTS5's `unicode61` splits on every non-alphanumeric. Both the
   generated `fts` column and `search_fts` therefore fold non-alphanumerics to
   spaces first. The fixture query `connection` matched 5 rows under FTS5 and 2
   without the fold — that is what caught it.
2. **The FTS fixtures were nearly vacuous.** Of the original seven queries, six
   returned 0 or 1 FTS rows and the seventh returned a 13-row block whose FTS5
   ranks all sat within 2.7e-7 of each other (FTS5 clamps a common term's idf
   to 1e-6, leaving only length normalisation to order by). Four discriminating
   queries were added to the P0 fixtures, and the parity report now asserts at
   least four exist.
3. **Weighted RRF makes the fused order undetermined when a component ties.**
   Fusion scores by *position*, so two documents with identical dense distances
   get different combined scores purely from scan order. The legacy engine had
   the same property; three fixture queries hit it. Making the fused order
   deterministic would be a ranking change needing its own fixtures, not part
   of a storage port.

No HNSW index exists yet, deliberately: it is approximate, and adding it in the
same change would make the fixtures unable to tell a port bug from index
recall. Exact scan first, parity proven, then HNSW with its own recall
measurement.

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
cd services/elitea-deepwiki && python -m pip install -e ".[test]" && python -m pytest tests/unit tests/conformance
```

The storage-parity suite needs PostgreSQL with pgvector:

```bash
podman run -d --name dwpg -e POSTGRES_USER=deepwiki -e POSTGRES_PASSWORD=deepwiki -e POSTGRES_DB=deepwiki -p 15434:5432 pgvector/pgvector:0.8.5-pg16
```

```bash
cd services/elitea-deepwiki && python -m pip install -e ".[test,storage-postgres,storage-legacy]" && DEEPWIKI_TEST_DSN=postgresql://deepwiki:deepwiki@127.0.0.1:15434/deepwiki python -m pytest tests/storage -q -rs
```

Without `DEEPWIKI_TEST_DSN` those tests skip. CI sets `DEEPWIKI_REQUIRE_POSTGRES=1`,
which turns the skip into a failure so a misconfigured workflow cannot report a
parity run it never performed.

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
- [x] **The storage port** — done for retrieval: the backend interface,
      the PostgreSQL implementation and migration 0001, parity-gated against
      `conformance/fixtures/retrieval/`.
- [ ] **HNSW** — `vector(n)` per deployment plus the index, with a recall
      measurement against the now-trusted exact backend.
- [ ] **Wire the registry table** — `wikis` exists in migration 0001 but
      nothing writes it yet; that lands with the generation path.
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
