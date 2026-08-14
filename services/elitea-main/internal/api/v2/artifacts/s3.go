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
var s3ErrorCodes = map[string]string{
	// A listing addresses exactly one resource — the bucket — so a
	// not-found surfacing from the storage layer can only mean the bucket,
	// never a key.
	"NotFound":        "NoSuchBucket",
	"AccessDenied":    "AccessDenied",
	"InvalidKey":      "InvalidArgument",
	"InvalidArgument": "InvalidArgument",
}

func s3ErrorCode(code string) string {
	if mapped, ok := s3ErrorCodes[code]; ok {
		return mapped
	}
	return "InternalError"
}

// ListObjectsS3 answers the SDK's bucket listing.
//
// The project is named by the `project_id` QUERY parameter, not a path
// segment — that is the SDK's wire format (_s3_params, client.py:1072) and
// cannot be changed from this side. A query parameter is caller-controlled
// input and is NOT trusted here as an authorization claim: the route is
// mounted behind RequireResolvedPermissionsForProject with
// ProjectIDFromQuery("project_id") (see mountArtifactRoutes in
// internal/api/router.go), which resolves the caller's permissions IN that
// named project before this handler runs. A caller who names a project they
// hold no role in resolves to zero permissions and is refused with 403, so
// changing the query string cannot reach another tenant's bucket. This
// handler then scopes every subsequent lookup to that same id.
func (h *Handler) ListObjectsS3(w http.ResponseWriter, r *http.Request) {
	projectIDStr := r.URL.Query().Get("project_id")
	projectID, err := strconv.ParseInt(projectIDStr, 10, 64)
	if err != nil || projectID <= 0 {
		writeError(w, http.StatusBadRequest, "InvalidArgument", "project_id is required")
		return
	}

	// The SDK lower-cases the bucket before building the URL
	// (client.py:1105), so normalise here too rather than letting a
	// differently-cased stored name miss.
	bucket := strings.ToLower(chi.URLParam(r, "bucket"))

	// Same bucket resolution as the native route, but rendered with the S3
	// code for a missing bucket: the SDK phrases NoSuchBucket specifically,
	// and a listing can only ever fail on the bucket, never on a key.
	if _, err := h.repo.GetBucket(r.Context(), projectID, bucket); err != nil {
		if errors.Is(err, storage.ErrNotFound) {
			writeError(w, http.StatusNotFound, "NoSuchBucket", "bucket not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "InternalError", "get bucket: "+err.Error())
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
		writeError(w, statusForCode(code), s3ErrorCode(code), message)
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
		writeError(w, statusForCode(storageErrorCode(err)), s3ErrorCode(storageErrorCode(err)), err.Error())
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
