# elitea-inventory — the Inventory engine, as a sidecar

The knowledge-graph engine of the legacy `inventory_plugin`, ported to run
behind the Go sub-application host (ADR-0023 stage H4c, I3).

```
facade ──mTLS──▶ elitea-subapp-host (Go)  ──unix socket──▶  this (Python)
                 SPI, admission, merge,        NDJSON        the engine:
                 deferred refusals,                          ingest, retrieve,
                 composition, artifact upload                investigate
```

The host owns everything generic: the provider SPI, the invocation registry and
slots, the error contract, the parameter merge, result composition, and putting
artifacts into the platform bucket. This package owns the engine — and only the
engine.

## Layout

| path | what it is |
|---|---|
| `src/elitea_inventory/engine/` | the legacy analysis layer, **copied byte for byte** (`COPY_MANIFEST.json` pins every digest) |
| `src/elitea_inventory/tool_operations.py` | `methods/invoke.py`, transformed by declared substitutions |
| `src/elitea_inventory/chat_operations.py` | `methods/inventory_chat.py`, likewise — the agent behind `investigate` |
| `src/elitea_inventory/v1_overrides.py` | the six methods v1 **replaces** rather than transforms |
| `src/elitea_inventory/tools_table.py` | the legacy routing table, as data |
| `src/elitea_inventory/sidecar.py` | `/engine/invoke`, `/engine/invocations/{id}/stop`, `/engine/health` |
| `tools/refresh_engine_copy.py` | performs the copy and verifies it (`--check`) |
| `tools/build_descriptor_v1.py` | derives descriptor revision `legacy-v1` from `legacy-v0` |

## Running it

```bash
uv venv --python 3.12 .venv
# `[engine]` too: tests/engine imports the copied engine, whose closure is
# elitea-sdk[tools] and everything it drags in (torch included — see
# pyproject.toml). `[test]` alone runs only the sidecar and runner suites:
#   PYTHONPATH=src .venv/bin/python -m pytest tests --ignore tests/engine
uv pip install --python .venv/bin/python -e '.[engine,test]'
PYTHONPATH=src .venv/bin/python -m pytest

# the sidecar on a socket, and a health probe over it
PYTHONPATH=src .venv/bin/python e2e/health_over_socket.py
```

```bash
# the shell image: 221 MB, builds in a couple of minutes
podman build -f services/elitea-inventory/Containerfile \
    -t localhost/elitea-inventory:local-shell .

# the sidecar answering on a real Unix socket, inside that image
podman run --rm -v "$PWD/services/elitea-inventory/e2e:/e2e:ro" \
    --entrypoint python localhost/elitea-inventory:local-shell \
    /e2e/health_over_socket.py

# the engine image — see the caveat below
podman build -f services/elitea-inventory/Containerfile \
    --build-arg 'EXTRAS=[engine]' \
    -t localhost/elitea-inventory:local-engine .
```

**Build status, stated exactly.** The SHELL image is built and verified: 221 MB,
and `health_over_socket.py` run inside it serves `/engine/health`, refuses a
foreign tool at the transport with 400, and refuses a served tool in band on the
stream. That exercises the whole Containerfile — the uv lock, the wheel build,
the `--no-deps` install, the socket directory's ownership, the non-root user and
the entrypoint.

The ENGINE image has **not** been built to completion here. Its wheel step
resolves, downloads and builds the full ~1,330-package closure and then fails
writing the layer: `no space left on device`, with ~18 GB free. A wheelhouse
containing torch, its NVIDIA CUDA wheels and opencv does not fit. Nothing about
that is specific to this port — it is the `tools`-extra weight recorded as I8
below, and it is the strongest argument for doing that work: the closure is not
merely wasteful, it is currently un-buildable on a developer machine.

`ELITEA_INVENTORY_RUNNER` defaults to `unavailable`, which refuses every tool
with a readable reason. `legacy` selects the engine and needs the `engine`
extra; `fixture` answers canned results for a stack that proves the socket hop
without the closure.

## The v1 scope, and what it deliberately does not port

**Sources: `github` and `ado_repos` only.** The facade expands the source
toolkit and forwards `{toolkit_id, type, name, settings, branch?, whitelist?,
blacklist?}` per invoke. The legacy plugin instead took a bare `toolkit_id` and
fetched that toolkit's expanded **credentials** itself, with an admin platform
token, on the strength of an id the caller supplied that nothing checked the
caller could see. There is no admin credential in this process at all;
`ELITEA_INVENTORY_SOURCE_TYPES` widens the allowlist for a deployment that has
actually run the engine against another type.

**No Kubernetes ingestion Jobs.** Ingestion runs here, under the host's
invocation manager and slot accounting. `k8s_ingestion_job_manager.py`, the
worker image and `INVENTORY_JOBS_ENABLED` are not ported, and the setting is not
read in any spelling — a setting that can be set and does nothing is worse than
none.

**Embeddings through the platform gateway.** The legacy plugin embedded entities
with a local `all-MiniLM-L6-v2`, which needed runtime egress to a model host and
meant the one thing on this platform that embedded outside the gateway was
unmetered. (It does NOT make the image small: torch still arrives transitively
through the SDK's `tools` extra — see I8 below. What changed is that this
service no longer has a reason of its own to carry it, and nothing downloads a
model at runtime.) v1 uses the toolkit's `embedding_model`
against `llm_settings.api_base`, and keeps the legacy code's *reasoning* about
drift by **recording** the model in the graph instead of pinning it in code: a
retrieval over a graph built in a different embedding space is refused by name,
which the legacy code could not do because it had nothing to compare.

**Chat is not ported** — the socket.io transport, `chat_history.json`, the
streaming callbacks. `investigate` **is**: it is one of the six
`inventory_search` tools, and it drives the same agent over `llm_settings`.

**Tools.** The `inventory` family declares 33 in revision `legacy-v1`, of which
28 are served; the five the legacy router never carried are refused by name at
the host. All 6 `inventory_search` tools are served. See
`conformance/provider/fixtures/inventory/descriptor/README.md`.

**Graph persistence.** `graph.json`, the per-source checkpoints and
`sources_status.json` are returned **inline** and uploaded by the host, through
the transport the facade handed over. Reading a graph back goes through
`elitea_inventory.artifacts`, authorised the same way — so a caller who cannot
see the bucket gets a 403 rather than someone else's graph. The local copy under
`ELITEA_INVENTORY_SCRATCH_PATH` is a cache; the bucket is the home.

## The copy, and why it is a copy

`engine/` is ~24k lines of graph algorithms, extractors, parsers and retrieval
with no platform coupling. Rewriting it would be a rewrite of the product, and a
rewrite is not checkable. A copy is — by digest:

```bash
python tools/refresh_engine_copy.py --check   # what CI runs; needs no legacy tree
python tools/refresh_engine_copy.py --source ../../legacy/plugins/inventory_plugin
```

The two **tool-layer** files cannot be verbatim: they import Pylon at module
scope, decorate every method with `@web.method()`, and read the invocation id
from a Pylon-injected module. The substitutions that remove those are declared
in the refresh tool and are the only thing applied; the manifest pins both the
result's digest and the digest of the legacy source it came from, so editing the
result by hand fails and the legacy source moving under us fails the next
re-copy.

Three copied *engine* files import Pylon's logger with no fallback. Rather than
grow the substitution list one entry per file — which is how a "verbatim" copy
quietly stops being one — `pylon_shim.py` registers a stub `pylon.core.tools`
providing exactly a stdlib logger and an inert decorator, and nothing else.

## Not yet done (stages I4–I8)

* **I4 — the facade.** `services/elitea-main` must expand the source toolkit and
  forward it per invoke. Until it does, every ingest call is refused by the host
  with "the facade does" — correctly, and unusably. Owned by another agent.
* **I5 — deploy wiring.** No Helm chart, no compose service, no `docker-bake.hcl`
  target and no `.github/image-scan-exempt.txt` entry. Nothing here needed one:
  the image builds from the Containerfile directly and the tests run without a
  stack.
* **I6 — the web UI.** The graph view, the sources view and the chat view all
  called the legacy plugin's own HTTP routes. Descriptor revision legacy-v1 is
  what makes their four tools reachable through the facade; nothing yet calls
  them.
* **I7 — a real-engine run.** Everything here is tested against injected tools
  or the copied engine's own unit tests. No ingestion has been run against a
  real repository through the socket, so the first one will find things — that
  is what DeepWiki's equivalent run found (a missing `git` binary, a
  root-owned socket directory, an empty manifest reported as success).
* **I8 — the engine image's weight.** `elitea-sdk[runtime,tools]` resolves to a
  ~1,330-package closure. MEASURED from the lock, it includes `torch` 2.14.0
  (with its NVIDIA CUDA wheels), `torchvision`, `timm`, `transformers` and
  `sentence-transformers` — pulled in by `unstructured` ->
  `unstructured-inference` — plus `python-pptx`, `textract` and `chromadb`, none
  of which a service that reads git repositories uses. The legacy plugin
  required the same extra, so this is parity rather than a regression, and
  removing the local embedding model removed this port's OWN reason to carry
  torch; it did not make the image small.

  Narrowing it is tractable, and partly measured already. `elitea_sdk.tools`
  imports every toolkit module and **tolerates the ones that fail** (it prints
  `Failed imports: github, ado_repos, …` and carries on), so a build needs only
  the dependencies of the toolkits it actually instantiates. Probed against
  `elitea-sdk[runtime]` alone:

  | step | result |
  |---|---|
  | `[runtime]` only | `instantiate_toolkit` imports; `github` refuses — "does not support direct instantiation or is not available" |
  | `+ PyGithub` | still refuses: `elitea_sdk.tools.github` needs `tree_sitter` |
  | `+ tree-sitter`, `tree-sitter-language-pack` | still refuses: it wants the older `tree_sitter_languages` |

  The remaining work is to finish that list for `github` and `ado_repos` and
  express it as an exact extra, the way `services/elitea-worker-python`'s
  `indexing-current` "intentionally replaces" the SDK's ranges. It was not done
  here because it is a change to what the image can instantiate, and that
  deserves its own measured commit rather than being smuggled into the port.

## A note on the dependency resolution

The engine image's builder stage resolves with **uv** and builds wheels with
pip (`--no-deps -r`), because pip cannot resolve this closure. MEASURED over
six image builds: the SDK's `tools` extra brings ~1,280 packages, and inside
that set chromadb, mcp, langsmith, `uvicorn[standard]`, unstructured-client and
their h11/httpcore/websockets constraints form a search space pip explores one
metadata download at a time. Every build was killed while pip was still walking
backwards through some package's release history; pinning the offenders one at
a time removed one dimension per build and revealed the next. uv resolves the
same set, to the same versions, in about twenty seconds.

The lock is generated inside the build rather than committed, so it cannot go
stale against `pyproject.toml`.

### The closure moves as a set, and Dependabot is silent on it

Same rule as `services/elitea-deepwiki`, same reason, and this package is where
it was proved twice over:

* **The pins move together, never one at a time.** #740 moved `fastapi` to
  0.141.1 in the same commit that moved `elitea-sdk` to 0.9.40, which pins
  `fastapi==0.115.9` exactly; #741 moved `mcp` to 2.1.1, and that SDK requires
  `mcp>=1.24,<2`. Either alone is a `ResolutionImpossible`. The `engine` extra
  did not resolve on `main` from 2026-09-02 until the gate below found it —
  nothing in CI resolved it, and no CI job builds this image.
* **The pins move together with the copy.** `pyproject.toml` carries a
  `# closure-stamp: COPY_MANIFEST.json sha256 …` line naming the engine copy
  the closure was resolved against; the gate refuses a tree where the copy
  moved and the stamp did not.
* **Dependabot is deliberately silent here.** `.github/dependabot.yml` gives
  this package its own pip entry with `ignore: "*"` and
  `open-pull-requests-limit: 0`. Alerts still appear in the Dependabot tab;
  the automatic one-pin-at-a-time pull request does not.

Validate — resolution only, no install and no image build:

```bash
bash scripts/ci/check-engine-closures.sh
```

It runs on every pull request and daily (the `engine-closures` job in
`.github/workflows/dependency-scanning.yml`), and it resolves this package with
**uv** at the same pinned version the `Containerfile` installs, for the reason
this section already gives.

Move the closure:

```bash
python3 scripts/ci/refresh-engine-closure.py services/elitea-inventory --check
```

For this package the tool **reports** the drift and does not rewrite. Its
`engine` extra deliberately mixes exact pins with ranges, and `chromadb`, `mcp`
and `langsmith` each carry paragraphs of measured reasoning beside them in
`pyproject.toml`; a mechanical rewrite would delete the reason along with the
version number it explains. So
the edit here is a person's, made with the reported drift in hand, and the
acceptance gate is the `[engine]` image build.

The pins that survive in `pyproject.toml` — exact `fastapi`, `uvicorn`,
`chromadb`, `mcp`, and `langsmith<0.12` — each record a real constraint with
the measurement beside it, and they are what a resolver of either kind lands
on. The `langsmith` bound is copied unchanged from
`services/elitea-worker-python`: it is one platform-wide fact (0.12 moves to
httpx2/httpcore2 and needs h11>=0.16, which cannot coexist with httpcore 1.0.7)
and two services disagreeing about it would be worse than either answer.
