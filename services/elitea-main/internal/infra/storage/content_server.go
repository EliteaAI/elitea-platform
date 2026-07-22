package storage

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"crypto/x509"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
)

const (
	defaultMaxInputContentBytes  = 256 * 1024
	defaultMaxContentRequests    = 16
	claimIDHeader                = "X-Elitea-Claim-Id"
	fenceHeader                  = "X-Elitea-Fence"
	SourceContentDigestHeader    = "X-Elitea-Source-Content-Digest"
	SourceContentLengthHeader    = "X-Elitea-Source-Content-Length"
	SourceImmutableVersionHeader = "X-Elitea-Source-Immutable-Version"
)

var (
	ErrContentUnauthorized = errors.New("input content authorization failed")
	ErrContentNotFound     = errors.New("input content not found")
	ErrContentRejected     = errors.New("input content materialization rejected")
	ErrContentUnavailable  = errors.New("input content materialization unavailable")
)

// ContentClaim is the complete claim-bound authorization input. The workload
// identity comes only from the verified peer certificate, never a forwarded
// user/project header.
type ContentClaim struct {
	PeerCertificate  *x509.Certificate
	ExecutionID      string
	Generation       uint64
	ClaimID          string
	FenceToken       []byte
	ContentID        string
	ImmutableVersion string
}

type ContentAuthorization struct {
	ResourceProjectID string
	InputBundleID     string
	CapabilityID      string
	SemanticRole      string
	ExpectedDigest    [sha256.Size]byte
	ExpectedLength    int64
}

// ContentAuthorizer validates workload identity, claim, generation, fence,
// content identity, and project ownership against the durable control state.
type ContentAuthorizer interface {
	AuthorizeContent(context.Context, ContentClaim) (ContentAuthorization, error)
}

// ContentStore opens immutable content only after authorization. Implementors
// must scope lookup by the authorized resource project.
type ContentStore interface {
	OpenContent(context.Context, string, string, string, string) (io.ReadCloser, error)
}

// ContentMaterializer derives one claim-scoped response from already verified
// immutable source bytes. It must not persist or publish the returned bytes.
// The source digest/version remain the durable execution input identity.
type ContentMaterializer interface {
	MaterializeContent(context.Context, ContentAuthorization, []byte, int64) ([]byte, error)
}

type ContentServer struct {
	authorizer   ContentAuthorizer
	store        ContentStore
	materializer ContentMaterializer
	maxBytes     int64
	requests     chan struct{}
}

func NewContentServer(authorizer ContentAuthorizer, store ContentStore, maxBytes int64) (*ContentServer, error) {
	return NewContentServerWithLimits(authorizer, store, maxBytes, defaultMaxContentRequests)
}

func NewContentServerWithLimits(authorizer ContentAuthorizer, store ContentStore, maxBytes int64, maxConcurrentRequests int) (*ContentServer, error) {
	return newContentServer(authorizer, store, nil, maxBytes, maxConcurrentRequests)
}

// NewMaterializingContentServerWithLimits extends the same private mTLS,
// claim, fence and audience authorization path with last-moment materialization.
// It intentionally does not expose a second authentication contract.
func NewMaterializingContentServerWithLimits(authorizer ContentAuthorizer, store ContentStore, materializer ContentMaterializer, maxBytes int64, maxConcurrentRequests int) (*ContentServer, error) {
	if materializer == nil {
		return nil, errors.New("content materializer is required")
	}
	return newContentServer(authorizer, store, materializer, maxBytes, maxConcurrentRequests)
}

func newContentServer(authorizer ContentAuthorizer, store ContentStore, materializer ContentMaterializer, maxBytes int64, maxConcurrentRequests int) (*ContentServer, error) {
	if authorizer == nil || store == nil {
		return nil, errors.New("content authorizer and store are required")
	}
	if maxBytes == 0 {
		maxBytes = defaultMaxInputContentBytes
	}
	if maxBytes < 1 || maxConcurrentRequests < 1 || maxConcurrentRequests > 1024 {
		return nil, errors.New("content size and concurrency limits must be positive and bounded")
	}
	return &ContentServer{
		authorizer:   authorizer,
		store:        store,
		materializer: materializer,
		maxBytes:     maxBytes,
		requests:     make(chan struct{}, maxConcurrentRequests),
	}, nil
}

// Routes exposes only the internal, claim-bound input data plane.
func (s *ContentServer) Routes() http.Handler {
	r := chi.NewRouter()
	r.Get("/executions/{executionID}/generations/{generation}/inputs/{contentID}/versions/{version}", s.Get)
	return r
}

func (s *ContentServer) Get(w http.ResponseWriter, r *http.Request) {
	select {
	case s.requests <- struct{}{}:
		defer func() { <-s.requests }()
	default:
		w.Header().Set("Retry-After", "1")
		http.Error(w, http.StatusText(http.StatusServiceUnavailable), http.StatusServiceUnavailable)
		return
	}
	claim, err := parseContentClaim(r)
	if err != nil {
		http.Error(w, http.StatusText(http.StatusUnauthorized), http.StatusUnauthorized)
		return
	}
	authorization, err := s.authorizer.AuthorizeContent(r.Context(), claim)
	if err != nil || authorization.ResourceProjectID == "" || authorization.InputBundleID == "" || authorization.CapabilityID == "" || authorization.SemanticRole == "" || authorization.ExpectedLength <= 0 {
		http.Error(w, http.StatusText(http.StatusForbidden), http.StatusForbidden)
		return
	}
	if authorization.ExpectedLength > s.maxBytes {
		http.Error(w, http.StatusText(http.StatusRequestEntityTooLarge), http.StatusRequestEntityTooLarge)
		return
	}

	content, err := s.store.OpenContent(
		r.Context(),
		authorization.ResourceProjectID,
		authorization.InputBundleID,
		claim.ContentID,
		claim.ImmutableVersion,
	)
	if errors.Is(err, ErrContentNotFound) {
		http.Error(w, http.StatusText(http.StatusNotFound), http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, http.StatusText(http.StatusInternalServerError), http.StatusInternalServerError)
		return
	}
	defer content.Close()

	// This validation slice is deliberately small. Buffering here lets the
	// server verify length/digest before sending any bytes to the worker; larger
	// artifact paths use a separately resumable streaming contract.
	data, err := io.ReadAll(io.LimitReader(content, s.maxBytes+1))
	if err != nil || int64(len(data)) != authorization.ExpectedLength || int64(len(data)) > s.maxBytes {
		http.Error(w, http.StatusText(http.StatusInternalServerError), http.StatusInternalServerError)
		return
	}
	digest := sha256.Sum256(data)
	if subtle.ConstantTimeCompare(digest[:], authorization.ExpectedDigest[:]) != 1 {
		http.Error(w, http.StatusText(http.StatusInternalServerError), http.StatusInternalServerError)
		return
	}

	responseData := data
	if s.materializer != nil {
		responseData, err = s.materializer.MaterializeContent(r.Context(), authorization, data, s.maxBytes)
		if err != nil {
			status := http.StatusServiceUnavailable
			if errors.Is(err, ErrContentRejected) {
				status = http.StatusUnprocessableEntity
			}
			http.Error(w, http.StatusText(status), status)
			return
		}
		if len(responseData) == 0 || int64(len(responseData)) > s.maxBytes {
			http.Error(w, http.StatusText(http.StatusUnprocessableEntity), http.StatusUnprocessableEntity)
			return
		}
	}
	responseDigest := sha256.Sum256(responseData)
	defer clearContentBytes(responseData)

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Length", strconv.Itoa(len(responseData)))
	w.Header().Set("Content-Digest", formatSHA256Digest(responseDigest))
	w.Header().Set(SourceContentDigestHeader, formatSHA256Digest(digest))
	w.Header().Set(SourceContentLengthHeader, strconv.FormatInt(authorization.ExpectedLength, 10))
	w.Header().Set(SourceImmutableVersionHeader, claim.ImmutableVersion)
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(responseData)
}

func formatSHA256Digest(digest [sha256.Size]byte) string {
	return "sha-256=:" + base64.StdEncoding.EncodeToString(digest[:]) + ":"
}

func clearContentBytes(value []byte) {
	for index := range value {
		value[index] = 0
	}
}

func parseContentClaim(r *http.Request) (ContentClaim, error) {
	if r.TLS == nil || len(r.TLS.VerifiedChains) == 0 || len(r.TLS.VerifiedChains[0]) == 0 {
		return ContentClaim{}, ErrContentUnauthorized
	}
	generation, err := strconv.ParseUint(chi.URLParam(r, "generation"), 10, 64)
	if err != nil || generation == 0 {
		return ContentClaim{}, ErrContentUnauthorized
	}
	fence, err := base64.RawURLEncoding.DecodeString(r.Header.Get(fenceHeader))
	if err != nil || len(fence) != sha256.Size {
		return ContentClaim{}, ErrContentUnauthorized
	}
	claim := ContentClaim{
		PeerCertificate:  r.TLS.VerifiedChains[0][0],
		ExecutionID:      chi.URLParam(r, "executionID"),
		Generation:       generation,
		ClaimID:          r.Header.Get(claimIDHeader),
		FenceToken:       fence,
		ContentID:        chi.URLParam(r, "contentID"),
		ImmutableVersion: chi.URLParam(r, "version"),
	}
	if claim.ExecutionID == "" || claim.ClaimID == "" || claim.ContentID == "" || claim.ImmutableVersion == "" {
		return ContentClaim{}, fmt.Errorf("%w: incomplete claim", ErrContentUnauthorized)
	}
	return claim, nil
}
