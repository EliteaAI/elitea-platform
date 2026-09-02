package deepwiki

// Rewriting an invoke body before it crosses the hop (ADR-0022 decision 6).
//
// The client sends references; the provider receives material. Specifically:
//
//	code_toolkit: 42          →  code_toolkit: {github_configuration: {...}}
//	(nothing)                 →  llm_settings: {api_base, api_key, organization}
//
// Both substitutions are UNCONDITIONAL. A client that sends its own expanded
// code_toolkit dict, or its own llm_settings, is not honoured — those are the
// two fields that carry credentials, and a facade that accepted them would let
// any caller push a secret of their choosing to a service that then uses it to
// clone and to call back. What the client may choose is which configuration in
// their own project to use, and the platform expands it under the caller's own
// project membership.

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
	"github.com/go-chi/chi/v5"
)

// maxInvokeBodyBytes caps what is parsed. The real payload is a handful of
// small fields; anything larger is a client sending something this facade has
// no business rewriting, and reading it into memory to find that out is the
// failure mode worth avoiding.
const maxInvokeBodyBytes = 1 << 20

// ErrInvokeRejected reports a body the facade will not forward.
var ErrInvokeRejected = errors.New("DeepWiki invocation rejected")

// CallbackMinter mints the short-lived, project-bound bearer the provider
// calls back with. Satisfied by v2auth.CallbackTokenMinter; narrowed to what
// this package uses so the facade's tests do not need a database.
type CallbackMinter interface {
	Mint(ctx context.Context, ownerID, projectID int64, name string, lifetime time.Duration) (CallbackGrant, error)
	Revoke(ctx context.Context, ownerID int64, tokenUUID string) error
}

// CallbackGrant is one minted bearer, in this package's terms.
type CallbackGrant struct {
	Bearer  string
	Expires time.Time
	UUID    string
}

// InvokeRewriter turns a reference-carrying body into a material-carrying one.
type InvokeRewriter struct {
	credentials *CredentialResolver
	minter      CallbackMinter
	// callbackBase is the platform origin the provider calls back to. The
	// engine derives the artifact API base by STRIPPING `/llm/v1` off
	// api_base (artifacts_platform_client.extract_artifact_settings), so the
	// two are one value and cannot be configured apart.
	callbackBase string
	lifetime     time.Duration
}

// NewInvokeRewriter refuses one that cannot do its job.
func NewInvokeRewriter(
	credentials *CredentialResolver,
	minter CallbackMinter,
	callbackBase string,
	lifetime time.Duration,
) (*InvokeRewriter, error) {
	if credentials == nil || minter == nil {
		return nil, fmt.Errorf(
			"%w: a credential resolver and a callback minter are required",
			ErrCredentialsUnavailable)
	}
	base := strings.TrimRight(strings.TrimSpace(callbackBase), "/")
	if base == "" {
		return nil, fmt.Errorf(
			"%w: %s is required — the provider cannot call back to an unnamed origin",
			ErrCredentialsUnavailable, CallbackBaseURLEnv)
	}
	return &InvokeRewriter{
		credentials:  credentials,
		minter:       minter,
		callbackBase: base,
		lifetime:     lifetime,
	}, nil
}

// Rewrite reads the request body and returns the one to forward, plus the
// grant it minted so a failed hop can revoke it.
func (rw *InvokeRewriter) Rewrite(
	ctx context.Context,
	body io.Reader,
	projectID int64,
	userID int64,
) ([]byte, CallbackGrant, error) {
	raw, err := io.ReadAll(io.LimitReader(body, maxInvokeBodyBytes+1))
	if err != nil {
		return nil, CallbackGrant{}, fmt.Errorf("%w: %s", ErrInvokeRejected, err)
	}
	if len(raw) > maxInvokeBodyBytes {
		return nil, CallbackGrant{}, fmt.Errorf(
			"%w: body exceeds %d bytes", ErrInvokeRejected, maxInvokeBodyBytes)
	}

	var envelope map[string]json.RawMessage
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return nil, CallbackGrant{}, fmt.Errorf("%w: body is not a JSON object", ErrInvokeRejected)
	}

	parameters, configurationRest, err := invokeParameters(envelope)
	if err != nil {
		return nil, CallbackGrant{}, err
	}

	toolkitID, err := codeToolkitID(parameters)
	if err != nil {
		return nil, CallbackGrant{}, err
	}

	// The project id, narrowed at the point of narrowing.
	//
	// The route already bounds it (validProjectID), and this is deliberate
	// defence in depth for the reason repos.narrowRowID gives: it covers a
	// caller that does not come through that route — Rewrite is exported —
	// and unlike the boundary check it is local enough for CodeQL's dataflow
	// to see (go/incorrect-integer-conversion).
	//
	// Refusing rather than clamping: the configuration columns are Postgres
	// `integer`, so a value above MaxInt32 cannot name a row, and truncating
	// would silently resolve a DIFFERENT project's credentials.
	narrowedProject, ok := narrowProjectID(projectID)
	if !ok {
		return nil, CallbackGrant{}, fmt.Errorf(
			"%w: project %d is out of range", ErrToolkitNotResolvable, projectID)
	}

	// The credentials come first, and the token second. Resolution is the
	// step that refuses — an unknown toolkit, a host off the allowlist — and
	// minting before it would leave a live bearer behind for every refused
	// request, which is a credential issued for work that never happened.
	resolved, err := rw.credentials.Resolve(ctx, narrowedProject, toolkitID,
		stringParameter(parameters, "repository"),
		firstStringParameter(parameters, "active_branch", "branch", "base_branch"))
	if err != nil {
		return nil, CallbackGrant{}, err
	}

	grant, err := rw.minter.Mint(ctx, userID, projectID,
		fmt.Sprintf("deepwiki callback (project %d)", projectID), rw.lifetime)
	if err != nil {
		return nil, CallbackGrant{}, err
	}

	encodedToolkit, err := json.Marshal(resolved.Payload)
	if err != nil {
		return nil, grant, fmt.Errorf("%w: %s", ErrInvokeRejected, err)
	}
	parameters["code_toolkit"] = encodedToolkit

	settings, err := json.Marshal(rw.llmSettings(parameters, grant, projectID))
	if err != nil {
		return nil, grant, fmt.Errorf("%w: %s", ErrInvokeRejected, err)
	}
	parameters["llm_settings"] = settings

	encodedParameters, err := json.Marshal(parameters)
	if err != nil {
		return nil, grant, fmt.Errorf("%w: %s", ErrInvokeRejected, err)
	}
	configurationRest["parameters"] = encodedParameters

	encodedConfiguration, err := json.Marshal(configurationRest)
	if err != nil {
		return nil, grant, fmt.Errorf("%w: %s", ErrInvokeRejected, err)
	}
	envelope["configuration"] = encodedConfiguration

	rewritten, err := json.Marshal(envelope)
	if err != nil {
		return nil, grant, fmt.Errorf("%w: %s", ErrInvokeRejected, err)
	}
	return rewritten, grant, nil
}

// llmSettings builds the block the engine reads for BOTH its model calls and
// its artifact callbacks.
//
// One block, two uses, and that is the engine's design rather than a shortcut
// here: extract_artifact_settings derives the artifact base by stripping
// `/llm/v1` off api_base and takes project_id from `organization`. Splitting
// them would mean editing the engine, which this port does not do.
func (rw *InvokeRewriter) llmSettings(
	parameters map[string]json.RawMessage,
	grant CallbackGrant,
	projectID int64,
) map[string]any {
	settings := map[string]any{
		"api_base": rw.callbackBase + "/llm/v1",
		"api_key":  grant.Bearer,
		// The engine reads project_id from `organization` first. It is the
		// project the artifacts land in and the project the model calls bill,
		// and both must be the one in the path — not one the client names.
		"organization": fmt.Sprintf("%d", projectID),
	}
	// model_name is a caller choice, not a credential, so the caller's own
	// llm_model still decides it. Anything else the client put in llm_settings
	// is discarded with the block.
	if model := stringParameter(parameters, "llm_model"); model != "" {
		settings["model_name"] = model
	}
	return settings
}

// invokeParameters extracts configuration.parameters as a mutable map.
func invokeParameters(
	envelope map[string]json.RawMessage,
) (map[string]json.RawMessage, map[string]json.RawMessage, error) {
	configurationRest := map[string]json.RawMessage{}
	if encoded, ok := envelope["configuration"]; ok && !isJSONNull(encoded) {
		if err := json.Unmarshal(encoded, &configurationRest); err != nil {
			return nil, nil, fmt.Errorf(
				"%w: configuration is not an object", ErrInvokeRejected)
		}
	}
	parameters := map[string]json.RawMessage{}
	if encoded, ok := configurationRest["parameters"]; ok && !isJSONNull(encoded) {
		if err := json.Unmarshal(encoded, &parameters); err != nil {
			return nil, nil, fmt.Errorf(
				"%w: configuration.parameters is not an object", ErrInvokeRejected)
		}
	}
	return parameters, configurationRest, nil
}

// codeToolkitID reads the configuration id the caller named.
//
// A NUMBER, and only a number. The descriptor types this field Integer, and a
// client sending an expanded object instead is a client pushing its own
// credentials — refused rather than merged, because merging would leave the
// caller in control of which token the provider clones with.
func codeToolkitID(parameters map[string]json.RawMessage) (int32, error) {
	encoded, ok := parameters["code_toolkit"]
	if !ok || isJSONNull(encoded) {
		return 0, fmt.Errorf(
			"%w: configuration.parameters.code_toolkit is required", ErrInvokeRejected)
	}
	var id int32
	if err := json.Unmarshal(encoded, &id); err != nil {
		return 0, fmt.Errorf(
			"%w: code_toolkit must be a configuration id, not %s",
			ErrInvokeRejected, describeJSON(encoded))
	}
	if id <= 0 {
		return 0, fmt.Errorf("%w: code_toolkit %d is not a configuration id", ErrInvokeRejected, id)
	}
	return id, nil
}

// narrowProjectID converts to the width the configuration columns use, or
// refuses. See the call site for why refusing is the only correct answer.
func narrowProjectID(value int64) (int32, bool) {
	if value <= 0 || value > math.MaxInt32 {
		return 0, false
	}
	return int32(value), true
}

func stringParameter(parameters map[string]json.RawMessage, key string) string {
	encoded, ok := parameters[key]
	if !ok {
		return ""
	}
	var value string
	if err := json.Unmarshal(encoded, &value); err != nil {
		return ""
	}
	return strings.TrimSpace(value)
}

func firstStringParameter(parameters map[string]json.RawMessage, keys ...string) string {
	for _, key := range keys {
		if value := stringParameter(parameters, key); value != "" {
			return value
		}
	}
	return ""
}

func isJSONNull(raw json.RawMessage) bool {
	return len(bytes.TrimSpace(raw)) == 4 && bytes.Equal(bytes.TrimSpace(raw), []byte("null"))
}

// describeJSON names a value's kind for an error message, without echoing the
// value: the thing a client wrongly put in code_toolkit is exactly the thing
// most likely to be a secret.
func describeJSON(raw json.RawMessage) string {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 {
		return "nothing"
	}
	switch trimmed[0] {
	case '{':
		return "an object"
	case '[':
		return "an array"
	case '"':
		return "a string"
	default:
		return "that value"
	}
}

// invokeError maps a rewrite failure to a status a caller can act on.
func invokeError(err error) (int, string) {
	switch {
	case errors.Is(err, ErrEgressRefused):
		// The caller named a repository this deployment may not clone from.
		// Their input, their fix — but the message names the variable rather
		// than the allowlist's contents, which is an operator's business.
		return http.StatusForbidden,
			"This deployment may not clone from that repository host."
	case errors.Is(err, ErrToolkitNotResolvable):
		return http.StatusBadRequest,
			"The requested code toolkit is not a repository configuration in this project."
	case errors.Is(err, ErrInvokeRejected):
		return http.StatusBadRequest, "The invocation request could not be read."
	default:
		return http.StatusServiceUnavailable,
			"DeepWiki credentials could not be resolved."
	}
}

// invoke rewrites the body, forwards it, and revokes the minted bearer when
// the provider did not accept the invocation.
//
// REVOCATION IS THE POINT OF CAPTURING THE STATUS. A refused invoke leaves a
// live, project-bound credential behind for nothing: the work it was minted
// for will never run, and it stays valid until its TTL. It expires either way,
// so this is a narrowing rather than a guarantee — but it narrows the window
// from hours to nothing for the case that fails fastest and most often, a
// malformed or refused request.
func invoke(
	w http.ResponseWriter,
	r *http.Request,
	proxy *Proxy,
	rewriter *InvokeRewriter,
	logger *slog.Logger,
	providerPath string,
) {
	projectID, ok := pathProjectID(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "The project id is not valid.")
		return
	}
	userID := ownerIDFrom(r)
	if userID <= 0 {
		// A machine principal with no owning user cannot be given a callback
		// bearer: the token row must belong to somebody, and inventing an
		// owner would put a credential under a user who did not ask for it.
		writeError(w, http.StatusForbidden,
			"Starting a DeepWiki generation requires a user identity.")
		return
	}

	rewritten, grant, err := rewriter.Rewrite(r.Context(), r.Body, projectID, userID)
	if err != nil {
		if grant.UUID != "" {
			revoke(r.Context(), rewriter, logger, userID, grant.UUID)
		}
		status, message := invokeError(err)
		logger.Warn("deepwiki invoke rejected",
			"project", projectID, "status", status, "error", err)
		writeError(w, status, message)
		return
	}

	r.Body = io.NopCloser(bytes.NewReader(rewritten))
	r.ContentLength = int64(len(rewritten))
	r.Header.Set("Content-Type", "application/json")
	// A stale Content-Length from the original body would be forwarded
	// alongside the new one; the header and the field must agree.
	r.Header.Del("Content-Length")

	// The status is observed through the proxy's own ModifyResponse hook, not
	// by wrapping the ResponseWriter.
	//
	// A wrapper was the first shape, and it was worse in two ways. It has to
	// forward Flush or a streaming response stops streaming — a hazard this
	// route does not need to carry — and it puts a Write on a
	// caller-influenced response body, which CodeQL reads as a reflected-XSS
	// sink (go/reflected-xss). SecurityHeaders already sets nosniff in front
	// of every route, so the sink was not exploitable; ModifyResponse is
	// simply the seam the standard library provides for reading a proxied
	// status, and using it means there is no wrapper to reason about.
	status := proxy.ForwardObserved(w, r,
		providerPath, strconv.FormatInt(projectID, 10),
		strconv.FormatInt(userID, 10))

	// Zero means ModifyResponse never ran, which is a transport failure — the
	// provider was never reached, so the invocation certainly did not start.
	if status >= 400 || status == 0 {
		revoke(r.Context(), rewriter, logger, userID, grant.UUID)
	}
}

func revoke(
	ctx context.Context,
	rewriter *InvokeRewriter,
	logger *slog.Logger,
	userID int64,
	tokenUUID string,
) {
	if tokenUUID == "" {
		return
	}
	// context.WithoutCancel: the request context may already be done — a
	// client that disconnected is one of the cases that leaves a token behind
	// — and revoking is exactly the work that must still happen then.
	if err := rewriter.minter.Revoke(context.WithoutCancel(ctx), userID, tokenUUID); err != nil {
		logger.Warn("deepwiki callback token not revoked; it expires on its own",
			"token", tokenUUID, "error", err)
	}
}

func pathProjectID(r *http.Request) (int64, bool) {
	raw := chi.URLParam(r, "project_id")
	if !validProjectID(raw) {
		return 0, false
	}
	value, err := strconv.ParseInt(raw, 10, 64)
	return value, err == nil
}

// ownerIDFrom reads the database user a callback token can belong to.
func ownerIDFrom(r *http.Request) int64 {
	principal, ok := auth.RuntimePrincipalFromContext(r.Context())
	if !ok {
		return 0
	}
	owner, ok := principal.OwningUserID()
	if !ok {
		return 0
	}
	return owner
}
