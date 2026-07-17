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
	defaultMaxInputContentBytes = 256 * 1024
	claimIDHeader               = "X-Elitea-Claim-Id"
	fenceHeader                 = "X-Elitea-Fence"
)

var (
	ErrContentUnauthorized = errors.New("input content authorization failed")
	ErrContentNotFound     = errors.New("input content not found")
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

type ContentServer struct {
	authorizer ContentAuthorizer
	store      ContentStore
	maxBytes   int64
}

func NewContentServer(authorizer ContentAuthorizer, store ContentStore, maxBytes int64) (*ContentServer, error) {
	if authorizer == nil || store == nil {
		return nil, errors.New("content authorizer and store are required")
	}
	if maxBytes == 0 {
		maxBytes = defaultMaxInputContentBytes
	}
	if maxBytes < 1 {
		return nil, errors.New("maximum content size must be positive")
	}
	return &ContentServer{authorizer: authorizer, store: store, maxBytes: maxBytes}, nil
}

// Routes exposes only the internal, claim-bound input data plane.
func (s *ContentServer) Routes() http.Handler {
	r := chi.NewRouter()
	r.Get("/executions/{executionID}/generations/{generation}/inputs/{contentID}/versions/{version}", s.Get)
	return r
}

func (s *ContentServer) Get(w http.ResponseWriter, r *http.Request) {
	claim, err := parseContentClaim(r)
	if err != nil {
		http.Error(w, http.StatusText(http.StatusUnauthorized), http.StatusUnauthorized)
		return
	}
	authorization, err := s.authorizer.AuthorizeContent(r.Context(), claim)
	if err != nil || authorization.ResourceProjectID == "" || authorization.InputBundleID == "" || authorization.ExpectedLength <= 0 {
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

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Length", strconv.FormatInt(authorization.ExpectedLength, 10))
	w.Header().Set("Content-Digest", "sha-256=:"+base64.StdEncoding.EncodeToString(digest[:])+":")
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
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
