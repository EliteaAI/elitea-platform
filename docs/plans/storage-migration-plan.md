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
a time in S8, S9, S10 — `pg_repo.go` is deleted in S8, the moment its
replacement lands, not held until the end. The old `Backend` interface and the
filesystem package are deleted at the end of S10, when nothing references them
anymore.

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
| S7 | OpenAPI contract; register route stubs; delete `oapiserver/artifacts.go` | S6 | Medium |
| S8 | Bucket-plane handlers; delete `pg_repo.go` | S5, S6, S7 | Medium |
| S9 | Object-plane handlers: download, HEAD, streaming upload, batch delete | S5, S6, S7, S8 | High |
| S10 | Retire `/artifacts/s3`; delete `Backend`/`filesystem/`; strip old `Backend` methods from `s3`/`azure`/`gcs` | S8, S9 | High |
| S11 | Production mount, auth, RBAC, public-rule removal | S10 | High |
| S12 | Limits: body caps, read and write deadlines, quota | S6, S11 | Medium |
| S13 | Project-creation bucket bootstrap | S6, S8 | Low |
| S14 | Retention ledger and sweeper | S6, S8, S9 | Medium |
| S15 | Presigned transfer grants | S3, S6, S11 | Medium |
| S16 | Native multipart upload | S3, S15 | Medium |
| S17 | Deployment: Helm, compose, secrets, workload identity | S2, S5, S12 | Medium |
| S18 | Observability: metrics, tracing, audit | S11, S14, S15 | Low |
| S19 | API conformance suite in `tests/contract/` | S10, S11, S15, S4 | Medium |
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
- **`CompleteMultipartUpload` requires parts in strictly ascending
  `PartNumber` order — confirmed against real RustFS, which rejects an
  out-of-order list with `InvalidPartOrder: Part numbers must be strictly
  increasing`.** Sort the caller's `[]Part` by `Number` before building the
  request; do not assume the caller already sorted it (S16's future HTTP
  handler has no reason to guarantee that, and neither does this stage's own
  conformance suite, S4, which deliberately completes with parts reversed to
  catch exactly this).

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
- `grep -rn 'io.ReadAll' services/elitea-main/internal/infra/storage/{s3,azure,gcs}/` finds
  nothing. **Scoped to the three backend packages this stage writes, not the
  whole `internal/infra/storage/` tree** — that tree also contains pre-existing,
  out-of-scope code this stage does not touch, e.g. `content_server.go`'s
  deliberate, documented, small bounded `io.ReadAll` on a validation slice. The
  wider grep this stage originally specified fails against code no
  implementation of this stage could ever satisfy.
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
  the Azure leg with `AZURE_STORAGE_KEY` set, or the whole leg skips (not just
  case 12 — every operation needs a credential Azurite accepts, and shared key
  is the only one it does). **The `mcr.microsoft.com/azure-storage/azurite:latest`
  image, confirmed as of 2026-08, rejects every request from the pinned
  `azblob` SDK version with `400 InvalidHeaderValue` / "The API version ... is
  not supported by Azurite" unless started with `--skipApiVersionCheck`** —
  confirmed by actually running the SDK against a live container, not
  documentation. Pass it as a command-line argument to the `azurite-blob`
  entrypoint.
- **fake-gcs-server**: listens on 4443 with HTTPS by default — pass `-scheme http`
  or the connection fails regardless of the endpoint path. Set `GCS_ENDPOINT`
  to the full `http://localhost:4443/storage/v1/` form. Case 12 will skip for
  GCS unless a fake service-account key is injected via
  `option.WithCredentialsJSON` so `SignedURL` can sign locally; recording the
  skip is acceptable.

**Create `deploy/docker-compose.storage-test.yml`** with the three emulators,
and add a step to the `test` job in `.github/workflows/ci-go.yml` (its only Go
test job — there is no separate "storage" job) that starts it before the
tests. A `services:` block is also acceptable if it proves
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
  the unknown case) is enough, **for `s3` and `azure`**. `gcs.New` dials for
  live GCP default credentials at construction time unless S2's
  `Endpoint`/`WithoutAuthentication` support already landed (S5 depends on S3,
  which depends on S2, so by the time this stage runs it always has) — if
  you're implementing out of order for any reason, the `gcs` leg of this test
  needs S2's constructor to assert a concrete type instead of tolerating a
  credential error.
- `grep -rn 'ARTIFACTS_DATA_DIR' --include='*.go' services/elitea-main/` finds nothing.
- `grep -n 'os.Getenv' services/elitea-main/internal/infra/storage/config.go services/elitea-main/cmd/elitea-main/storage_factory.go` finds nothing.
  (Scoped to the two files this stage writes — the wider directories contain
  pre-existing, out-of-scope `os.Getenv` calls, e.g. in
  `postgres_secret_vault_integration_test.go` and `main.go`'s unrelated
  `AUTH_DEV_MODE` lookup, which this stage does not touch and a broader grep
  would never let pass.)
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
-- retention_default_days and retention_max_days are deliberately distinct:
-- the first is what a bucket gets when the caller omits a value, the second
-- is the ceiling S8's PATCH validates a caller-supplied value against. They
-- are not interchangeable — see S8.
CREATE TABLE elitea_storage.project_storage_policy (
    project_id             BIGINT PRIMARY KEY,
    max_object_bytes       BIGINT,
    max_total_bytes        BIGINT,
    retention_default_days INTEGER,
    retention_max_days     INTEGER, -- null means unlimited
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
`UpdateBucketTags`, `SoftDeleteBucket`, `UpsertObject`, `ListObjects`,
`DeleteObjects`, `SumBucketBytes`, and `CountBucketObjects` — the last two are
single aggregate queries (`SUM`/`COUNT`), never a full object listing. S8's
bucket response needs both, and `UpdateBucketTags` closes a real gap: S19's
conformance suite exercises "patch (pin, tags, retention)" end to end, but
without this method there is no way to persist a tag update at all — say so
explicitly in S8 too, when you get there, not just here.

**Also add `GetProjectStoragePolicy(ctx, projectID) (ProjectStoragePolicy, error)`**,
reading the `project_storage_policy` row (a missing row means every field is
unlimited/default — do not error). S8's retention-limit check and S12's quota
check both need to read this row and no earlier stage provides a way to; there
is no other repository method anywhere in this plan that fetches it.

**And add the four methods S14's sweeper needs**, none of which the methods
above can compose into, because a background sweeper has no request-bound
`projectID` to scope by and this plan defines no cross-project enumeration
method otherwise: `ListExpiredObjects(ctx, olderThan time.Time, limit int32) ([]ObjectRow, error)`
(bounded batch, backed by the `objects_expiry` index above — this is the query
that index exists for, and until now nothing used it),
`DeleteObjectRows(ctx, ids []int64) error`,
`ListBucketsNeedingExpiryNotice(ctx, within time.Duration, limit int32) ([]BucketRow, error)`
(buckets with `expires_at` inside the window and `notified_at` still null),
and `MarkBucketNotified(ctx, bucketID int64) error`.

**And add `SumProjectBytes(ctx, projectID) (int64, error)`**, the method S12's
project-quota check needs. `SumBucketBytes` (above) is deliberately
single-bucket — it feeds one bucket's `size_bytes` response field in S8 — and
does not compose into a project total; joining across every bucket owned by
a project is a different query (`SUM(size_bytes) ... JOIN buckets ON
buckets.id = objects.bucket_id WHERE buckets.project_id = $1 AND buckets.
deleted_at IS NULL`), not a loop over `SumBucketBytes` calls. S12 is the only
caller; without this method S12's `project_storage_policy.max_total_bytes`
check has nothing to compare against.

**Acceptance criteria:** every method has a `*_postgres_integration_test.go`
following the existing pattern. Unique-violation and no-rows paths map to the S1
sentinels. **Every test function in this package is named with a `TestArtifact`
prefix** (e.g. `TestArtifactBucketsRepositoryRejectsDuplicateName`,
`TestArtifactCountBucketObjectsExcludesSoftDeleted`) — **this is a hard
requirement, not a suggestion.** The existing repositories in this directory
are named by behavior (`TestListPendingIndexIngestIDsIsCapabilityAndStreamScoped`
and similar — none of the 317 test functions in this package follow a
domain-noun-prefix convention), and this stage's own Verify command filters on
`-run Artifact`, which matches against the Go function name only, not the file
name. A correctly implemented, correctly named-by-behavior test that happens
not to contain the literal substring "Artifact" is silently excluded from the
run — not reported as a skip, simply absent from the output — while the
command still exits 0. Follow the neighbouring repositories' construction and
error style; do not follow their naming style for these specific functions.

**Note on the verify command:** every `*_postgres_integration_test.go` in that
package calls `newPostgresIntegrationPool`, which **skips** when the integration
database URL is unset, and `ci-go.yml` sets no such variable. A bare `go test`
therefore exits 0 with every new test skipped. Either add a `postgres:16`
service and the DSN to the ci-go test job as part of this stage, or accept that
the suite is local-only and gate on the explicit run below.

**Do not pipe `go test` through `tee` and then check the pipeline's exit
code — it lies.** This shell has `pipefail` off by default (confirmed:
`false | tee /tmp/x; echo $?` prints `0`), so `go test ... | tee log && grep ...`
reports success from `tee`'s exit code, not `go test`'s — a single genuinely
failing test among a dozen passing ones is invisible to this command.
Capture `go test`'s own exit code before piping:

**Verify:** `cd services/elitea-main && go test ./internal/infra/db/repos/ -race -run TestArtifact -v > /tmp/s6.log 2>&1; rc=$?; cat /tmp/s6.log; test $rc -eq 0 && grep -qc -- '--- PASS' /tmp/s6.log && ! grep -q -- '--- SKIP' /tmp/s6.log`

---

## S7 — OpenAPI contract: define the new artifact API

**Preconditions:** S6.
**Read first:** `api/openapi/v2.yaml`, `internal/api/router.go` (the
`/artifacts` block, ~line 672), `internal/api/oapiserver/artifacts.go`,
`internal/api/oapiserver/server.go`.

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

**Also delete `internal/api/oapiserver/artifacts.go` here, not in S10.**
Regenerating `api.gen.go` from the new 13-operation spec removes the generated
param types for the 9 retired operations (`BucketListParams`,
`ArtifactListParams`, `EditBucketParams`, `DeleteBucketParams`,
`UpdateBucketPinParams`, `DeleteArtifactParams`, `DeleteArtifactsParams`).
`internal/api/oapiserver/artifacts.go` is a hand-written `ServerInterface`
implementation typed directly against those seven structs. Leave it in place
and `task openapi` produces a spec that compiles fine, but the *file* no longer
does — seven `undefined: generated.XxxParams` errors, breaking `go build ./...`
for this stage and, transitively, `task vet`/`task test`/`task build` for S7,
S8, and S9, since nothing between here and the old S10 deletion point fixes it.
This is the exact "N consecutive stages fail the global gate" failure mode the
`Backend`/`ObjectStore` split earlier in this plan exists to avoid — it just
wasn't applied to this file.

Deleting it here is safe and does not depend on S8 or S9: `oapiserver.Server`
is never wired into production routing (`oapiserver.New`/`Mount`/`Handler` are
referenced only by `internal/api/oapiserver/conformance_test.go` and
`conformance_matcher_test.go`); `internal/api/oapiserver/mount.go` is 19 lines
and registers nothing artifact-specific, so it needs no edit; and
`var _ generated.ServerInterface = (*Server)(nil)` (`server.go:68`) stays
satisfied through the embedded `generated.Unimplemented` (`server.go:17`),
which supplies a 501 stub for every operation `artifacts.go` used to implement.
Also drop the now-dead `artifactsDir` field and `ArtifactsDir` config field
from `server.go` (currently at roughly lines 30, 45, 49–51, 64) in this same
edit. **S10 no longer has this item on its list** — it was moved here.

**Delete the two now-orphaned response schemas**, `S3BucketListResponse` and
`S3ObjectListResponse` (`components/schemas`), referenced only by the old
`bucketList`/`artifactList` paths this stage removes (`$ref` at the old
`/artifacts/s3` and `/artifacts/s3/{bucket}` blocks). Nothing else points at
them. Their description prose names `internal/api/v2/artifacts/s3handler.go`,
which contains the literal substring `artifacts/s3` — leaving them in place
makes an unanchored `grep 'artifacts/s3' api/openapi/v2.yaml` still match after
a fully correct edit, failing the Verify command on complete, correct work.
Deleting them removes the last `artifacts/s3` text from the file. The Verify
grep below is also anchored to the `paths:` keys as defense in depth.

**Acceptance criteria:** the spec declares at least 75 operations after the
swap; `go build ./...` and `go test ./internal/api/oapiserver/ -race` pass —
genuinely, because all 13 new paths now resolve to the stub and
`oapiserver/artifacts.go` no longer references a removed type; no `/artifacts/s3`
path key remains in `v2.yaml`; every route the stub replaced now returns 501
with the typed error envelope instead of 404.

**Verify:** `cd services/elitea-main && task openapi && go build ./... && go test ./internal/api/oapiserver/ -race && ! grep -qE '^  /artifacts/s3' api/openapi/v2.yaml`

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
`NewHandler(fakeRepo, fakeStore)` over two in-test fakes added in this stage:
`internal/api/v2/artifacts/fake_store_test.go` (an in-memory `ObjectStore`) and
`internal/api/v2/artifacts/fake_repo_test.go` (an in-memory implementation of
the S6 repository interface — nothing before this stage builds one; `fakeRepo`
is not a pre-existing fixture).

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

`size_bytes` and `object_count` come from `SumBucketBytes` and
`CountBucketObjects` (S6) — both single-aggregate queries, never a full object
listing. Both fields are integers; formatting is the client's job.

**`PATCH` accepts `is_pinned`, `retention_days`, and `tags`, all optional and
independently settable.** Route `tags` through S6's `UpdateBucketTags` — S19's
conformance suite exercises "patch (pin, tags, retention)" as one combined
capability, and there is no method anywhere else in this plan that persists a
tag update; this is the only place it happens.

**Retention is an explicit `retention_days` integer.** Do not port legacy's
`(expiration_measure, expiration_value)` pair or its `relativedelta` calendar
arithmetic. A client that wants "one year" sends `365`. Read the limit via S6's
`GetProjectStoragePolicy(ctx, projectID).RetentionMaxDays` — **not**
`retention_default_days`, which is what applies when the caller omits a value,
not a ceiling on what they may request; the two columns exist separately in S6
precisely because they mean different things. Reject with 403 and
`code: QuotaExceeded` when `retention_days` exceeds `RetentionMaxDays`, where a
null `RetentionMaxDays` (or a missing policy row) means unlimited.

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
**Read first:** `internal/infra/storage/storage.go`,
`internal/infra/storage/{s3,azure,gcs}/backend.go`,
`internal/api/router_security_test.go`,
`internal/api/oapiserver/conformance_matcher_test.go`.

Everything in this stage is deletion. There is no S3-proxy rewrite: ADR-0016 §7
retires the surface rather than porting it.

**Delete:**

- `internal/api/v2/artifacts/s3handler.go` and its tests.
- The prototype `/artifacts/s3/*` registrations in `internal/api/router.go`
  (the five `r.Get`/`r.Put`/`r.Delete` calls near line 241) and
  `mountArtifactS3Routes` together with its block in `router_security_test.go`.
- `internal/infra/storage/filesystem/` (whole directory).
- The old `Backend` interface and `BucketInfo` in `internal/infra/storage/storage.go`.

`internal/api/oapiserver/artifacts.go` and the dead `artifactsDir`/`ArtifactsDir`
fields in `server.go` are **not this stage's job** — S7 already deleted them,
because leaving them until here breaks S7/S8/S9's own builds. If you find them
still present, S7 was not implemented correctly; fix it there, not here.

**Also strip the old `Backend` method set from the three surviving backends.**
S3 kept `s3`, `azure`, and `gcs`'s original `Backend`-shaped methods
(`ListBuckets`, `CreateBucket`, `DeleteBucket`, `RenameBucket`, and the
old-signature `ListObjects`/`GetObject`/`PutObject`/`DeleteObject`/`StatObject`)
and their `var _ storage.Backend = (*Backend)(nil)` assertions *alongside* the
new `ObjectStore` methods, deliberately, so handlers could keep calling the old
ones through S9. Deleting `Backend`/`BucketInfo` from `storage.go` above, on its
own, breaks all three: every one of those old methods and the compile-time
assertion still references `storage.Backend` and `storage.BucketInfo`, which no
longer exist. This is not hypothetical — `go build ./...` immediately after
removing `Backend`/`BucketInfo` fails with `undefined: storage.Backend` and
`undefined: storage.BucketInfo` in all three files. Read and edit
`internal/infra/storage/{s3,azure,gcs}/backend.go` in this stage: delete the
old `Backend`-shaped methods and the `var _ storage.Backend = (*Backend)(nil)`
line from each, keeping only the `ObjectStore` methods S3 added and the
`var _ storage.ObjectStore = (*Backend)(nil)` assertion. (`filesystem/`'s
identical breakage is moot — that whole package is deleted above.)

**`internal/api/router_security_test.go` needs care.** It imports the filesystem
package for its fixture and it contains the traversal test. Repoint the fixture
at the S8 fake store, and **keep the traversal test, retargeted at the new
object routes**: the current test covers only the percent-encoded `%2e%2e` form,
which incidentally fails; add the raw `..` form, which actually escapes, and
assert 400 with `code: InvalidKey` now that the handler constructs `ObjectRef`
before any store call.

**`internal/api/oapiserver/conformance_matcher_test.go` also needs a one-line
fix, unrelated to conformance itself.** `TestMatcherProbeE_MidPatternWildcardDoesNotSwallow`
hardcodes its positive control against the literal route
`/artifacts/s3/{bucket}/deep/object/key` — a route this stage deletes. Repoint
that probe (and its assertion message) at the S7-registered
`/api/v2/artifacts/objects/{projectID}/{bucket}/*` instead; it exercises the
identical trailing-wildcard behavior and is, if anything, a better example
since it is the actual reason this plan uses that pattern. Left unfixed, this
test fails the moment the `/artifacts/s3/*` registrations are gone —
`go test ./internal/api/oapiserver/...` genuinely reds — even though the file
has nothing to do with artifact storage.

Deleting the S3 surface also deletes the only reason to build SigV4, the S3
credential API, the XML dialect, and the sub-resource dispatch table. If a stage
ever seems to need one of those, the surface has been reintroduced by mistake.

**Acceptance criteria:**

- `grep -rn 'infra/storage/filesystem' --include='*.go' services/` finds nothing.
- `grep -rn 'storage_meta\|bucket_metadata' --include='*.go' services/` finds nothing.
- `grep -rn 'NewInMemoryHandler\|memRepo\|S3Handler\|mountArtifactS3Routes' --include='*.go' services/` finds nothing.
- `grep -rn 'artifacts/s3' services/elitea-main/internal/api/router.go services/elitea-main/internal/api/router_security_test.go services/elitea-main/internal/api/v2/artifacts/ services/elitea-main/internal/api/oapiserver/` finds nothing.
  **Scoped deliberately to what this stage owns.** `internal/api/main_public_rules.go`,
  `main_public_rules_test.go`, and `production_router_test.go` also contain the
  literal string `artifacts/s3` at this point — removing it there is S11's job,
  paired with a specific test re-anchor, and S11 runs strictly after this
  stage. A broader `grep -rn 'artifacts/s3' services/elitea-main/` is
  **unsatisfiable at the end of S10 as a standalone check** — it can only pass
  once S11 has also run. Do not widen this grep; check S11's own acceptance
  criteria for that file instead. (`.yaml` is excluded for the same reason S7
  already cleared `/artifacts/s3` from `v2.yaml`.)
- `grep -rn 'storage\.Backend\b\|storage\.BucketInfo\b' services/elitea-main/internal/infra/storage/` finds nothing.
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

- Every artifact route returns 401 unauthenticated and 403 with a valid
  principal lacking the permission. The 11 routes with a real handler by this
  point (5 from S8, 6 from S9) additionally return 2xx with the right
  permission. **The two grant routes are excluded from the 2xx check** — S15,
  which implements them, hasn't run yet, so they correctly still return 501
  regardless of authorization outcome; only their 401/403 gating is asserted
  here.
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
  `project_storage_policy.max_total_bytes` compared with S6's
  `SumProjectBytes(ctx, projectID)` — **not** `SumBucketBytes`, which is
  single-bucket and cannot be summed across a project by looping (see S6) —
  returning 413.

**The `http.Server{ReadTimeout, WriteTimeout}` edit lives in `cmd/elitea-main/main.go`
(`package main`), which nothing under `internal/api/v2/artifacts` can import —
not just by convention, but as a genuine Go import cycle
(`artifacts → ... → cmd/elitea-main → internal/api → internal/api/v2/artifacts`).
This stage's own Verify command, as scoped, cannot exercise that edit at all**
— a fully correct-looking `-run 'Limit|Quota|Deadline'` pass in that package
proves nothing about whether `ReadTimeout`/`WriteTimeout` were actually
touched. Extract the server construction into a small, testable, same-package
helper — `func newHTTPServer(handler http.Handler) *http.Server` in
`cmd/elitea-main/` — and add `cmd/elitea-main/http_server_test.go` asserting
`ReadHeaderTimeout` is set and `ReadTimeout`/`WriteTimeout` are zero. This is
the only way the ceiling change is checked by anything, since no later stage
touches `cmd/elitea-main` either.

**Acceptance criteria:** a 200 MiB upload returns 413 with a JSON error body,
not a truncated stream or a connection reset; a 100 MiB upload over a 30-second
body succeeds; a write that would push a project's `SumProjectBytes` total
past `max_total_bytes` returns 413 even though the individual object is under
`max_object_bytes` — this is a materially different code path from the
per-object cap and needs its own test, not just a bullet in the requirements;
`newHTTPServer`'s returned config has `ReadHeaderTimeout` set and
`ReadTimeout`/`WriteTimeout` unset — this is what actually stands in for
"a 300-second download completes," since nothing in this stage's own test
scope can drive a real 300-second HTTP round trip.

Name every new test `TestArtifactLimit*` — the current filter
(`-run 'Limit|Quota|Deadline|Timeout'`) collides with a genuinely unrelated,
already-passing test, `cmd/elitea-main/main_test.go`'s
`TestServeApplicationReturnsAtOneSharedDrainDeadline` (a graceful-shutdown
test, matched via the substring "Deadline"), so the bare command reports a
full pass today with zero S12 code written. A distinctive prefix removes both
that collision and the separate zero-match risk.

**Verify:**
```
cd services/elitea-main && go test ./internal/api/v2/artifacts/ ./cmd/elitea-main/... -race -run TestArtifactLimit -v > /tmp/s12.log 2>&1; rc=$?; cat /tmp/s12.log; test $rc -eq 0 && grep -qc -- '--- PASS' /tmp/s12.log && ! grep -q -- '--- SKIP' /tmp/s12.log
```

---

## S13 — Project-creation bucket bootstrap function (unwired)

**Preconditions:** S6, S8.

Legacy creates `reports` and `tasks` with `bucket_type='system'` on project
creation and deletes both on project deletion. Without this, every project
created by the Go service has no system buckets — and the legacy on-disk tree
confirms both exist for every project.

**There is no project-creation or project-deletion path to hook, anywhere in
this Go service, today.** Verified: no `CreateProject`/`DeleteProject`
handler exists (`internal/api/v2/projects/handler.go` implements only
`GetProject`, `GetCurrentProjectList`, `GroupList`, `PutProjectGroups`); no
`internal/application/projects`-shaped package exists at all; and the
`projects` table itself has no `CREATE TABLE` in any migration under this
service — it is owned and written by something outside `elitea-main`
entirely. S6 and S8 build no such hook either. This stage's original framing
("hook the project-creation path") describes a mechanism that does not exist
in this codebase, and no stage before it creates one.

**Scope this stage down accordingly: build the bootstrap and teardown logic
as an idempotent, directly callable, fully-tested function — do not claim it
is wired into production, because it cannot be.**

```go
func BootstrapProjectBuckets(ctx context.Context, projectID string) error
func TeardownProjectBuckets(ctx context.Context, projectID string) error
```

`BootstrapProjectBuckets` creates `reports` and `tasks` with
`bucket_type='system'`, idempotently (a second call is a no-op, not an
error). `TeardownProjectBuckets` soft-deletes both and purges their objects.
Unit-test both directly against the S6 repository — no HTTP layer, no
project-lifecycle integration, because none exists to integrate with.

**Leave an explicit, visible gap, not a silent one.** Add a code comment on
`BootstrapProjectBuckets` stating it is not called from anywhere yet, and
record the open question this raises: an owner needs to identify the actual
project-creation and project-deletion trigger — a legacy webhook, an event
this service should subscribe to, a database trigger, or something not yet
designed — before this function does anything in a running system. Until
that's answered, every project created after this migration ships has no
system buckets, exactly as today.

**Acceptance criteria:** `BootstrapProjectBuckets` called twice for the same
project creates exactly one `reports` and one `tasks` bucket, both
`bucket_type='system'`; `TeardownProjectBuckets` removes both and leaves no
objects. **The criterion is scoped to the function's own behavior in
isolation** — this stage does not and cannot assert "a newly created project
lists exactly reports and tasks" in the running service, because nothing
creates a project through this service yet. **Name every test function in
this package with a `TestArtifact` prefix** (e.g.
`TestArtifactBootstrapCreatesReportsAndTasksIdempotently`) — see the naming
rule in S6, which this stage's Verify command relies on for the same reason.

**Verify:**
```
cd services/elitea-main && go test ./internal/application/artifactbootstrap/... -race -run TestArtifact -v > /tmp/s13.log 2>&1; rc=$?; cat /tmp/s13.log; test $rc -eq 0 && grep -qc -- '--- PASS' /tmp/s13.log && ! grep -q -- '--- SKIP' /tmp/s13.log
```

---

## S14 — Retention ledger and sweeper

**Preconditions:** S6, S8, **S9** — stamping `expires_at` on written objects
means editing the upload path, which S9 introduces; it does not exist after S8
alone.
**Read first:** `internal/api/v2/artifacts/handler.go` (bucket create/retention
update, S8) and the object-write path (S9); the S6-created
`internal/infra/db/repos/artifact_{buckets,objects}.go`;
`internal/runtimecomposition/current_index_schedule_due_work*.go` and
`current_index_runtime.go` for the sweeper *shape*; **and
`internal/runtimecomposition/composition.go`, specifically the
`schedulingapp.Registry`/`newPublisherSet` chain around line 985** — this is
where the pattern files' shape actually gets registered into the running
scheduler, and neither pattern file references it. Skipping this file is why
an otherwise-correct sweeper never runs in production.

This stage has four distinct pieces of work. Each needs its own acceptance
check — a Verify command scoped to one package, as below, structurally cannot
exercise all four:

1. **Stamp `expires_at`.** On bucket create and retention update, compute
   `expires_at` for the bucket (edit in `internal/api/v2/artifacts/handler.go`,
   S8's package). Stamp `expires_at` on objects written into it (edit in the
   S9 upload path, same package). Neither edit touches
   `internal/runtimecomposition` at all.
2. **The sweeper `Handler`.** Follow the shape in
   `current_index_schedule_due_work*.go`/`current_index_runtime.go`: selects
   expired objects in bounded batches via S6's new `ListExpiredObjects`,
   deletes them through `ObjectStore.DeleteBatch`, and removes the metadata
   rows via `DeleteObjectRows` in the same transaction boundary as the delete
   acknowledgement.
3. **Wire the sweeper into production — the pattern files alone do not do
   this.** `schedulingapp.Job{...}` is registered exactly once in the whole
   codebase, inside `composition.go`'s `New(...)`, accumulated into
   `publisherRoot` via repeated `newPublisherSet(...)` calls. Add the
   retention-sweeper `Job` to that same chain. Without this edit, a fully
   correct `Handler` compiles, unit-tests green, and never runs — objects past
   `expires_at` are never deleted and the notification never fires, in a
   running service, indefinitely. This is the same class of gap S15 already
   flags for its own routes ("no other stage catches the gap... a
   handler-level Verify command can pass while the route itself is still
   unwired") — the identical failure mode, one layer down, in the scheduler
   instead of the router.
4. **The notification.** A real, wired notification mechanism already exists —
   don't invent a new one and don't just log. `internal/infra/db/repos/
   current_index_schedule_notification.go`'s `InsertCurrentIndexScheduleNotification`
   writes a row into `centry.notifications` (`uuid`, `is_seen`, `project_id`,
   `user_id`, `meta`, `event_type`), which `internal/api/v2/notifications/
   current_events.go` already streams to the browser over the existing
   `notifications_notify` Socket.IO event — no new transport is needed, only a
   new writer following that file's construction pattern (a new sqlc query, a
   new `event_type` value, e.g. `'artifact_bucket_expiring'`). Emit one insert
   per bucket with one day of `expires_at` remaining, sourced from S6's
   `ListBucketsNeedingExpiryNotice`, deduplicated by calling
   `MarkBucketNotified` once sent.
   **This table's `user_id` column is `NOT NULL`, and every existing read path
   is scoped `WHERE user_id = ...` — there is no project-wide broadcast row.**
   `elitea_storage.buckets` (S6) has no owning-user column, only `project_id`,
   and this plan defines no project→member-list lookup anywhere a bucket
   notification could iterate over. Do not invent one. Pick one of: (a) look
   up the bucket-creating user if S8's create handler is changed to record
   one (a schema change this plan does not currently make), or (b) find and
   reuse an existing project-membership enumeration elsewhere in the
   codebase if one exists, and if you cannot find one, treat this as an open
   question for a human owner and land the sweeper/repository-method work
   (items 1-3, 5) without the notification insert rather than guessing at a
   `user_id`.
5. **Multipart-abort lifecycle rule.** Provider-native lifecycle rules are
   **not** used for per-bucket retention (see item 2). Set one coarse
   provider-native rule aborting incomplete multipart uploads after 7 days —
   this is a one-time backend/factory-level configuration call (S3's package),
   not sweeper logic, and belongs in whichever of `s3`/`azure`/`gcs`
   `New(...)` already runs at startup.

**Acceptance criteria:**

- An object with `expires_at` in the past is gone from both the object store
  and the metadata table after one sweeper tick.
- If the `user_id` open question above is resolved, a `centry.notifications`
  row with `event_type = 'artifact_bucket_expiring'` is inserted exactly once
  per bucket per expiry cycle, and is visible through the existing
  `internal/api/v2/notifications/current_events.go` stream — not just that
  `MarkBucketNotified` was called, which a no-op stub can also satisfy. If the
  open question is left unresolved for a human owner, this criterion is
  dropped for this landing and the open question is recorded instead of
  silently skipped.
- **A composition-level test asserts the sweeper `Job` is actually present in
  `composition.go`'s registry** — not just that the standalone `Handler`
  passes its own unit test. This is the check that catches item 3 being
  skipped.
- A newly created bucket with `retention_days: 30` has `expires_at` set on
  itself and on every object subsequently uploaded into it — checked through
  the real S8/S9 handlers, not by calling the sweeper's repository methods
  directly.
- The configured backend reports an active multipart-abort lifecycle rule
  after startup.
- **Every new test function in this stage's scope is named with a
  `TestArtifactRetention` prefix.** A bare `-run Retention` collides with
  three genuine, unrelated, already-passing tests in
  `internal/runtimecomposition` (`TestExecutionReplayRetentionJanitor*`, about
  execution-history replay, nothing to do with artifact storage) — confirmed:
  that filter alone reports a clean PASS today, before any S14 code exists.

**Verify:** both halves must be guarded — a bare `go test` at the end of the
chain exits 0 on zero matches just like the first half would, and the second
half is what covers 4 of this stage's 5 work items (everything except item 1).
```bash
cd services/elitea-main && \
  go test ./internal/runtimecomposition/ -race -run TestArtifactRetention -v > /tmp/s14a.log 2>&1; rc=$?; cat /tmp/s14a.log; \
  test $rc -eq 0 && grep -qc -- '--- PASS' /tmp/s14a.log && ! grep -q -- '--- SKIP' /tmp/s14a.log && \
  go test ./internal/api/v2/artifacts/... ./internal/infra/storage/... -race -run TestArtifactRetention -v > /tmp/s14b.log 2>&1; rc=$?; cat /tmp/s14b.log; \
  test $rc -eq 0 && grep -qc -- '--- PASS' /tmp/s14b.log && ! grep -q -- '--- SKIP' /tmp/s14b.log
```

---

## S15 — Presigned transfer grants

**Preconditions:** S3, S6, S11.

**Wire the two grant routes.** S7 registered
`POST /artifacts/grants/{projectID}/{bucket}` (`createTransferGrant`) and
`POST /artifacts/grants/{projectID}/{grantID}:commit` (`commitTransferGrant`)
against the `notImplementedArtifact` stub in `internal/api/router.go`, and no
stage before this one replaces them — S8 and S9 explicitly touched only their
own 5 and 6 lines. **Replace the placeholder at those two lines with the real
handlers** — do not add a second registration at the same path (chi panics on
that). Without this, the two endpoints stay permanently 501 in production; no
other stage catches the gap, since this package (`internal/api/v2/artifacts`,
`package artifacts`) cannot reach `internal/api/router.go` (`package api`)
from its own tests, so a handler-level Verify command can pass while the route
itself is still unwired. Add a small router-level test in `internal/api/`
(e.g. `internal/api/grant_routes_test.go`) that builds the router and asserts
both grant paths resolve to something other than the stub — this is the only
way to actually exercise the replacement, since `internal/api/v2/artifacts`'s
own tests exercise the handler directly and never touch the mounted route.

Add `POST /api/v2/artifacts/grants/{projectID}/{bucket}` returning a
short-lived presigned URL bound to a server-derived key, persisted in
`elitea_storage.transfer_grants`. **The request body carries the caller's
expected `digest_alg`/`digest` (and content type and size) for the object it
is about to upload** — this is not optional decoration. The grant row's
`digest`/`digest_alg` columns exist so commit has something to check the
uploaded bytes *against*; nothing else in this plan populates them, so if the
caller doesn't supply an expected digest at grant-creation time, commit has
no digest to compare and the "mismatched digest returns 409" criterion below
is unimplementable. Reject a grant request with no digest when the caller
declares one is required (media types where integrity matters); allow it to
be optional for cases where digest verification genuinely isn't needed.

The grant response carries the URL, the required method, the expiry, and the
required content type and maximum size. It does **not** carry the physical
bucket, the backend URL, or any credential. The caller may request a display
name and a logical bucket; the server chooses the key.

`POST /api/v2/artifacts/grants/{projectID}/{grantID}:commit` verifies size,
digest, and media type against the grant row before the object becomes
listable, then stamps `consumed_at`. Media type verification at commit is
**mandatory**, not defensive: `ContentType` is not part of the signed
presigned-PUT payload, so the URL alone does not enforce it.

**Digest verification cannot be done with `Stat`/`HeadObject` alone — this is
not an implementation shortcut to find, it is a real property of presigned
uploads that must be designed around.** Confirmed empirically against a real
RustFS instance: a presigned PUT followed by `HeadObject` returns an `ETag`
that is the object's content-MD5 (not SHA-256, and not even the same
algorithm S1's `ObjectInfo.DigestSHA256` names), and `ChecksumSHA256` is
`nil` — including with `ChecksumMode: ENABLED` and via
`GetObjectAttributes`. No cheap provider-side call yields a SHA-256 for an
object that landed via presigned PUT, on any backend. **The commit handler
must call `Get` on the object and stream it through a SHA-256 hasher to learn
the real digest — there is no shortcut.** This costs one full read of the
object from the store to `elitea-main` at commit time. That is a real,
deliberate cost of verifying integrity on a path designed to keep bulk bytes
off `elitea-main` during upload; it is not paid during the upload itself, and
it is bounded to once per commit, not once per read. If that cost is judged
unacceptable for large objects, the alternative is to relax commit to
size-and-media-type-only and drop digest verification — but that is a
material change to what ADR-0016 promises ("Go verifies size, digest, and
media type on commit") and should be a deliberate decision, not a silent
downgrade because the digest check turned out to be inconvenient to
implement.

Default TTL 15 minutes, maximum 60. `PUT` grants are single-use.

**Fall back to the streaming facade when `Capabilities().Presign` is false** —
an Azure client using workload identity, or a GCS client with no signing
material. Return the facade URL, not an error.

**Acceptance criteria:** a presigned `PUT` followed by a commit produces a
listable object; a commit with a mismatched digest returns 409 and the object is
deleted; a commit with a mismatched media type returns 409; an expired grant URL
returns 403 from the provider; a second commit on the same grant returns 409;
**both grant endpoints resolve through the real chi router**, not just the
handler under test — a request to the mounted route returns something other
than 501 with `code: NotImplemented`, matching the pattern S9 already requires
for its own routes. **Name every new test function with a
`TestArtifactGrant` prefix.** Both `-run Grant` target packages
(`internal/api/v2/artifacts` and `internal/api`) currently have zero tests
matching that substring, so an unimplemented S15 also reports
`[no tests to run]`, exit 0 — indistinguishable from success without a
required-match guard.

**Verify:**
```bash
cd services/elitea-main && \
  go test ./internal/api/v2/artifacts/ -race -run TestArtifactGrant -v > /tmp/s15a.log 2>&1; rc=$?; cat /tmp/s15a.log; \
  test $rc -eq 0 && grep -qc -- '--- PASS' /tmp/s15a.log && \
  go test ./internal/api/ -race -run TestArtifactGrant -v > /tmp/s15b.log 2>&1; rc=$?; cat /tmp/s15b.log; \
  test $rc -eq 0 && grep -qc -- '--- PASS' /tmp/s15b.log
```

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
facade; a part call with another project's grant returns 403. That is three
required, distinct scenarios. **Name every new test function with a
`TestArtifactMultipart` prefix.** `-run Multipart` alone matches zero tests on
the unmodified tree (`internal/api/v2/artifacts` has no existing test
containing that substring) — so an unimplemented S16 also reports
`ok ... [no tests to run]`, exit 0, indistinguishable from success.

A bare "at least one PASS" check is not enough here either: a suite that runs
only one of the three scenarios and legitimately skips or drops the other two
(e.g. only the GCS-facade test, if the S3/Azure cases are accidentally gated
behind an emulator flag) would still satisfy "at least one match." Require at
least 3 `--- PASS` lines, not just a nonzero count.

**Verify:**
```
cd services/elitea-main && go test ./internal/api/v2/artifacts/ -race -run TestArtifactMultipart -v > /tmp/s16.log 2>&1; rc=$?; cat /tmp/s16.log; test $rc -eq 0 && test "$(grep -c -- '--- PASS' /tmp/s16.log)" -ge 3
```

---

## S17 — Deployment

**Preconditions:** S2, S5, S12 — the env var names this stage wires into the
chart come from all three: `S3_ENDPOINT_URL`/credentials from S5,
`AZURE_STORAGE_ENDPOINT`/`GCS_ENDPOINT` from S2, `ARTIFACT_MAX_OBJECT_BYTES`
from S12. Confirm all three actually landed before starting — this stage is
naturally one of the last to run, not "right after S5."

- `deploy/helm/elitea-main/values.yaml` and `templates/deployment.yaml`: add
  the storage environment block. **Render `S3_ACCESS_KEY`, `S3_SECRET_KEY`,
  and `AZURE_STORAGE_KEY` as individual `env:` entries with
  `valueFrom.secretKeyRef`, not a chart-managed `envFrom: secretRef` gated
  behind a `create` toggle.** Both shapes are common Helm idiom, but only the
  former renders the literal key names `helm template` output — and this
  stage's own Verify command greps for exactly that. A `create`-gated
  `envFrom` secret defaults to off and never spells out `S3_ACCESS_KEY` in
  rendered output at all, so the Verify command fails even on an otherwise
  reasonable implementation. The chart currently delivers only
  `envFrom: configMapRef` and has no secret path of either shape.
- `deploy/helm/elitea-main/templates/serviceaccount.yaml`: add an `annotations`
  block so IRSA and Azure Workload Identity can be configured. It has none
  today, which is why credentials must be static.
- Confirm no `volumes`, `volumeMounts`, `persistentVolumeClaim`, or `emptyDir`
  appear for artifact data. There are none — keep it that way, and the HPA
  scaling from 2 to 10 replicas becomes correct rather than accidentally so.
- Remove the storage variables from
  `deploy/helm/elitea-main/env-drift-allowlist.txt` now that they are wired, and
  add the new names introduced by S2, S5, and S12.
- Remove `ARTIFACTS_DATA_DIR` and the artifact bind mount from
  `deploy/docker-compose.staging.yml`.
- Add a Helm chart for `pylon-indexer` and `elitea-worker-python`, or record
  explicitly that they are out of scope for R1.

A bare `grep -q 'S3_ACCESS_KEY'` only proves the literal string appears
*somewhere* in the rendered output — it passes just as well for a hardcoded
plaintext `value:` as for a real `valueFrom.secretKeyRef`, and it never checks
`S3_SECRET_KEY` or `AZURE_STORAGE_KEY` at all. Check all three names are each
followed by a `secretKeyRef` within the next few lines, not merely present.

**Verify:**
```bash
helm lint deploy/helm/elitea-main && \
helm template deploy/helm/elitea-main > /tmp/rendered.yaml && \
for VAR in S3_ACCESS_KEY S3_SECRET_KEY AZURE_STORAGE_KEY; do \
  grep -A3 -- "name: $VAR" /tmp/rendered.yaml | grep -q 'secretKeyRef' || { echo "missing valueFrom.secretKeyRef for $VAR"; exit 1; }; \
done && \
! grep -qE 'persistentVolumeClaim|emptyDir' /tmp/rendered.yaml
```

---

## S18 — Observability

**Preconditions:** S11, **S15** — auditing "every grant issuance" requires the
grant-creation code S15 adds; it does not exist right after S11. **S14** — the
byte-usage gauge below is sourced from S14's sweeper tick, which is a sibling
branch off S6/S8/S9, not something S11 or S15 transitively guarantees.

Instrument every `ObjectStore` method with the existing OTel setup — read
`internal/api/middleware/otel.go` for the house pattern (its actual test names
are `TestOtelMiddleware_SetsStatusCode` / `TestOtelMiddleware_DefaultStatus200` —
behavior-named, no "Metrics" substring; do not assume you can grep for that
word in existing code and find the convention this stage should follow).
Operation duration histogram, error counter by sentinel type, bytes-in and
bytes-out counters, all labelled by backend and operation but **never** by
project identifier or key, which would explode cardinality. Add a per-project
byte-usage gauge sourced from the metadata table on the sweeper tick (S14), not
per request.

**There is no audit-record mechanism anywhere in this codebase to hook —
verified exhaustively.** `internal/domain/admin/types.go` declares
`AuditEntry`/`AuditListResponse` types with zero writers and zero consumers
anywhere else in the tree. The existing `AuditTraces`/`AuditTraceHeatmap`
handlers (`internal/api/v2/eliteacore/handler.go`) are hardcoded stubs
returning an empty list — not real persistence to extend. No migration
creates an audit table. The only other "audit" code in the repository
(`cmd/cutover-ctl/audit.go`) is an unrelated static-analysis CLI for a
different migration. **Do not invent a bespoke audit mechanism for this stage
alone.** Emit a structured `slog` line (`operation`, `bucket`, `key`,
`project_id`, `principal`, `outcome`) for every delete and every grant
issuance instead, and record this as an explicit open question: an owner
needs to decide whether artifact deletes and grants belong in a real,
queryable audit trail — and if so, whether that's the same
`AuditEntry`/`AuditListResponse` shape already declared and unused, or
something new. This is the same treatment S13 gives its own missing
integration point.

**Name every new test function with a `TestArtifactObservability` prefix.**
`-run Metrics` alone matches nothing today (`[no tests to run]`, exit 0 —
already hollow before any code exists) and, worse, would silently exclude any
correctly-implemented but behaviorally-named tracing or audit-logging test
even once one Metrics-named test exists to make the bare command pass.

**Acceptance criteria** — four distinct, separately testable behaviors, so "at
least one PASS" is not enough (a suite that only exercises one of them, e.g.
only the histogram, would still satisfy a bare nonzero-match check):
1. An `ObjectStore` call records the operation-duration histogram and the
   error counter (on a sentinel error), labelled by backend and operation
   only — assert no `project_id`/key label exists on either.
2. A write/read records the bytes-in/bytes-out counters.
3. The per-project byte-usage gauge updates after a sweeper tick (S14), not
   on a per-request path — assert it does *not* move between ticks.
4. A delete and a grant issuance each emit the structured `slog` line
   (`operation`, `bucket`, `key`, `project_id`, `principal`, `outcome`).

**Verify:**
```
cd services/elitea-main && go test ./internal/infra/storage/... -race -run TestArtifactObservability -v > /tmp/s18.log 2>&1; rc=$?; cat /tmp/s18.log; test $rc -eq 0 && test "$(grep -c -- '--- PASS' /tmp/s18.log)" -ge 4
```

---

## S19 — API conformance suite

**Preconditions:** S10, S11, **S15** — grant/presign coverage below needs the
real handlers S15 wires in, not the S7 stub. **S4** — this stage needs the
RustFS/Azurite/fake-gcs-server emulator wiring S4 builds, and S4 is deferrable
relative to S1-S11 (it has no critical-path dependents until now), so check it
was actually done before starting this stage rather than assuming it was.
**Read first:** `tests/contract/contract_test.go` (the existing `TestMain` and
its `CONTRACT_AUTH_TOKEN` gate), `.github/workflows/ci-contract.yml`.

`services/elitea-main/tests/contract/` and `.github/workflows/ci-contract.yml`
already exist and run weekly. The workflow accepts a `legacy_url` input and was
built to diff Go against the legacy service — **that comparison is no longer
meaningful** and the input should be removed. Repurpose the harness as a
self-contained conformance suite driving the new artifact API against a running
Go service plus a RustFS emulator (S4).

**`package contract`'s existing `TestMain` (`tests/contract/contract_test.go`)
gates the entire package shut by default, and this stage's Verify command
cannot detect it — this is not the same bug the `TestArtifact`-naming rule
below fixes, it is a different, deeper one.** `TestMain` reads
`CONTRACT_AUTH_TOKEN` and calls `os.Exit(0)` **before `m.Run()`** when it's
unset — which is the default locally, and is exactly what
`ci-contract.yml`'s PR-triggered `compile` job does (it deliberately sets no
token, by design, so the legacy-parity fixtures merely compile on every PR
without needing secrets; only the weekly `schedule`/`workflow_dispatch` job
sets the real token from `secrets.CONTRACT_AUTH_TOKEN`). Any new
`TestArtifact*` test added to this same package inherits that gate — it is
never reached, at all, regardless of its name. **You must restructure
`TestMain` as part of this stage**, not merely add tests alongside it: gate
only the legacy-parity comparison tests on `CONTRACT_AUTH_TOKEN`, and let the
new self-contained `TestArtifact*` suite run unconditionally, skipping
per-test via `t.Skip` only when S4's RustFS environment variables are absent
— the same pattern S4 already uses for its own emulator-gated cases, not a
new one. Then edit `ci-contract.yml`'s PR-triggered `compile` job to actually
start the RustFS emulator (mirroring what S4 already wires into `ci-go.yml`)
so the new suite runs on every PR, not only in the weekly cron.

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
- Grant creation followed by a presigned upload and commit produces a listable
  object; a commit with a mismatched digest or media type returns 409.
- A key containing `..`, a leading `/`, or a control character returns 400 with
  `code: InvalidKey`.
- Cross-project access returns 403.

**Acceptance criteria:** the suite fails if any response is not the documented
shape; `ci-contract.yml` no longer references a legacy base URL. **Name every
test function with a `TestArtifact` prefix**, for the same reason S6 requires
it: `-run Artifact` matches Go function names, not file names or behavior, and
a correctly-implemented test named by what it checks rather than by
containing the literal word "Artifact" is silently excluded from this
command's run with no failure or skip reported.

The "Cover, end to end" list above names 11 distinct scenarios. A bare
"at least one PASS" check cannot tell a fully-run suite from one where most
of those scenarios are `t.Skip`-ed because S4's RustFS environment variables
are only partially set in the run environment — the restructured `TestMain`
makes that skip legitimate in isolation, but a Verify command that can't
distinguish "1 passed, 10 skipped" from "11 passed" is not actually verifying
this stage's coverage. Require at least 11 `--- PASS` lines, not just a
nonzero count — a real implementation with table-driven subtests (e.g. the
4-way bucket-name-rejection case) will clear this floor comfortably.

**Verify:**
```
cd services/elitea-main && go test ./tests/contract/ -race -run TestArtifact -v > /tmp/s19.log 2>&1; rc=$?; cat /tmp/s19.log; test $rc -eq 0 && test "$(grep -c -- '--- PASS' /tmp/s19.log)" -ge 11 && ! grep -q 'CONTRACT_AUTH_TOKEN not set' /tmp/s19.log
```

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
path exists silently drops attachment bytes. Name every new test
`TestArtifactAttachment*` — `-run Attachment` alone would also match any
pre-existing `chat_conversations`-meta attachment tests that aren't about the
byte path.
*Verify:*
```
cd services/elitea-main && go test ./internal/api/v2/... -race -run TestArtifactAttachment -v > /tmp/s20a.log 2>&1; rc=$?; cat /tmp/s20a.log; test $rc -eq 0 && grep -qc -- '--- PASS' /tmp/s20a.log && ! grep -q -- '--- SKIP' /tmp/s20a.log
```

**S20b — Icons.** `UploadIcon` writes to `ICONS_DATA_DIR` and returns
`/icons/{projectID}/{filename}`, but nothing serves `/icons/*` — no route, no
Traefik rule, no volume. Every uploaded icon is currently unreachable. Move
icons onto the object store using the S9 object plane with a reserved system
bucket, and serve them through the download route. **Edit the real,
production-mounted handler — `internal/api/v2/eliteacore/handler.go`'s
`UploadIcon`, registered at `internal/api/router.go:619-620` as
`POST /upload_icon/prompt_lib/{projectID}` — not
`internal/api/oapiserver/misc.go`'s `UploadApplicationIcon`.** That second
function looks like the same feature (it also returns an icon-upload URL) but
belongs to `oapiserver.Server`, which S7 already establishes is never wired
into production routing — it exists only for the package's own conformance
tests. Editing it would compile, pass its own package's tests, and leave the
real, reachable-but-broken icon path completely untouched. Once icon bytes
are written through the object store instead of `ICONS_DATA_DIR`, the
pre-existing `TestUploadIconStoresFileWithinConfiguredRoot`,
`TestUploadIconRejectsTraversalAndSymlinkEscape`, and
`TestDeleteIconIsConfinedToConfiguredRoot` are testing a code path (filesystem
path confinement) that no longer exists — delete them as part of this stage
rather than leaving them green-but-meaningless against dead code. Name the
replacement tests `TestArtifactIcon*` — `-run Icon` alone would keep matching
those three tests until they're actually removed, hiding whether the removal
happened.
*Verify:*
```
cd services/elitea-main && go test ./internal/api/v2/eliteacore/ ./internal/api/oapiserver/ -race -run TestArtifactIcon -v > /tmp/s20b.log 2>&1; rc=$?; cat /tmp/s20b.log; test $rc -eq 0 && grep -qc -- '--- PASS' /tmp/s20b.log && ! grep -q -- '--- SKIP' /tmp/s20b.log
```

**S20c — Result-artifact attestation.** `elitea_runtime.index_result_artifacts`
is documented as owned by "the future artifact upload data plane".
`ArtifactVerifier` is a required production dependency, `VerifyDurable` returns
`ErrIndexIngestArtifactUnavailable` on no rows, and **there is zero non-test
insert into the table** — so any index-ingest result carrying a result artifact
cannot settle today. Implement the writer: a grant, commit, and verify path on
the S15 machinery, honouring the existing 1 MiB and `application/json` policy,
sharing the `ObjectStore` adapter but keeping its own metadata and settlement
semantics per ADR-0014. Requires an answer to open question 2 in the spec.

This stage builds a writer with **no wired caller** — same shape as S13.
`ArtifactVerifier`'s production implementation lives in
`internal/application/output/`, called from the index-ingest completion path,
but nothing in that path today constructs a grant or commits bytes to the
object store first; the codebase has no worker- or provider-facing surface
that a result-producing caller (a skill run, a pipeline step,
`services/elitea-worker-python`, or elsewhere) could call to obtain a grant,
stream the artifact bytes, and commit before index-ingest tries to verify it.
Implement `CreateArtifactGrant` / `CommitArtifact` / `ResolveArtifact` per
ADR-0014 as isolated, tested functions on the S15 grant machinery, and leave
them unwired from any producer. Do not invent a call site — record as an open
question for a human owner: who builds the producer-side caller (is
`services/elitea-worker-python` in scope, or a Go-side skill/pipeline runner?),
and whether that's a new stage or belongs to the worker's own tracked issue.
Name every new test `TestIndexIngestArtifact*` so the Verify command actually
matches something — `-run IndexIngestArtifact` alone matches zero tests today
(there is nothing in the tree that satisfies that filter), so the bare command
would exit 0 for the wrong reason: no tests found, not tests passed.
*Verify:*
```
cd services/elitea-main && go test ./internal/application/output/ ./internal/infra/db/repos/ -race -run TestIndexIngestArtifact -v > /tmp/s20c.log 2>&1; rc=$?; cat /tmp/s20c.log; test $rc -eq 0 && grep -qc -- '--- PASS' /tmp/s20c.log && ! grep -q -- '--- SKIP' /tmp/s20c.log
```

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
