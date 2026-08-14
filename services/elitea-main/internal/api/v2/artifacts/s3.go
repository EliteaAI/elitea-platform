package artifacts

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/storage"
)

// This file serves the S3-shaped representation of a bucket listing — the
// one the Python SDK's artifact toolkit speaks, and the only listing an
// index run ever performs.
//
// The route is deliberately NOT under /api/v2. The worker builds the URL as
// `{platform_origin}/artifacts/s3/{bucket}` (elitea-sdk
// runtime/clients/client.py:115, :1105) where platform_origin is validated
// to be a bare origin carrying no path at all (elitea-worker-python
// config.py:187-199), and the platform edge forwards the path verbatim with
// no stripPrefix/addPrefix (deploy/runtime/platform-edge-dynamic.yml). So
// the path that actually arrives at elitea-main is /artifacts/s3/{bucket},
// and a route mounted under /api/v2 would 404 exactly as before.
//
// Despite the name, the response is JSON, not S3's XML: the SDK calls
// response.json() unconditionally (client.py:1118). The name reflects the
// legacy pylon route this replaces, not the wire format.
//
// Only the representation is new. The bucket resolution, prefix validation,
// delimiter handling and paging all come from the same helpers the native
// route uses (parseListObjectsQuery / listBucketObjects in objects.go), so
// the two listings cannot silently diverge.

// s3ObjectSummary is one entry of the S3 listing's "contents" array.
//
// The field names are load-bearing and camelCase, unlike the native route's
// snake_case objectSummary: the SDK reads item['key'], item['size'] and
// item['lastModified'] by exact name (elitea-sdk
// runtime/clients/artifact.py:123-127, :203-217). A casing regression here
// would not fail loudly — it would make every listing look empty and send
// an index run green having indexed nothing, which is the exact defect this
// route exists to fix.
type s3ObjectSummary struct {
	Key          string    `json:"key"`
	Size         int64     `json:"size"`
	LastModified time.Time `json:"lastModified"`
	// ETag is not read by the SDK today. It is included because it is free
	// (storage.ObjectInfo already carries it) and canonical for an S3
	// listing, and omitted when the backend supplies none.
	ETag string `json:"etag,omitempty"`
}

// s3ListResponse is the S3 listing envelope.
//
// commonPrefixes is a flat []string. The SDK accepts either a plain string
// or a {"prefix": "..."} object (artifact.py:203-217, the isinstance(dict)
// branch), so both would work; the plain string is chosen because it is
// what storage.ListPage.CommonPrefixes already is and what the native route
// already returns, making the two representations differ in key casing
// only. Both slices are always non-nil so the JSON carries [] rather than
// null — the SDK iterates them with .get(key, []) and a null would be
// indistinguishable from a missing key.
type s3ListResponse struct {
	Contents       []s3ObjectSummary `json:"contents"`
	CommonPrefixes []string          `json:"commonPrefixes"`
	// IsTruncated/NextContinuationToken are reported so a caller can page.
	// The SDK does not read them today, which means a bucket larger than
	// the backend's page cap lists only its first page — a real gap, but a
	// client-side one that cannot be closed from here.
	IsTruncated           bool   `json:"isTruncated"`
	NextContinuationToken string `json:"nextContinuationToken,omitempty"`
}

// s3ErrorCodes translates this package's artifact error vocabulary into the
// S3 codes the SDK's _handle_s3_error knows how to phrase
// (client.py:1060-1067, S3_ERROR_MESSAGES). It reads error.code out of the
// JSON body — the same {"error":{"code","message"}} envelope writeError
// already produces — and falls back to "S3 error: <code>" for anything
// unrecognised, so an unmapped code degrades to a vague message rather than
// a wrong one.
// "NotFound" is deliberately absent: S3 has two distinct not-found codes and
// which one applies depends on what the request addressed. A listing can only
// ever miss the bucket (NoSuchBucket); an object GET has already confirmed
// the bucket before it reads, so a miss there can only be the key
// (NoSuchKey). Each caller passes the one that is true for it — collapsing
// them into a single mapping here would tell the SDK the bucket is gone every
// time a file is merely absent.
var s3ErrorCodes = map[string]string{
	"AccessDenied":    "AccessDenied",
	"InvalidKey":      "InvalidArgument",
	"InvalidArgument": "InvalidArgument",
}

func s3ErrorCode(code, notFoundAs string) string {
	if code == "NotFound" {
		return notFoundAs
	}
	if mapped, ok := s3ErrorCodes[code]; ok {
		return mapped
	}
	return "InternalError"
}

// s3ProjectID reads the `project_id` QUERY parameter both S3 routes carry.
//
// The project is named in the query string, not a path segment — that is the
// SDK's wire format (_s3_params, client.py:1072) and cannot be changed from
// this side. A query parameter is caller-controlled input and is NOT trusted
// here as an authorization claim: both routes are mounted behind
// RequireResolvedPermissionsForProject with ProjectIDFromQuery("project_id")
// (see mountArtifactRoutes in internal/api/router.go), which resolves the
// caller's permissions IN that named project before the handler runs. A
// caller who names a project they hold no role in resolves to zero
// permissions and is refused with 403, so changing the query string cannot
// reach another tenant's artifacts. The handlers then scope every subsequent
// lookup to that same id.
//
// Returns the id in both forms the handlers need — int64 for the repository,
// the original string for storage refs — and writes the error itself when it
// is unusable.
func s3ProjectID(w http.ResponseWriter, r *http.Request) (int64, string, bool) {
	projectIDStr := r.URL.Query().Get("project_id")
	projectID, err := strconv.ParseInt(projectIDStr, 10, 64)
	if err != nil || projectID <= 0 {
		writeError(w, http.StatusBadRequest, "InvalidArgument", "project_id is required")
		return 0, "", false
	}
	return projectID, projectIDStr, true
}

// s3Bucket reads the bucket path parameter. The SDK lower-cases the bucket
// before building the URL (client.py:1105, :1176), so normalise here too
// rather than letting a differently-cased stored name miss.
func s3Bucket(r *http.Request) string {
	return strings.ToLower(chi.URLParam(r, "bucket"))
}

// requireS3Bucket is requireBucket rendered in the S3 error vocabulary: the
// SDK phrases NoSuchBucket specifically (S3_ERROR_MESSAGES, client.py:1061).
// Callers return immediately when ok is false.
func (h *Handler) requireS3Bucket(w http.ResponseWriter, r *http.Request, projectID int64, bucket string) bool {
	if _, err := h.repo.GetBucket(r.Context(), projectID, bucket); err != nil {
		if errors.Is(err, storage.ErrNotFound) {
			writeError(w, http.StatusNotFound, "NoSuchBucket", "bucket not found")
			return false
		}
		writeError(w, http.StatusInternalServerError, "InternalError", "get bucket: "+err.Error())
		return false
	}
	return true
}

// ListObjectsS3 answers the SDK's bucket listing.
func (h *Handler) ListObjectsS3(w http.ResponseWriter, r *http.Request) {
	projectID, projectIDStr, ok := s3ProjectID(w, r)
	if !ok {
		return
	}
	bucket := s3Bucket(r)

	// Same bucket resolution as the native route. A listing can only ever
	// fail on the bucket, never on a key.
	if !h.requireS3Bucket(w, r, projectID, bucket) {
		return
	}

	// list-type and format are accepted and ignored on purpose. The SDK
	// pins them to "2" and "json" on every call and this route serves
	// exactly one representation — a JSON, V2-style listing — so there is
	// nothing to select. Rejecting other values would add a failure mode
	// that only ever fires if the SDK changes its constants, and honouring
	// them would mean building an XML representation with no consumer.
	q, code, message := parseListObjectsQuery(r.URL.Query())
	if code != "" {
		writeError(w, statusForCode(code), s3ErrorCode(code, "NoSuchBucket"), message)
		return
	}

	// prefix and delimiter pass through unchanged. The SDK appends a
	// trailing "/" to a folder prefix itself, and omits delimiter entirely
	// for a recursive listing — an absent delimiter is the empty string,
	// which storage.List already treats as "do not group", so recursion
	// needs no special case here.
	page, err := h.listBucketObjects(r.Context(), projectIDStr, bucket, q)
	if err != nil {
		if errors.Is(err, errInvalidBucketRef) {
			writeError(w, http.StatusInternalServerError, "InternalError", "list objects: "+err.Error())
			return
		}
		writeError(w, statusForCode(storageErrorCode(err)), s3ErrorCode(storageErrorCode(err), "NoSuchBucket"), err.Error())
		return
	}

	contents := make([]s3ObjectSummary, 0, len(page.Objects))
	for _, o := range page.Objects {
		contents = append(contents, s3ObjectSummary{
			Key:          o.Key,
			Size:         o.Size,
			LastModified: o.LastModified,
			ETag:         o.ETag,
		})
	}
	commonPrefixes := page.CommonPrefixes
	if commonPrefixes == nil {
		commonPrefixes = []string{}
	}

	writeJSON(w, http.StatusOK, s3ListResponse{
		Contents:              contents,
		CommonPrefixes:        commonPrefixes,
		IsTruncated:           page.IsTruncated,
		NextContinuationToken: page.NextContinuationToken,
	})
}

// DownloadObjectS3 answers the SDK's object GET — the other half of an index
// run. The listing enumerates the bucket; this reads each file's bytes
// (elitea-sdk runtime/tools/artifact.py:_base_loader lists, then _extend_data
// downloads every listed key). Without it a run lists files correctly and
// then indexes them all with empty content, which is the same vacuous green
// as listing nothing.
//
// On success the body is the raw object bytes, NOT JSON: the SDK returns
// response.content unconditionally (client.py:1184) and hands it to a binary
// content parser. The `format=json` parameter it sends on every S3 call
// (_s3_params, client.py:1074) is therefore accepted and ignored here — this
// route has exactly one representation, and honouring `format` would mean
// base64-wrapping bytes no caller unwraps. JSON appears only in the error
// case, which is exactly what _handle_s3_error parses.
//
// Authorization is identical to the listing's — see s3ProjectID.
func (h *Handler) DownloadObjectS3(w http.ResponseWriter, r *http.Request) {
	projectID, projectIDStr, ok := s3ProjectID(w, r)
	if !ok {
		return
	}
	bucket := s3Bucket(r)

	// The key is the whole remaining path, captured by a trailing chi
	// wildcard rather than a single {key} segment: the SDK quotes the key
	// with safe='/' (client.py:1176), so a nested key like
	// "folder/sub/file.txt" arrives as literal path segments. This is the
	// same capture the native download route uses.
	key := objectKeyFromRequest(r)

	// Before the bucket lookup, matching DownloadObject: a malformed key is
	// caller error whether or not the bucket exists. storage.ErrInvalidKey
	// maps to the S3 InvalidArgument the SDK can phrase.
	ref, err := storage.NewObjectRef(projectIDStr, bucket, key)
	if err != nil {
		writeError(w, http.StatusBadRequest, "InvalidArgument", err.Error())
		return
	}

	if !h.requireS3Bucket(w, r, projectID, bucket) {
		return
	}

	// Past the bucket check, a not-found can only be the key — so this call
	// site, unlike the listing's, renders NotFound as NoSuchKey. The SDK
	// phrases that as "File '<key>' not found" (client.py:1062).
	if code, message := h.streamObject(w, r, ref, key); code != "" {
		writeError(w, statusForCode(code), s3ErrorCode(code, "NoSuchKey"), message)
	}
}
