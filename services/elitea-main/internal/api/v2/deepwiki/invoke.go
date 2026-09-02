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
//
// THE MECHANICS ARE NO LONGER HERE. The bounded read, the
// `configuration.parameters` split, the callback block and its tool-level
// lift, and the invoke handler that revokes a refused invocation's grant all
// live in internal/providerhost/material, because Inventory does the same six
// things to different field names. What is left in this file is the two names
// DeepWiki rewrites.

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/providerhost/material"
)

// ErrInvokeRejected reports a body the facade will not forward. It is the
// shared sentinel: a caller matching on it matches every facade's refusal.
var ErrInvokeRejected = material.ErrRejected

// CallbackMinter mints the short-lived, project-bound bearer the provider
// calls back with.
type CallbackMinter = material.Minter

// CallbackGrant is one minted bearer.
type CallbackGrant = material.Grant

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
	envelope, err := material.Read(body)
	if err != nil {
		return nil, CallbackGrant{}, err
	}
	parameters := envelope.Parameters()

	toolkitID, err := material.RowID(
		parameters["code_toolkit"], "configuration.parameters.code_toolkit")
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
	narrowedProject, ok := material.NarrowRowID(projectID)
	if !ok {
		return nil, CallbackGrant{}, fmt.Errorf(
			"%w: project %d is out of range", ErrToolkitNotResolvable, projectID)
	}

	// The credentials come first, and the token second. Resolution is the
	// step that refuses — an unknown toolkit, a host off the allowlist — and
	// minting before it would leave a live bearer behind for every refused
	// request, which is a credential issued for work that never happened.
	resolved, err := rw.credentials.Resolve(ctx, narrowedProject, toolkitID,
		material.String(parameters, "repository"),
		material.FirstString(parameters, "active_branch", "branch", "base_branch"))
	if err != nil {
		return nil, CallbackGrant{}, err
	}

	grant, err := rw.minter.Mint(ctx, userID, projectID,
		fmt.Sprintf("deepwiki callback (project %d)", projectID), rw.lifetime)
	if err != nil {
		return nil, CallbackGrant{}, err
	}

	if err := envelope.Set("code_toolkit", resolved.Payload); err != nil {
		return nil, grant, err
	}

	block := material.CallbackSettings(rw.callbackBase, grant, projectID,
		material.String(parameters, "llm_model"))
	if err := envelope.LiftToolLLMSettings(block); err != nil {
		return nil, grant, err
	}
	if err := envelope.Set("llm_settings", block); err != nil {
		return nil, grant, err
	}

	rewritten, err := envelope.Encode()
	if err != nil {
		return nil, grant, err
	}
	return rewritten, grant, nil
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
