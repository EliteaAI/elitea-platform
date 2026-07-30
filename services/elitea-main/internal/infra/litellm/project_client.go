package litellm

import (
	"context"
	"net/http"
	"net/url"
	"strconv"
)

const (
	currentAdminPageSize         = 100
	maxAdminListPages            = 100
	maxAdminListItems            = currentAdminPageSize * maxAdminListPages
	maxAdminModelMembershipItems = 1000
)

// TeamRecord is the current LiteLLM /v2/team/list shape used to discover a
// project's team before deleting it. Unknown response fields are ignored.
type TeamRecord struct {
	TeamID    string   `json:"team_id"`
	TeamAlias string   `json:"team_alias"`
	Models    []string `json:"models"`
}

// TeamCreateResult is the minimum current /team/new response contract.
type TeamCreateResult struct {
	TeamID string `json:"team_id"`
}

// KeyRecord is the current full-object /key/list shape used to identify and
// delete a project's key. Token is sensitive and must not be logged.
type KeyRecord struct {
	Token    string `json:"token"`
	KeyAlias string `json:"key_alias"`
	TeamID   string `json:"team_id"`
}

// KeyGenerateRequest is the current /key/generate request. Models may be nil
// for the general API, but project keys use ["all-team-models"].
type KeyGenerateRequest struct {
	KeyAlias string   `json:"key_alias"`
	TeamID   string   `json:"team_id"`
	Models   []string `json:"models,omitempty"`
}

// KeyGenerateResult contains the newly generated project key. The client does
// not retain it; the Configurations lifecycle owner must persist it securely.
type KeyGenerateResult struct {
	Key string `json:"key"`
}

// CreateTeam calls the current /team/new endpoint.
func (c *Client) CreateTeam(ctx context.Context, teamAlias string, models []string) (TeamCreateResult, error) {
	if !validAdminIdentifier(teamAlias) || !validModelMembership(models, false) {
		return TeamCreateResult{}, ErrInvalidRequest
	}
	payload := struct {
		TeamAlias string   `json:"team_alias"`
		Models    []string `json:"models"`
	}{TeamAlias: teamAlias, Models: models}
	var result TeamCreateResult
	if err := c.doJSON(ctx, "team create", http.MethodPost, "/team/new", "", nil, payload, &result); err != nil {
		return TeamCreateResult{}, err
	}
	if !validAdminIdentifier(result.TeamID) {
		return TeamCreateResult{}, ErrInvalidResponse
	}
	return result, nil
}

// ListTeams returns all bounded pages from the current /v2/team/list endpoint.
// An empty alias lists all teams; project deletion supplies an exact alias.
func (c *Client) ListTeams(ctx context.Context, teamAlias string) ([]TeamRecord, error) {
	if teamAlias != "" && !validAdminIdentifier(teamAlias) {
		return nil, ErrInvalidRequest
	}
	result := make([]TeamRecord, 0)
	for page := 1; page <= maxAdminListPages; page++ {
		query := url.Values{
			"page":      []string{strconv.Itoa(page)},
			"page_size": []string{strconv.Itoa(currentAdminPageSize)},
		}
		if teamAlias != "" {
			query.Set("team_alias", teamAlias)
		}
		var envelope struct {
			Teams      *[]TeamRecord `json:"teams"`
			TotalPages *int          `json:"total_pages"`
		}
		if err := c.doJSON(ctx, "team list", http.MethodGet, "/v2/team/list", "", query, nil, &envelope); err != nil {
			return nil, err
		}
		if envelope.Teams == nil || envelope.TotalPages == nil || *envelope.TotalPages < 0 {
			return nil, ErrInvalidResponse
		}
		if *envelope.TotalPages > maxAdminListPages || len(result)+len(*envelope.Teams) > maxAdminListItems {
			return nil, ErrResponseTooLarge
		}
		result = append(result, *envelope.Teams...)
		if page >= *envelope.TotalPages {
			return result, nil
		}
	}
	return nil, ErrResponseTooLarge
}

// DeleteTeam calls the current /team/delete endpoint for one discovered team.
func (c *Client) DeleteTeam(ctx context.Context, teamID string) error {
	if !validAdminIdentifier(teamID) {
		return ErrInvalidRequest
	}
	payload := struct {
		TeamIDs []string `json:"team_ids"`
	}{TeamIDs: []string{teamID}}
	return c.mutate(ctx, "team delete", http.MethodPost, "/team/delete", "", nil, payload)
}

// AddTeamModels adds explicit model membership to an existing team.
func (c *Client) AddTeamModels(ctx context.Context, teamID string, models []string) error {
	return c.mutateTeamModels(ctx, "team model add", "/team/model/add", teamID, models)
}

// DeleteTeamModels removes explicit model membership from an existing team.
func (c *Client) DeleteTeamModels(ctx context.Context, teamID string, models []string) error {
	return c.mutateTeamModels(ctx, "team model delete", "/team/model/delete", teamID, models)
}

func (c *Client) mutateTeamModels(ctx context.Context, operation, path, teamID string, models []string) error {
	if !validAdminIdentifier(teamID) || !validModelMembership(models, false) {
		return ErrInvalidRequest
	}
	payload := struct {
		TeamID string   `json:"team_id"`
		Models []string `json:"models"`
	}{TeamID: teamID, Models: models}
	return c.mutate(ctx, operation, http.MethodPost, path, "", nil, payload)
}

// GenerateKey calls the current /key/generate endpoint and returns the secret
// only to the lifecycle caller.
func (c *Client) GenerateKey(ctx context.Context, request KeyGenerateRequest) (KeyGenerateResult, error) {
	if !validAdminIdentifier(request.KeyAlias) || !validAdminIdentifier(request.TeamID) ||
		!validModelMembership(request.Models, true) {
		return KeyGenerateResult{}, ErrInvalidRequest
	}
	var result KeyGenerateResult
	if err := c.doJSON(ctx, "key generate", http.MethodPost, "/key/generate", "", nil, request, &result); err != nil {
		return KeyGenerateResult{}, err
	}
	if !validAdminIdentifier(result.Key) {
		return KeyGenerateResult{}, ErrInvalidResponse
	}
	return result, nil
}

// ListKeys returns all bounded full-object pages from the current /key/list
// endpoint. An empty team ID lists all keys.
func (c *Client) ListKeys(ctx context.Context, teamID string) ([]KeyRecord, error) {
	if teamID != "" && !validAdminIdentifier(teamID) {
		return nil, ErrInvalidRequest
	}
	result := make([]KeyRecord, 0)
	for page := 1; page <= maxAdminListPages; page++ {
		query := url.Values{
			"page":               []string{strconv.Itoa(page)},
			"return_full_object": []string{"true"},
			"size":               []string{strconv.Itoa(currentAdminPageSize)},
		}
		if teamID != "" {
			query.Set("team_id", teamID)
		}
		var envelope struct {
			Keys       *[]KeyRecord `json:"keys"`
			TotalPages *int         `json:"total_pages"`
		}
		if err := c.doJSON(ctx, "key list", http.MethodGet, "/key/list", "", query, nil, &envelope); err != nil {
			return nil, err
		}
		if envelope.Keys == nil || envelope.TotalPages == nil || *envelope.TotalPages < 0 {
			return nil, ErrInvalidResponse
		}
		if *envelope.TotalPages > maxAdminListPages || len(result)+len(*envelope.Keys) > maxAdminListItems {
			return nil, ErrResponseTooLarge
		}
		result = append(result, *envelope.Keys...)
		if page >= *envelope.TotalPages {
			return result, nil
		}
	}
	return nil, ErrResponseTooLarge
}

// DeleteKey calls the token-based current /key/delete contract. The token is
// included only in the bounded request body and never in returned errors.
func (c *Client) DeleteKey(ctx context.Context, token string) error {
	if !validAdminIdentifier(token) {
		return ErrInvalidRequest
	}
	payload := struct {
		Keys []string `json:"keys"`
	}{Keys: []string{token}}
	return c.mutate(ctx, "key delete", http.MethodPost, "/key/delete", "", nil, payload)
}

func validModelMembership(models []string, optional bool) bool {
	if len(models) == 0 {
		return optional && models == nil
	}
	if len(models) > maxAdminModelMembershipItems {
		return false
	}
	for _, model := range models {
		if !validAdminIdentifier(model) {
			return false
		}
	}
	return true
}
