package account

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/maximhq/bifrost/core/schemas"
)

// credential is a single provider credential row read from the project's
// configuration table. apiKeyRef is the stored api_key value, which may be a
// literal or a {{secret.NAME}} reference resolved through the Fernet vault; it
// is never logged.
type credential struct {
	configID string // configuration row id (used as the bifrost Key ID)
	name     string // human-readable label (elitea_title)
	apiBase  string // provider endpoint (subject to the self-referential guard)
	apiKeyRef string // stored api_key: literal or {{secret.NAME}} reference
}

// providerConfigTypes maps a bifrost provider to the p_{projectID}.configuration
// `type` values that represent a credential for it. Derived from the legacy
// runtime_interface_litellm configuration mappers (open_ai→OpenAI,
// azure_open_ai/open_ai_azure/ai_dial→Azure, ollama→Ollama,
// amazon_bedrock→Bedrock, vertex_ai→Vertex).
var providerConfigTypes = map[schemas.ModelProvider][]string{
	schemas.OpenAI:    {"open_ai"},
	schemas.Azure:     {"azure_open_ai", "open_ai_azure", "ai_dial"},
	schemas.Anthropic: {"anthropic"},
	schemas.Ollama:    {"ollama"},
	schemas.Bedrock:   {"amazon_bedrock"},
	schemas.Vertex:    {"vertex_ai"},
	schemas.VLLM:      {"vllm"},
}

// credentialData is the subset of a configuration row's JSONB `data` the account
// reads. api_key holds the credential secret (literal or {{secret.NAME}}); the
// legacy integration schema used api_token, so that name is accepted as a
// fallback for rows authored via the integration path.
type credentialData struct {
	APIBase  string `json:"api_base"`
	APIKey   string `json:"api_key"`
	APIToken string `json:"api_token"`
}

// credentialKeyRef returns the credential secret reference, preferring api_key
// and falling back to the legacy api_token field.
func (d credentialData) credentialKeyRef() string {
	if d.APIKey != "" {
		return d.APIKey
	}
	return d.APIToken
}

// loadCredentials reads the ai_credentials configuration rows for the given
// project and provider from p_{projectID}.configuration and decodes each row's
// `data` JSONB into a credential. Rows whose type does not map to a supported
// provider yield no results. No secret material is resolved here — that happens
// in GetKeysForProvider after the self-referential guard runs.
func (a *EliteaAccount) loadCredentials(ctx context.Context, projectID string, provider schemas.ModelProvider) ([]credential, error) {
	types, ok := providerConfigTypes[provider]
	if !ok || len(types) == 0 {
		return nil, nil
	}

	// projectID and the derived schema name come from a signed, server-resolved
	// header (never raw client input) and are validated numeric before use, so
	// the fmt-built schema identifier is not an injection vector.
	if err := validateProjectID(projectID); err != nil {
		return nil, err
	}
	schema := fmt.Sprintf("p_%s", projectID)

	q := fmt.Sprintf(`
		SELECT COALESCE(uuid::text, id::text), COALESCE(elitea_title, ''), data
		FROM %q.configuration
		WHERE section = 'ai_credentials' AND type = ANY($1) AND status_ok = true
		ORDER BY id`, schema)

	rows, err := a.db.Query(ctx, q, types)
	if err != nil {
		return nil, fmt.Errorf("query configuration: %w", err)
	}
	defer rows.Close()

	var creds []credential
	for rows.Next() {
		var (
			id, title string
			dataBytes []byte
		)
		if err := rows.Scan(&id, &title, &dataBytes); err != nil {
			return nil, fmt.Errorf("scan configuration row: %w", err)
		}
		var d credentialData
		if len(dataBytes) > 0 {
			if err := json.Unmarshal(dataBytes, &d); err != nil {
				// A malformed row must not poison the whole provider; skip it.
				a.logger.WarnContext(ctx, "skipping unparsable ai_credentials row",
					"project_id", projectID, "provider", string(provider), "config_id", id)
				continue
			}
		}
		creds = append(creds, credential{
			configID:  id,
			name:      title,
			apiBase:   d.APIBase,
			apiKeyRef: d.credentialKeyRef(),
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate configuration rows: %w", err)
	}
	return creds, nil
}

// validateProjectID rejects a projectID that is not a positive integer. The
// schema name is interpolated into SQL, so this guards against a malformed or
// hostile value reaching the query even though the id is server-resolved.
func validateProjectID(projectID string) error {
	if projectID == "" {
		return fmt.Errorf("empty project id")
	}
	for _, r := range projectID {
		if r < '0' || r > '9' {
			return fmt.Errorf("invalid project id %q: must be numeric", projectID)
		}
	}
	return nil
}
