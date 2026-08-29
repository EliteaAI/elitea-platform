package storage

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"net/url"
	"strconv"

	"github.com/go-chi/chi/v5"
)

const (
	defaultMaxInputContentBytes  = 256 * 1024
	defaultMaxContentRequests    = 16
	maxRuntimeGeneration         = uint64(1<<63 - 1)
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
	// ActorID is the exact durable execution_jobs.actor_id. Materializers own
	// any capability-specific interpretation, including current user lookup.
	ActorID           string
	InputBundleID     string
	CapabilityID      string
	SemanticRole      string
	ExpectedMediaType string
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
	authorizer      ContentAuthorizer
	store           ContentStore
	materializer    ContentMaterializer
	runtimeToken    *EliteaClientTokenService
	runtimeVersions *RuntimeApplicationVersionService
	maxBytes        int64
	requests        chan struct{}
	logger          *slog.Logger
}

func NewContentServer(authorizer ContentAuthorizer, store ContentStore, maxBytes int64) (*ContentServer, error) {
	return NewContentServerWithLimits(authorizer, store, maxBytes, defaultMaxContentRequests)
}

func NewContentServerWithLimits(authorizer ContentAuthorizer, store ContentStore, maxBytes int64, maxConcurrentRequests int) (*ContentServer, error) {
	return newContentServer(authorizer, store, nil, nil, nil, maxBytes, maxConcurrentRequests)
}

// NewMaterializingContentServerWithLimits extends the same private mTLS,
// claim, fence and audience authorization path with last-moment materialization.
// It intentionally does not expose a second authentication contract.
func NewMaterializingContentServerWithLimits(authorizer ContentAuthorizer, store ContentStore, materializer ContentMaterializer, maxBytes int64, maxConcurrentRequests int) (*ContentServer, error) {
	if materializer == nil {
		return nil, errors.New("content materializer is required")
	}
	return newContentServer(authorizer, store, materializer, nil, nil, maxBytes, maxConcurrentRequests)
}

// NewRuntimeContentServerWithLimits enables the private Elitea client-token
// compatibility context on the same bounded mTLS listener as immutable input
// reads. Configuration materialization is deliberately not composed here: it
// belongs behind the generic Configurations domain, not an index/provider
// specific switch.
func NewRuntimeContentServerWithLimits(
	authorizer ContentAuthorizer,
	store ContentStore,
	runtimeToken *EliteaClientTokenService,
	maxBytes int64,
	maxConcurrentRequests int,
) (*ContentServer, error) {
	if runtimeToken == nil {
		return nil, errors.New("runtime context is required")
	}
	return newContentServer(authorizer, store, nil, runtimeToken, nil, maxBytes, maxConcurrentRequests)
}

// NewMaterializingRuntimeContentServerWithLimits composes generic
// claim-scoped materialization and Elitea client-token compatibility on one
// bounded private mTLS listener.
func NewMaterializingRuntimeContentServerWithLimits(
	authorizer ContentAuthorizer,
	store ContentStore,
	materializer ContentMaterializer,
	runtimeToken *EliteaClientTokenService,
	maxBytes int64,
	maxConcurrentRequests int,
) (*ContentServer, error) {
	if materializer == nil {
		return nil, errors.New("content materializer is required")
	}
	if runtimeToken == nil {
		return nil, errors.New("runtime context is required")
	}
	return newContentServer(authorizer, store, materializer, runtimeToken, nil, maxBytes, maxConcurrentRequests)
}

// NewNestedAgentRuntimeContentServerWithLimits adds the nested application
// (agent-as-tool) definition route to the same bounded private mTLS listener.
//
// It is a separate constructor rather than an extra argument on the one above
// because the nested route is only meaningful where agent execution is
// dispatched: the index path composes the identical listener and must not grow
// a route it can never authorize. A nil version service leaves the route
// unregistered, which is what the index composition wants and what every
// pre-existing caller keeps.
func NewNestedAgentRuntimeContentServerWithLimits(
	authorizer ContentAuthorizer,
	store ContentStore,
	materializer ContentMaterializer,
	runtimeToken *EliteaClientTokenService,
	runtimeVersions *RuntimeApplicationVersionService,
	maxBytes int64,
	maxConcurrentRequests int,
) (*ContentServer, error) {
	if materializer == nil {
		return nil, errors.New("content materializer is required")
	}
	if runtimeToken == nil {
		return nil, errors.New("runtime context is required")
	}
	if runtimeVersions == nil {
		return nil, errors.New("runtime application version context is required")
	}
	return newContentServer(
		authorizer,
		store,
		materializer,
		runtimeToken,
		runtimeVersions,
		maxBytes,
		maxConcurrentRequests,
	)
}

func newContentServer(
	authorizer ContentAuthorizer,
	store ContentStore,
	materializer ContentMaterializer,
	runtimeToken *EliteaClientTokenService,
	runtimeVersions *RuntimeApplicationVersionService,
	maxBytes int64,
	maxConcurrentRequests int,
) (*ContentServer, error) {
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
		authorizer:      authorizer,
		store:           store,
		materializer:    materializer,
		runtimeToken:    runtimeToken,
		runtimeVersions: runtimeVersions,
		maxBytes:        maxBytes,
		requests:        make(chan struct{}, maxConcurrentRequests),
		logger:          slog.Default(),
	}, nil
}

// Routes exposes only the internal, claim-bound input data plane.
func (s *ContentServer) Routes() http.Handler {
	r := chi.NewRouter()
	r.Get("/executions/{executionID}/generations/{generation}/inputs/{contentID}/versions/{version}", s.Get)
	if s.runtimeToken != nil {
		r.Post("/executions/{executionID}/generations/{generation}/runtime-context/elitea-client-token", s.PostEliteaClientToken)
	}
	if s.runtimeVersions != nil {
		r.Post(
			"/executions/{executionID}/generations/{generation}/runtime-context/applications/{applicationID}/versions/{versionID}",
			s.PostApplicationVersion,
		)
	}
	return r
}

func (s *ContentServer) Get(w http.ResponseWriter, r *http.Request) {
	if !s.acquire(w) {
		return
	}
	defer s.release()
	claim, err := parseContentClaim(r)
	if err != nil {
		http.Error(w, http.StatusText(http.StatusUnauthorized), http.StatusUnauthorized)
		return
	}
	authorization, err := s.authorizer.AuthorizeContent(r.Context(), claim)
	if err != nil || authorization.ResourceProjectID == "" || authorization.InputBundleID == "" || authorization.CapabilityID == "" || authorization.SemanticRole == "" || authorization.ExpectedMediaType == "" || authorization.ExpectedLength <= 0 {
		http.Error(w, http.StatusText(http.StatusForbidden), http.StatusForbidden)
		return
	}
	mediaType, parameters, err := mime.ParseMediaType(authorization.ExpectedMediaType)
	if err != nil || mediaType != authorization.ExpectedMediaType || len(parameters) != 0 {
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
	defer func() {
		if closeErr := content.Close(); closeErr != nil {
			s.logger.WarnContext(r.Context(), "input content close failed")
		}
	}()

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

	w.Header().Set("Content-Type", authorization.ExpectedMediaType)
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

func (s *ContentServer) PostEliteaClientToken(w http.ResponseWriter, r *http.Request) {
	setPrivateNoCacheHeaders(w.Header())
	if !s.acquire(w) {
		return
	}
	defer s.release()
	if s.runtimeToken == nil || r.ContentLength != 0 || len(r.TransferEncoding) != 0 {
		http.Error(w, http.StatusText(http.StatusBadRequest), http.StatusBadRequest)
		return
	}
	claim, err := parseExecutionClaim(r)
	if err != nil {
		http.Error(w, http.StatusText(http.StatusUnauthorized), http.StatusUnauthorized)
		return
	}
	value, err := s.runtimeToken.Resolve(r.Context(), claim)
	if err != nil {
		status := http.StatusServiceUnavailable
		if errors.Is(err, ErrContentUnauthorized) {
			status = http.StatusForbidden
		} else if errors.Is(err, ErrContentUnavailable) {
			s.logger.WarnContext(
				r.Context(),
				"runtime context unavailable",
				"stage",
				runtimeContextUnavailableStage(err),
			)
		}
		http.Error(w, http.StatusText(status), status)
		return
	}
	encoded, err := json.Marshal(value)
	if err != nil || len(encoded) == 0 || len(encoded) > maxRuntimeContextResponseBytes {
		clearContentBytes(encoded)
		http.Error(w, http.StatusText(http.StatusServiceUnavailable), http.StatusServiceUnavailable)
		return
	}
	defer clearContentBytes(encoded)
	digest := sha256.Sum256(encoded)
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Length", strconv.Itoa(len(encoded)))
	w.Header().Set("Content-Digest", formatSHA256Digest(digest))
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(encoded)
}

// PostApplicationVersion serves one frozen nested (agent-as-tool) child
// definition under the live claim that already authorized the parent turn.
//
// It is the exact server twin of PostEliteaClientToken above — same claim
// parsing, same concurrency gate, same private-no-cache headers, same error
// taxonomy — and that symmetry is the point: the worker reaches both routes
// over one mTLS channel with one authority, and a route that authorized
// differently would be a second, weaker contract on the same connection.
func (s *ContentServer) PostApplicationVersion(w http.ResponseWriter, r *http.Request) {
	setPrivateNoCacheHeaders(w.Header())
	if !s.acquire(w) {
		return
	}
	defer s.release()
	if s.runtimeVersions == nil || r.ContentLength != 0 || len(r.TransferEncoding) != 0 {
		http.Error(w, http.StatusText(http.StatusBadRequest), http.StatusBadRequest)
		return
	}
	claim, err := parseExecutionClaim(r)
	if err != nil {
		http.Error(w, http.StatusText(http.StatusUnauthorized), http.StatusUnauthorized)
		return
	}
	applicationID, applicationIDOK := claimPathIdentity(r, "applicationID")
	versionID, versionIDOK := claimPathIdentity(r, "versionID")
	if !applicationIDOK || !versionIDOK {
		http.Error(w, http.StatusText(http.StatusBadRequest), http.StatusBadRequest)
		return
	}
	value, err := s.runtimeVersions.Resolve(r.Context(), claim, applicationID, versionID)
	if err != nil {
		status := http.StatusServiceUnavailable
		switch {
		case errors.Is(err, ErrContentUnauthorized):
			status = http.StatusForbidden
		case errors.Is(err, ErrContentNotFound):
			// The claim was good and the agent/version pair was not. Kept
			// distinct from 403 so an operator can tell a stale nested
			// reference from a rejected claim; the worker collapses both into
			// its own failure taxonomy either way.
			status = http.StatusNotFound
		case errors.Is(err, ErrContentUnavailable):
			s.logger.WarnContext(
				r.Context(),
				"nested application version unavailable",
				"stage",
				runtimeContextUnavailableStage(err),
			)
		}
		http.Error(w, http.StatusText(status), status)
		return
	}
	encoded, err := json.Marshal(value)
	if err != nil || len(encoded) == 0 || len(encoded) > maxRuntimeApplicationVersionResponseBytes {
		// Refused, never trimmed: the body is one indivisible definition, and a
		// truncated one would either fail the client's JSON decode or, worse,
		// parse into an agent missing tools its author attached.
		clearContentBytes(encoded)
		http.Error(w, http.StatusText(http.StatusServiceUnavailable), http.StatusServiceUnavailable)
		return
	}
	defer clearContentBytes(encoded)
	digest := sha256.Sum256(encoded)
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Length", strconv.Itoa(len(encoded)))
	w.Header().Set("Content-Digest", formatSHA256Digest(digest))
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusOK)
	if _, err := w.Write(encoded); err != nil {
		s.logger.WarnContext(r.Context(), "nested application version write failed")
	}
}

func (s *ContentServer) acquire(w http.ResponseWriter) bool {
	select {
	case s.requests <- struct{}{}:
		return true
	default:
		w.Header().Set("Retry-After", "1")
		http.Error(w, http.StatusText(http.StatusServiceUnavailable), http.StatusServiceUnavailable)
		return false
	}
}

func (s *ContentServer) release() {
	<-s.requests
}

func setPrivateNoCacheHeaders(header http.Header) {
	header.Set("Cache-Control", "no-store, no-cache, must-revalidate")
	header.Set("Pragma", "no-cache")
	header.Set("Expires", "0")
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
	claim, err := parseExecutionClaim(r)
	if err != nil {
		return ContentClaim{}, err
	}
	claim.ContentID, err = claimPathPart(r, "contentID")
	if err != nil {
		return ContentClaim{}, err
	}
	claim.ImmutableVersion, err = claimPathPart(r, "version")
	if err != nil {
		return ContentClaim{}, fmt.Errorf("%w: incomplete claim", ErrContentUnauthorized)
	}
	return claim, nil
}

func parseExecutionClaim(r *http.Request) (ContentClaim, error) {
	if r.TLS == nil || len(r.TLS.VerifiedChains) == 0 || len(r.TLS.VerifiedChains[0]) == 0 {
		return ContentClaim{}, ErrContentUnauthorized
	}
	generationText := chi.URLParam(r, "generation")
	generation, err := strconv.ParseUint(generationText, 10, 64)
	if err != nil || generation == 0 || generation > maxRuntimeGeneration || strconv.FormatUint(generation, 10) != generationText {
		return ContentClaim{}, ErrContentUnauthorized
	}
	claimID, claimIDOK := singleHeader(r.Header, claimIDHeader)
	fenceText, fenceOK := singleHeader(r.Header, fenceHeader)
	fence, err := base64.RawURLEncoding.DecodeString(fenceText)
	if !claimIDOK || !fenceOK || err != nil || len(fence) != sha256.Size || base64.RawURLEncoding.EncodeToString(fence) != fenceText {
		return ContentClaim{}, ErrContentUnauthorized
	}
	if !boundedClaimPart(claimID) {
		return ContentClaim{}, fmt.Errorf("%w: incomplete claim", ErrContentUnauthorized)
	}
	executionID, err := claimPathPart(r, "executionID")
	if err != nil {
		return ContentClaim{}, err
	}
	return ContentClaim{
		PeerCertificate: r.TLS.VerifiedChains[0][0],
		ExecutionID:     executionID,
		Generation:      generation,
		ClaimID:         claimID,
		FenceToken:      fence,
	}, nil
}

func claimPathPart(r *http.Request, name string) (string, error) {
	value, err := url.PathUnescape(chi.URLParam(r, name))
	if err != nil || !boundedClaimPart(value) {
		return "", fmt.Errorf("%w: incomplete claim", ErrContentUnauthorized)
	}
	return value, nil
}

// claimPathIdentity reads one canonical positive integer path segment.
//
// Canonical, not merely parseable: the worker formats these with plain
// `{application_id}` interpolation (runtime_context.rs:454-456), so "007" or
// "+7" never come from it. Admitting them would let two spellings of the same
// identity address one agent, and the response echoes the identity back for the
// client to compare (:554-564) — a comparison that only means something while
// exactly one spelling reaches the query.
func claimPathIdentity(r *http.Request, name string) (uint64, bool) {
	text := chi.URLParam(r, name)
	value, err := strconv.ParseUint(text, 10, 64)
	if err != nil || value == 0 || strconv.FormatUint(value, 10) != text {
		return 0, false
	}
	return value, true
}

func singleHeader(header http.Header, name string) (string, bool) {
	values := header.Values(name)
	if len(values) != 1 {
		return "", false
	}
	return values[0], true
}

func boundedClaimPart(value string) bool {
	if value == "" || len(value) > 256 {
		return false
	}
	for index := range len(value) {
		switch value[index] {
		case '\r', '\n', 0:
			return false
		}
	}
	return true
}
