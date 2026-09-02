# Inventory provider descriptor revisions

Two revisions live here. Both are kept, and they answer different questions.

## `legacy-v0` — what the legacy plugin declared

Recorded from `legacy/plugins/inventory_plugin/methods/descriptor.py`. It is the
record of what the Pylon plugin actually advertised, and it is what a **parity**
question is asked against: "did the port drop anything the legacy product
declared?" is only answerable against this file.

It is not what the host serves. Nothing should be added to it.

## `legacy-v1` — what the host serves (ADR-0023 H4c stage I3)

`legacy-v0` **plus four tools**, and nothing else. The Go host's embedded
`internal/apps/inventory/descriptor.json` is a byte-for-byte copy of this file,
pinned by `internal/spi/conformance_inventory_test.go`.

| tool | who calls it |
|---|---|
| `get_entity_neighbors` | the graph view's "expand connections" context menu (1–3 hops) |
| `get_entities_by_ids` | the chat view's highlighting of the entities a response drew on |
| `get_ingestion_status` | the sources view's run-in-flight indicator |
| `smart_normalize_types` | the LLM type normaliser, re-run on an existing graph |

### Why they were added

All four are **implemented** in the legacy plugin (`methods/invoke.py` has a
`_tool_*` handler for each), **routed** by it (`_handle_inventory_tool`'s
dispatch dict names all four), and **called** by the legacy UI — and none was
ever declared in its descriptor.

That worked on the legacy platform because the UI called the plugin's own HTTP
routes directly, bypassing the descriptor entirely. Under ADR-0022/0023 the
facade admits a tool only if the descriptor advertises it, so an undeclared tool
is an unreachable one. Porting the provider without declaring them would have
been a port that silently dropped three features of the product — and dropped
them in a way no test could see, because nothing that exists today calls them
through the descriptor.

`legacy-v0` records the omission; `legacy-v1` corrects it.

### What did NOT change

Everything else: both toolkit configs byte for byte, the `inventory_search`
family untouched, every existing tool's `args_schema`, description and
`sync_invocation_supported` unchanged, and no tool removed. A conformance case
(`legacy-v1 adds four tools to legacy-v0 and changes nothing else`) diffs the
two revisions and fails on any other difference — a 37 KB document edited by a
generator cannot be reviewed for what it did *not* change.

The five tools `legacy-v0` declares and the legacy router **never** carried —
`get_type_stats`, `link_toolkits_to_tools`, `connect_orphan_nodes`,
`validate_relationships`, and `query_graph` on the `inventory` family — are
still declared in `legacy-v1`, and the runner refuses them by name
(`internal/apps/inventory/run`.`DeferredTools`). Removing them from the
descriptor would tell a caller the tool does not exist; what is true is that it
is declared and has never been implemented on any platform.

### Regenerating

```
cd services/elitea-inventory
python tools/build_descriptor_v1.py          # rewrite legacy-v1 from legacy-v0
python tools/build_descriptor_v1.py --check  # verify it is current
```

Then copy it to the host's embedded descriptor — the byte pin is what enforces
that they agree:

```
cp conformance/provider/fixtures/inventory/descriptor/legacy-v1/provider_descriptor.json \
   services/elitea-subapp-host/internal/apps/inventory/descriptor.json
```

> **Note when checking a fixture change locally:** `go test` caches a package
> result across edits to these JSON files, so a fixture-only change can re-run
> against a cached PASS. Use `go test -count=1` when the only thing you changed
> is a fixture.
