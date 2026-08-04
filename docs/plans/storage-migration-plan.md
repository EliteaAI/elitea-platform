# Object Storage Migration — Staged Implementation Plan

**Normative decision:** `elitea-docs/docs/internal/03-architecture/adrs/adr-0016-object-storage-architecture.mdx`
**Gap analysis and target contract:** `elitea-docs/docs/internal/03-architecture/cloud-native-migration/spec-artifact-storage.mdx`

This plan is written to be executed by a coding agent (Sonnet or Haiku class) one
stage at a time. Each stage is independently mergeable, has an explicit file
list, explicit acceptance criteria, and a verification command whose exit code
decides pass or fail.

> Every path, symbol, library API, and test assertion below was verified against
> the tree at commit `de3cdf1` and against the pinned module versions. Where a
> stage touches a file whose *test* pins the current behaviour, that test is
> named in the stage. Do not discover these the hard way.

## Posture: brownfield service, clean break from legacy

**Brownfield** means the constraints that bind are *Go-side*: existing packages,
tests that pin current behaviour, a generated OpenAPI surface with a conformance
gate, and first-party consumers. Every one of those is named in the stage that
touches it.

**Clean break** means legacy Python is read for intent only. Do **not**:

- reproduce a legacy response shape, field name, or serialisation quirk;
- preserve a legacy URL form because legacy accepted it;
- build tooling to read legacy data — no artifact bytes are migrated;
- implement a capability solely because legacy had one. §3.3 of the spec lists
  what is deliberately dropped, including the entire `/artifacts/s3` surface.

Design the API for its consumers. Sizes are integers, not human-formatted
strings. Errors are a typed envelope. Retention is a day count. If you find
yourself porting a Python helper's output format, stop — that is the failure
mode this posture exists to prevent.

**No consumer code is changed by this plan.** The SDK, the web UI, and the
indexer all call endpoints that will no longer exist. Each is a separately
tracked issue, reworked once the new API lands. Do not edit `elitea-sdk`,
`apps/elitea-web`, `apps/elitea-ui`, or the indexer as part of any stage here.

---

## How to execute this plan

1. Read the stage. Read every file in its "Read first" list before editing.
2. Make only the changes the stage lists.
3. Run the stage's **Verify** command. It must exit 0.
4. Run the global gate: `task vet && task lint && task test && task build`.
5. Commit with the stage identifier in the subject, e.g. `feat(storage): S1 object store interface and typed errors`.

### Path bases — read this before touching anything

| Prefix | Relative to |
| --- | --- |
| `internal/`, `cmd/`, `migrations/`, `tests/`, `api/openapi/`, `go.mod` | `services/elitea-main/` |
| `deploy/`, `.github/`, `Taskfile.yml`, `docs/` | repository root |

Verify commands begin with `cd services/elitea-main` where they operate on the
Go module. Grep acceptance criteria are written repo-root-relative and are
therefore fully qualified — a grep against a path that does not exist exits
non-zero with no output and would otherwise pass trivially.

### Global guardrails — violating any of these fails review

- **No local filesystem in the artifact path.** No `os.Create`, `os.MkdirAll`,
  `os.OpenFile`, `os.TempDir`, `filepath.Join` on a caller-influenced path, and
  no `ParseMultipartForm` or `r.FormValue` anywhere under
  `internal/api/v2/artifacts/` or `internal/infra/storage/`. `r.FormValue` calls
  `ParseMultipartForm` internally and poisons `r.MultipartReader()`; read query
  parameters with `r.URL.Query().Get`.
- **No whole-object buffering.** No `io.ReadAll` on a request body or an object
  body. Bounded reads use `http.MaxBytesReader` or `io.LimitReader` with an
  explicit limit.
- **No default project.** Never write `if projectID == "" { projectID = "1" }`.
  A missing or non-canonical project identifier is a 400.
- **No `filepath.Join` for object keys.** It collapses `..`. Keys are validated
  and rejected, never normalised.
- **Never add `//go:build ignore` to a file to make a stage compile.** It does
  not work here: a package containing zero buildable files still fails
  `go vet` for any package that imports it, and `task vet` and `task test`
  both break. If a stage seems to need it, the staging is wrong — stop and
  re-read the sequencing note below.
- **Fail closed.** Unknown backend, missing credentials, failed authorization,
  and errored lookups all produce an error, never a permissive fallback.
- **Do not touch** `internal/infra/storage/content_server.go`,
  `postgres_content.go`, `postgres_secret_vault.go`, or any `current_*.go` file
  in `internal/infra/storage/`. Those serve execution input content and
  configuration state, not artifacts.
- Follow `AGENTS.md`'s other guardrails. Its default of preserving public HTTP
  paths and SDK behaviour does **not** apply to `/api/v2/artifacts/*` or
  `/artifacts/s3/*`: ADR-0016 §7 and this plan's Posture section replace every
  legacy artifact path deliberately, for API-design reasons, not only to fix a
  security defect. That replacement — the full S7-S11 route redesign — is the
  explicit goal of this plan, not an exception to flag.

### Why the sequencing looks the way it does

The existing `storage.Backend` interface has callers in three handler files
(`internal/api/v2/artifacts/{s3handler,handler,pg_repo}.go`) and is implemented
by all four backend packages (`internal/infra/storage/{s3,azure,gcs,filesystem}/`,
each with a `var _ storage.Backend = (*Backend)(nil)` compile-time assertion).
Rewriting `Backend`'s method set in place breaks all seven sites immediately,
and they are not replaced until much later — six consecutive stages would fail
the global gate.

So: **S1 introduces the new interface under a new name, `ObjectStore`, in new
files (plus the small additive `ObjectInfo` edit above, which is backward
compatible). The old `Backend` interface and all its callers stay untouched and
compiling.** S3 makes each remote backend implement `ObjectStore` *alongside*
its existing `Backend` methods — the `s3`, `azure`, and `gcs` packages gain a
second interface satisfaction without losing the first. Handlers migrate one at
a time in S8, S9, S10. The old `Backend` interface, the filesystem package, and
`pg_repo.go` are deleted at the end of S10, when nothing references them.

---

## Stage map

| Stage | Title | Depends on | Risk |
| --- | --- | --- | --- |
| S1 | `ObjectStore` interface, typed errors, validated `ObjectRef` | — | Low |
| S2 | Emulator-reachable backends: Azure and GCS configuration | — | Low |
| S3 | Implement `ObjectStore` on the three remote backends | S1, S2 | Medium |
| S4 | Conformance suite and CI emulators | S2, S3 | Medium |
| S5 | Factory, fail-closed config, `main.go` wiring | S3 | Low |
| S6 | Metadata schema and repositories | S1 | Medium |
| S7 | OpenAPI contract: define the new artifact API | S6 | Medium |
| S8 | Bucket-plane handlers; delete `pg_repo.go` | S5, S6, S7 | Medium |
| S9 | Object-plane handlers: download, HEAD, streaming upload, batch delete | S5, S6, S7, S8 | High |
| S10 | Retire `/artifacts/s3`; delete `Backend`, `filesystem/`, `oapiserver/artifacts.go` | S8, S9 | High |
| S11 | Production mount, auth, RBAC, public-rule removal | S10 | High |
| S12 | Limits: body caps, read and write deadlines, quota | S6, S11 | Medium |
| S13 | Project-creation bucket bootstrap | S6, S8 | Low |
| S14 | Retention ledger and sweeper | S6, S8, S9 | Medium |
| S15 | Presigned transfer grants | S3, S6, S11 | Medium |
| S16 | Native multipart upload | S3, S15 | Medium |
| S17 | Deployment: Helm, compose, secrets, workload identity | S5 | Medium |
| S18 | Observability: metrics, tracing, audit | S11, S15 | Low |
| S19 | API conformance suite in `tests/contract/` | S10, S11 | Medium |
| S20 | Adjacent planes: chat attachments, icons, result-artifact attestation | S9, S11, S15; **S20c also blocked on spec §6 open question 2 being answered** | High |

S1, S2, S3, S5, S6, S7, S8, S9, S10, S11 are the critical path. S4
(conformance suite) can run any time after S2/S3 — nothing on the path to S11
depends on it, so it is not itself "critical path" in the blocking sense.

There is **no data-migration stage**. Legacy artifact bytes, `centry.storage_meta`,
and the on-disk `libcloud` tree are out of scope per ADR-0016 §8.

---

## S1 — `ObjectStore` interface, typed errors, validated `ObjectRef`

**Preconditions:** none.
**Read first:** `internal/infra/storage/storage.go`, `config.go`, `client.go`.

This stage **adds new files and makes one small, additive edit to `storage.go`**.
It does not delete `Backend`, does not remove or rename any existing field, and
does not touch any handler or backend implementation.

**Edit `internal/infra/storage/storage.go`:** add two fields to the existing
`ObjectInfo` struct — `ETag string` and `DigestSHA256 []byte`. Every current
construction of `storage.ObjectInfo{...}` in the four backend packages uses
keyed field literals (verified: `storage.ObjectInfo{Key: ..., Size: ...}`
throughout `s3/`, `azure/`, `gcs/`, `filesystem/`), so adding fields is
non-breaking — no existing call site needs to change. **Do not declare a second
`ObjectInfo` type in a new file.** `objectstore.go` and `storage.go` are the
same Go package; a duplicate type declaration is a compile error
(`ObjectInfo redeclared in this block`), not a style choice, and it would break
`go build ./...` for every stage from here through S10.

**Create `internal/infra/storage/errors.go`:**

```go
var (
    ErrNotFound           = errors.New("storage: not found")
    ErrAlreadyExists      = errors.New("storage: already exists")
    ErrAccessDenied       = errors.New("storage: access denied")
    ErrPreconditionFailed = errors.New("storage: precondition failed")
    ErrTooLarge           = errors.New("storage: object too large")
    ErrInvalidKey         = errors.New("storage: invalid object reference")
    ErrNotSupported       = errors.New("storage: operation not supported by backend")
)
```

**Create `internal/infra/storage/ref.go`:**

```go
type ObjectRef struct{ projectID, bucket, key string } // zero value invalid

func NewObjectRef(projectID, bucket, key string) (ObjectRef, error)
func NewBucketRef(projectID, bucket string) (ObjectRef, error) // key empty
func ValidateKeyPrefix(p string) error                          // laxer, see below
func (r ObjectRef) ProjectID() string
func (r ObjectRef) Bucket() string
func (r ObjectRef) Key() string
func (r ObjectRef) StorageKey(keyPrefix string) string
func (r ObjectRef) BucketPrefix(keyPrefix string) string
```

Object-key rules, all rejecting with `ErrInvalidKey` wrapped in a message naming
the offending field:

- `projectID` matches `^[1-9][0-9]{0,17}$`. No leading zeros, no sign, no dot.
- `bucket` matches `^[a-z][a-z0-9-]{1,62}$`.
- `key`: non-empty; at most 1024 bytes; `utf8.ValidString`; no rune below 0x20
  and no 0x7f; no leading `/`; no `//`; no segment equal to `.` or `..`; no
  trailing `/`.

`ValidateKeyPrefix` is **deliberately laxer** and applies only to list prefixes:
it permits the empty string and permits a trailing `/`, because the SDK forces
every list prefix to end in `/` (`prefix if prefix.endswith('/') else f"{prefix}/"`).
It still rejects `..`, a leading `/`, `//`, control characters, and anything
over 1024 bytes. An object key and a list prefix are **not** the same type of
value; do not reuse one validator for both.

`StorageKey` returns, with `keyPrefix` omitted entirely when empty:

```
{keyPrefix}/p/{projectID}/b/{bucket}/o/{key}
```

`BucketPrefix` returns the same string truncated after `/o/`, for use as a list
prefix.

**Create `internal/infra/storage/objectstore.go`** with the new interface and
its supporting types — **everything except `ObjectInfo`**, which now lives in
`storage.go` per the edit above. Every type the interface references must be
declared somewhere in the package — an agent that omits one produces a file
with undefined identifiers.

```go
type UploadID string
type Part struct{ Number int32; ETag string; Size int64 }
type BatchError struct{ Key string; Err error }

type PutOptions struct {
    ContentType   string
    ContentLength int64 // -1 when unknown
    Metadata      map[string]string
}

type ByteRange struct{ Start, End int64 } // End -1 means "to end of object"

type ListQuery struct {
    Bucket            ObjectRef // bucket ref; its Key() is always empty
    KeyPrefix         string    // validated by ValidateKeyPrefix; may end in "/"
    Delimiter         string
    MaxKeys           int32     // 0 means backend default; hard cap 1000
    ContinuationToken string
}

type ListPage struct {
    Objects               []ObjectInfo
    CommonPrefixes        []string
    IsTruncated           bool
    NextContinuationToken string
}

type BatchResult struct {
    Deleted []string
    Failed  []BatchError
}

type Capabilities struct {
    Presign         bool
    NativeMultipart bool
    ServerSideCopy  bool
}

type ObjectStore interface {
    Put(ctx context.Context, ref ObjectRef, body io.Reader, opts PutOptions) (ObjectInfo, error)
    Get(ctx context.Context, ref ObjectRef, rng *ByteRange) (io.ReadCloser, ObjectInfo, error)
    Stat(ctx context.Context, ref ObjectRef) (ObjectInfo, error)
    Delete(ctx context.Context, ref ObjectRef) error
    DeleteBatch(ctx context.Context, refs []ObjectRef) (BatchResult, error)
    List(ctx context.Context, q ListQuery) (ListPage, error)

    PresignGet(ctx context.Context, ref ObjectRef, ttl time.Duration) (string, error)
    PresignPut(ctx context.Context, ref ObjectRef, ttl time.Duration, opts PutOptions) (string, error)

    StartMultipart(ctx context.Context, ref ObjectRef, opts PutOptions) (UploadID, error)
    PresignPart(ctx context.Context, ref ObjectRef, id UploadID, part int32, ttl time.Duration) (string, error)
    CompleteMultipart(ctx context.Context, ref ObjectRef, id UploadID, parts []Part) (ObjectInfo, error)
    AbortMultipart(ctx context.Context, ref ObjectRef, id UploadID) error

    Capabilities() Capabilities
}
```

**Semantic rules every implementation must honour**, stated here so the
conformance suite has one source of truth:

- `Delete` is **idempotent**: a missing key returns nil, never `ErrNotFound`.
- The not-found mapping to `ErrNotFound` applies to `Get` and `Stat` only.
- `List` returns exactly one page per call.
- An unsupported operation returns `ErrNotSupported`, never a panic.

**Acceptance criteria:**

- `ref_test.go` is table-driven and rejects, at minimum: `../x`, `a/../b`,
  leading `/`, `//`, trailing `/`, empty key, a 1025-byte key, a key containing
  `\x00` and one containing `\x7f`, invalid UTF-8, `projectID` values `0`, `01`,
  `-1`, `1.2`, and empty, and bucket names `A`, `1abc`, `a`, `a_b`, and a
  64-character name. Every rejection satisfies `errors.Is(err, ErrInvalidKey)`.
- `ValidateKeyPrefix` **accepts** `""`, `folder/`, and `a/b/`, and rejects
  `../`, `/a`, `a//b`.
- Valid refs produce the exact expected `StorageKey` with and without a prefix.
- The tree still builds: `storage.go`'s `ObjectInfo` gained two fields; nothing
  else changed and nothing was deleted.

**Verify:** `cd services/elitea-main && go test ./internal/infra/storage/ -race -run 'ObjectRef|KeyPrefix|StorageKey' -v && go build ./...`

---

## S2 — Emulator-reachable backends

**Preconditions:** none. May run in parallel with S1.

**Why first:** the Azure backend hardcodes `https://%s.blob.core.windows.net/`
and accepts only shared-key credentials; the GCS backend ignores
`cfg.CredentialsFile` and sets no endpoint. Until both are configurable, Azurite
and fake-gcs-server are unreachable and S4 cannot be written.

**Add the missing module first** — `azidentity` is only an indirect entry in
`go.sum` today, so the first import fails under `-mod=readonly`:

```bash
cd services/elitea-main && go get github.com/Azure/azure-sdk-for-go/sdk/azidentity@v1.13.1 && go mod tidy
```

That version requires `azcore v1.20.0`, below the pinned `v1.22.0`, so nothing
else moves.

**Edit `internal/infra/storage/azure/backend.go`:**

- Add `Endpoint string` to `Config`. When set, use it verbatim as the service
  URL; otherwise derive `https://{account}.blob.core.windows.net/`.
- When `Key` is empty, use `azidentity.NewDefaultAzureCredential` with
  `azblob.NewClient(serviceURL, cred, opts)`, enabling workload identity. When
  `Key` is set, keep the shared-key path.
- **Record on the Config which credential path was taken.** Presigning depends
  on it: `blob.Client.GetSASURL` returns `MissingSharedKeyCredential` when there
  is no shared key. A token-credential client must mint a **user-delegation**
  SAS instead (`ServiceClient().GetUserDelegationCredential` then
  `sas.BlobSignatureValues.SignWithUserDelegation`), and Azurite does not issue
  user-delegation keys. S3 uses this flag for `Capabilities().Presign`.

**Edit `internal/infra/storage/gcs/backend.go`:**

- Add `Endpoint string` to `Config`.
- `Endpoint` and `CredentialsFile` are **mutually exclusive**. Setting both is a
  hard construction error inside the client library —
  `options.WithoutAuthentication is incompatible with any option that provides
  credentials`. Reject the combination at config time with an error naming both
  environment variables, rather than letting the client fail at startup.
- When `CredentialsFile` is non-empty: append `option.WithCredentialsFile`.
- When `Endpoint` is non-empty and `CredentialsFile` is empty: append
  `option.WithEndpoint(cfg.Endpoint)` and `option.WithoutAuthentication()`.
- **`GCS_ENDPOINT` must be a full base URL including the `/storage/v1/` path**,
  for example `http://localhost:4443/storage/v1/`. `option.WithEndpoint` is a
  complete base-URL override, not a host override; only the
  `STORAGE_EMULATOR_HOST` code path appends `storage/v1/` for you. A bare host
  value silently routes every call to the wrong path and 404s on every
  `Stat`, `List`, and `Delete`. Document this in the `Config` field comment.

**Edit `internal/infra/storage/config.go`:** add `AzureEndpoint` from
`AZURE_STORAGE_ENDPOINT` and `GCSEndpoint` from `GCS_ENDPOINT`.

**Acceptance criteria:** both `New` functions accept an endpoint; neither
hardcodes a public-cloud hostname when one is supplied; the GCS constructor
returns an error when both `Endpoint` and `CredentialsFile` are set, with a
message naming both variables.

**Verify:** `cd services/elitea-main && go build ./internal/infra/storage/... && go test ./internal/infra/storage/gcs/ -run Config`

---

## S3 — Implement `ObjectStore` on the three remote backends

**Preconditions:** S1, S2.

Each of `s3`, `azure`, `gcs` gains an `ObjectStore` implementation. **Keep the
existing `Backend` methods in place** — handlers still call them until S10. Add
the new methods to the same type where names do not collide, and add a small
adapter type where they do.

Add `var _ storage.ObjectStore = (*Backend)(nil)` to each package.

**Add the AWS uploader at the one compatible version:**

```bash
cd services/elitea-main && go get github.com/aws/aws-sdk-go-v2/feature/s3/manager@v1.22.34
```

`@latest` upgrades 19 modules including the core SDK and smithy-go — do not use
it. `v1.22.34` is a much smaller bump: it moves `service/s3` from `v1.105.0` to
`v1.105.2` plus six same-family modules by one patch each (`config`,
`credentials`, `service/{signin,sso,ssooidc,sts}`), and leaves the core SDK
(`aws-sdk-go-v2`) and `smithy-go` untouched. Run `go mod tidy` and inspect
`git diff go.mod` before committing — the exact patch set can drift as new
releases land — and record what actually moved in the commit message. The
module carries a deprecation notice pointing at `feature/s3/transfermanager`;
note in the same commit message why the successor is not being used yet.

### S3 backend

- **Route every non-seekable body through `manager.Uploader`, not only
  unknown-length ones.** Against an `http://` endpoint, *any* non-seekable body
  fails before the network with `failed to compute payload hash: failed to seek
  body to start, request stream is not seekable` — the SigV4 middleware's
  `RewindStream`, not the checksum middleware. Setting
  `RequestChecksumCalculation: WhenRequired` does not help. Since S4 runs
  RustFS over plain HTTP and S9 passes a `*multipart.Part` straight into `Put`,
  every
  upload test would otherwise fail. Use the plain `PutObject` path only when the
  body implements `io.ReadSeeker`.
- Remove `isErrType`. Use `errors.As` with `*types.NoSuchKey`,
  `*types.NoSuchBucket`, and `smithy.APIError` code matching.
- `DeleteBatch` chunks keys into groups of at most 1000 and **leaves
  `Delete.Quiet` nil** — the field is `*bool` and `Quiet: false` does not
  compile; omitting it selects verbose mode, which is what populates
  `Deleted[]`. Report every `Errors[]` entry in `BatchResult.Failed`.
- `List` honours `MaxKeys`, `Delimiter`, and `ContinuationToken`, returning
  `CommonPrefixes` and `NextContinuationToken` from the provider response.
- When `AccessKey` is empty, let `awsconfig.LoadDefaultConfig` resolve IRSA,
  instance, and environment credentials — do not force static credentials.
- `Get` with a non-nil range sets the `Range` header and expects 206.
- Presigning uses `s3.NewPresignClient` with `PresignGetObject` /
  `PresignPutObject`. It works with a custom `BaseEndpoint` and `UsePathStyle`.
  Note that `ContentType` on `PutObjectInput` is **not** signed, so a presigned
  PUT does not enforce media type — S15 verifies it on commit.

### Azure backend

- `Put` sets `UploadStreamOptions{BlockSize: 8 << 20, Concurrency: 4}`. The
  library defaults of a 1 MiB block and concurrency 1 cap an object at 50000
  blocks × 1 MiB ≈ 48.8 GiB and serialise every upload. 8 MiB raises the ceiling
  to about 390 GiB.
- `List` obtains a container client via
  `client.ServiceClient().NewContainerClient(cfg.ContainerName)`. The hierarchy
  pager exists **only** on `container.Client`; the top-level `azblob.Client`
  exposes only the flat pager. Use `NewListBlobsHierarchyPager(delimiter, opts)`
  when `Delimiter` is set and `NewListBlobsFlatPager` otherwise; set `Marker`
  from `ContinuationToken`, call `NextPage` exactly once, and return
  `*resp.NextMarker` as `NextContinuationToken`. The `CommonPrefixes` equivalent
  is `page.Segment.BlobPrefixes`.
- Map errors with `bloberror.HasCode`: `BlobNotFound` and `ContainerNotFound` to
  `ErrNotFound` on `Get`/`Stat`; `AuthenticationFailed`, `AuthorizationFailure`,
  and `AuthorizationPermissionMismatch` to `ErrAccessDenied`.
- `Delete` swallows `BlobNotFound` and `ContainerNotFound` and returns nil.

### GCS backend

- `Get` issues a single call: `NewRangeReader(ctx, off, len)` when `rng != nil`,
  `NewReader` otherwise. Read attributes from `reader.Attrs`. Remove the separate
  `Attrs` call and its TOCTOU window. **`ObjectInfo.ETag` is empty on this
  path** — `ReaderObjectAttrs` does not carry one. Only `Stat` and `List`
  populate `ETag`, from `ObjectAttrs.Etag`. Handlers must not require it on the
  `Get` path.
- `Put` sets `w.ChunkSize` explicitly (8 MiB) and `w.ContentType`; on `io.Copy`
  error it calls `w.Close()` and returns the copy error, otherwise it returns
  the `Close` error.
- `List` honours `Query.Delimiter` and `Query.Prefix` and paginates via
  `iterator.NewPager`, returning `CommonPrefixes` from `attrs.Prefix` entries.
- Map `gcstorage.ErrObjectNotExist` and `ErrBucketNotExist` to `ErrNotFound` on
  `Get`/`Stat`. **`Delete` must explicitly check
  `errors.Is(err, gcstorage.ErrObjectNotExist)` and return nil** — the provider
  returns an error for a missing key, unlike S3.
- The four multipart methods return `ErrNotSupported`. The pinned client library
  has no multipart upload API: no upload identifier, no part list, no per-part
  signing. Do not attempt to emulate one.

### Capabilities must be honest

```go
// s3
Capabilities{Presign: true, NativeMultipart: true, ServerSideCopy: true}
// azure
Capabilities{Presign: cfg.HasSharedKey, NativeMultipart: true, ServerSideCopy: true}
// gcs
Capabilities{Presign: cfg.HasSigningMaterial, NativeMultipart: false, ServerSideCopy: true}
```

`Capabilities` exists precisely so a handler can fall back to the streaming
facade rather than failing. Reporting `true` uniformly defeats its purpose and
makes the conformance suite unpassable.

**Acceptance criteria:**

- `var _ storage.ObjectStore = (*Backend)(nil)` compiles in all three packages.
- `Capabilities()` matches the constructed configuration — a table test asserts
  Azure with no key reports `Presign: false`, and GCS always reports
  `NativeMultipart: false`.
- `grep -rn 'io.ReadAll' services/elitea-main/internal/infra/storage/` finds nothing.
- The tree still builds: the old `Backend` methods and their callers are intact.

**Verify:** `cd services/elitea-main && go build ./... && go vet ./internal/infra/storage/...`

---

## S4 — Conformance suite and CI emulators

**Preconditions:** S2, S3.

**Create `internal/infra/storage/conformance/`** — one table-driven suite run
against each backend its environment provides. Each backend skips with `t.Skip`
when its emulator variables are absent, so the suite is green on a laptop with
no containers and exhaustive in CI.

Cases 1 to 11 run against every backend. Cases 12 to 14 are **gated on
`Capabilities()`** and skip with a recorded reason when the backend reports the
feature as unavailable.

1. `Put` then `Stat` returns the same size and content type.
2. `Get` on a missing key satisfies `errors.Is(err, ErrNotFound)`.
3. `Delete` on a missing key returns **nil** on every backend.
4. `List` with a key prefix returns only matching keys.
5. `List` with `Delimiter: "/"` and a prefix ending in `/` returns
   `CommonPrefixes` and no keys below the delimiter.
6. `List` with `MaxKeys: 2` over 5 objects returns `IsTruncated: true` and a
   continuation token yielding the remainder with no duplicates and no gaps.
7. `Get` with `ByteRange{10, 19}` returns exactly 10 bytes matching the source.
8. `DeleteBatch` over 1500 keys deletes all of them and reports no failures.
9. `DeleteBatch` including 3 missing keys succeeds for the present ones.
10. A 5 MiB object round-trips with a matching SHA-256, not merely a matching
    length.
11. A zero-byte object round-trips.
12. *(gated on `Presign`)* `PresignGet` produces a URL an unauthenticated
    `http.Get` can fetch, and that returns 403 after a 2-second TTL elapses.
13. *(gated on `NativeMultipart`)* `StartMultipart` / `PresignPart` /
    `CompleteMultipart` over two 5 MiB parts yields an object whose digest
    matches the concatenation.
14. *(gated on `NativeMultipart`)* `AbortMultipart` leaves no listable object.

Plus one case asserting that a backend reporting `NativeMultipart: false`
returns `ErrNotSupported` from all four multipart methods.

**Emulator notes that determine whether this stage works at all:**

- **RustFS**, not MinIO — Elitea's chosen S3-compatible service for local dev,
  CI, and self-hosted deployment (see S17). RustFS is a real, independent
  S3-API-compatible object store (Apache 2.0, `github.com/rustfs/rustfs`); it
  is not a code fork or wrapper of MinIO and requires no special-casing in the
  `storage/s3` backend — it is exercised through the exact same code path as
  AWS S3, addressed by `S3_ENDPOINT_URL` like any other S3-compatible endpoint.
  Verified against the project's own `docker-compose-simple.yml` and container
  docs as of 2026-08: official image `rustfs/rustfs:latest`; S3 API on `9000`,
  console on `9001`; server-side credentials set via `RUSTFS_ACCESS_KEY` /
  `RUSTFS_SECRET_KEY` (these configure the RustFS server's root identity — pass
  the same values through as Elitea's client-side `S3_ACCESS_KEY` /
  `S3_SECRET_KEY` when pointing the S3 backend at it); the container runs as a
  non-root user, UID/GID `10001:10001`, and every mounted data path must be
  writable by that UID or the container fails to start. Run over plain HTTP
  with `S3_FORCE_PATH_STYLE=true` — RustFS is accessed by host:port rather than
  a DNS-based virtual-hosted bucket subdomain, so path-style is the safe
  default; confirm against the current compose file, since RustFS is a young,
  fast-moving project (public beta, first released mid-2025) and exact
  defaults can shift between releases. **Copy the actual service definition
  from `rustfs/rustfs`'s own `docker-compose-simple.yml` rather than
  hand-rolling one** — re-verify the image tag and env var names against that
  file at implementation time.
- **Azurite**: shared key only. It does not issue user-delegation keys, so run
  the Azure leg with `AZURE_STORAGE_KEY` set, or case 12 skips.
- **fake-gcs-server**: listens on 4443 with HTTPS by default — pass `-scheme http`
  or the connection fails regardless of the endpoint path. Set `GCS_ENDPOINT`
  to the full `http://localhost:4443/storage/v1/` form. Case 12 will skip for
  GCS unless a fake service-account key is injected via
  `option.WithCredentialsJSON` so `SignedURL` can sign locally; recording the
  skip is acceptable.

**Create `deploy/docker-compose.storage-test.yml`** with the three emulators,
and add a step to the storage job in `.github/workflows/ci-go.yml` that starts
it before the tests. A `services:` block is also acceptable if it proves
workable in the runner; the acceptance criterion is that the suite runs and
passes in CI, not the mechanism.

**Edit `deploy/docker-compose.yml`:** add a `rustfs` service and a
bucket-create init container so `task up` gives a working local object store.

**Acceptance criteria:** every non-gated case passes against all three backends
in CI; gated skips print their reason; the suite skips cleanly with no emulator.

**Verify:** `cd services/elitea-main && go test ./internal/infra/storage/conformance/ -race -v`

---

## S5 — Factory and wiring

**Preconditions:** S3.

**Rewrite `internal/infra/storage/config.go`:**

```go
type Config struct {
    Backend   string // "s3" | "azure" | "gcs" — required, env STORAGE_BACKEND
    Container string // physical bucket or container name — required, env STORAGE_CONTAINER
    KeyPrefix string // optional, empty by default, env STORAGE_KEY_PREFIX
    S3    S3Config
    Azure AzureConfig
    GCS   GCSConfig
}

func ConfigFromEnv(lookup func(string) (string, bool)) (Config, error)
```

Take a lookup function, matching the convention in `cmd/elitea-main/*_config.go`.
Return an error — never a default — when `STORAGE_BACKEND` is unset, empty, or
not one of the three; when `STORAGE_CONTAINER` is unset; when the selected
backend's required credentials are absent; or when GCS has both an endpoint and
a credentials file. `ARTIFACTS_DATA_DIR` is no longer read. `STORAGE_CONTAINER`
is the single physical bucket/container name used regardless of backend — the
per-backend `Config` structs (`S3Config`, `AzureConfig`, `GCSConfig`) take it as
their container/bucket field; there is no separate per-backend container-name
env var (the old prototype's `AZURE_STORAGE_CONTAINER` and `GCS_BUCKET` are
retired along with the rest of `config.go`).

**Use the lookup function, not `os.Getenv`, as a matter of convention — not
because CI enforces it yet.** `scripts/env-drift-check.sh` fails when code
reads a variable via `os.Getenv("X")` that the chart neither sets nor
allowlists, but it is invoked only from `.github/workflows/ci-gateway.yml`,
whose `paths:` trigger is scoped to `services/elitea-llm-gateway/**` — it will
not run at all on a PR touching only `services/elitea-main`. There is no
`golangci-lint` rule banning `os.Getenv` either. So nothing in this repo's CI
actually blocks a stray `os.Getenv` here today; follow the lookup-function
convention anyway, since S17 (which owns the Helm chart) runs later and the
check may be widened to cover `elitea-main` before then.

**The factory does NOT live in `internal/infra/storage/`.** `s3`, `azure`, and
`gcs` each already import package `storage` (for `ObjectRef`, `ObjectInfo`,
`PutOptions`, and the rest of S1's types — required by S3's
`var _ storage.ObjectStore = (*Backend)(nil)` assertions). A factory inside
package `storage` that constructs `s3.Backend` / `azure.Backend` / `gcs.Backend`
would need `storage` to import `s3`, `azure`, and `gcs` — `storage → s3 →
storage` is a direct Go import cycle, not a style choice. This is exactly the
constraint the file this stage deletes documents: `internal/infra/storage/client.go`
says the factory "lives in `cmd/elitea-main/main.go` to avoid import cycles
(backends import this package for the interface types; this package cannot
import them back)". That was correct. Keep it true.

**Delete `internal/infra/storage/client.go`** — supersede its comment with the
real thing, in the place it already said the real thing belongs.

**Create `cmd/elitea-main/storage_factory.go`** (package `main`, which can
safely import `internal/infra/storage`, `internal/infra/storage/s3`,
`internal/infra/storage/azure`, and `internal/infra/storage/gcs` — none of
those import `main`, so there is no cycle):

```go
func newObjectStore(ctx context.Context, cfg storage.Config) (storage.ObjectStore, error)
```

A `switch` over `cfg.Backend` calling `s3.New`, `azure.New`, or `gcs.New` with
the matching sub-config, and an error for anything else. Unexported — it has
exactly one caller, `main()`.

**Edit `cmd/elitea-main/main.go`:**

- Call `storage.ConfigFromEnv(os.LookupEnv)` and the new `newObjectStore`.
- On error, log and exit non-zero. The service does not start without a working
  object store.
- Add a startup readiness probe issuing one `Stat` against a sentinel key,
  tolerating `ErrNotFound` but not `ErrAccessDenied` or a transport error.
- Add an `ObjectStore` field to `RouterConfig` and assign it. **Do not assume
  assigning the existing `Storage` field puts the backend on the request path** —
  it is read only inside `newPrototypeCompatibilityRouter`, and
  `prototypeCompatibilityRequested` does not include it, so `main.go` never
  reaches that branch. S11 is what actually mounts the routes.

**Acceptance criteria:**

- A table-driven test asserts `ConfigFromEnv` errors for: unset backend,
  `STORAGE_BACKEND=filesystem`, `STORAGE_BACKEND=nonsense`, `s3` with no
  container, `azure` with no account, `gcs` with both endpoint and credentials
  file.
- A separate table-driven test in `cmd/elitea-main/storage_factory_test.go`
  asserts `newObjectStore` dispatches to the right constructor per
  `cfg.Backend` and errors on an unrecognised one. It does not need real
  network reachability — asserting the returned concrete type (or the error for
  the unknown case) is enough.
- `grep -rn 'ARTIFACTS_DATA_DIR' --include='*.go' services/elitea-main/` finds nothing.
- `grep -rn 'os.Getenv' services/elitea-main/internal/infra/storage/ services/elitea-main/cmd/elitea-main/` finds nothing.
- `go build ./...` exits 0 (this is the actual test for the import-cycle
  constraint above — a cycle fails the build with `import cycle not allowed`,
  not a grep).

**Verify:** `cd services/elitea-main && go build ./... && go test ./internal/infra/storage/... ./cmd/elitea-main/... -race`

---

## S6 — Metadata schema and repositories

**Preconditions:** S1.

**Create `services/elitea-main/migrations/shared/0057_artifact_storage.sql`.**
The head is `0056_agent_execution_output.sql`, so `0057` is free.

**There is no registration file.** `LoadManifest` discovers migrations from the
`//go:embed shared/*.sql tenant/*.sql` in `migrations/embed.go`. But there **is**
a pinned head assertion that will fail: bump
`internal/infra/db/migrate/manifest_test.go:97` from
`require.EqualValues(t, 56, Head(shared))` to `57`. Forgetting this reds
`task test`.

Four tables. `BIGINT GENERATED ALWAYS AS IDENTITY` matches the house style
already used in `migrations/shared/`.

```sql
CREATE SCHEMA IF NOT EXISTS elitea_storage;

CREATE TABLE elitea_storage.buckets (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    project_id      BIGINT      NOT NULL,
    name            TEXT        NOT NULL,
    display_name    TEXT        NOT NULL DEFAULT '',
    bucket_type     TEXT        NOT NULL DEFAULT 'local',
    is_pinned       BOOLEAN     NOT NULL DEFAULT FALSE,
    tags            JSONB       NOT NULL DEFAULT '{}'::jsonb,
    retention_days  INTEGER,
    expires_at      TIMESTAMPTZ,
    notified_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ,
    CONSTRAINT buckets_name_valid CHECK (name ~ '^[a-z][a-z0-9-]{1,62}$'),
    CONSTRAINT buckets_type_valid CHECK (bucket_type IN ('system','autogenerated','local'))
);
CREATE UNIQUE INDEX buckets_project_name_uniq
    ON elitea_storage.buckets (project_id, name) WHERE deleted_at IS NULL;

CREATE TABLE elitea_storage.objects (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    bucket_id      BIGINT      NOT NULL REFERENCES elitea_storage.buckets(id) ON DELETE CASCADE,
    key            TEXT        NOT NULL,
    byte_length    BIGINT      NOT NULL,
    media_type     TEXT        NOT NULL DEFAULT 'application/octet-stream',
    digest_alg     TEXT,
    digest         BYTEA,
    classification TEXT        NOT NULL DEFAULT 'internal',
    scan_state     TEXT        NOT NULL DEFAULT 'not_scanned',
    expires_at     TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT objects_key_len CHECK (octet_length(key) BETWEEN 1 AND 1024)
);
CREATE UNIQUE INDEX objects_bucket_key_uniq ON elitea_storage.objects (bucket_id, key);
CREATE INDEX objects_expiry ON elitea_storage.objects (expires_at) WHERE expires_at IS NOT NULL;

-- Required by S12 (quota) and S20a (attachment bucket name).
CREATE TABLE elitea_storage.project_storage_policy (
    project_id             BIGINT PRIMARY KEY,
    max_object_bytes       BIGINT,
    max_total_bytes        BIGINT,
    retention_default_days INTEGER,
    attachment_bucket      TEXT,
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Required by S15 (presigned grants) and S20c (attestation commit).
CREATE TABLE elitea_storage.transfer_grants (
    id           UUID        PRIMARY KEY,
    project_id   BIGINT      NOT NULL,
    bucket_id    BIGINT      NOT NULL REFERENCES elitea_storage.buckets(id) ON DELETE CASCADE,
    key          TEXT        NOT NULL,
    method       TEXT        NOT NULL,
    content_type TEXT        NOT NULL DEFAULT '',
    max_bytes    BIGINT      NOT NULL,
    digest_alg   TEXT,
    digest       BYTEA,
    expires_at   TIMESTAMPTZ NOT NULL,
    consumed_at  TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT grants_method_valid CHECK (method IN ('GET','PUT'))
);
CREATE INDEX grants_expiry ON elitea_storage.transfer_grants (expires_at);
```

**Create `internal/infra/db/repos/artifact_buckets.go` and
`artifact_objects.go`** following the construction and error conventions of the
neighbouring repositories — read `internal/infra/db/repos/index_ingest_results.go`
first for the house style.

Methods: `ListBuckets`, `GetBucket`, `CreateBucket` (mapping unique violation
`23505` to `ErrAlreadyExists`), `UpdateBucketRetention`, `SetBucketPinned`,
`SoftDeleteBucket`, `UpsertObject`, `ListObjects`, `DeleteObjects`, and
`SumBucketBytes` — a single `SUM`, never a full object listing.

**Acceptance criteria:** every method has a `*_postgres_integration_test.go`
following the existing pattern. Unique-violation and no-rows paths map to the S1
sentinels.

**Note on the verify command:** every `*_postgres_integration_test.go` in that
package calls `newPostgresIntegrationPool`, which **skips** when the integration
database URL is unset, and `ci-go.yml` sets no such variable. A bare `go test`
therefore exits 0 with every new test skipped. Either add a `postgres:16`
service and the DSN to the ci-go test job as part of this stage, or accept that
the suite is local-only and gate on the explicit run below.

**Verify:** `cd services/elitea-main && go test ./internal/infra/db/repos/ -race -run Artifact -v 2>&1 | tee /tmp/s6.log && grep -qc -- '--- PASS' /tmp/s6.log && ! grep -q -- '--- SKIP' /tmp/s6.log`

---

## S7 — OpenAPI contract: define the new artifact API

**Preconditions:** S6.

**This stage must land before any route change.**
`internal/api/oapiserver/conformance_test.go` asserts the forward direction:
every `operationId` in `api/openapi/v2.yaml` must resolve to a route registered
by `api.NewRouter(buildFullSurfaceConfig())`, and it pins floors of 75 spec
operations and 280 router routes. The spec currently declares 78 operations, 9
of them artifact operations: `bucketList`, `createBucket`, `editBucket`,
`updateBucketPin`, `deleteBucket`, `artifactList`, `createArtifact`,
`deleteArtifacts`, `deleteArtifact`.

Changing routes without updating the spec fails the forward assertion. Removing
operations without replacing them drops the count below the floor. Both break
`task test`.

**Replace the 9 legacy artifact operations with the 13 operations of the new
contract**, so the count rises rather than falls:

| Method | Path | operationId |
| --- | --- | --- |
| GET | `/artifacts/buckets/{projectID}` | `listBuckets` |
| POST | `/artifacts/buckets/{projectID}` | `createBucket` |
| GET | `/artifacts/buckets/{projectID}/{bucket}` | `getBucket` |
| PATCH | `/artifacts/buckets/{projectID}/{bucket}` | `updateBucket` |
| DELETE | `/artifacts/buckets/{projectID}/{bucket}` | `deleteBucket` |
| GET | `/artifacts/objects/{projectID}/{bucket}` | `listObjects` |
| POST | `/artifacts/objects/{projectID}/{bucket}` | `uploadObject` |
| POST | `/artifacts/objects/{projectID}/{bucket}:batchDelete` | `batchDeleteObjects` |
| GET | `/artifacts/objects/{projectID}/{bucket}/{key}` | `downloadObject` |
| HEAD | `/artifacts/objects/{projectID}/{bucket}/{key}` | `statObject` |
| DELETE | `/artifacts/objects/{projectID}/{bucket}/{key}` | `deleteObject` |
| POST | `/artifacts/grants/{projectID}/{bucket}` | `createTransferGrant` |
| POST | `/artifacts/grants/{projectID}/{grantID}:commit` | `commitTransferGrant` |

The old paths — `/artifacts/buckets/default/{project_id}`,
`/artifacts/artifacts/default/{project_id}/{bucket}`, `/artifacts/artifact/...`,
and everything under `/artifacts/s3` — are removed from the spec entirely. The
`default/` segment was a Pylon mode selector with exactly one value; it carries
no information and does not survive.

Schema rules, applied uniformly:

- Sizes are `integer` with `format: int64`, in bytes. Never a formatted string.
- Timestamps are `string` with `format: date-time`.
- Retention is `retention_days`, an integer, nullable for "no expiry".
- Every non-2xx response uses one shared `Error` schema:
  `{"error": {"code": "...", "message": "...", "details": {}}}` with `code` an
  enum of `NotFound`, `AlreadyExists`, `AccessDenied`, `InvalidArgument`,
  `InvalidKey`, `TooLarge`, `QuotaExceeded`, `PreconditionFailed`,
  `NotImplemented`, `Internal`.
- `listObjects` returns `{"objects": [...], "common_prefixes": [...], "next_cursor": "..."}`
  with `next_cursor` omitted when exhausted.

Regenerate with `task openapi`. Confirm `internal/api/generated/api.gen.go`
updates. `apps/elitea-web/src/shared/api/endpoints.manifest.json` is generated
from the same source — regenerating it is fine, but **do not** edit web UI
source to match; that is the tracked UI rework issue.

**The conformance test checks one direction only, and editing the spec alone
fails it.** `every_spec_operation_resolves_to_a_route` requires every spec
`operationId` to resolve to *some* registered router pattern — it does not
require the reverse. So after this edit, the 13 new paths have no route to
resolve to until something registers them, and the test fails with all 13
unresolved. **This stage must also register a minimal stub route for each of
the 13 new paths**, so the shape resolves; the *behaviour* is filled in by
S8/S9. Do this in `internal/api/router.go`, inside
`newPrototypeCompatibilityRouter`: replace the existing
`r.Route("/artifacts", func(r chi.Router) { ... })` block (currently ~11
registrations built on `v2artifacts.NewInMemoryHandler()`, around line 670)
with the 13 new paths from the table above, each pointing at one shared
placeholder:

```go
func notImplementedArtifact(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(http.StatusNotImplemented)
    _, _ = w.Write([]byte(`{"error":{"code":"NotImplemented","message":"pending S8/S9"}}`))
}
```

**Register the three key-bearing routes** (`downloadObject`, `statObject`,
`deleteObject`) **as a chi wildcard, not the literal `{key}` from the table.**
chi v5.1.0 has no multi-segment named-param syntax — a literal `{key}` matches
only one path segment and 404s on any key containing `/`, which S1's own key
grammar explicitly allows. Register these three as
`r.Get("/artifacts/objects/{projectID}/{bucket}/*", notImplementedArtifact)`
(and `r.Head`, `r.Delete` for the other two) instead. This is safe for the
conformance check specifically: `segmentsMatch` in
`internal/api/oapiserver/conformance.go` treats a **trailing** `*` as matching
any remainder of the spec path, unconditionally — confirmed by reading
`conformance.go:308-339`, which returns `true` the instant it reaches a
trailing `*` in the router pattern, before comparing further segments. So a
router pattern ending in `/*` still resolves the spec's `.../{key}` operation.
The other ten paths use ordinary `{projectID}`/`{bucket}`/`{grantID}` chi
params, matching the table's placeholders directly.

This removes the `artifactHandler := v2artifacts.NewInMemoryHandler()` line
and its 11 call sites from `router.go`. `NewInMemoryHandler` and `memRepo`
themselves stay — `internal/api/v2/artifacts/handler_test.go` still calls
`NewInMemoryHandler()` at seven places, so they remain live until S8 deletes
them there, per S8's own instructions. S8 and S9 do not add new registrations
at these paths and do not need to touch the wildcard pattern again; they
**replace** `notImplementedArtifact` at each path with the real handler,
editing the same 13 lines this stage adds.

**Acceptance criteria:** the spec declares at least 75 operations after the
swap; `go test ./internal/api/oapiserver/ -race` passes — genuinely, because
all 13 new paths now resolve to the stub; no path under `/artifacts/s3` remains
in `v2.yaml`; every route the stub replaced now returns 501 with the typed
error envelope instead of 404.

**Verify:** `cd services/elitea-main && task openapi && go test ./internal/api/oapiserver/ -race && ! grep -q 'artifacts/s3' api/openapi/v2.yaml`

---

## S8 — Bucket-plane handlers

**Preconditions:** S5, S6, S7.
**Read first:** `internal/api/v2/artifacts/handler.go`, `pg_repo.go`,
`handler_test.go`, and the 13-path stub block S7 added to
`newPrototypeCompatibilityRouter` in `internal/api/router.go`.

Rewrite the bucket half of `internal/api/v2/artifacts/handler.go` against the S6
repositories and the S1 `ObjectStore`, serving the S7 contract.

**Delete in this stage, because their replacements land here:**
`internal/api/v2/artifacts/pg_repo.go` (it queries `centry.storage_meta`, which
no Go migration creates and which is not migrated), `NewInMemoryHandler`, and
`memRepo`.

**Wire the five bucket-plane routes.** S7 already registered
`GET/POST /artifacts/buckets/{projectID}` and
`GET/PATCH/DELETE /artifacts/buckets/{projectID}/{bucket}` against
`notImplementedArtifact`. **Replace that placeholder at those five lines** with
`NewHandler(realRepo, realStore).{ListBuckets,CreateBucket,GetBucket,UpdateBucket,DeleteBucket}`
— do not add a second registration at the same path; chi panics on that. The
object-plane paths stay on the S7 stub until S9.

**`NewInMemoryHandler` has one remaining live caller after S7's edit:**
`internal/api/v2/artifacts/handler_test.go`, at seven places. Replace each with
`NewHandler(fakeRepo, fakeStore)` over an in-test fake added in this stage as
`internal/api/v2/artifacts/fake_store_test.go`.

Response bodies:

```jsonc
// GET /artifacts/buckets/{projectID}
{"buckets": [{"name": "reports", "type": "system", "is_pinned": false,
              "tags": {}, "retention_days": 365, "expires_at": "…",
              "size_bytes": 10485760, "object_count": 42,
              "created_at": "…", "updated_at": "…"}]}

// POST, GET one, PATCH  -> the single bucket object above
// DELETE                -> 204, no body
```

`size_bytes` comes from `SumBucketBytes` — a single `SUM`, never a full object
listing. It is an integer; formatting is the client's job.

**Retention is an explicit `retention_days` integer.** Do not port legacy's
`(expiration_measure, expiration_value)` pair or its `relativedelta` calendar
arithmetic. A client that wants "one year" sends `365`. Reject with 403 and
`code: QuotaExceeded` when the value exceeds the project's configured retention
limit, where a limit of `-1` or null means unlimited.

`POST` validates the bucket name against `^[a-z][a-z0-9-]{1,62}$` and rejects a
duplicate with 409 and `code: AlreadyExists`. **Do not silently normalise** —
legacy lowercased and stripped underscores, which quietly created a different
bucket than the caller asked for. Reject with 400 and `code: InvalidArgument`,
naming the rule.

Deleting a bucket deletes its objects via `ObjectStore.DeleteBatch` over a
prefix listing, then soft-deletes the metadata row.

**Acceptance criteria:** handler tests assert the exact JSON keys above for
every route; a bucket name needing normalisation is rejected, not normalised;
a retention value above the project limit produces 403 with the typed code;
`size_bytes` is an integer in every response.

**Verify:** `cd services/elitea-main && go test ./internal/api/v2/artifacts/ ./internal/api/ -race`

---

## S9 — Object-plane handlers

**Preconditions:** S5, S6, S7, **S8** — this stage's fake store and the
`NewHandler(fakeRepo, fakeStore)` constructor its own acceptance tests depend
on are introduced by S8, not created here.

This stage closes the highest-impact gap: object download and stat are
implemented in every backend and routed nowhere.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/artifacts/objects/{projectID}/{bucket}` | List. `prefix`, `delimiter`, `limit`, `cursor` |
| POST | `/artifacts/objects/{projectID}/{bucket}` | Streaming multipart upload, field `file` |
| POST | `/artifacts/objects/{projectID}/{bucket}:batchDelete` | Body `{"keys": [...]}`, per-key results |
| GET | `/artifacts/objects/{projectID}/{bucket}/*` | Streams bytes, `Range` supported |
| HEAD | `/artifacts/objects/{projectID}/{bucket}/*` | Metadata as headers |
| DELETE | `/artifacts/objects/{projectID}/{bucket}/*` | Delete one object |

**The key is the chi wildcard, not a named param.** chi v5.1.0 has no
`{name...}` syntax; a literal `{key}` matches only one path segment and 404s
the instant a key contains an internal `/`. Since S1's own key grammar
explicitly allows multi-segment keys and folder listing is a required
capability, this is not an edge case — it is the common case. S7 already
registered all six of these paths against the `notImplementedArtifact` stub,
with the three key-bearing routes on the correct `/*` wildcard pattern (not the
table's `{key}` placeholder) for exactly this reason. **Replace the stub at
each of the six lines with the real handler — do not add a second registration
at the same path** (chi panics on that) and do not change the pattern again.
Extract the key with `strings.TrimPrefix(chi.URLParam(r, "*"), "/")`, exactly
the pattern already used by the routes this stage retires
(`internal/api/v2/artifacts/{handler,s3handler}.go` both do this today).

Response bodies:

```jsonc
// list
{"objects": [{"key": "a/b.png", "size_bytes": 1024, "media_type": "image/png",
              "etag": "…", "modified_at": "…"}],
 "common_prefixes": ["a/"],
 "next_cursor": "…"}            // omitted when exhausted

// upload -> 201
{"key": "…", "size_bytes": 0, "media_type": "…", "etag": "…", "created_at": "…"}

// batch delete -> 200
{"deleted": ["a", "b"], "failed": [{"key": "c", "code": "AccessDenied", "message": "…"}]}

// single delete -> 204, no body
```

**Upload must stream.** Use `r.MultipartReader()` and pass the `file` part
directly as the `io.Reader` to `ObjectStore.Put`. `ParseMultipartForm` spills to
`os.TempDir` above its memory limit and is prohibited by ADR-0016. Read query
parameters with `r.URL.Query().Get` — **never `r.FormValue`**, which calls
`ParseMultipartForm` internally and makes `MultipartReader` return
`http: multipart handled by ParseMultipartForm`.

The server derives the object key from the logical bucket and the supplied
display name. A caller never supplies a storage path or a physical bucket.
Overwrite behaviour is an explicit `?overwrite=true|false` query parameter,
defaulting to `false`; a collision with `overwrite=false` returns 409 and
`code: AlreadyExists`.

**Download** streams with `io.Copy`, sets `Content-Type` from stored metadata
falling back to extension detection, sets `Content-Length`, and supports `Range`
by passing a `ByteRange` to `ObjectStore.Get` and replying 206.

**Batch delete** takes a JSON body, not repeated query parameters, and always
returns a per-key result array. An empty `keys` array is 400 with
`code: InvalidArgument` — it never means "delete the bucket", which is what
legacy did.

**Do not emit a `file_modified` event from the server.** That event is
dispatched by the SDK's artifact tool, not by Elitea's HTTP layer. Preserving
or re-specifying it belongs to the SDK rework issue.

**Acceptance criteria:**

- `grep -rn 'ParseMultipartForm\|io.ReadAll\|FormValue' services/elitea-main/internal/api/v2/artifacts/` finds nothing.
- A streaming test proves the handler does not buffer: set
  `t.Setenv("TMPDIR", t.TempDir())` and assert that directory is empty after a
  40 MiB upload; and drive the request body from an `io.Pipe` while the fake
  store records `time.Now()` on its first `Read`, asserting that timestamp
  precedes the final write to the pipe. Do **not** use `runtime.ReadMemStats` —
  GC timing and `-race` make the delta meaningless, and the test body is
  allocated in the same process.
- Download, HEAD, and range tests pass against the fake store, using the
  `NewHandler(fakeRepo, fakeStore)` constructor and fake store S8 introduces.
- **A key containing an internal `/` round-trips through the real chi router**,
  not just the fake store — e.g. upload to `a/b/c.png`, then GET, HEAD, and
  DELETE the same key through the mounted route and confirm each resolves the
  full key rather than 404ing on the first segment. This is the case the
  `/*` wildcard fix above exists to cover.
- A key containing `..` returns 400 with `code: InvalidKey`.

**Verify:** `cd services/elitea-main && go test ./internal/api/v2/artifacts/ -race`

---

## S10 — Retire `/artifacts/s3`, and the deletions

**Preconditions:** S8, S9.

Everything in this stage is deletion. There is no S3-proxy rewrite: ADR-0016 §7
retires the surface rather than porting it.

**Delete:**

- `internal/api/v2/artifacts/s3handler.go` and its tests.
- The prototype `/artifacts/s3/*` registrations in `internal/api/router.go`
  (the five `r.Get`/`r.Put`/`r.Delete` calls near line 241) and
  `mountArtifactS3Routes` together with its block in `router_security_test.go`.
- `internal/infra/storage/filesystem/` (whole directory).
- The old `Backend` interface and `BucketInfo` in `internal/infra/storage/storage.go`.
- `internal/api/oapiserver/artifacts.go`. **No `mount.go` change is needed** —
  that file is 19 lines and registers nothing; routes come from the generated
  code. Removal falls back to the embedded `generated.Unimplemented` in
  `internal/api/oapiserver/server.go:17`, which keeps
  `var _ generated.ServerInterface = (*Server)(nil)` satisfied. Also drop the
  now-dead `artifactsDir` and `ArtifactsDir` fields from `server.go`.

**`internal/api/router_security_test.go` needs care.** It imports the filesystem
package for its fixture and it contains the traversal test. Repoint the fixture
at the S8 fake store, and **keep the traversal test, retargeted at the new
object routes**: the current test covers only the percent-encoded `%2e%2e` form,
which incidentally fails; add the raw `..` form, which actually escapes, and
assert 400 with `code: InvalidKey` now that the handler constructs `ObjectRef`
before any store call.

Deleting the S3 surface also deletes the only reason to build SigV4, the S3
credential API, the XML dialect, and the sub-resource dispatch table. If a stage
ever seems to need one of those, the surface has been reintroduced by mistake.

**Acceptance criteria:**

- `grep -rn 'infra/storage/filesystem' --include='*.go' services/` finds nothing.
- `grep -rn 'storage_meta\|bucket_metadata' --include='*.go' services/` finds nothing.
- `grep -rn 'NewInMemoryHandler\|memRepo\|S3Handler\|mountArtifactS3Routes' --include='*.go' services/` finds nothing.
- `grep -rn 'artifacts/s3' services/elitea-main/ --include='*.go' --include='*.yaml'` finds nothing.
- A raw `..` key returns 400, not 200 and not 404.

**Verify:** `task test && task build`

---

## S11 — Production mount, auth, RBAC

**Preconditions:** S10.
**Read first:** `internal/api/router.go`, `production_router.go`,
`main_public_rules.go`, `main_public_rules_test.go`, `router_security_test.go`,
`internal/api/oapiserver/conformance_test.go`.

**Extract a single `mountArtifactRoutes(r chi.Router, deps ArtifactDeps)` and
call it from both `newPrototypeCompatibilityRouter` and the production router.**
Registering only in production breaks the oapiserver conformance test, which
walks the prototype router. One shared mount function satisfies both.

- Apply `apimw.Auth` plus `apimw.RequireResolvedPermissionsForProject` to
  **every** route. The current `/api/v2/artifacts/*` routes have authentication
  but no permission check at all.
- Permission mapping, using the existing
  `configuration.artifacts.artifacts.{view,create,edit,delete}` catalog:
  GET and HEAD to `view`, POST upload and bucket create to `create`, PATCH to
  `edit`, DELETE and `:batchDelete` to `delete`, grant creation to `create`.
  The `edit` permission is easy to miss — legacy uses it for retention and pin
  changes, and wiring those to `create` or `delete` grants or denies the wrong
  principals.
- **Remove** `^/artifacts/s3/.*$` from `internal/api/main_public_rules.go`, and
  **in the same commit** delete the `current.artifacts.s3` entry from the `want`
  table in `main_public_rules_test.go` and re-anchor
  `TestCurrentMainRoutePublicRulesReturnsDetachedCatalog` on the new index-0
  rule, `current.admin_ui.assets`. Both tests iterate by index and fatal on a
  length mismatch, so removing the rule alone reds `task test`. No artifact
  route is ForwardAuth-exempt; the surface that justified the exemption is gone.
- Delete `TestLegacyS3CompatibilityRoutesAreNotProductionMounted`, which pins
  the dead-code state, and replace it with a test asserting the new routes
  **are** mounted and **do** require authentication and permission.
- **Do not let the artifact routes inherit the shadow middleware.**
  `internal/api/shadow/middleware.go` wraps `http.ResponseWriter` without an
  `Unwrap` method and buffers the whole response into a `bytes.Buffer`. It is
  installed on the entire `/api/v2` group in the prototype router. Mount the
  artifact routes outside it, or the download path buffers every object in
  memory and `ResponseController` deadlines stop working.

**Acceptance criteria:**

- Every artifact route returns 401 unauthenticated, 403 with a valid principal
  lacking the permission, and 2xx with it.
- A PATCH with only `create` permission returns 403; with `edit` it succeeds.
- A request for project 8's object with a principal scoped to project 7 returns
  403 — tested end-to-end through the router, not at the store layer.
- `grep -rn 'artifacts/s3' services/elitea-main/internal/api/` finds nothing.

**Verify:** `cd services/elitea-main && go test ./internal/api/... -race`

---

## S12 — Limits

**Preconditions:** S6, S11.

- Wrap every upload route body in `http.MaxBytesReader`, limit sourced from
  `elitea_storage.project_storage_policy.max_object_bytes` falling back to
  `ARTIFACT_MAX_OBJECT_BYTES` (default 150 MiB, matching the legacy
  vault-sourced `chat_max_file_upload_size_mb`).
- **Replace the global `ReadTimeout: 10 * time.Second` with
  `ReadHeaderTimeout: 10 * time.Second`** and set per-request body deadlines via
  `http.ResponseController.SetReadDeadline` in the upload handlers. `ReadTimeout`
  bounds reading the entire request including the body, so it is the real upload
  ceiling today — well below any size limit.
- **Do the same for the write side.** `WriteTimeout: 120 * time.Second` on the
  same lines caps every *download* at 120 seconds regardless of object size,
  which S9 has just made a live route. Set per-request write deadlines with
  `http.ResponseController.SetWriteDeadline` on the download route
  (`GET /artifacts/objects/{projectID}/{bucket}/*`, S9). There is no S3-GET
  route by this stage — S10 already retired `/artifacts/s3`.
- `ResponseController` walks `Unwrap()`. The OTel middleware's recorder
  implements it; the shadow middleware's does not — which is why S11 keeps the
  artifact routes off the shadow path.
- Enforce the project quota on the write path against
  `project_storage_policy.max_total_bytes` compared with `SumBucketBytes` across
  the project, returning 413.

**Acceptance criteria:** a 200 MiB upload returns 413 with a JSON error body,
not a truncated stream or a connection reset; a 100 MiB upload over a 30-second
body succeeds; a 300-second download of a large object completes.

**Verify:** `cd services/elitea-main && go test ./internal/api/v2/artifacts/ -race -run 'Limit|Quota|Deadline'`

---

## S13 — Project-creation bucket bootstrap

**Preconditions:** S6, S8.

Legacy creates `reports` and `tasks` with `bucket_type='system'` on project
creation and deletes both on project deletion. Without this, every project
created by the Go service has no system buckets — and the legacy on-disk tree
confirms both exist for every project.

Hook the project-creation path to insert both rows into
`elitea_storage.buckets`, and the deletion path to soft-delete them and purge
their objects.

**Acceptance criteria:** a newly created project lists exactly `reports` and
`tasks`, both with `bucket_type='system'`; deleting the project removes both and
leaves no objects.

**Verify:** `cd services/elitea-main && go test ./internal/api/v2/artifacts/ ./internal/application/... -race -run 'Bootstrap|SystemBucket'`

---

## S14 — Retention ledger and sweeper

**Preconditions:** S6, S8, **S9** — stamping `expires_at` on written objects
means editing the upload path, which S9 introduces; it does not exist after S8
alone.

- On bucket create and retention update, compute `expires_at` for the bucket and
  stamp `expires_at` on objects written into it.
- Add a scheduled sweeper following the pattern in
  `internal/runtimecomposition/current_index_schedule_due_work*.go` and
  `current_index_runtime.go`. It selects expired objects in bounded batches,
  deletes them through `ObjectStore.DeleteBatch`, and removes the metadata rows
  in the same transaction boundary as the delete acknowledgement.
- Emit the expiry warning notification when a bucket has one day remaining,
  deduplicated via `notified_at`.
- Provider-native lifecycle rules are **not** used for per-bucket retention. Set
  one coarse rule aborting incomplete multipart uploads after 7 days.

**Acceptance criteria:** an object with `expires_at` in the past is gone from
both the object store and the metadata table after one sweeper tick; the
notification fires exactly once per bucket per expiry cycle.

**Verify:** `cd services/elitea-main && go test ./internal/runtimecomposition/ -race -run Retention`

---

## S15 — Presigned transfer grants

**Preconditions:** S3, S6, S11.

Add `POST /api/v2/artifacts/grants/{projectID}/{bucket}` returning a
short-lived presigned URL bound to a server-derived key, persisted in
`elitea_storage.transfer_grants`.

The grant response carries the URL, the required method, the expiry, and the
required content type and maximum size. It does **not** carry the physical
bucket, the backend URL, or any credential. The caller may request a display
name and a logical bucket; the server chooses the key.

`POST /api/v2/artifacts/grants/{projectID}/{grantID}:commit` verifies size, digest, and media type against
the grant row before the object becomes listable, then stamps `consumed_at`.
Media type verification at commit is **mandatory**, not defensive: `ContentType`
is not part of the signed presigned-PUT payload, so the URL alone does not
enforce it.

Default TTL 15 minutes, maximum 60. `PUT` grants are single-use.

**Fall back to the streaming facade when `Capabilities().Presign` is false** —
an Azure client using workload identity, or a GCS client with no signing
material. Return the facade URL, not an error.

**Acceptance criteria:** a presigned `PUT` followed by a commit produces a
listable object; a commit with a mismatched digest returns 409 and the object is
deleted; a commit with a mismatched media type returns 409; an expired grant URL
returns 403 from the provider; a second commit on the same grant returns 409.

**Verify:** `cd services/elitea-main && go test ./internal/api/v2/artifacts/ -race -run Grant`

---

## S16 — Native multipart upload

**Preconditions:** S3, S15.

Expose the four multipart operations through the grant API for objects above
64 MiB, **gated on `Capabilities().NativeMultipart`**. Part state lives in the
provider, never in Redis and never in process memory.

GCS reports `NativeMultipart: false` and must fall back to the streaming facade.
Do not emulate multipart on top of resumable writes.

**Do not port the legacy design.** Legacy stored parts in Redis with a 24-hour
TTL, fell back to a process-local dictionary when Redis was unavailable,
concatenated the whole object in memory on completion, and recorded `uploadId`
ownership without ever checking it — permitting cross-tenant part theft.
Ownership must be verified on every part and completion call.

**Acceptance criteria:** a 2-part 10 MiB upload against S3 and Azure completes
with a matching digest; the same request against GCS transparently uses the
facade; a part call with another project's grant returns 403.

**Verify:** `cd services/elitea-main && go test ./internal/api/v2/artifacts/ -race -run Multipart`

---

## S17 — Deployment

**Preconditions:** S5.

- `deploy/helm/elitea-main/values.yaml`: add the storage environment block and a
  `secretRef` for `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `AZURE_STORAGE_KEY`. The
  chart currently delivers only `envFrom: configMapRef` and has no secret path.
- `deploy/helm/elitea-main/templates/serviceaccount.yaml`: add an `annotations`
  block so IRSA and Azure Workload Identity can be configured. It has none
  today, which is why credentials must be static.
- Confirm no `volumes`, `volumeMounts`, `persistentVolumeClaim`, or `emptyDir`
  appear for artifact data. There are none — keep it that way, and the HPA
  scaling from 2 to 10 replicas becomes correct rather than accidentally so.
- Remove the storage variables from
  `deploy/helm/elitea-main/env-drift-allowlist.txt` now that they are wired, and
  add the new names introduced by S5 and S12.
- Remove `ARTIFACTS_DATA_DIR` and the artifact bind mount from
  `deploy/docker-compose.staging.yml`.
- Add a Helm chart for `pylon-indexer` and `elitea-worker-python`, or record
  explicitly that they are out of scope for R1.

**Verify:** `helm template deploy/helm/elitea-main > /tmp/rendered.yaml && grep -q 'S3_ACCESS_KEY' /tmp/rendered.yaml && ! grep -qE 'persistentVolumeClaim|emptyDir' /tmp/rendered.yaml`

---

## S18 — Observability

**Preconditions:** S11, **S15** — auditing "every grant issuance" requires the
grant-creation code S15 adds; it does not exist right after S11.

Instrument every `ObjectStore` method with the existing OTel setup — read
`internal/api/middleware/otel.go` for the house pattern. Operation duration
histogram, error counter by sentinel type, bytes-in and bytes-out counters, all
labelled by backend and operation but **never** by project identifier or key,
which would explode cardinality. Add a per-project byte-usage gauge sourced from
the metadata table on the sweeper tick, not per request.

Emit an audit record for every delete and every grant issuance.

**Verify:** `cd services/elitea-main && go test ./internal/infra/storage/... -race -run Metrics`

---

## S19 — API conformance suite

**Preconditions:** S10, S11.

`services/elitea-main/tests/contract/` and `.github/workflows/ci-contract.yml`
already exist and run weekly. The workflow accepts a `legacy_url` input and was
built to diff Go against the legacy service — **that comparison is no longer
meaningful** and the input should be removed. Repurpose the harness as a
self-contained conformance suite driving the new artifact API against a running
Go service plus a RustFS emulator (S4).

Cover, end to end through the real router with real auth:

- Bucket create, get, list, patch (pin, tags, retention), delete.
- Bucket name rejection: uppercase, leading digit, underscore, 63-plus characters.
- Retention above the project limit returns 403 with `code: QuotaExceeded`.
- Upload, download, HEAD, delete, and range read of a 5 MiB object with a
  digest check on the round trip.
- Upload with `overwrite=false` onto an existing key returns 409.
- List with `prefix` and `delimiter`, asserting `common_prefixes` and that
  `next_cursor` paginates without duplicates or gaps.
- Batch delete with a mix of present and absent keys, asserting the per-key
  result array; an empty `keys` array returns 400.
- Every error code in the envelope enum is reachable by some request, and no
  response body is plain text.
- A key containing `..`, a leading `/`, or a control character returns 400 with
  `code: InvalidKey`.
- Cross-project access returns 403.

**Acceptance criteria:** the suite fails if any response is not the documented
shape; `ci-contract.yml` no longer references a legacy base URL.

**Verify:** `cd services/elitea-main && go test ./tests/contract/ -race -run Artifact`

---

## S20 — Adjacent planes

**Preconditions:** S9, S11, **S15** — S20c needs the grant and commit machinery.
**S20c is additionally blocked on spec-artifact-storage.mdx §6 open question 2**
("does the attestation plane share this `ObjectStore`?") being answered by an
owner — that gate is prose, not a stage number, so check it explicitly before
starting S20c even once S9/S11/S15 are done.

Three separate pieces of work, each with its own design step. Do not merge them.

**S20a — Chat attachments.** Go's `AddAttachments` takes a JSON body and writes
`chat_conversations.meta`; legacy is a multipart upload writing bytes to a
bucket plus `chat_messages_attachment` rows. These are different resource types.
Implement the byte path against the S9 handlers, port the 5 MiB chunked-upload
contract (`file_id`, `chunk_index`, `total_chunks`, `file_name`), and source the
per-project limits from `elitea_storage.project_storage_policy` — legacy reads
them from vault secrets at request time: 150 MB total, 150 MB per file, 3 MB per
image, 365-day retention, and the attachment bucket name from
`default_attachment_bucket`. A cutover that flips this route before the byte
path exists silently drops attachment bytes.
*Verify:* `cd services/elitea-main && go test ./internal/api/v2/... -race -run Attachment`

**S20b — Icons.** `UploadIcon` writes to `ICONS_DATA_DIR` and returns
`/icons/{projectID}/{filename}`, but nothing serves `/icons/*` — no route, no
Traefik rule, no volume. Every uploaded icon is currently unreachable. Move
icons onto the object store using the S9 object plane with a reserved system
bucket, and serve them through the download route. Replace the
`internal/api/oapiserver/misc.go` stub that returns an empty URL.
*Verify:* `cd services/elitea-main && go test ./internal/api/v2/eliteacore/ ./internal/api/oapiserver/ -race -run Icon`

**S20c — Result-artifact attestation.** `elitea_runtime.index_result_artifacts`
is documented as owned by "the future artifact upload data plane".
`ArtifactVerifier` is a required production dependency, `VerifyDurable` returns
`ErrIndexIngestArtifactUnavailable` on no rows, and **there is zero non-test
insert into the table** — so any index-ingest result carrying a result artifact
cannot settle today. Implement the writer: a grant, commit, and verify path on
the S15 machinery, honouring the existing 1 MiB and `application/json` policy,
sharing the `ObjectStore` adapter but keeping its own metadata and settlement
semantics per ADR-0014. Requires an answer to open question 2 in the spec.
*Verify:* `cd services/elitea-main && go test ./internal/application/output/ ./internal/infra/db/repos/ -race -run IndexIngestArtifact`

---

## Explicitly out of scope

Do not implement, and reject review requests that add them without a new ADR:

- **The entire `/artifacts/s3` surface**, and everything that existed only to
  serve it: AWS SigV4 verification, the customer-facing S3 credential API and
  its key format, S3 XML response bodies, the `?format=json` mode,
  `move_objects`, S3 Select, and the `?acl` / `?tagging` / `?lifecycle` /
  `?versioning` / `?delete` sub-resources.
- **Any migration of legacy artifact data**: the on-disk `libcloud` tree,
  `centry.storage_meta`, legacy bucket tags, dual-write, read-through shims, or
  a reverse migration.
- **Any change to consumer code.** `elitea-sdk`, `apps/elitea-web`,
  `apps/elitea-ui`, and the indexer are each a separate tracked issue.
- Bucket rename. It never existed in legacy; the Go prototype invented it and
  dropped retention doing so.
- Per-project bring-your-own-S3 credentials. Threaded through every legacy
  endpoint but a no-op in every deployment.
- `bucket_permissions` enforcement, until open question 1 in the spec is
  answered.
- Virus scanning and quarantine. Required by `spec-security-verification` but
  needs its own design and an external scanner dependency.
- Cross-region replication, object versioning, object lock, and *provider-native*
  soft delete/undelete (Azure Blob soft delete, GCS soft-delete). This is a
  different thing from the S6 `buckets.deleted_at` metadata tombstone that
  `SoftDeleteBucket` writes in S8/S13 — that one is in scope; it is an internal
  DB flag, not a provider recovery feature, and nothing here forbids it.

## Reference

- Decision: `elitea-docs/docs/internal/03-architecture/adrs/adr-0016-object-storage-architecture.mdx`
- Contract and current-state detail: `elitea-docs/docs/internal/03-architecture/cloud-native-migration/spec-artifact-storage.mdx`
- Consumer rework: tracked as issues in `EliteaAI/elitea_issues`
