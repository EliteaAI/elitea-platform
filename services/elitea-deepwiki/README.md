# elitea-deepwiki

The standalone DeepWiki provider service — the ADR-0022 port of the legacy
`deepwiki_plugin` Pylon module.

**Status: it runs.** A real `generate_wiki` has been driven through the frozen
SPI, into the copied tool layer, out to a subprocess worker and back with the
frozen artifact set — clone, index, repository analysis, structure planning,
page generation, composition. See [Running it end to end](#running-it-end-to-end).

The engine's dependency closure stays an optional extra, so a default build
still refuses every tool and says so in `GET /health`. The Kubernetes-Job path
is still not repointed. See [What is not wired yet](#what-is-not-wired-yet).

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
│   ├── toolrunner.py    the seam between the SPI and the engine
│   ├── legacy_runner.py dispatch + result composition (perform_invoke_request)
│   ├── repo_config.py   repository-config extraction, copied from the handler
│   ├── config.py        strict-parsed settings
│   ├── engine/          the analysis engine — 101 files, plain copy, digest-guarded
│   └── storage/
│       ├── base.py      the RetrievalBackend interface + the frozen RRF
│       ├── postgres.py  pgvector + tsvector + BM25 term statistics
│       ├── sqlite.py    the legacy file backend, as the reference
│       └── migrate.py   versioned, checksummed migrations
├── migrations/          service-owned SQL, applied against the deepwiki DB
├── tools/               refresh_engine_copy.py — re-copy and re-digest
├── e2e/                 the end-to-end harness + a deterministic LLM stub
├── tests/
│   ├── conformance/     replays the P0 SPI fixtures against the real app
│   ├── engine/          copy digests + the dispatch/composition adapter
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

## Engine

`src/elitea_deepwiki/engine/` is a **plain copy** of
`deepwiki_plugin/plugin_implementation/` at revision `ce679f11` — 101 files,
~90.5k lines, unmodified. ADR-0022 decision 1: the engine moves, it is not
rewritten. `COPY_MANIFEST.json` records every file's SHA-256 and the test suite
re-checks them, because at that size a modification is not detectable by
reading. `tools/refresh_engine_copy.py` performs the copy and regenerates the
manifest; `--check` verifies it and needs no legacy checkout.

The one file we own inside that tree is `__init__.py`. The legacy one was
empty; ours registers `sys.modules["plugin_implementation"]`, because twenty
engine call sites import their siblings absolutely. Rewriting those would make
the copy non-verbatim, and the parity argument rests on it being verbatim.

`toolrunner.py` is the seam: a one-method `ToolRunner` protocol. Everything
above it is the SPI, everything below is the engine.

* `UnavailableToolRunner` (the default) **refuses** every tool with a
  `resource_not_found` error. A shell that answered `Completed` with an empty
  artifact set would let the facade (P2) and the UI (P4) be built against a
  fake success. `GET /health` reports which runner is active.
* `LegacyToolRunner` (`ELITEA_DEEPWIKI_RUNNER=legacy`) is the port of
  `perform_invoke_request`: the parameter merge, per-tool dispatch and the
  composed artifact set. It takes its tool callables by injection, so the
  composition path is tested against
  `conformance/fixtures/generation/composed_result.json` with a stub in place
  of the engine — the same experiment that recorded the fixture.

`repo_config.py` is also copied rather than retyped: 140 lines resolving four
providers, each with its own precedence chain over a dozen differently-prefixed
keys. Only the GitHub path has a fixture; the other three are carried on trust,
which is an argument for copying it rather than against.

### Deliberate omissions from the handler port

The legacy `methods/invoke.py` was 1767 lines. These parts have no successor,
by decision:

* **the LLM factory** — the engine builds its own models from `llm_settings`;
* **`extract_artifact_settings`** — it derived the artifact base URL by
  regex-stripping `/llm` off the LLM base URL and defaulted an `X-SECRET`
  header to the literal `"secret"`. ADR-0022 decision 6 retires both;
* **`verify=False`** — on every legacy artifact call. Absent here, and
  forbidden from returning;
* **the registry write** — a read-modify-write on one JSON blob under no lock;
  its successor is the `wikis` table.

### One legacy defect preserved, and named

`[SERVICE_BUSY]` is stripped from the error before the category classifier
runs, and the classifier looks for exactly that marker. So a busy signal
carrying its own explanation classifies as `runtime_error` — a caller cannot
tell "retry shortly" from "this broke". Only a bare marker falls through to the
default text and classifies as `service_busy`. Verified against the legacy
`_create_error_response` directly, and pinned by a test. It stands because
decision 2 freezes the error contract; changing a visible category needs its
own decision.

## Running it end to end

`e2e/` holds the harness and its own README. It needs the `engine` extra
(~1.1 GB) and a local git daemon, and is deliberately not in CI. The LLM is a
local deterministic stub — the pipeline is under test, not the prose.

### What running it found

Nine defects and contract details, none of which were visible from reading:

1. **The tool layer was left behind.** `methods/tool_operations.py` — 1403
   lines — holds the real `generate_wiki`/`ask`/`deep_research`, the subprocess
   and Job launchers and the worker-slot accounting. It lives under `methods/`,
   so it looked like part of the Pylon shim. It needs exactly five hooks from
   its host, which `ToolHost` supplies.
2. **Binding one method is not enough.** `generate_wiki` calls
   `self._run_wiki_subprocess`; the whole mixin has to be composed onto the
   host, not a single function bound to it.
3. **`from ..plugin_implementation.` escaped the package** at the new depth
   (5 sites).
4. **The subprocess worker module name was unresolvable in the child.** The
   launcher picks a name by importing it in the *parent*, where the
   compatibility alias exists; the child has only `sys.path` and no alias.
   Naming the real module fixes it (3 sites).
5. **The in-process path requires `openai_api_base` / `openai_api_key`;** the
   subprocess worker accepts `api_base` / `api_key` too. A caller that sends
   only the short spelling works out-of-process and fails in-process.
6. **`embedding_model` must be a string,** despite the descriptor declaring it
   as `JSON`: the engine passes it straight to `OpenAIEmbeddings(model=...)`.
7. **`repository` and `active_branch` sit at the toolkit level,** not inside
   `github_configuration`. The P0 SPI fixture's example request put them
   inside, which yields `repo_config["repository"] = None` and
   "GitHub repository not specified" — the example was never a valid request.
8. **GitHub reads `base_url`; GitLab reads `url`.** Not interchangeable.
9. **The subprocess workers stream.** They build their LLM with
   `streaming=True` and fail with "No generations found in stream" against a
   non-streaming endpoint.

### The finding that matters most

**`run_in_subprocess` is not a performance switch — it changes the result.**

In-process the pipeline completes, but the composed set is a *subset*: no
`wiki_manifest`, and `repository_context` loses its `{wiki_id}/` prefix. The
manifest, the wiki id and the registry metadata are built by
`wiki_subprocess_worker`, not by the in-process wrapper.

So the frozen artifact set decision 2 pins is produced **only** by the
out-of-process path. The composition fixtures would not catch a regression
here, because they test the composer *given* a worker result rather than the
worker itself — which is exactly why this run exists.

## What is not wired yet

1. **The dependency closure is optional.** `pip install -e ".[engine]"`
   installs the 92 pins from the legacy `requirements.txt` (torch,
   transformers, faiss-cpu, tree-sitter grammars). The default image does not
   carry it, which is why the default runner refuses.
2. **The Kubernetes-Job path is not repointed.** Subprocess mode works; the Job
   path still builds a `PYTHONPATH` from the legacy filesystem layout
   (`/data/plugins/deepwiki_plugin`), runs
   `plugin_implementation/wiki_job_worker.py` as a file, expects the
   licence-credential init container ADR-0022 drops, and passes secrets through
   Job environment variables where the ADR requires projected files. A test
   pins this.
3. **Credentials and artifacts.** The facade has to pass artifact base URL and
   token explicitly (decision 6); nothing here derives them any more, so
   nothing here can currently fetch or store a platform artifact.
4. **Storage.** The engine still writes its own SQLite/FAISS files. The
   PostgreSQL backend exists and is parity-gated but is not yet the engine's
   storage layer — that wiring is the next slice.

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
4. **`GET /health` reports `extra_info.durable_invocations` and
   `extra_info.runner`.** The first is `false`
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

- [x] **Move the engine** — 101 files, plain copy, digest-guarded, wired behind
      the `ToolRunner` seam with the composition gated by
      `conformance/fixtures/generation/composed_result.json`.
- [x] **Run the engine end to end** — done, with the findings above.
- [ ] **Repoint the Kubernetes-Job path** — a worker entry point replacing the
      legacy filesystem `PYTHONPATH`; drop the licence-credential init
      container; secrets to Jobs via projected files, not environment
      variables.
- [ ] **Point the engine at the PostgreSQL backend** — it still writes its own
      per-wiki files; the parity-gated backend is not yet its storage layer.
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
