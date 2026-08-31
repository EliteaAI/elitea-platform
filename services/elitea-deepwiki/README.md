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
│   ├── publishing.py    publish a completed generation into PostgreSQL
│   ├── jobs.py          the Kubernetes-Job manifest, repointed at this layout
│   ├── security/        the mTLS terminus, identity headers, egress allowlist
│   ├── config.py        strict-parsed settings
│   ├── engine/          the analysis engine — 101 files, plain copy, digest-guarded
│   └── storage/
│       ├── base.py      the RetrievalBackend interface + the frozen RRF
│       ├── postgres.py  pgvector + tsvector + BM25 term statistics
│       ├── sqlite.py    the legacy file backend, as the reference
│       ├── unified_db_adapter.py  the engine's read path, over PostgreSQL
│       ├── publish.py   move a generated index from scratch into PostgreSQL
│       ├── install.py   the runtime substitution (readonly reads only)
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

## Kubernetes Jobs

ADR-0022 decision 7 keeps execution out of process — subprocess workers for
compose and dev, Jobs for scale — and names two legacy practices that do not
survive. Both live in the Job manifest, so `jobs.py` subclasses the copied
`K8sJobManager` and replaces exactly the manifest construction. Slot
accounting, status, failure diagnosis, log streaming, result reading and
cleanup are inherited unchanged: none of them is what the ADR alters, and
re-implementing 800 working lines to change 200 would be the wrong trade.

**No init container.** The legacy one git-cloned `deepwiki_plugin` from GitHub
with a licence credential and pip-installed its requirements, at Job start, on
every job — so every generation depended on GitHub being reachable and on a
long-lived credential in the controller's environment. The engine and its
closure are in the image now.

**A module, not a file path.** The legacy command was a shell that probed
`/data/plugins/…` then `/app/deepwiki_plugin/…` for
`plugin_implementation/wiki_job_worker.py` and ran whichever existed. Neither
exists here. The worker is run as `python -m elitea_deepwiki.engine.wiki_job_worker`
— which is what the engine's own module docstring documented all along; the
legacy Job manager was the thing running it as a file.

**Secrets as projected files.** The legacy manifest put artifact credentials —
a bearer token among them — into `V1EnvVar` values, readable by every process
in the pod, visible in `kubectl describe`, and captured by crash reporters.
They now arrive on a projected Secret volume mounted read-only at
`/var/run/deepwiki/credentials` with mode `0400`. The wholesale `DEEPWIKI_*`
pass-through is kept, because the feature flags really are numerous, but names
that look like secrets are dropped rather than copied.

### What is not verified

No cluster was available, so **this has never created a real Job.** What is
verified is the manifest, in detail, against a fake Kubernetes client — and
the manifest is the artifact the ADR constrains. One thing that would normally
need a cluster *is* covered: the tests execute
`python -m elitea_deepwiki.engine.wiki_job_worker --help`, which proves the
module has a `__main__` guard and parses `--job-id`. Without a guard, `-m`
would import it, exit 0 having done nothing, and the Job would report success
while generating no wiki.

## The security boundary

ADR-0022 decisions 5 and 6. Both controls report themselves in `GET /health`
(`mtls_required`, `identity_verified`, `git_egress`), because both off is a
valid dev stack and an invalid production one, and an operator should be able
to tell which they have without reading the deployment.

### mTLS and identity

`ELITEA_DEEPWIKI_TLS_CERTFILE` / `_TLS_KEYFILE` / `_TLS_CA_FILE` terminate mTLS
in uvicorn with `CERT_REQUIRED` — the actual terminus. `MutualTLSMiddleware`
then refuses any request that reached the app without a verified client
certificate, which is the misconfiguration case: TLS terminated somewhere that
did not verify a client, or plain HTTP forwarded in. `/health` stays reachable,
because a readiness probe has no certificate.

`IdentityMiddleware` **strips every identity header unconditionally**, then
re-derives the identity only from a valid HMAC signature. Stripping first is
what makes the order safe: no handler can read a header a client set, because
by the time anything else runs it is gone. The only way to see an identity is
`request.state.identity`, which exists only when a signature was checked.

The signing scheme is a **third implementation** of one that already exists
twice in Go — elitea-main signs, the LLM gateway verifies — and it must agree
byte for byte or every facade request fails. The canonical string, header names
and the version rule are transcribed, not designed:

```
canonical(v1) = "v1\n" + project + "\n" + user + "\n" + tenant
canonical(v2) = same with "v2", + "\n" + execution
signature     = "sha256=" + hex(HMAC-SHA256(secret, canonical))
```

Verification accepts v2 always and v1 **only when no execution id is present** —
falling back to v1 for a request that carries one would make that id
caller-attachable, which is what signing it prevents. That asymmetry is easy to
get wrong and has its own test.

### Git-host egress

`ELITEA_DEEPWIKI_GIT_ALLOWLIST` names the hosts this deployment may clone from,
and it is **fail-closed: unset refuses every clone.** Treating "unset" as "allow
everything" would be an egress control that silently does nothing, which is
worse than not having one because it looks like it is there. `*` disables the
control, but only by saying so in configuration a reviewer can see. Nothing
depends on the permissive behaviour yet, so this is the cheapest this decision
will ever be.

The check runs in the runner **before the engine sees the request**, and
therefore before the token in it is ever written into a clone URL. That
ordering is the point: the legacy engine embedded credentials directly into
clone URLs (`https://{token}@host/owner/repo.git`), so a mistyped or
attacker-influenced host meant handing a live token to whoever answered.
ADR-0022's criterion is "refused before any credential is decrypted" — the
facade does the pre-decrypt half with the vault in reach (P2); this is the half
that governs the socket.

Matching is exact hostnames plus an optional leading `*.` for **direct**
subdomains only: `*.github.com` matches `api.github.com`, not `github.com` and
not `a.b.github.com`. A wildcard that spans labels would let anyone who
controls one subdomain reach the rest. Ports are ignored — the control is about
destination, and `:443` vs `:8443` on one host is one host.

Registry-only tools (`wiki_query`) clone nothing and are not subject to it;
refusing them for want of a repository would break a toolkit for a control that
does not apply.

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
4. **Generation still writes files.** By design — it is bounded by slot
   accounting and runs on the pod that owns the work — but the `.bm25.sqlite`,
   docstore and FAISS artefacts it also produces are not published; only the
   `.wiki.db` is. The BM25 statistics are rebuilt from the node text on
   publish, which is faithful for a docstore built from the same nodes and is
   the assumption to revisit if that stops being true.
5. **The other generation artefacts are not published.** Only the `.wiki.db`
   is. The `.bm25.sqlite`, the mmap docstore and the FAISS binaries a
   generation also writes stay on scratch; BM25 statistics are rebuilt from the
   node text on publish.

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

### The engine reads from it

Set `ELITEA_DEEPWIKI_DATABASE_URL` and the engine's **read path** is served
from PostgreSQL, which is what makes a query replica stateless — ADR-0022's own
verification for this layer is "an `ask` served by a replica that did not build
the index returns the fixture answer", and
`test_a_replica_that_never_built_the_index_can_retrieve` is that test: a
generation builds an index on its own scratch, publishes it, the scratch is
deleted, and a second reader answers from the database alone.

The engine is a verbatim copy, so this is a **runtime substitution**, not an
edit. It is narrow enough to state in one line: `UnifiedWikiDB(path,
readonly=True)` returns a PostgreSQL-backed reader; every other construction
keeps the file class. `readonly` is not a proxy for intent — the engine already
records it at all eleven construction sites, and it splits them exactly:

| `readonly=True` (7 sites) | no flag (3 sites) |
| --- | --- |
| both toolkit wrappers, both ask workers, the deep-research worker, the cluster reader, research tools | the filesystem indexer, the clustering pass, cluster expansion |

Query on the left, index build on the right. So generation stays on ephemeral
scratch and querying does not, which is the split decision 3 asks for.

`UnifiedRetriever` asks its `db` for six things — `search_hybrid`, `get_node`,
`get_edges_from`, `get_edges_to`, `vec_available`, `close` — and
`PostgresUnifiedDB` serves all of them. A test derives that list from the
engine's own AST rather than keeping it by hand, so a future re-sync that
starts using a seventh method fails in CI rather than in a worker thread. The
write methods are present but **refuse**: a write reaching the read backend is
a wiring bug, and silently accepting it would be a generation that appeared to
succeed and stored nothing.

`publish.py` is the step between the two. It reads a generated `.wiki.db` and
writes its nodes, edges, embeddings and BM25 statistics into PostgreSQL. It is
a separate, callable step rather than something bolted into the engine, so a
publish that fails looks like a publish failure instead of a generation that
appears to have worked and then cannot be queried.

`publishing.py` calls it automatically. When `generate_wiki` completes, the
index is published **before** the invocation reports success, so a wiki that
finished is a wiki any replica can answer about. It finds the index from the
manifest's `unified_db_key`, and falls back to the newest `*.wiki.db` in the
cache directory when there is no manifest — which is the in-process path's
situation, and is the same mtime heuristic the legacy worker used, so it fails
the same way rather than in a new one. Either way the choice is logged.

A publish failure is reported **in band**, through the same `errors` list the
legacy composer renders as "⚠️ Partial issues detected", and does not fail the
invocation. The reasoning is that the pages, manifest and structure are genuine
and will land; what is lost is other replicas' ability to answer. Discarding
good artifacts over that would be worse, and passing silently would claim a
queryable wiki that is not. Publishing runs before composition precisely so the
failure can reach that list.

**A bug worth recording, because it was silent.** `repo_vec` is a sqlite-vec
*virtual* table: without the extension loaded, every read of it raises. The
first version of the publisher caught that, logged a warning and published
**zero vectors** — which at query time is indistinguishable from a wiki that
never had embeddings. Dense retrieval just returns nothing and fused ranking
quietly becomes FTS-only. The publisher now loads the extension, and
distinguishes "no `repo_vec` table" (legitimate; reported as `embeddings: 0`)
from "`repo_vec` exists and cannot be read" (refused). Every other test loaded
the extension successfully and so could not catch a regression;
`test_unreadable_vectors_raise_instead_of_publishing_none` forces the
condition.

## What here is provider-generic

**Read this before porting another provider.** Roughly 29% of the hand-written
code in this service has nothing to do with DeepWiki: it implements the shared
provider SPI, and the next provider will want all of it.

Inventory is the specced next port
(`elitea-docs`:
`docs/internal/03-architecture/cloud-native-migration/spec-provider-service.mdx`,
phase PVS-07): 34 unique tools, 36 declarations, the same SPI, the same
subprocess-and-Jobs execution, the same slot accounting, and a stricter
durable-state requirement than this service has. Everything in the first table
below applies to it unchanged.

### Generic — belongs in a shared library

| Module | Lines | What it is |
| --- | --- | --- |
| `invocations.py` | 429 | The invocation registry: the `pending`/`running`/`stopped`/`pruned` vocabulary, the `Started`/`InProgress` projection, drain-on-read `custom_events`, cooperative cancel, retention, and the `InvocationStore` seam. Every audited provider has this, and the spec describes it as one shape. |
| `jobs.py` | 296 | The Kubernetes Job manifest builder. The label, worker module and image are parameters; the structure — no init container, projected-file secrets, no retry — is what ADR-0022 decision 7 requires of any provider. |
| `app.py` | 236 | The SPI routes themselves. Only the descriptor wiring is provider-specific. |
| `security/identity.py` | 138 | The HMAC identity scheme. **See the warning below.** |
| `security/middleware.py` | 142 | mTLS refusal and unconditional identity-header stripping. |
| `security/egress.py` | 202 | The fail-closed host allowlist. Inventory ingests from sources and needs the same control. |
| `errors.py` | 131 | The two frozen error shapes and the category classifier. |
| `toolrunner.py` | 110 | The seam between the SPI and whatever runs the tools. |
| `config.py` | 157 | Strict-parsed settings; only the variable names are ours. |
| `slots.py` | 82 | Capacity accounting, including the `canStart` alias. |
| `storage/migrate.py` | 136 | Versioned, checksummed, service-owned migrations. |

Plus about 1,160 lines of conformance tooling that works on **any** Pylon
plugin, not just this one: `conformance/tools/_legacy.py` (the stubbed
`pylon.core.tools` that lets legacy modules be imported and executed offline,
plus digest pinning), `capture_descriptor.py` and `record_spi.py`. Recording a
second provider's golden fixtures is a matter of pointing these at it.

### DeepWiki's own

`descriptor.py`, `toolkits.py` (the alias lists), `legacy_runner.py` (dispatch
and result composition), `repo_config.py`, `publishing.py`, the copied
`tool_operations.py`, and all of `storage/` except `migrate.py` — the retrieval
layer is specific to what this engine indexes.

### The identity scheme is now written three times

`security/identity.py` is the **third** implementation of one contract:

    services/elitea-main/internal/llmproxy/identity.go         signs
    services/elitea-llm-gateway/internal/llmproxy/identity.go  verifies
    this file                                                  verifies

The Go comment on the canonical string says why that matters: it is duplicated
across independently deployed modules, so changing it in place fails every
request in both directions for the length of a rolling deploy. A fourth copy
for the next provider is not a DRY nicety — it is a rotation hazard. This one
belongs in a shared library on its own merits, whenever someone next touches
it.

### Why it was not extracted here

Extracting from a single instance is speculative: the boundaries are guesses
until a second consumer shows where they actually fall. The recommendation is
to make the extraction **the first step of the next provider port**, when
there are two real consumers and the split is evidence rather than
prediction — and when the code being moved has already been reviewed, which
this has not.

There is an intended home for it. spec-provider-service names a *Python
reference adapter* as phase PVS-04, a numbered deliverable in its own right.
This service was built into `services/elitea-deepwiki/` because that adapter
does not exist yet; when it does, the first table is its contents.

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
- [x] **Repoint the Kubernetes-Job path** — module entry point, no init
      container, projected-file secrets. Manifest verified; never run on a
      cluster.
- [x] **Point the engine at the PostgreSQL backend** — the read path is served
      from PostgreSQL and a replica that never built an index can answer.
- [x] **Call the publisher from the generation path** — a completed
      `generate_wiki` publishes its index before reporting success.
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
