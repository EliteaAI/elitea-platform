# End-to-end run

What this proves: the ported service **executes**. A real `generate_wiki`
invocation goes through the frozen SPI, into the copied tool layer, out to a
subprocess worker, and back with the frozen artifact set — clone, index,
repository analysis, structure planning, page generation, composition.

What it does **not** prove: content quality. `llm_stub.py` is a local,
deterministic, prompt-aware OpenAI-compatible stub. It returns a well-formed
`WikiStructureSpec` when asked for structure and canned markdown for pages, so
the pipeline has something of the right *shape* to work with. No model is
called, nothing leaves the machine, and a run is reproducible.

It is deliberately **not** in CI: it needs the `engine` extra (~1.1 GB, torch
and friends) and a local git daemon.

## Setup

```bash
cd services/elitea-deepwiki && python -m pip install -e ".[engine,test]"
```

Serve a repository over `git://` — the engine clones with `--depth`, which the
dumb HTTP transport cannot do:

```bash
mkdir -p /tmp/dwe2e/www/acme && git clone --bare <a-small-repo> /tmp/dwe2e/www/acme/notes-service.git && git daemon --reuseaddr --export-all --base-path=/tmp/dwe2e/www --listen=127.0.0.1 --port=19418 /tmp/dwe2e/www &
```

```bash
python services/elitea-deepwiki/e2e/llm_stub.py &
```

```bash
python services/elitea-deepwiki/e2e/run_generate_wiki.py /tmp/dwe2e/scratch
```

The runner rewrites `https://127.0.0.1:18900/` to `git://127.0.0.1:19418/`
through `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_0`, which is process-scoped — no
global git configuration is touched.

## What a good run looks like

Seven result objects, matching the frozen set in
`conformance/fixtures/generation/composed_result.json` by object type and
envelope (target, extension, encoding, bucket):

```
message
wiki_structure       {wiki_id}/analysis/wiki_structure_{ts}.json
wiki_page            {wiki_id}/wiki_pages/README.md
wiki_page            {wiki_id}/wiki_pages/{section}/{page}.md
wiki_manifest        {wiki_id}/wiki_manifest_{version}.json
repository_context   {wiki_id}/repository_context.txt
```

## The finding this run exists to record

**`run_in_subprocess` is not a performance switch — it changes the result.**

In-process (`run_in_subprocess=False`) the pipeline completes, but the composed
set is a *subset*: no `wiki_manifest`, and `repository_context` loses its
`{wiki_id}/` prefix. The manifest, the wiki id and the registry metadata are
built by `wiki_subprocess_worker`, not by the in-process wrapper.

So the frozen artifact set ADR-0022 decision 2 pins is only produced by the
out-of-process path. Any deployment that runs generate_wiki in-process — or any
future "simplification" that removes the subprocess hop — silently returns less
than the contract requires, and the composition fixtures alone would not catch
it, because they test the composer given a worker result rather than the worker.
