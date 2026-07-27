# Current `index_types` parity evidence

Status: source-complete and integration-tested; intentionally unmounted from
production composition pending the indexing cutover/browser checkpoint.

## Observable contract

| Concern | Current application evidence | Go target | Result |
| --- | --- | --- | --- |
| HTTP route | `elitea_core/api/v2/index_types.py` registers `GET /api/v2/elitea_core/index_types/prompt_lib/{project_id}`. | `CurrentIndexTypesRoute` | Exact method, mode and path shape. |
| Permission | `index_types.py` requires `models.applications.index_types.details` for project admin, editor and viewer roles. | `CurrentIndexTypesPermission`; existing PostgreSQL RBAC resolver | Exact permission; project membership, suspension and central-role non-inheritance are tested against PostgreSQL. |
| Success body | The current handler returns `module.index_types` directly. | `CurrentIndexTypes` | Exact top-level `document_types`, `image_types`, `code_types` object. The incompatible prototype `{index_types:[...]}` shape is rejected by contract tests. |
| Snapshot producer | `indexer_worker/methods/indexer_file_loaders.py:file_loaders_request` projects `document_loaders_map`, `image_loaders_map`, and `code_loaders_map`/`code_extensions`. | `sync_index_types_snapshot.py` and `CurrentIndexTypesSnapshot` | Generated from the worker-lock SDK revision; 18 document, 5 image, and 42 code entries. No partial Go list. |
| Image compatibility | The current producer reads `image_loaders_map`, not `image_loaders_map_converted`. | Generated snapshot excludes `.bmp` and `.svg`. | Exact current behavior. EliteaUI independently adds `.svg` in `fileTypes.js`; the API must not silently widen during this port. |
| UI consumer | `EliteaUI/src/api/applications.js:getDocumentLoaders`, `hooks/useFileTypes.js`, and `slices/fileTypes.js` consume the three maps directly. | `testdata/current_index_types_ui_response.json` | Full unchanged-UI fixture is returned byte-for-byte by the Go route tests. |
| Tenant boundary | The payload is process-global, but access is project-scoped by the current decorator. | Auth and PostgreSQL permission resolution execute before snapshot read. | Cross-project membership, suspended project/user, wrong permission, viewer/editor, and platform-admin cases are integration-tested. |

## Snapshot identity and bounds

- Worker lock SDK revision:
  `a78d3654f99d8ff89ca7233f20a66d676e564f79`.
- SDK constants source digest:
  `sha256:518049fb0ad8e8bf7030af2da64924a38684e2f9cbe037d35cec523d4b327bfd`.
- Canonical response digest:
  `sha256:f872b2f235c72836e85724cd0d49bcb030a567bf378ba6a0efe1e5768751e244`.
- Loader bounds: 64 KiB snapshot, 256 total category entries, 32-byte
  extensions, and 128-byte MIME values.
- Startup rejects partial, unknown-field, oversized, digest-mismatched, or
  malformed snapshots. Request handling copies the 65-entry immutable snapshot
  so callers cannot mutate concurrent responses; it starts no goroutines and
  owns no runtime cache or refresh loop.

The generator reads the exact Git object selected by
`services/elitea-worker-python/elitea-sdk.lock.json`; it does not require the
SDK worktree HEAD to equal that revision and does not import or execute SDK
modules. `--check` fails when either the embedded snapshot or the full UI
fixture is stale.

The audited current Centry `sdk_plugin` installation declares Elitea SDK
`0.8.30`; its installed `constants.py` has the same source digest above. The
new worker remains pinned to `0.8.26`, so dependency-version reconciliation is
a broader worker cutover gate, but it does not create `index_types` data drift
for this snapshot.

## Verification

- Generator parser tests cover full named-source extraction, converted-image
  exclusion, duplicate/partial definitions, and non-execution of SDK source.
- Go unit/contract tests cover the exact route/permission/body, authentication
  and authorization ordering, failure sanitization, nil/empty compatibility,
  snapshot validation, detached maps, and concurrent reads.
- `go test -race` passes for the route and snapshot packages.
- A disposable PostgreSQL HTTP integration matrix passes for project viewer,
  project editor, second-project viewer, cross-project denial, wrong
  permission, suspended principal, suspended project, and platform-admin
  non-inheritance. Tenant canaries are not returned.

## Deliberate safe differences and remaining cutover gates

The current Pylon module is briefly initialized with `{}` and can fall back to
three empty maps after an SDK import failure. When mounted, Go composition must
instead load the pinned complete snapshot and fail startup if that evidence is
invalid. This avoids serving a silently partial capability catalog. If an
already-composed reader fails during a request, the Go handler returns a
generic `500 {"error":"Failed to get index types"}` without dependency details;
the current in-memory handler has no equivalent runtime failure branch.

The route is not added to `elitea-main` production composition in this slice.
Consequently, live browser routing through Traefik and a real signed browser
session remains a cutover gate, not claimed evidence. Mounting should be one
default-off composition change followed by a browser comparison of the current
and Go responses for the same project and user. No EliteaUI change is required.
